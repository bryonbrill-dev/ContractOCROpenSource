"""Contract OCR & renewal tracker FastAPI application."""

from processor import process_contract

import os
import json
import uuid
import hashlib
import hmac
import secrets
import smtplib
import sqlite3
import logging
import traceback
import secrets
import hmac
import urllib.parse
import urllib.request
from datetime import datetime, date, timedelta
from email.message import EmailMessage
from typing import Optional, List, Literal, Dict, Any

from fastapi import FastAPI, UploadFile, File, HTTPException, Request, Depends, Response
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
from dotenv import load_dotenv
import jwt

load_dotenv()

# ----------------------------
# Paths / config
# ----------------------------
DB_PATH = os.environ.get("CONTRACT_DB", r"C:\ContractOCR\data\contracts.db")
DATA_ROOT = os.environ.get("CONTRACT_DATA", r"C:\ContractOCR\data\originals")
LOG_DIR = os.environ.get("CONTRACT_LOG", r"C:\ContractOCR\log")
TESSERACT_CMD = os.environ.get(
    "TESSERACT_CMD", r"C:\Program Files\Tesseract-OCR\tesseract.exe"
)
POPPLER_PATH = os.environ.get("POPPLER_PATH", r"C:\poppler-25.12.0\Library\bin")

os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
os.makedirs(DATA_ROOT, exist_ok=True)
os.makedirs(LOG_DIR, exist_ok=True)

LOG_FILE = os.path.join(LOG_DIR, "contractocr.log")

# ----------------------------
# Logging
# ----------------------------
logger = logging.getLogger("contractocr")
logger.setLevel(logging.INFO)

if not logger.handlers:
    fh = logging.FileHandler(LOG_FILE, encoding="utf-8")
    fmt = logging.Formatter("%(asctime)s | %(levelname)s | %(message)s")
    fh.setFormatter(fmt)
    logger.addHandler(fh)

    ch = logging.StreamHandler()
    ch.setFormatter(fmt)
    logger.addHandler(ch)

# ----------------------------
# App + CORS
# ----------------------------
app = FastAPI(title="Contract OCR & Renewal Tracker")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # adjust to specific origins if desired
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------------------
# Agreement types (LinkSquares-style)
# ----------------------------
AGREEMENT_TYPES = [
    "Addendum",
    "Amendment",
    "Assignment",
    "Business Associate Agreement",
    "Certificate of Insurance",
    "CNDA",
    "Consent Agreement",
    "Consulting Agreement",
    "Contract Agreement",
    "Corporate Agreement",
    "Data Agreement",
    "Employment Agreement",
    "Financial Agreement",
    "Letter",
    "Master Agreement",
    "Mutual Non Disclosure Agreement",
    "Non Disclosure Agreement",
    "Order Form",
    "Property Agreement",
    "Publishing Agreement",
    "Reference",
    "Release Agreement",
    "Requisition Document",
    "Sales Agreement",
    "Service Agreement",
    "Statement of Work",
    "Terms and Conditions",
    "Uncategorized",
]

# ----------------------------
# Startup / Shutdown / Middleware
# ----------------------------
@app.on_event("startup")
def _startup():
    logger.info(f"APP START pid={os.getpid()}")
    logger.info(f"POPPLER_PATH: {POPPLER_PATH}")
    logger.info(f"TESSERACT_CMD: {TESSERACT_CMD}")

    if not os.path.exists(TESSERACT_CMD):
        logger.error(f"Tesseract not found at: {TESSERACT_CMD}")

    if POPPLER_PATH:
        pdfinfo = os.path.join(POPPLER_PATH, "pdfinfo.exe")
        pdftoppm = os.path.join(POPPLER_PATH, "pdftoppm.exe")
        if not os.path.exists(pdfinfo):
            logger.error(f"pdfinfo.exe not found at: {pdfinfo}")
        if not os.path.exists(pdftoppm):
            logger.error(f"pdftoppm.exe not found at: {pdftoppm}")

    init_db()
    logger.info("APP READY")


@app.on_event("shutdown")
def _shutdown():
    logger.info("APP SHUTDOWN")


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = datetime.utcnow()
    try:
        response = await call_next(request)
        ms = int((datetime.utcnow() - start).total_seconds() * 1000)
        logger.info(f"{request.method} {request.url.path} -> {response.status_code} ({ms}ms)")
        return response
    except Exception:
        ms = int((datetime.utcnow() - start).total_seconds() * 1000)
        logger.error(
            f"{request.method} {request.url.path} -> 500 ({ms}ms)\n{traceback.format_exc()}"
        )
        return JSONResponse(status_code=500, content={"detail": "Internal Server Error"})


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(
        f"UNHANDLED EXCEPTION {request.method} {request.url.path}\n{traceback.format_exc()}"
    )
    return JSONResponse(status_code=500, content={"detail": str(exc)})

# ----------------------------
# DB helpers
# ----------------------------
def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def safe_filename(name: str) -> str:
    keep = "._- ()[]{}"
    return "".join(c for c in name if c.isalnum() or c in keep).strip()[:180] or "upload.bin"


def safe_json_list(value: Optional[str]) -> List[str]:
    if not value:
        return []
    try:
        data = json.loads(value)
    except json.JSONDecodeError:
        return []
    if isinstance(data, list):
        return [str(item) for item in data]
    return []


def safe_json_int_list(value: Optional[str]) -> List[int]:
    if not value:
        return []
    try:
        data = json.loads(value)
    except json.JSONDecodeError:
        return []
    if isinstance(data, list):
        cleaned: List[int] = []
        for item in data:
            try:
                cleaned.append(int(item))
            except (TypeError, ValueError):
                continue
        return cleaned
    return []


def _table_has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(row["name"] == column for row in rows)


def _get_user_role_ids(conn: sqlite3.Connection, user_id: int) -> List[int]:
    rows = conn.execute(
        "SELECT role_id FROM auth_user_roles WHERE user_id = ?",
        (user_id,),
    ).fetchall()
    return [row["role_id"] for row in rows]


def _validate_role_ids(conn: sqlite3.Connection, role_ids: List[int]) -> List[int]:
    if not role_ids:
        return []
    unique_ids = sorted(set(role_ids))
    placeholders = ",".join("?" for _ in unique_ids)
    rows = conn.execute(
        f"SELECT id FROM auth_roles WHERE id IN ({placeholders})",
        tuple(unique_ids),
    ).fetchall()
    found = {row["id"] for row in rows}
    missing = [role_id for role_id in unique_ids if role_id not in found]
    if missing:
        missing_list = ", ".join(str(role_id) for role_id in missing)
        raise HTTPException(status_code=400, detail=f"Unknown role id(s): {missing_list}")
    return unique_ids


def _set_user_roles(conn: sqlite3.Connection, user_id: int, role_ids: List[int]) -> None:
    conn.execute("DELETE FROM auth_user_roles WHERE user_id = ?", (user_id,))
    if not role_ids:
        return
    now = now_iso()
    if _table_has_column(conn, "auth_user_roles", "created_at"):
        conn.executemany(
            """
            INSERT INTO auth_user_roles (user_id, role_id, created_at)
            VALUES (?, ?, ?)
            """,
            [(user_id, role_id, now) for role_id in role_ids],
        )
    else:
        conn.executemany(
            "INSERT INTO auth_user_roles (user_id, role_id) VALUES (?, ?)",
            [(user_id, role_id) for role_id in role_ids],
        )


def _load_role_recipients(conn: sqlite3.Connection, role_ids: List[int]) -> List[str]:
    if not role_ids:
        return []
    placeholders = ",".join("?" for _ in role_ids)
    rows = conn.execute(
        f"""
        SELECT DISTINCT u.email
        FROM auth_users u
        JOIN auth_user_roles ur ON ur.user_id = u.id
        WHERE u.is_active = 1 AND ur.role_id IN ({placeholders})
        """,
        tuple(role_ids),
    ).fetchall()
    return [row["email"] for row in rows if row["email"]]


def _env_bool(key: str, default: bool = False) -> bool:
    raw = os.environ.get(key)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_first(*keys: str) -> str:
    for key in keys:
        value = os.getenv(key)
        if value:
            cleaned = value.strip()
            if cleaned and cleaned not in {key, f"{key}_PLACEHOLDER"}:
                return cleaned
    return ""


def hash_password(password: str, salt: Optional[str] = None) -> str:
    if not password:
        raise ValueError("password is required")
    if not salt:
        salt = secrets.token_hex(16)
    iterations = 200_000
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        bytes.fromhex(salt),
        iterations,
    )
    return f"pbkdf2_sha256${iterations}${salt}${digest.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    if not password or not stored_hash:
        return False
    try:
        scheme, iter_raw, salt, digest = stored_hash.split("$", 3)
    except ValueError:
        return False
    if scheme != "pbkdf2_sha256":
        return False
    try:
        iterations = int(iter_raw)
    except ValueError:
        return False
    computed = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        bytes.fromhex(salt),
        iterations,
    ).hex()
    return hmac.compare_digest(computed, digest)


AUTH_REQUIRED = _env_bool("AUTH_REQUIRED", False)
AUTH_COOKIE_NAME = os.environ.get("AUTH_COOKIE_NAME", "contractocr_session")
AUTH_COOKIE_SECURE = _env_bool("AUTH_COOKIE_SECURE", False)
try:
    AUTH_SESSION_DAYS = int(os.environ.get("AUTH_SESSION_DAYS", "7"))
except ValueError:
    AUTH_SESSION_DAYS = 7

OIDC_CLIENT_ID = _env_first("OIDC_CLIENT_ID", "AZURE_AD_CLIENT_ID")
OIDC_TENANT_ID = _env_first("OIDC_TENANT_ID", "AZURE_AD_TENANT_ID")
OIDC_CLIENT_SECRET = _env_first("OIDC_CLIENT_SECRET", "AZURE_AD_CLIENT_SECRET")
OIDC_REDIRECT_URI = _env_first("OIDC_REDIRECT_URI", "AZURE_AD_REDIRECT_URI")
OIDC_DEFAULT_ROLE_NAMES = [
    name.strip()
    for name in _env_first("OIDC_DEFAULT_ROLE_NAMES").split(",")
    if name.strip()
] or ["user"]
OIDC_SCOPES = _env_first("OIDC_SCOPES") or "openid profile email"
try:
    OIDC_STATE_TTL_MINUTES = int(os.environ.get("OIDC_STATE_TTL_MINUTES", "10"))
except ValueError:
    OIDC_STATE_TTL_MINUTES = 10
OIDC_ENABLED = bool(OIDC_CLIENT_ID and OIDC_TENANT_ID and OIDC_CLIENT_SECRET and OIDC_REDIRECT_URI)

_OIDC_CONFIG_CACHE: Dict[str, Any] = {}
_OIDC_JWKS_CACHE: Dict[str, Dict[str, Any]] = {}


def init_db():
    with db() as conn:
        conn.executescript(SCHEMA_SQL)
        conn.executescript(SEED_TERMS_SQL)
        conn.executescript(SEED_TAGS_SQL)
        _apply_migrations(conn)


def _apply_migrations(conn: sqlite3.Connection) -> None:
    """Apply simple, idempotent schema migrations for existing databases."""

    def has_column(table: str, column: str) -> bool:
        rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
        return any(r["name"].lower() == column.lower() for r in rows)

    def has_table(table: str) -> bool:
        row = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
            (table,),
        ).fetchone()
        return row is not None

    if not has_column("contracts", "agreement_type"):
        conn.execute(
            "ALTER TABLE contracts ADD COLUMN agreement_type TEXT"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_contracts_agreement_type ON contracts(agreement_type)"
        )

    conn.execute("CREATE INDEX IF NOT EXISTS idx_contracts_title ON contracts(title)")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_contracts_original_filename ON contracts(original_filename)"
    )

    if not has_table("tag_roles"):
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS tag_roles (
              tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
              role_id INTEGER NOT NULL REFERENCES auth_roles(id) ON DELETE CASCADE,
              created_at TEXT NOT NULL,
              PRIMARY KEY (tag_id, role_id)
            );
            CREATE INDEX IF NOT EXISTS idx_tag_roles_tag ON tag_roles(tag_id);
            CREATE INDEX IF NOT EXISTS idx_tag_roles_role ON tag_roles(role_id);
            """
        )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS notification_users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_notification_users_email_lower
        ON notification_users(lower(email))
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_notification_users_name ON notification_users(name)"
    )
    existing = conn.execute("SELECT COUNT(1) AS count FROM notification_users").fetchone()
    if existing and existing["count"] == 0:
        conn.executemany(
            "INSERT OR IGNORE INTO notification_users (name, email, created_at) VALUES (?, ?, ?)",
            [(u["name"], u["email"], now_iso()) for u in DEFAULT_NOTIFICATION_USERS],
        )

    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS auth_users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS ux_auth_users_email_lower
          ON auth_users(lower(email));

        CREATE TABLE IF NOT EXISTS auth_roles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS auth_user_roles (
          user_id INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
          role_id INTEGER NOT NULL REFERENCES auth_roles(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          PRIMARY KEY (user_id, role_id)
        );
        CREATE INDEX IF NOT EXISTS idx_auth_user_roles_user ON auth_user_roles(user_id);
        CREATE INDEX IF NOT EXISTS idx_auth_user_roles_role ON auth_user_roles(role_id);

        CREATE TABLE IF NOT EXISTS auth_sessions (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);

        CREATE TABLE IF NOT EXISTS auth_oidc_states (
          state TEXT PRIMARY KEY,
          nonce TEXT NOT NULL,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_auth_oidc_states_expires ON auth_oidc_states(expires_at);
        """
    )

    conn.execute(
        "INSERT OR IGNORE INTO auth_roles (name, created_at) VALUES (?, ?)",
        ("admin", now_iso()),
    )
    admin_email = _env_first("ADMIN_EMAIL", "CONTRACT_ADMIN_EMAIL").strip().lower()
    admin_password = _env_first("ADMIN_PASSWORD", "CONTRACT_ADMIN_PASSWORD").strip()
    admin_name = _env_first("ADMIN_NAME", "CONTRACT_ADMIN_NAME") or "Admin"
    if not admin_email:
        admin_email = "admin@local.com"
    if not admin_password:
        admin_password = "password"
    if admin_email and admin_password:
        row = conn.execute(
            "SELECT id FROM auth_users WHERE lower(email) = ?",
            (admin_email,),
        ).fetchone()
        if row:
            user_id = row["id"]
        else:
            now = now_iso()
            password_hash = hash_password(admin_password)
            cur = conn.execute(
                """
                INSERT INTO auth_users
                  (name, email, password_hash, is_active, created_at, updated_at)
                VALUES (?, ?, ?, 1, ?, ?)
                """,
                (admin_name, admin_email, password_hash, now, now),
            )
            user_id = cur.lastrowid
        role_row = conn.execute(
            "SELECT id FROM auth_roles WHERE name = ?",
            ("admin",),
        ).fetchone()
        if role_row and user_id:
            conn.execute(
                """
                INSERT OR IGNORE INTO auth_user_roles (user_id, role_id, created_at)
                VALUES (?, ?, ?)
                """,
                (user_id, role_row["id"], now_iso()),
            )

    if not has_table("notification_logs"):
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS notification_logs (
              id TEXT PRIMARY KEY,
              kind TEXT NOT NULL,
              recipients_json TEXT NOT NULL,
              subject TEXT NOT NULL,
              body TEXT NOT NULL,
              status TEXT NOT NULL,
              error TEXT,
              related_id TEXT,
              metadata_json TEXT,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at ON notification_logs(created_at);
            CREATE INDEX IF NOT EXISTS idx_notification_logs_kind ON notification_logs(kind);
            CREATE INDEX IF NOT EXISTS idx_notification_logs_status ON notification_logs(status);
            """
        )

    if not has_table("pending_agreements"):
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS pending_agreements (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              owner TEXT NOT NULL,
              owner_email TEXT,
              contract_id TEXT,
              due_date TEXT,
              status TEXT,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_pending_agreements_created_at
              ON pending_agreements(created_at);
            """
        )
    else:
        if not has_column("pending_agreements", "owner_email"):
            conn.execute("ALTER TABLE pending_agreements ADD COLUMN owner_email TEXT")
        if not has_column("pending_agreements", "contract_id"):
            conn.execute("ALTER TABLE pending_agreements ADD COLUMN contract_id TEXT")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_pending_agreements_contract_id ON pending_agreements(contract_id)"
        )

    if not has_table("pending_agreement_reminders"):
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS pending_agreement_reminders (
              id TEXT PRIMARY KEY,
              frequency TEXT NOT NULL,
              roles_json TEXT NOT NULL,
              recipients_json TEXT NOT NULL,
              message TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_pending_agreement_reminders_created_at
              ON pending_agreement_reminders(created_at);
            """
        )

    if not has_table("tasks"):
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS tasks (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              description TEXT,
              due_date TEXT NOT NULL,
              recurrence TEXT NOT NULL DEFAULT 'none',
              reminders_json TEXT NOT NULL,
              assignees_json TEXT NOT NULL,
              completed INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_tasks_created_at
              ON tasks(created_at);
            CREATE INDEX IF NOT EXISTS idx_tasks_completed
              ON tasks(completed);
            """
        )

# ----------------------------
# Models
# ----------------------------
SearchMode = Literal["quick", "terms", "fulltext"]


class ReminderUpdate(BaseModel):
    recipients: List[str] = Field(default_factory=list)
    offsets: List[int] = Field(default_factory=lambda: [90, 60, 30, 7, 0])
    enabled: bool = True

    @field_validator("recipients", mode="before")
    def normalize_recipients(cls, value):
        if value is None:
            return []
        if isinstance(value, str):
            value = value.split(",")
        if isinstance(value, (list, tuple)):
            return [str(v).strip() for v in value if str(v).strip()]
        return []

    @field_validator("offsets", mode="before")
    def normalize_offsets(cls, value):
        if value is None:
            return []
        if isinstance(value, str):
            value = value.split(",")
        if isinstance(value, (list, tuple)):
            cleaned = []
            for v in value:
                try:
                    cleaned.append(int(v))
                except (TypeError, ValueError):
                    continue
            return cleaned
        return []


class UploadResponse(BaseModel):
    contract_id: str
    title: str
    stored_path: str
    sha256: str
    status: str


class TagCreate(BaseModel):
    name: str
    color: str = "#3b82f6"


class TagUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None


class NotificationUserCreate(BaseModel):
    name: str
    email: str

    @field_validator("name", mode="before")
    def normalize_name(cls, value: str) -> str:
        return str(value or "").strip()

    @field_validator("email", mode="before")
    def normalize_email(cls, value: str) -> str:
        return str(value or "").strip().lower()


class NotificationUser(BaseModel):
    id: int
    name: str
    email: str


class AuthLogin(BaseModel):
    email: str
    password: str

    @field_validator("email", mode="before")
    def normalize_email(cls, value: str) -> str:
        return str(value or "").strip().lower()


class AuthUserOut(BaseModel):
    id: int
    name: str
    email: str
    roles: List[str] = Field(default_factory=list)


class AdminUserCreate(BaseModel):
    name: str
    email: str
    password: str
    roles: List[int] = Field(default_factory=list)
    is_active: bool = True
    is_admin: bool = False

    @field_validator("name", mode="before")
    def normalize_name(cls, value: str) -> str:
        return str(value or "").strip()

    @field_validator("email", mode="before")
    def normalize_email(cls, value: str) -> str:
        return str(value or "").strip().lower()

    @field_validator("roles", mode="before")
    def normalize_roles(cls, value):
        if value is None:
            return []
        if isinstance(value, str):
            value = value.split(",")
        if isinstance(value, (list, tuple)):
            cleaned = [str(v).strip() for v in value if str(v).strip()]
            try:
                return [int(v) for v in cleaned]
            except ValueError as exc:
                raise ValueError("role IDs must be integers") from exc
        return []


class AdminUserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    roles: Optional[List[int]] = None
    is_active: Optional[bool] = None
    is_admin: Optional[bool] = None

    @field_validator("name", mode="before")
    def normalize_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return str(value or "").strip()

    @field_validator("email", mode="before")
    def normalize_email(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return str(value or "").strip().lower()

    @field_validator("roles", mode="before")
    def normalize_roles(cls, value):
        if value is None:
            return None
        if isinstance(value, str):
            value = value.split(",")
        if isinstance(value, (list, tuple)):
            cleaned = [str(v).strip() for v in value if str(v).strip()]
            try:
                return [int(v) for v in cleaned]
            except ValueError as exc:
                raise ValueError("role IDs must be integers") from exc
        return []


class RoleCreate(BaseModel):
    name: str
    description: Optional[str] = None

    @field_validator("name", mode="before")
    def normalize_name(cls, value: str) -> str:
        return str(value or "").strip()

    @field_validator("description", mode="before")
    def normalize_description(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return str(value).strip() or None


class RoleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

    @field_validator("name", mode="before")
    def normalize_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return str(value or "").strip()

    @field_validator("description", mode="before")
    def normalize_description(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return str(value).strip() or None


class TagPermissionUpdate(BaseModel):
    roles: List[int] = Field(default_factory=list)

    @field_validator("roles", mode="before")
    def normalize_roles(cls, value):
        if value is None:
            return []
        if isinstance(value, str):
            value = value.split(",")
        if isinstance(value, (list, tuple)):
            cleaned = [str(v).strip() for v in value if str(v).strip()]
            try:
                return [int(v) for v in cleaned]
            except ValueError as exc:
                raise ValueError("role IDs must be integers") from exc
        return []


class PendingAgreementCreate(BaseModel):
    title: str
    owner: str
    owner_email: Optional[str] = None
    due_date: Optional[str] = None
    status: Optional[str] = None
    contract_id: Optional[str] = None

    @field_validator("owner", mode="before")
    def normalize_owner(cls, value: str) -> str:
        return str(value or "").strip()

    @field_validator("owner_email", mode="before")
    def normalize_owner_email(cls, value: Optional[str]) -> Optional[str]:
        cleaned = str(value or "").strip().lower()
        return cleaned or None

    @field_validator("contract_id", mode="before")
    def normalize_contract_id(cls, value: Optional[str]) -> Optional[str]:
        cleaned = str(value or "").strip()
        return cleaned or None


class PendingAgreementUpdate(BaseModel):
    title: Optional[str] = None
    owner: Optional[str] = None
    owner_email: Optional[str] = None
    due_date: Optional[str] = None
    status: Optional[str] = None
    contract_id: Optional[str] = None

    @field_validator("owner", mode="before")
    def normalize_owner(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return str(value or "").strip()

    @field_validator("owner_email", mode="before")
    def normalize_owner_email(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = str(value or "").strip().lower()
        return cleaned or None

    @field_validator("contract_id", mode="before")
    def normalize_contract_id(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = str(value or "").strip()
        return cleaned or None


class PendingAgreementAction(BaseModel):
    action: str

    @field_validator("action", mode="before")
    def normalize_action(cls, value: str) -> str:
        return str(value or "").strip().lower()


class PendingAgreementReminderCreate(BaseModel):
    frequency: str
    roles: List[int] = Field(default_factory=list)
    recipients: List[str] = Field(default_factory=list)
    message: Optional[str] = None

    @field_validator("roles", "recipients", mode="before")
    def normalize_list(cls, value, info):
        if value is None:
            return []
        if isinstance(value, str):
            value = value.split(",")
        if isinstance(value, (list, tuple)):
            cleaned = [str(v).strip() for v in value if str(v).strip()]
            if info.field_name == "roles":
                try:
                    return [int(v) for v in cleaned]
                except ValueError as exc:
                    raise ValueError("role IDs must be integers") from exc
            return cleaned
        return []

    @field_validator("frequency", mode="before")
    def normalize_frequency(cls, value: str) -> str:
        return str(value or "").strip().lower()

    @field_validator("message", mode="before")
    def normalize_message(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return str(value).strip()


class PendingAgreementReminderUpdate(BaseModel):
    frequency: Optional[str] = None
    roles: Optional[List[int]] = None
    recipients: Optional[List[str]] = None
    message: Optional[str] = None

    @field_validator("roles", "recipients", mode="before")
    def normalize_list(cls, value, info):
        if value is None:
            return None
        if isinstance(value, str):
            value = value.split(",")
        if isinstance(value, (list, tuple)):
            cleaned = [str(v).strip() for v in value if str(v).strip()]
            if info.field_name == "roles":
                try:
                    return [int(v) for v in cleaned]
                except ValueError as exc:
                    raise ValueError("role IDs must be integers") from exc
            return cleaned
        return []

    @field_validator("frequency", mode="before")
    def normalize_frequency(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return str(value).strip().lower()

    @field_validator("message", mode="before")
    def normalize_message(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = str(value).strip()
        return cleaned or None


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    due_date: str
    recurrence: str = "none"
    reminders: List[str] = Field(default_factory=list)
    assignees: List[str] = Field(default_factory=list)


class TaskStatusUpdate(BaseModel):
    completed: bool


class ContractUpdate(BaseModel):
    title: Optional[str] = None
    vendor: Optional[str] = None
    agreement_type: Optional[str] = None


class TermUpsert(BaseModel):
    term_key: str
    value_raw: str
    value_normalized: Optional[str] = None
    status: str = "manual"
    confidence: float = 0.95
    value_type: str = "text"
    source_page: Optional[int] = None
    source_snippet: Optional[str] = None
    create_definition_name: Optional[str] = None
    event_type: Optional[str] = None
    event_date: Optional[str] = None


class EventCreate(BaseModel):
    event_type: str
    event_date: str
    derived_from_term_key: Optional[str] = None


class EventUpdate(BaseModel):
    event_type: Optional[str] = None
    event_date: Optional[str] = None
    derived_from_term_key: Optional[str] = None


class BulkReprocessResponse(BaseModel):
    processed: List[str]
    errors: List[Dict[str, str]]

# ----------------------------
# Schema + seed (inline)
# ----------------------------
SCHEMA_SQL = r"""
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  vendor TEXT,
  agreement_type TEXT,
  original_filename TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  pages INTEGER DEFAULT 0,
  uploaded_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processed'
);
CREATE INDEX IF NOT EXISTS idx_contracts_uploaded_at ON contracts(uploaded_at);
CREATE INDEX IF NOT EXISTS idx_contracts_vendor ON contracts(vendor);
CREATE INDEX IF NOT EXISTS idx_contracts_title ON contracts(title);
CREATE INDEX IF NOT EXISTS idx_contracts_original_filename ON contracts(original_filename);
CREATE INDEX IF NOT EXISTS idx_contracts_agreement_type ON contracts(agreement_type);
CREATE UNIQUE INDEX IF NOT EXISTS ux_contracts_sha256 ON contracts(sha256);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#3b82f6',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contract_tags (
  contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  auto_generated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (contract_id, tag_id)
);

CREATE TABLE IF NOT EXISTS tag_roles (
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES auth_roles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tag_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_tag_roles_tag ON tag_roles(tag_id);
CREATE INDEX IF NOT EXISTS idx_tag_roles_role ON tag_roles(role_id);

CREATE TABLE IF NOT EXISTS tag_keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tag_keywords_tag ON tag_keywords(tag_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_tag_keywords_tag_keyword ON tag_keywords(tag_id, keyword);

CREATE TABLE IF NOT EXISTS ocr_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ocr_pages_contract_page ON ocr_pages(contract_id, page_number);

CREATE TABLE IF NOT EXISTS term_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  key TEXT NOT NULL UNIQUE,
  value_type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 100,
  extraction_hint TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS term_instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  term_key TEXT NOT NULL REFERENCES term_definitions(key),
  value_raw TEXT,
  value_normalized TEXT,
  confidence REAL NOT NULL DEFAULT 0.0,
  status TEXT NOT NULL DEFAULT 'smart',
  source_page INTEGER,
  source_snippet TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_term_instances_contract ON term_instances(contract_id);
CREATE INDEX IF NOT EXISTS idx_term_instances_termkey ON term_instances(term_key);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_date TEXT NOT NULL,
  derived_from_term_key TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
CREATE INDEX IF NOT EXISTS idx_events_contract ON events(contract_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);

CREATE TABLE IF NOT EXISTS reminder_settings (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  recipients TEXT NOT NULL,
  offsets_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminder_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  offset_days INTEGER NOT NULL,
  scheduled_for TEXT NOT NULL,
  sent_at TEXT,
  status TEXT NOT NULL,
  error TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_reminder_sends_unique
  ON reminder_sends(event_id, offset_days, scheduled_for);

CREATE TABLE IF NOT EXISTS notification_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_notification_users_email_lower
  ON notification_users(lower(email));
CREATE INDEX IF NOT EXISTS idx_notification_users_name
  ON notification_users(name);

CREATE TABLE IF NOT EXISTS auth_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_auth_users_email_lower
  ON auth_users(lower(email));

CREATE TABLE IF NOT EXISTS auth_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_user_roles (
  user_id INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES auth_roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_oidc_states (
  state TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_oidc_states_expires ON auth_oidc_states(expires_at);

CREATE TABLE IF NOT EXISTS notification_logs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  recipients_json TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  related_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at ON notification_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_notification_logs_kind ON notification_logs(kind);
CREATE INDEX IF NOT EXISTS idx_notification_logs_status ON notification_logs(status);

CREATE TABLE IF NOT EXISTS pending_agreements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  owner TEXT NOT NULL,
  owner_email TEXT,
  contract_id TEXT,
  due_date TEXT,
  status TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_agreements_created_at
  ON pending_agreements(created_at);

CREATE TABLE IF NOT EXISTS pending_agreement_reminders (
  id TEXT PRIMARY KEY,
  frequency TEXT NOT NULL,
  roles_json TEXT NOT NULL,
  recipients_json TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_agreement_reminders_created_at
  ON pending_agreement_reminders(created_at);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  due_date TEXT NOT NULL,
  recurrence TEXT NOT NULL DEFAULT 'none',
  reminders_json TEXT NOT NULL,
  assignees_json TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at
  ON tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_completed
  ON tasks(completed);

CREATE TABLE IF NOT EXISTS job_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  detail TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS contracts_fts USING fts5(
  contract_id UNINDEXED,
  title,
  vendor,
  ocr_text
);
"""


# ----------------------------
# Auth helpers
# ----------------------------
def _parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _load_user_roles(conn: sqlite3.Connection, user_id: int) -> List[str]:
    rows = conn.execute(
        """
        SELECT r.name
        FROM auth_roles r
        JOIN auth_user_roles ur ON ur.role_id = r.id
        WHERE ur.user_id = ?
        ORDER BY r.name ASC
        """,
        (user_id,),
    ).fetchall()
    return [row["name"] for row in rows]


def _get_session_token(request: Request) -> Optional[str]:
    token = request.cookies.get("session_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.lower().startswith("bearer "):
            token = auth_header.split(" ", 1)[1].strip()
    return token or None


def _get_current_user(request: Request) -> Optional[Dict[str, Any]]:
    token = _get_session_token(request)
    if not token:
        return None
    with db() as conn:
        row = conn.execute(
            """
            SELECT u.id, u.name, u.email, u.is_admin, s.expires_at
            FROM auth_sessions s
            JOIN auth_users u ON u.id = s.user_id
            WHERE s.token = ?
            """,
            (token,),
        ).fetchone()
        if not row:
            return None
        expires_at = _parse_iso_datetime(row["expires_at"])
        if expires_at:
            now = datetime.utcnow()
            if expires_at.tzinfo:
                now = now.replace(tzinfo=expires_at.tzinfo)
        if expires_at and expires_at <= now:
            conn.execute("DELETE FROM auth_sessions WHERE token = ?", (token,))
            return None
        roles = _load_user_roles(conn, row["id"])
        return {
            "id": row["id"],
            "name": row["name"],
            "email": row["email"],
            "is_admin": bool(row["is_admin"]),
            "roles": roles,
        }


def require_user(request: Request) -> Dict[str, Any]:
    user = _get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user


def require_admin(user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def _cookie_secure_flag() -> bool:
    value = os.environ.get("AUTH_COOKIE_SECURE", "").strip().lower()
    return value in {"1", "true", "yes", "on"}

SEED_TERMS_SQL = r"""
INSERT OR IGNORE INTO term_definitions (id, name, key, value_type, enabled, priority, extraction_hint, created_at) VALUES
  (lower(hex(randomblob(16))), 'Effective Date', 'effective_date', 'date', 1, 10, 'effective date; effective as of; commencement', datetime('now')),
  (lower(hex(randomblob(16))), 'Renewal Date', 'renewal_date', 'date', 1, 20, 'renewal date; renews on; term ends', datetime('now')),
  (lower(hex(randomblob(16))), 'Termination Date', 'termination_date', 'date', 1, 30, 'termination date; terminates on; expires on', datetime('now')),
  (lower(hex(randomblob(16))), 'Extraction Sensitivity', 'extraction_sensitivity', 'text', 1, 35, 'sensitivity; extraction confidence; classifier confidence', datetime('now')),
  (lower(hex(randomblob(16))), 'Automatic Renewal', 'automatic_renewal', 'bool', 1, 40, 'auto renew; automatically renews; renews automatically', datetime('now')),
  (lower(hex(randomblob(16))), 'Auto-Renew Opt-Out Days', 'auto_renew_opt_out_days', 'int', 1, 50, 'notice; written notice; days prior to renewal', datetime('now')),
  (lower(hex(randomblob(16))), 'Auto-Renew Opt-Out Date (calculated)', 'auto_renew_opt_out_date', 'date', 1, 60, 'calculated from renewal date - opt-out days', datetime('now')),
  (lower(hex(randomblob(16))), 'Termination Notice Days', 'termination_notice_days', 'int', 1, 70, 'terminate; termination; written notice', datetime('now')),
  (lower(hex(randomblob(16))), 'Governing Law', 'governing_law', 'text', 1, 80, 'governed by the laws of', datetime('now')),
  (lower(hex(randomblob(16))), 'Payment Terms', 'payment_terms', 'text', 1, 90, 'payment; due; net 30; invoice', datetime('now')),
  (lower(hex(randomblob(16))), 'Term Length', 'term_length', 'text', 1, 95, 'initial term; term of; term shall be', datetime('now'));
"""

SEED_TAGS_SQL = r"""
INSERT OR IGNORE INTO tags (name, color, created_at) VALUES
  ('Confidential', '#ef4444', datetime('now')),
  ('Auto-Renew', '#f97316', datetime('now')),
  ('High-Value', '#eab308', datetime('now')),
  ('Vendor', '#3b82f6', datetime('now')),
  ('Customer', '#8b5cf6', datetime('now')),
  ('Insurance', '#ec4899', datetime('now')),
  ('Real Estate', '#06b6d4', datetime('now')),
  ('Employment', '#10b981', datetime('now')),
  ('Expiring Soon', '#dc2626', datetime('now'));

INSERT OR IGNORE INTO tag_keywords (tag_id, keyword, created_at)
SELECT id, 'confidential', datetime('now') FROM tags WHERE name = 'Confidential'
UNION ALL SELECT id, 'non-disclosure', datetime('now') FROM tags WHERE name = 'Confidential'
UNION ALL SELECT id, 'nda', datetime('now') FROM tags WHERE name = 'Confidential'
UNION ALL SELECT id, 'proprietary', datetime('now') FROM tags WHERE name = 'Confidential'
UNION ALL SELECT id, 'automatic renewal', datetime('now') FROM tags WHERE name = 'Auto-Renew'
UNION ALL SELECT id, 'auto-renew', datetime('now') FROM tags WHERE name = 'Auto-Renew'
UNION ALL SELECT id, 'automatically renews', datetime('now') FROM tags WHERE name = 'Auto-Renew'
UNION ALL SELECT id, 'insurance', datetime('now') FROM tags WHERE name = 'Insurance'
UNION ALL SELECT id, 'certificate of insurance', datetime('now') FROM tags WHERE name = 'Insurance'
UNION ALL SELECT id, 'liability coverage', datetime('now') FROM tags WHERE name = 'Insurance'
UNION ALL SELECT id, 'lease', datetime('now') FROM tags WHERE name = 'Real Estate'
UNION ALL SELECT id, 'real estate', datetime('now') FROM tags WHERE name = 'Real Estate'
UNION ALL SELECT id, 'property', datetime('now') FROM tags WHERE name = 'Real Estate'
UNION ALL SELECT id, 'premises', datetime('now') FROM tags WHERE name = 'Real Estate'
UNION ALL SELECT id, 'employment', datetime('now') FROM tags WHERE name = 'Employment'
UNION ALL SELECT id, 'employee', datetime('now') FROM tags WHERE name = 'Employment'
UNION ALL SELECT id, 'offer letter', datetime('now') FROM tags WHERE name = 'Employment';
"""

DEFAULT_NOTIFICATION_USERS = [
    {"name": "Avery Carter", "email": "avery.carter@contractsuite.com"},
    {"name": "Jordan Lee", "email": "jordan.lee@contractsuite.com"},
    {"name": "Priya Patel", "email": "priya.patel@contractsuite.com"},
    {"name": "Morgan Rivera", "email": "morgan.rivera@contractsuite.com"},
]

# ----------------------------
# Tag + agreement helpers
# ----------------------------
def auto_tag_contract(contract_id: str, ocr_text: str):
    with db() as conn:
        rows = conn.execute(
            """
            SELECT t.id as tag_id, tk.keyword
            FROM tags t
            JOIN tag_keywords tk ON tk.tag_id = t.id
            """
        ).fetchall()

        ocr_lower = ocr_text.lower()
        for row in rows:
            if row["keyword"].lower() in ocr_lower:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO contract_tags (contract_id, tag_id, auto_generated, created_at)
                    VALUES (?, ?, 1, ?)
                    """,
                    (contract_id, row["tag_id"], now_iso()),
                )


def detect_agreement_type(ocr_text: str, filename: str) -> str:
    text_lower = (ocr_text + " " + filename).lower()

    if "non-disclosure" in text_lower or "nda" in text_lower or "confidential" in text_lower:
        if "mutual" in text_lower:
            return "Mutual Non Disclosure Agreement"
        return "Non Disclosure Agreement"
    if "employment" in text_lower or "offer letter" in text_lower:
        return "Employment Agreement"
    if "service agreement" in text_lower or "services agreement" in text_lower:
        return "Service Agreement"
    if "statement of work" in text_lower or "sow" in text_lower:
        return "Statement of Work"
    if "master agreement" in text_lower or "msa" in text_lower:
        return "Master Agreement"
    if "addendum" in text_lower:
        return "Addendum"
    if "amendment" in text_lower:
        return "Amendment"
    if "consulting" in text_lower:
        return "Consulting Agreement"
    if "certificate of insurance" in text_lower:
        return "Certificate of Insurance"
    if "order form" in text_lower or "purchase order" in text_lower:
        return "Order Form"
    return "Uncategorized"


TERM_EVENT_MAP = {
    "effective_date": "effective",
    "renewal_date": "renewal",
    "termination_date": "termination",
    "auto_renew_opt_out_date": "auto_opt_out",
}


def _ensure_term_definition(conn: sqlite3.Connection, term_key: str, value_type: str, name: Optional[str]) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM term_definitions WHERE key = ?",
        (term_key,),
    ).fetchone()
    if row:
        return row

    display_name = name or term_key.replace("_", " ").title()
    conn.execute(
        """
        INSERT INTO term_definitions (id, name, key, value_type, enabled, priority, created_at)
        VALUES (?, ?, ?, ?, 1, 100, ?)
        """,
        (str(uuid.uuid4()), display_name, term_key, value_type or "text", now_iso()),
    )
    return conn.execute(
        "SELECT * FROM term_definitions WHERE key = ?",
        (term_key,),
    ).fetchone()


def _normalize_date_string(date_str: str) -> str:
    try:
        return date.fromisoformat(date_str).isoformat()
    except Exception:
        try:
            return datetime.fromisoformat(date_str).date().isoformat()
        except Exception:
            raise HTTPException(status_code=400, detail="Date values must be ISO formatted (YYYY-MM-DD)")


def _upsert_manual_term(contract_id: str, payload: TermUpsert) -> Dict[str, Any]:
    value_type = payload.value_type or "text"
    value_norm = payload.value_normalized or payload.value_raw
    if value_type == "date" and payload.value_normalized:
        value_norm = _normalize_date_string(payload.value_normalized)
    if payload.event_date:
        payload.event_date = _normalize_date_string(payload.event_date)

    event_type = payload.event_type or TERM_EVENT_MAP.get(payload.term_key)
    event_date = payload.event_date or (value_norm if value_type == "date" else None)

    with db() as conn:
        _ensure_term_definition(conn, payload.term_key, value_type, payload.create_definition_name)
        conn.execute(
            "DELETE FROM term_instances WHERE contract_id = ? AND term_key = ?",
            (contract_id, payload.term_key),
        )
        conn.execute(
            "DELETE FROM events WHERE contract_id = ? AND derived_from_term_key = ?",
            (contract_id, payload.term_key),
        )
        conn.execute(
            """
            INSERT INTO term_instances
              (contract_id, term_key, value_raw, value_normalized, confidence, status, source_page, source_snippet, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                contract_id,
                payload.term_key,
                payload.value_raw,
                value_norm,
                float(payload.confidence or 0),
                payload.status or "manual",
                payload.source_page,
                payload.source_snippet,
                now_iso(),
            ),
        )

        ev_id = None
        if event_type and event_date:
            ev_id = str(uuid.uuid4())
            conn.execute(
                """
                INSERT INTO events (id, contract_id, event_type, event_date, derived_from_term_key, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (ev_id, contract_id, event_type, event_date, payload.term_key, now_iso()),
            )

    return {
        "term_key": payload.term_key,
        "event_id": ev_id,
        "event_type": event_type,
    }

# ----------------------------
# Auth helpers
# ----------------------------
def _parse_iso_datetime(value: str) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", ""))
    except ValueError:
        return None


def _get_user_roles(conn: sqlite3.Connection, user_id: int) -> List[str]:
    rows = conn.execute(
        """
        SELECT r.name
        FROM auth_roles r
        JOIN auth_user_roles ur ON ur.role_id = r.id
        WHERE ur.user_id = ?
        ORDER BY r.name ASC
        """,
        (user_id,),
    ).fetchall()
    return [row["name"] for row in rows]


def get_current_user(request: Request) -> Optional[Dict[str, Any]]:
    token = request.cookies.get(AUTH_COOKIE_NAME)
    if not token:
        return None
    with db() as conn:
        row = conn.execute(
            """
            SELECT s.id AS session_id, s.expires_at,
                   u.id, u.name, u.email, u.is_active
            FROM auth_sessions s
            JOIN auth_users u ON u.id = s.user_id
            WHERE s.id = ?
            """,
            (token,),
        ).fetchone()
        if not row:
            return None
        if not row["is_active"]:
            return None
        expires = _parse_iso_datetime(row["expires_at"])
        if expires and expires <= datetime.utcnow():
            conn.execute("DELETE FROM auth_sessions WHERE id = ?", (token,))
            return None
        roles = _get_user_roles(conn, row["id"])
        return {
            "id": row["id"],
            "name": row["name"],
            "email": row["email"],
            "roles": roles,
        }


def require_admin(request: Request) -> Optional[Dict[str, Any]]:
    if not AUTH_REQUIRED:
        return None
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    if "admin" not in user.get("roles", []):
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def create_session(conn: sqlite3.Connection, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    created_at = now_iso()
    expires_at = (
        datetime.utcnow() + timedelta(days=AUTH_SESSION_DAYS)
    ).replace(microsecond=0).isoformat() + "Z"
    conn.execute(
        """
        INSERT INTO auth_sessions (id, user_id, created_at, expires_at)
        VALUES (?, ?, ?, ?)
        """,
        (token, user_id, created_at, expires_at),
    )
    return token


def _oidc_authority() -> str:
    return f"https://login.microsoftonline.com/{OIDC_TENANT_ID}/v2.0"


def _oidc_discovery_url() -> str:
    return f"{_oidc_authority()}/.well-known/openid-configuration"


def _oidc_fetch_json(url: str, data: Optional[bytes] = None) -> Dict[str, Any]:
    headers = {}
    if data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=10) as resp:
        payload = resp.read()
    return json.loads(payload.decode("utf-8"))


def _oidc_config() -> Dict[str, Any]:
    if not OIDC_ENABLED:
        raise HTTPException(status_code=400, detail="OIDC is not configured")
    if _OIDC_CONFIG_CACHE:
        return _OIDC_CONFIG_CACHE
    config = _oidc_fetch_json(_oidc_discovery_url())
    _OIDC_CONFIG_CACHE.update(config)
    return config


def _oidc_jwks() -> Dict[str, Any]:
    if _OIDC_JWKS_CACHE:
        return _OIDC_JWKS_CACHE
    config = _oidc_config()
    jwks = _oidc_fetch_json(config["jwks_uri"])
    _OIDC_JWKS_CACHE.update(jwks)
    return jwks


def _oidc_state_store(conn: sqlite3.Connection, state: str, nonce: str) -> None:
    created_at = now_iso()
    expires_at = (datetime.utcnow() + timedelta(minutes=OIDC_STATE_TTL_MINUTES)).replace(
        microsecond=0
    ).isoformat() + "Z"
    conn.execute(
        """
        INSERT INTO auth_oidc_states (state, nonce, created_at, expires_at)
        VALUES (?, ?, ?, ?)
        """,
        (state, nonce, created_at, expires_at),
    )


def _oidc_state_pop(conn: sqlite3.Connection, state: str) -> Optional[str]:
    conn.execute(
        "DELETE FROM auth_oidc_states WHERE expires_at <= ?",
        (now_iso(),),
    )
    row = conn.execute(
        "SELECT nonce, expires_at FROM auth_oidc_states WHERE state = ?",
        (state,),
    ).fetchone()
    conn.execute("DELETE FROM auth_oidc_states WHERE state = ?", (state,))
    if not row:
        return None
    expires_at = _parse_iso_datetime(row["expires_at"])
    if expires_at and expires_at <= datetime.utcnow():
        return None
    return row["nonce"]


def _oidc_build_authorize_url(state: str, nonce: str) -> str:
    config = _oidc_config()
    params = {
        "client_id": OIDC_CLIENT_ID,
        "response_type": "code",
        "response_mode": "query",
        "scope": OIDC_SCOPES,
        "redirect_uri": OIDC_REDIRECT_URI,
        "state": state,
        "nonce": nonce,
    }
    return f"{config['authorization_endpoint']}?{urllib.parse.urlencode(params)}"


def _oidc_exchange_code(code: str) -> Dict[str, Any]:
    config = _oidc_config()
    payload = urllib.parse.urlencode(
        {
            "client_id": OIDC_CLIENT_ID,
            "client_secret": OIDC_CLIENT_SECRET,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": OIDC_REDIRECT_URI,
        }
    ).encode("utf-8")
    return _oidc_fetch_json(config["token_endpoint"], data=payload)


def _oidc_decode_id_token(id_token: str, nonce: str) -> Dict[str, Any]:
    config = _oidc_config()
    jwks = _oidc_jwks()
    unverified = jwt.get_unverified_header(id_token)
    kid = unverified.get("kid")
    key = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)
    if not key:
        raise HTTPException(status_code=401, detail="OIDC signing key not found")
    public_key = jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(key))
    claims = jwt.decode(
        id_token,
        public_key,
        algorithms=[unverified.get("alg", "RS256")],
        audience=OIDC_CLIENT_ID,
        issuer=config["issuer"],
    )
    if claims.get("nonce") != nonce:
        raise HTTPException(status_code=401, detail="OIDC nonce mismatch")
    return claims


def _oidc_default_role_ids(conn: sqlite3.Connection) -> List[int]:
    role_ids: List[int] = []
    now = now_iso()
    for name in OIDC_DEFAULT_ROLE_NAMES:
        row = conn.execute("SELECT id FROM auth_roles WHERE name = ?", (name,)).fetchone()
        if not row:
            if _table_has_column(conn, "auth_roles", "description"):
                cur = conn.execute(
                    "INSERT INTO auth_roles (name, description, created_at) VALUES (?, ?, ?)",
                    (name, None, now),
                )
            else:
                cur = conn.execute(
                    "INSERT INTO auth_roles (name, created_at) VALUES (?, ?)",
                    (name, now),
                )
            role_ids.append(cur.lastrowid)
        else:
            role_ids.append(row["id"])
    return role_ids


def _oidc_get_or_create_user(conn: sqlite3.Connection, email: str, name: str) -> int:
    row = conn.execute(
        "SELECT id, is_admin FROM auth_users WHERE lower(email) = ?",
        (email.lower(),),
    ).fetchone()
    now = now_iso()
    if row:
        if name:
            conn.execute(
                "UPDATE auth_users SET name = ?, updated_at = ? WHERE id = ?",
                (name, now, row["id"]),
            )
        role_ids = _get_user_role_ids(conn, row["id"])
        admin_role = conn.execute(
            "SELECT id FROM auth_roles WHERE name = ?",
            ("admin",),
        ).fetchone()
        has_admin_role = admin_role and admin_role["id"] in role_ids
        if not row["is_admin"] and not has_admin_role and not role_ids:
            _set_user_roles(conn, row["id"], _oidc_default_role_ids(conn))
        return row["id"]
    password_hash = hash_password(secrets.token_urlsafe(24))
    is_active_column = _table_has_column(conn, "auth_users", "is_active")
    is_admin_column = _table_has_column(conn, "auth_users", "is_admin")
    columns = ["name", "email", "password_hash"]
    values: List[Any] = [name or email, email.lower(), password_hash]
    if is_active_column:
        columns.append("is_active")
        values.append(1)
    if is_admin_column:
        columns.append("is_admin")
        values.append(0)
    columns.extend(["created_at", "updated_at"])
    values.extend([now, now])
    placeholders = ", ".join("?" for _ in values)
    cur = conn.execute(
        f"INSERT INTO auth_users ({', '.join(columns)}) VALUES ({placeholders})",
        tuple(values),
    )
    user_id = cur.lastrowid
    _set_user_roles(conn, user_id, _oidc_default_role_ids(conn))
    return user_id

# ----------------------------
# Agreement types / Tags endpoints
# ----------------------------
@app.get("/api/agreement-types")
def get_agreement_types():
    return AGREEMENT_TYPES


@app.get("/api/tags")
def list_tags():
    with db() as conn:
        rows = conn.execute("SELECT * FROM tags ORDER BY name").fetchall()
        return [dict(r) for r in rows]


@app.post("/api/tags")
def create_tag(tag: TagCreate, _: Dict[str, Any] = Depends(require_admin)):
    with db() as conn:
        cur = conn.execute(
            "INSERT INTO tags (name, color, created_at) VALUES (?, ?, ?)",
            (tag.name, tag.color, now_iso()),
        )
        tag_id = cur.lastrowid
        return {"id": tag_id, "name": tag.name, "color": tag.color}


@app.put("/api/tags/{tag_id}")
def update_tag(tag_id: int, tag: TagUpdate, _: Dict[str, Any] = Depends(require_admin)):
    with db() as conn:
        if tag.name:
            conn.execute("UPDATE tags SET name = ? WHERE id = ?", (tag.name, tag_id))
        if tag.color:
            conn.execute("UPDATE tags SET color = ? WHERE id = ?", (tag.color, tag_id))
        return {"tag_id": tag_id}


@app.delete("/api/tags/{tag_id}")
def delete_tag(tag_id: int, _: Dict[str, Any] = Depends(require_admin)):
    with db() as conn:
        conn.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
        return {"deleted": tag_id}


# ----------------------------
# Role endpoints
# ----------------------------
@app.get("/api/roles")
def list_roles(_: Dict[str, Any] = Depends(require_admin)):
    with db() as conn:
        if _table_has_column(conn, "auth_roles", "description"):
            rows = conn.execute(
                "SELECT id, name, description FROM auth_roles ORDER BY name"
            ).fetchall()
        else:
            rows = conn.execute("SELECT id, name FROM auth_roles ORDER BY name").fetchall()
        return [dict(r) for r in rows]


@app.post("/api/roles")
def create_role(payload: RoleCreate, _: Dict[str, Any] = Depends(require_admin)):
    name = payload.name
    if not name:
        raise HTTPException(status_code=400, detail="Role name is required")
    with db() as conn:
        now = now_iso()
        try:
            if _table_has_column(conn, "auth_roles", "description"):
                cur = conn.execute(
                    "INSERT INTO auth_roles (name, description, created_at) VALUES (?, ?, ?)",
                    (name, payload.description, now),
                )
            else:
                cur = conn.execute(
                    "INSERT INTO auth_roles (name, created_at) VALUES (?, ?)",
                    (name, now),
                )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=400, detail="Role name already exists") from exc
        return {"id": cur.lastrowid, "name": name, "description": payload.description}


@app.put("/api/roles/{role_id}")
def update_role(
    role_id: int,
    payload: RoleUpdate,
    _: Dict[str, Any] = Depends(require_admin),
):
    if payload.name is None and payload.description is None:
        raise HTTPException(status_code=400, detail="No updates provided")
    with db() as conn:
        row = conn.execute("SELECT id FROM auth_roles WHERE id = ?", (role_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Role not found")
        if payload.name:
            try:
                conn.execute("UPDATE auth_roles SET name = ? WHERE id = ?", (payload.name, role_id))
            except sqlite3.IntegrityError as exc:
                raise HTTPException(status_code=400, detail="Role name already exists") from exc
        if payload.description is not None and _table_has_column(conn, "auth_roles", "description"):
            conn.execute(
                "UPDATE auth_roles SET description = ? WHERE id = ?",
                (payload.description, role_id),
            )
        return {"id": role_id}


@app.delete("/api/roles/{role_id}")
def delete_role(role_id: int, _: Dict[str, Any] = Depends(require_admin)):
    with db() as conn:
        row = conn.execute("SELECT id FROM auth_roles WHERE id = ?", (role_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Role not found")
        conn.execute("DELETE FROM auth_roles WHERE id = ?", (role_id,))
        return {"deleted": role_id}


# ----------------------------
# Admin user management
# ----------------------------
@app.get("/api/admin/users")
def list_admin_users(_: Dict[str, Any] = Depends(require_admin)):
    with db() as conn:
        if _table_has_column(conn, "auth_users", "is_admin"):
            rows = conn.execute(
                """
                SELECT id, name, email, is_active, is_admin, created_at, updated_at
                FROM auth_users
                ORDER BY name ASC, email ASC
                """
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT id, name, email, is_active, created_at, updated_at
                FROM auth_users
                ORDER BY name ASC, email ASC
                """
            ).fetchall()
        users = []
        for row in rows:
            users.append(
                {
                    "id": row["id"],
                    "name": row["name"],
                    "email": row["email"],
                    "is_active": bool(row["is_active"]),
                    "is_admin": bool(row["is_admin"]) if "is_admin" in row.keys() else False,
                    "role_ids": _get_user_role_ids(conn, row["id"]),
                    "created_at": row["created_at"],
                    "updated_at": row["updated_at"],
                }
            )
        return users


@app.post("/api/admin/users")
def create_admin_user(payload: AdminUserCreate, _: Dict[str, Any] = Depends(require_admin)):
    name = payload.name
    email = payload.email
    if not name or not email or not payload.password:
        raise HTTPException(status_code=400, detail="Name, email, and password are required")
    with db() as conn:
        role_ids = _validate_role_ids(conn, payload.roles)
        now = now_iso()
        password_hash = hash_password(payload.password)
        try:
            if _table_has_column(conn, "auth_users", "is_admin"):
                cur = conn.execute(
                    """
                    INSERT INTO auth_users
                      (name, email, password_hash, is_active, is_admin, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        name,
                        email,
                        password_hash,
                        1 if payload.is_active else 0,
                        1 if payload.is_admin else 0,
                        now,
                        now,
                    ),
                )
            else:
                cur = conn.execute(
                    """
                    INSERT INTO auth_users
                      (name, email, password_hash, is_active, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        name,
                        email,
                        password_hash,
                        1 if payload.is_active else 0,
                        now,
                        now,
                    ),
                )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=400, detail="User email already exists") from exc
        user_id = cur.lastrowid
        _set_user_roles(conn, user_id, role_ids)
        return {"id": user_id}


@app.put("/api/admin/users/{user_id}")
def update_admin_user(
    user_id: int,
    payload: AdminUserUpdate,
    _: Dict[str, Any] = Depends(require_admin),
):
    if (
        payload.name is None
        and payload.email is None
        and payload.password is None
        and payload.roles is None
        and payload.is_active is None
        and payload.is_admin is None
    ):
        raise HTTPException(status_code=400, detail="No updates provided")
    with db() as conn:
        row = conn.execute("SELECT id FROM auth_users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        updates = []
        params: List[Any] = []
        if payload.name is not None:
            updates.append("name = ?")
            params.append(payload.name)
        if payload.email is not None:
            updates.append("email = ?")
            params.append(payload.email)
        if payload.password:
            updates.append("password_hash = ?")
            params.append(hash_password(payload.password))
        if payload.is_active is not None:
            updates.append("is_active = ?")
            params.append(1 if payload.is_active else 0)
        if payload.is_admin is not None and _table_has_column(conn, "auth_users", "is_admin"):
            updates.append("is_admin = ?")
            params.append(1 if payload.is_admin else 0)
        if updates:
            updates.append("updated_at = ?")
            params.append(now_iso())
            params.append(user_id)
            try:
                conn.execute(
                    f"UPDATE auth_users SET {', '.join(updates)} WHERE id = ?",
                    tuple(params),
                )
            except sqlite3.IntegrityError as exc:
                raise HTTPException(status_code=400, detail="User email already exists") from exc
        if payload.roles is not None:
            role_ids = _validate_role_ids(conn, payload.roles)
            _set_user_roles(conn, user_id, role_ids)
        return {"id": user_id}


# ----------------------------
# Tag permission endpoints
# ----------------------------
@app.get("/api/tag-permissions")
def list_tag_permissions(_: Dict[str, Any] = Depends(require_admin)):
    with db() as conn:
        rows = conn.execute("SELECT tag_id, role_id FROM tag_roles").fetchall()
        mapping: Dict[int, List[int]] = {}
        for row in rows:
            mapping.setdefault(row["tag_id"], []).append(row["role_id"])
        return mapping


@app.put("/api/tag-permissions/{tag_id}")
def update_tag_permissions(
    tag_id: int,
    payload: TagPermissionUpdate,
    _: Dict[str, Any] = Depends(require_admin),
):
    with db() as conn:
        tag_row = conn.execute("SELECT id FROM tags WHERE id = ?", (tag_id,)).fetchone()
        if not tag_row:
            raise HTTPException(status_code=404, detail="Tag not found")
        role_ids = _validate_role_ids(conn, payload.roles)
        conn.execute("DELETE FROM tag_roles WHERE tag_id = ?", (tag_id,))
        if role_ids:
            now = now_iso()
            if _table_has_column(conn, "tag_roles", "created_at"):
                conn.executemany(
                    "INSERT INTO tag_roles (tag_id, role_id, created_at) VALUES (?, ?, ?)",
                    [(tag_id, role_id, now) for role_id in role_ids],
                )
            else:
                conn.executemany(
                    "INSERT INTO tag_roles (tag_id, role_id) VALUES (?, ?)",
                    [(tag_id, role_id) for role_id in role_ids],
                )
        return {"tag_id": tag_id, "role_ids": role_ids}


# ----------------------------
# Auth endpoints
# ----------------------------
@app.post("/api/auth/login")
def login(payload: AuthLogin, response: Response):
    email = payload.email.strip().lower()
    password = payload.password or ""
    with db() as conn:
        row = conn.execute(
            """
            SELECT id, name, email, password_hash, is_active
            FROM auth_users
            WHERE lower(email) = ?
            """,
            (email,),
        ).fetchone()
        if not row or not row["is_active"] or not verify_password(password, row["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid credentials")
        token = create_session(conn, row["id"])
        roles = _get_user_roles(conn, row["id"])
    response.set_cookie(
        AUTH_COOKIE_NAME,
        token,
        httponly=True,
        samesite="lax",
        secure=AUTH_COOKIE_SECURE,
        max_age=AUTH_SESSION_DAYS * 86400,
    )
    return {"id": row["id"], "name": row["name"], "email": row["email"], "roles": roles}


@app.post("/api/auth/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get(AUTH_COOKIE_NAME)
    if token:
        with db() as conn:
            conn.execute("DELETE FROM auth_sessions WHERE id = ?", (token,))
    response.delete_cookie(AUTH_COOKIE_NAME)
    return {"logged_out": True}


@app.get("/api/auth/me")
def auth_me(request: Request):
    user = get_current_user(request)
    if not user and AUTH_REQUIRED:
        raise HTTPException(status_code=401, detail="Authentication required")
    return {"user": user, "auth_required": AUTH_REQUIRED}


@app.get("/api/auth/oidc/login")
def oidc_login():
    if not OIDC_ENABLED:
        raise HTTPException(status_code=400, detail="OIDC is not configured")
    state = secrets.token_urlsafe(24)
    nonce = secrets.token_urlsafe(24)
    with db() as conn:
        _oidc_state_store(conn, state, nonce)
    url = _oidc_build_authorize_url(state, nonce)
    return RedirectResponse(url)


@app.get("/api/auth/oidc/callback")
def oidc_callback(code: str, state: str, response: Response):
    if not OIDC_ENABLED:
        raise HTTPException(status_code=400, detail="OIDC is not configured")
    with db() as conn:
        nonce = _oidc_state_pop(conn, state)
    if not nonce:
        raise HTTPException(status_code=400, detail="OIDC state is invalid or expired")
    token_data = _oidc_exchange_code(code)
    id_token = token_data.get("id_token")
    if not id_token:
        raise HTTPException(status_code=401, detail="OIDC token response missing id_token")
    claims = _oidc_decode_id_token(id_token, nonce)
    email = (
        claims.get("preferred_username")
        or claims.get("email")
        or claims.get("upn")
        or ""
    ).strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="OIDC token missing email claim")
    name = (claims.get("name") or email).strip()
    with db() as conn:
        user_id = _oidc_get_or_create_user(conn, email, name)
        token = create_session(conn, user_id)
        roles = _get_user_roles(conn, user_id)
    response.set_cookie(
        AUTH_COOKIE_NAME,
        token,
        httponly=True,
        samesite="lax",
        secure=AUTH_COOKIE_SECURE,
        max_age=AUTH_SESSION_DAYS * 86400,
    )
    return {"id": user_id, "name": name, "email": email, "roles": roles}


# ----------------------------
# Notification users
# ----------------------------
@app.get("/api/notification-users")
def list_notification_users(_: Dict[str, Any] = Depends(require_admin)):
    with db() as conn:
        rows = conn.execute(
            "SELECT id, name, email FROM notification_users ORDER BY name ASC, email ASC"
        ).fetchall()
        return [dict(r) for r in rows]


@app.post("/api/notification-users")
def create_notification_user(payload: NotificationUserCreate, _: Dict[str, Any] = Depends(require_admin)):
    name = payload.name.strip()
    email = payload.email.strip().lower()
    if not name or not email:
        raise HTTPException(status_code=400, detail="name and email are required")

    with db() as conn:
        try:
            cur = conn.execute(
                """
                INSERT INTO notification_users (name, email, created_at)
                VALUES (?, ?, ?)
                """,
                (name, email, now_iso()),
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="user already exists") from exc
        return {"id": cur.lastrowid, "name": name, "email": email}


@app.delete("/api/notification-users/{user_id}")
def delete_notification_user(user_id: int, _: Dict[str, Any] = Depends(require_admin)):
    with db() as conn:
        row = conn.execute(
            "SELECT id FROM notification_users WHERE id = ?", (user_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        conn.execute("DELETE FROM notification_users WHERE id = ?", (user_id,))
        return {"deleted": user_id}


@app.get("/api/notification-logs")
def list_notification_logs(
    limit: int = 50,
    offset: int = 0,
    query: str = "",
    status: str = "all",
    kind: str = "all",
    _: Dict[str, Any] = Depends(require_admin),
):
    limit = max(1, min(limit, 200))
    offset = max(offset, 0)
    params: List[Any] = []
    where_parts = []
    if query:
        like = f"%{query.lower()}%"
        where_parts.append(
            """
            (
              lower(subject) LIKE ?
              OR lower(recipients_json) LIKE ?
              OR lower(body) LIKE ?
              OR lower(kind) LIKE ?
              OR lower(coalesce(related_id, '')) LIKE ?
              OR lower(coalesce(metadata_json, '')) LIKE ?
            )
            """
        )
        params.extend([like, like, like, like, like, like])
    if status and status != "all":
        where_parts.append("status = ?")
        params.append(status)
    if kind and kind != "all":
        where_parts.append("kind = ?")
        params.append(kind)

    where_clause = ""
    if where_parts:
        where_clause = "WHERE " + " AND ".join(where_parts)

    with db() as conn:
        total = conn.execute(
            f"SELECT COUNT(1) AS count FROM notification_logs {where_clause}",
            tuple(params),
        ).fetchone()["count"]
        rows = conn.execute(
            f"""
            SELECT id, kind, recipients_json, subject, body, status, error, related_id,
                   metadata_json, created_at
            FROM notification_logs
            {where_clause}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
            """,
            (*params, limit, offset),
        ).fetchall()

    items = []
    for row in rows:
        data = dict(row)
        data["recipients"] = safe_json_list(data.pop("recipients_json", None))
        metadata_raw = data.pop("metadata_json", None)
        try:
            data["metadata"] = json.loads(metadata_raw) if metadata_raw else None
        except json.JSONDecodeError:
            data["metadata"] = None
        items.append(data)

    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@app.get("/api/pending-agreements")
def list_pending_agreements(
    limit: int = 20,
    offset: int = 0,
    query: str = "",
):
    limit = max(1, min(limit, 100))
    offset = max(offset, 0)
    where_clause = ""
    params: List[Any] = []
    if query:
        where_clause = (
            "WHERE lower(p.title) LIKE ? OR lower(p.owner) LIKE ? "
            "OR lower(coalesce(p.owner_email, '')) LIKE ? "
            "OR lower(coalesce(p.status, '')) LIKE ? "
            "OR lower(coalesce(c.title, '')) LIKE ? "
            "OR lower(coalesce(c.vendor, '')) LIKE ?"
        )
        like = f"%{query.lower()}%"
        params.extend([like, like, like, like, like, like])

    with db() as conn:
        total = conn.execute(
            f"""
            SELECT COUNT(1) AS count
            FROM pending_agreements p
            LEFT JOIN contracts c ON c.id = p.contract_id
            {where_clause}
            """,
            params,
        ).fetchone()["count"]
        rows = conn.execute(
            f"""
            SELECT p.id, p.title, p.owner, p.owner_email, p.due_date, p.status,
                   p.contract_id, p.created_at, c.title AS contract_title,
                   c.vendor AS contract_vendor
            FROM pending_agreements p
            LEFT JOIN contracts c ON c.id = p.contract_id
            {where_clause}
            ORDER BY p.created_at DESC
            LIMIT ? OFFSET ?
            """,
            (*params, limit, offset),
        ).fetchall()
        return {
            "items": [dict(r) for r in rows],
            "total": total,
            "limit": limit,
            "offset": offset,
        }


@app.post("/api/pending-agreements")
def create_pending_agreement(payload: PendingAgreementCreate):
    title = payload.title.strip()
    owner = payload.owner.strip()
    if not title or not owner:
        raise HTTPException(status_code=400, detail="title and owner are required")
    owner_email = payload.owner_email
    if not owner_email and "@" in owner:
        owner_email = owner.strip().lower()
    agreement_id = str(uuid.uuid4())
    due_date = payload.due_date.strip() if payload.due_date else None
    status = payload.status.strip() if payload.status else None
    contract_id = payload.contract_id
    created_at = now_iso()

    with db() as conn:
        if contract_id:
            exists = conn.execute(
                "SELECT id FROM contracts WHERE id = ?", (contract_id,)
            ).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail="Contract not found")
        conn.execute(
            """
            INSERT INTO pending_agreements (
              id, title, owner, owner_email, contract_id, due_date, status, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                agreement_id,
                title,
                owner,
                owner_email,
                contract_id,
                due_date,
                status,
                created_at,
            ),
        )
    return {
        "id": agreement_id,
        "title": title,
        "owner": owner,
        "owner_email": owner_email,
        "due_date": due_date,
        "status": status,
        "contract_id": contract_id,
        "created_at": created_at,
    }


@app.put("/api/pending-agreements/{agreement_id}")
def update_pending_agreement(agreement_id: str, payload: PendingAgreementUpdate):
    with db() as conn:
        row = conn.execute(
            """
            SELECT id, title, owner, owner_email, contract_id, due_date, status, created_at
            FROM pending_agreements WHERE id = ?
            """,
            (agreement_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Pending agreement not found")

        title = row["title"]
        owner = row["owner"]
        owner_email = row["owner_email"]
        contract_id = row["contract_id"]
        due_date = row["due_date"]
        status = row["status"]

        if payload.title is not None:
            cleaned = payload.title.strip()
            if not cleaned:
                raise HTTPException(status_code=400, detail="title cannot be empty")
            title = cleaned
        if payload.owner is not None:
            cleaned = payload.owner.strip()
            if not cleaned:
                raise HTTPException(status_code=400, detail="owner cannot be empty")
            owner = cleaned
            if "@" in owner and not owner_email:
                owner_email = owner.strip().lower()
        if payload.owner_email is not None:
            owner_email = payload.owner_email
        if payload.due_date is not None:
            due_date = payload.due_date.strip() or None
        if payload.status is not None:
            status = payload.status.strip() or None
        if payload.contract_id is not None:
            contract_id = payload.contract_id or None
            if contract_id:
                exists = conn.execute(
                    "SELECT id FROM contracts WHERE id = ?", (contract_id,)
                ).fetchone()
                if not exists:
                    raise HTTPException(status_code=404, detail="Contract not found")

        conn.execute(
            """
            UPDATE pending_agreements
            SET title = ?, owner = ?, owner_email = ?, contract_id = ?, due_date = ?, status = ?
            WHERE id = ?
            """,
            (title, owner, owner_email, contract_id, due_date, status, agreement_id),
        )
        contract = None
        if contract_id:
            contract = conn.execute(
                "SELECT title, vendor FROM contracts WHERE id = ?",
                (contract_id,),
            ).fetchone()

    return {
        "id": agreement_id,
        "title": title,
        "owner": owner,
        "owner_email": owner_email,
        "due_date": due_date,
        "status": status,
        "contract_id": contract_id,
        "contract_title": contract["title"] if contract else None,
        "contract_vendor": contract["vendor"] if contract else None,
        "created_at": row["created_at"],
    }


@app.delete("/api/pending-agreements/{agreement_id}")
def delete_pending_agreement(agreement_id: str):
    with db() as conn:
        row = conn.execute(
            "SELECT id FROM pending_agreements WHERE id = ?", (agreement_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Pending agreement not found")
        conn.execute("DELETE FROM pending_agreements WHERE id = ?", (agreement_id,))
        return {"deleted": agreement_id}


@app.get("/api/pending-agreement-reminders")
def list_pending_agreement_reminders(_: Dict[str, Any] = Depends(require_admin)):
    with db() as conn:
        rows = conn.execute(
            """
            SELECT id, frequency, roles_json, recipients_json, message, created_at, updated_at
            FROM pending_agreement_reminders
            ORDER BY created_at DESC
            """
        ).fetchall()
        items = []
        for row in rows:
            item = dict(row)
            item["roles"] = safe_json_int_list(item.pop("roles_json", None))
            item["recipients"] = safe_json_list(item.pop("recipients_json", None))
            items.append(item)
        return items


@app.post("/api/pending-agreement-reminders")
def create_pending_agreement_reminder(
    payload: PendingAgreementReminderCreate,
    _: Dict[str, Any] = Depends(require_admin),
):
    if not payload.roles and not payload.recipients:
        raise HTTPException(
            status_code=400, detail="At least one role or recipient is required"
        )

    reminder_id = str(uuid.uuid4())
    created_at = now_iso()
    with db() as conn:
        role_ids = _validate_role_ids(conn, payload.roles)
        conn.execute(
            """
            INSERT INTO pending_agreement_reminders
              (id, frequency, roles_json, recipients_json, message, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                reminder_id,
                payload.frequency,
                json.dumps(role_ids),
                json.dumps(payload.recipients or []),
                payload.message,
                created_at,
                created_at,
            ),
        )
    return {
        "id": reminder_id,
        "frequency": payload.frequency,
        "roles": role_ids,
        "recipients": payload.recipients,
        "message": payload.message,
        "created_at": created_at,
        "updated_at": created_at,
    }


@app.put("/api/pending-agreement-reminders/{reminder_id}")
def update_pending_agreement_reminder(
    reminder_id: str,
    payload: PendingAgreementReminderUpdate,
    _: Dict[str, Any] = Depends(require_admin),
):
    with db() as conn:
        row = conn.execute(
            """
            SELECT id, frequency, roles_json, recipients_json, message, created_at, updated_at
            FROM pending_agreement_reminders WHERE id = ?
            """,
            (reminder_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Reminder rule not found")

        frequency = row["frequency"]
        roles = safe_json_int_list(row["roles_json"])
        recipients = safe_json_list(row["recipients_json"])
        message = row["message"]

        if payload.frequency is not None:
            if not payload.frequency:
                raise HTTPException(status_code=400, detail="frequency cannot be empty")
            frequency = payload.frequency
        if payload.roles is not None:
            roles = _validate_role_ids(conn, payload.roles)
        if payload.recipients is not None:
            recipients = payload.recipients
        if payload.message is not None:
            message = payload.message

        if not roles and not recipients:
            raise HTTPException(
                status_code=400, detail="At least one role or recipient is required"
            )

        updated_at = now_iso()
        conn.execute(
            """
            UPDATE pending_agreement_reminders
            SET frequency = ?, roles_json = ?, recipients_json = ?, message = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                frequency,
                json.dumps(roles),
                json.dumps(recipients),
                message,
                updated_at,
                reminder_id,
            ),
        )
    return {
        "id": reminder_id,
        "frequency": frequency,
        "roles": roles,
        "recipients": recipients,
        "message": message,
        "created_at": row["created_at"],
        "updated_at": updated_at,
    }


@app.delete("/api/pending-agreement-reminders/{reminder_id}")
def delete_pending_agreement_reminder(
    reminder_id: str,
    _: Dict[str, Any] = Depends(require_admin),
):
    with db() as conn:
        row = conn.execute(
            "SELECT id FROM pending_agreement_reminders WHERE id = ?",
            (reminder_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Reminder rule not found")
        conn.execute("DELETE FROM pending_agreement_reminders WHERE id = ?", (reminder_id,))
        return {"deleted": reminder_id}


@app.get("/api/tasks")
def list_tasks(
    limit: int = 20,
    offset: int = 0,
    query: str = "",
):
    limit = max(1, min(limit, 100))
    offset = max(offset, 0)
    where_clause = ""
    params: List[Any] = []
    if query:
        where_clause = (
            "WHERE lower(title) LIKE ? OR lower(coalesce(description, '')) LIKE ? "
            "OR lower(assignees_json) LIKE ?"
        )
        like = f"%{query.lower()}%"
        params.extend([like, like, like])

    with db() as conn:
        total = conn.execute(
            f"SELECT COUNT(1) AS count FROM tasks {where_clause}",
            params,
        ).fetchone()["count"]
        rows = conn.execute(
            f"""
            SELECT id, title, description, due_date, recurrence, reminders_json, assignees_json,
                   completed, created_at
            FROM tasks
            {where_clause}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
            """,
            (*params, limit, offset),
        ).fetchall()
        items = []
        for row in rows:
            data = dict(row)
            data["reminders"] = safe_json_list(data.pop("reminders_json", None))
            data["assignees"] = safe_json_list(data.pop("assignees_json", None))
            data["completed"] = bool(data.get("completed"))
            items.append(data)
        return {
            "items": items,
            "total": total,
            "limit": limit,
            "offset": offset,
        }


@app.post("/api/tasks")
def create_task(payload: TaskCreate):
    title = payload.title.strip()
    due_date = payload.due_date.strip()
    if not title or not due_date:
        raise HTTPException(status_code=400, detail="title and due_date are required")
    task_id = str(uuid.uuid4())
    created_at = now_iso()
    description = payload.description.strip() if payload.description else None
    recurrence = (payload.recurrence or "none").strip() or "none"
    reminders_json = json.dumps(payload.reminders or [])
    assignees_json = json.dumps(payload.assignees or [])

    with db() as conn:
        conn.execute(
            """
            INSERT INTO tasks (id, title, description, due_date, recurrence, reminders_json,
                               assignees_json, completed, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
            """,
            (
                task_id,
                title,
                description,
                due_date,
                recurrence,
                reminders_json,
                assignees_json,
                created_at,
            ),
        )
    return {
        "id": task_id,
        "title": title,
        "description": description,
        "due_date": due_date,
        "recurrence": recurrence,
        "reminders": payload.reminders or [],
        "assignees": payload.assignees or [],
        "completed": False,
        "created_at": created_at,
    }


@app.patch("/api/tasks/{task_id}")
def update_task_status(task_id: str, payload: TaskStatusUpdate):
    with db() as conn:
        row = conn.execute("SELECT id FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Task not found")
        conn.execute(
            "UPDATE tasks SET completed = ? WHERE id = ?",
            (1 if payload.completed else 0, task_id),
        )
        return {"id": task_id, "completed": payload.completed}


@app.get("/api/terms/definitions")
def list_term_definitions():
    with db() as conn:
        rows = conn.execute(
            "SELECT id, name, key, value_type, enabled, priority, extraction_hint FROM term_definitions ORDER BY priority ASC, name ASC"
        ).fetchall()
        return [dict(r) for r in rows]


@app.post("/api/contracts/{contract_id}/tags/{tag_id}")
def add_tag_to_contract(contract_id: str, tag_id: int):
    with db() as conn:
        conn.execute(
            """
            INSERT OR IGNORE INTO contract_tags (contract_id, tag_id, auto_generated, created_at)
            VALUES (?, ?, 0, ?)
            """,
            (contract_id, tag_id, now_iso()),
        )
        return {"contract_id": contract_id, "tag_id": tag_id}


@app.delete("/api/contracts/{contract_id}/tags/{tag_id}")
def remove_tag_from_contract(contract_id: str, tag_id: int):
    with db() as conn:
        conn.execute(
            "DELETE FROM contract_tags WHERE contract_id = ? AND tag_id = ?",
            (contract_id, tag_id),
        )
        return {"contract_id": contract_id, "tag_id": tag_id}


def _reprocess_contract(contract_id: str) -> Dict[str, Any]:
    with db() as conn:
        existing = conn.execute(
            """
            SELECT id, stored_path, original_filename, agreement_type
            FROM contracts
            WHERE id = ?
            """,
            (contract_id,),
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Contract not found")

        conn.execute(
            "DELETE FROM contract_tags WHERE contract_id = ? AND auto_generated = 1",
            (contract_id,),
        )

    logger.info(f"REPROCESS START contract_id={contract_id}")

    try:
        result = process_contract(
            db_path=DB_PATH,
            contract_id=contract_id,
            stored_path=existing["stored_path"],
            tesseract_cmd=TESSERACT_CMD,
            max_pages=8,
            poppler_path=POPPLER_PATH,
        )

        ocr_text = result.get("ocr_text", "")
        agreement_type = existing["agreement_type"]
        if not agreement_type or agreement_type == "Uncategorized":
            agreement_type = detect_agreement_type(ocr_text, existing["original_filename"])

        with db() as conn:
            conn.execute(
                "UPDATE contracts SET status='processed', agreement_type=? WHERE id=?",
                (agreement_type, contract_id),
            )

        auto_tag_contract(contract_id, ocr_text)
        logger.info(f"REPROCESS SUCCESS contract_id={contract_id}")

        return {
            "contract_id": contract_id,
            "status": "processed",
            "agreement_type": agreement_type,
            "pages": result.get("pages_ocrd"),
        }

    except Exception as e:
        error_msg = f"{type(e).__name__}: {str(e)}"
        with db() as conn:
            conn.execute("UPDATE contracts SET status='error' WHERE id=?", (contract_id,))
        logger.error(
            f"REPROCESS FAILED contract_id={contract_id} | {error_msg}\n{traceback.format_exc()}"
        )
        raise HTTPException(
            status_code=500, detail=f"Reprocessing failed: {error_msg}"
        )

# ----------------------------
# Upload
# ----------------------------
@app.post("/api/contracts/upload", response_model=UploadResponse)
async def upload_contract(
    file: UploadFile = File(...),
    title: Optional[str] = None,
    vendor: Optional[str] = None,
    agreement_type: Optional[str] = None,
):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    file_hash = sha256_bytes(data)
    fn = safe_filename(file.filename or "upload.bin")

    with db() as conn:
        existing = conn.execute(
            "SELECT * FROM contracts WHERE sha256 = ?", (file_hash,)
        ).fetchone()
        if existing:
            logger.info(f"DUPLICATE FILE contract_id={existing['id']} filename={fn}")
            return UploadResponse(
                contract_id=existing["id"],
                title=existing["title"],
                stored_path=existing["stored_path"],
                sha256=existing["sha256"],
                status=existing["status"],
            )

    contract_id = str(uuid.uuid4())
    dt = datetime.utcnow()
    subdir = os.path.join(DATA_ROOT, f"{dt.year:04d}", f"{dt.month:02d}")
    os.makedirs(subdir, exist_ok=True)

    stored_name = f"{contract_id}_{file_hash[:16]}_{fn}"
    stored_path = os.path.join(subdir, stored_name)

    with open(stored_path, "wb") as f:
        f.write(data)

    contract_title = title or os.path.splitext(fn)[0]

    with db() as conn:
        conn.execute(
            """
            INSERT INTO contracts (
              id, title, vendor, agreement_type,
              original_filename, sha256, stored_path,
              mime_type, uploaded_at, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                contract_id,
                contract_title,
                vendor,
                agreement_type,
                fn,
                file_hash,
                stored_path,
                file.content_type or "application/octet-stream",
                now_iso(),
                "processing",
            ),
        )
        conn.execute(
            "INSERT INTO contracts_fts (contract_id, title, vendor, ocr_text) VALUES (?, ?, ?, ?)",
            (contract_id, contract_title, vendor or "", ""),
        )

    logger.info(f"PROCESS START contract_id={contract_id} file={fn}")

    try:
        result = process_contract(
            db_path=DB_PATH,
            contract_id=contract_id,
            stored_path=stored_path,
            tesseract_cmd=TESSERACT_CMD,
            max_pages=8,
            poppler_path=POPPLER_PATH,
        )

        ocr_text = result.get("ocr_text", "")

        if not agreement_type:
            agreement_type = detect_agreement_type(ocr_text, fn)

        with db() as conn:
            conn.execute(
                "UPDATE contracts SET status='processed', agreement_type=? WHERE id=?",
                (agreement_type, contract_id),
            )

        auto_tag_contract(contract_id, ocr_text)

        logger.info(f"PROCESS SUCCESS contract_id={contract_id}")
        return UploadResponse(
            contract_id=contract_id,
            title=contract_title,
            stored_path=stored_path,
            sha256=file_hash,
            status="processed",
        )

    except Exception as e:
        error_msg = f"{type(e).__name__}: {str(e)}"
        with db() as conn:
            conn.execute("UPDATE contracts SET status='error' WHERE id=?", (contract_id,))
        logger.error(
            f"PROCESS FAILED contract_id={contract_id} filename={fn} | {error_msg}\n{traceback.format_exc()}"
        )
        raise HTTPException(
            status_code=500, detail=f"Processing failed: {error_msg}"
        )

# ----------------------------
# Reprocess
# ----------------------------
@app.post("/api/contracts/{contract_id}/reprocess")
def reprocess_single_contract(contract_id: str):
    return _reprocess_contract(contract_id)


@app.post("/api/contracts/reprocess", response_model=BulkReprocessResponse)
def reprocess_contracts(
    limit: int = 50,
    status: Optional[str] = None,
    agreement_type: Optional[str] = None,
    all: bool = False,
):
    limit = max(1, min(limit, 500))

    with db() as conn:
        where_clauses = []
        params: List[Any] = []

        if status:
            where_clauses.append("status = ?")
            params.append(status)
        if agreement_type:
            where_clauses.append("agreement_type = ?")
            params.append(agreement_type)

        where_sql = " AND ".join(where_clauses) if where_clauses else "1=1"

        if all:
            rows = conn.execute(
                f"""
                SELECT id
                FROM contracts
                WHERE {where_sql}
                ORDER BY uploaded_at DESC
                """,
                tuple(params),
            ).fetchall()
        else:
            params.append(limit)
            rows = conn.execute(
                f"""
                SELECT id
                FROM contracts
                WHERE {where_sql}
                ORDER BY uploaded_at DESC
                LIMIT ?
                """,
                tuple(params),
            ).fetchall()

    processed: List[str] = []
    errors: List[Dict[str, str]] = []

    for row in rows:
        contract_id = row["id"]
        try:
            _reprocess_contract(contract_id)
            processed.append(contract_id)
        except HTTPException as exc:
            errors.append({"contract_id": contract_id, "error": str(exc.detail)})
        except Exception as exc:
            errors.append({"contract_id": contract_id, "error": str(exc)})

    return {"processed": processed, "errors": errors}

# ----------------------------
# Calendar events endpoint
# ----------------------------
@app.get("/api/calendar/events")
def get_calendar_events(start: str, end: str):
    """Get events for calendar view (start and end are YYYY-MM-DD)"""
    with db() as conn:
        rows = conn.execute(
            """
            SELECT e.*, c.title, c.vendor, c.agreement_type
            FROM events e
            JOIN contracts c ON c.id = e.contract_id
            WHERE e.event_date >= ? AND e.event_date <= ?
            ORDER BY e.event_date ASC
            """,
            (start, end),
        ).fetchall()

        events = []
        for r in rows:
            tags = conn.execute(
                """
                SELECT t.name, t.color
                FROM contract_tags ct
                JOIN tags t ON t.id = ct.tag_id
                WHERE ct.contract_id = ?
                """,
                (r["contract_id"],),
            ).fetchall()

            events.append(
                {
                    **dict(r),
                    "tags": [{"name": t["name"], "color": t["color"]} for t in tags],
                }
            )

        return events

# ----------------------------
# Contract visibility helpers
# ----------------------------
def _filter_contract_visibility(
    conn: sqlite3.Connection,
    contract_ids: List[str],
    user_role_ids: List[int],
) -> List[str]:
    if not contract_ids:
        return []
    placeholders = ",".join("?" for _ in contract_ids)
    restricted_rows = conn.execute(
        f"""
        SELECT DISTINCT ct.contract_id
        FROM contract_tags ct
        JOIN tag_roles tr ON tr.tag_id = ct.tag_id
        WHERE ct.contract_id IN ({placeholders})
        """,
        tuple(contract_ids),
    ).fetchall()
    restricted_ids = {row["contract_id"] for row in restricted_rows}
    if not restricted_ids:
        return contract_ids
    if not user_role_ids:
        return [cid for cid in contract_ids if cid not in restricted_ids]
    role_placeholders = ",".join("?" for _ in user_role_ids)
    visible_rows = conn.execute(
        f"""
        SELECT DISTINCT ct.contract_id
        FROM contract_tags ct
        JOIN tag_roles tr ON tr.tag_id = ct.tag_id
        WHERE ct.contract_id IN ({placeholders})
          AND tr.role_id IN ({role_placeholders})
        """,
        tuple(contract_ids) + tuple(user_role_ids),
    ).fetchall()
    visible_ids = {row["contract_id"] for row in visible_rows}
    return [cid for cid in contract_ids if cid not in restricted_ids or cid in visible_ids]

# ----------------------------
# List contracts
# ----------------------------
@app.get("/api/contracts")
def list_contracts(
    limit: int = 50,
    offset: int = 0,
    status: Optional[str] = None,
    agreement_type: Optional[str] = None,
    q: Optional[str] = None,
    mode: Optional[Literal["quick", "fulltext"]] = "quick",
    include_tags: bool = True,
    request: Request = None,
):
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    q = (q or "").strip()

    with db() as conn:
        where_clauses = []
        params: List[Any] = []

        if status:
            where_clauses.append("status = ?")
            params.append(status)
        if agreement_type:
            where_clauses.append("agreement_type = ?")
            params.append(agreement_type)

        where_sql = " AND ".join(where_clauses) if where_clauses else "1=1"

        if q:
            if mode == "fulltext":
                params = [q] + params + [limit, offset]
                rows = conn.execute(
                    f"""
                    SELECT c.id, c.title, c.vendor, c.agreement_type,
                           c.original_filename, c.status, c.pages, c.uploaded_at, c.sha256
                    FROM contracts_fts f
                    JOIN contracts c ON c.id = f.contract_id
                    WHERE contracts_fts MATCH ?
                      AND {where_sql}
                    ORDER BY c.uploaded_at DESC
                    LIMIT ? OFFSET ?
                    """,
                    tuple(params),
                ).fetchall()
            else:
                like = f"%{q}%"
                params = [like, like, like] + params + [limit, offset]
                rows = conn.execute(
                    f"""
                    SELECT id, title, vendor, agreement_type,
                           original_filename, status, pages, uploaded_at, sha256
                    FROM contracts
                    WHERE (title LIKE ? OR vendor LIKE ? OR original_filename LIKE ?)
                      AND {where_sql}
                    ORDER BY uploaded_at DESC
                    LIMIT ? OFFSET ?
                    """,
                    tuple(params),
                ).fetchall()
        else:
            params.append(limit)
            params.append(offset)
            rows = conn.execute(
                f"""
                SELECT id, title, vendor, agreement_type,
                       original_filename, status, pages, uploaded_at, sha256
                FROM contracts
                WHERE {where_sql}
                ORDER BY uploaded_at DESC
                LIMIT ? OFFSET ?
                """,
                tuple(params),
            ).fetchall()

        result = [dict(r) for r in rows]
        user_role_ids: List[int] = []
        if request is not None:
            user = get_current_user(request)
            if user:
                user_role_ids = _get_user_role_ids(conn, user["id"])
        if result:
            contract_ids = [item["id"] for item in result]
            visible_ids = set(_filter_contract_visibility(conn, contract_ids, user_role_ids))
            result = [item for item in result if item["id"] in visible_ids]
        if not include_tags:
            return result

        for item in result:
            tags = conn.execute(
                """
                SELECT t.id, t.name, t.color, ct.auto_generated
                FROM contract_tags ct
                JOIN tags t ON t.id = ct.tag_id
                WHERE ct.contract_id = ?
                """,
                (item["id"],),
            ).fetchall()
            item["tags"] = [dict(t) for t in tags]

        return result


@app.put("/api/contracts/{contract_id}")
def update_contract(contract_id: str, payload: ContractUpdate):
    with db() as conn:
        existing = conn.execute(
            "SELECT * FROM contracts WHERE id = ?",
            (contract_id,),
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Contract not found")

        fields = []
        params: List[Any] = []

        if payload.title is not None:
            fields.append("title = ?")
            params.append(payload.title)
        if payload.vendor is not None:
            fields.append("vendor = ?")
            params.append(payload.vendor)
        if payload.agreement_type is not None:
            fields.append("agreement_type = ?")
            params.append(payload.agreement_type or "Uncategorized")

        if fields:
            conn.execute(
                f"UPDATE contracts SET {', '.join(fields)} WHERE id = ?",
                tuple(params + [contract_id]),
            )
            conn.execute(
                "UPDATE contracts_fts SET title = ?, vendor = ? WHERE contract_id = ?",
                (
                    payload.title or existing["title"],
                    payload.vendor or existing["vendor"] or "",
                    contract_id,
                ),
            )

    return get_contract(contract_id)


@app.delete("/api/contracts/{contract_id}")
def delete_contract(contract_id: str):
    with db() as conn:
        existing = conn.execute(
            "SELECT id, stored_path FROM contracts WHERE id = ?",
            (contract_id,),
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Contract not found")

        conn.execute("DELETE FROM contracts WHERE id = ?", (contract_id,))
        conn.execute("DELETE FROM contracts_fts WHERE contract_id = ?", (contract_id,))

    stored_path = existing["stored_path"]
    if stored_path and os.path.exists(stored_path):
        try:
            os.remove(stored_path)
        except OSError as exc:
            logger.warning(
                "Failed to delete stored file %s for contract %s: %s",
                stored_path,
                contract_id,
                exc,
            )

    return {"deleted": contract_id}

# ----------------------------
# Contract detail
# ----------------------------
@app.get("/api/contracts/{contract_id}")
def get_contract(contract_id: str):
    with db() as conn:
        c = conn.execute(
            "SELECT * FROM contracts WHERE id = ?", (contract_id,)
        ).fetchone()
        if not c:
            raise HTTPException(status_code=404, detail="Contract not found")

        terms = conn.execute(
            """
            SELECT ti.*, td.name, td.value_type
            FROM term_instances ti
            JOIN term_definitions td ON td.key = ti.term_key
            WHERE ti.contract_id = ?
            ORDER BY td.priority ASC
            """,
            (contract_id,),
        ).fetchall()

        events = conn.execute(
            "SELECT * FROM events WHERE contract_id = ? ORDER BY event_date ASC",
            (contract_id,),
        ).fetchall()

        tags = conn.execute(
            """
            SELECT t.id, t.name, t.color, ct.auto_generated
            FROM contract_tags ct
            JOIN tags t ON t.id = ct.tag_id
            WHERE ct.contract_id = ?
            """,
            (contract_id,),
        ).fetchall()

        reminder_map: Dict[str, Any] = {}
        for ev in events:
            rs = conn.execute(
                "SELECT * FROM reminder_settings WHERE event_id = ?", (ev["id"],)
            ).fetchone()
            if rs:
                reminder_map[ev["id"]] = {
                    "enabled": bool(rs["enabled"]),
                    "recipients": rs["recipients"].split(","),
                    "offsets": json.loads(rs["offsets_json"]),
                    "updated_at": rs["updated_at"],
                }
            else:
                reminder_map[ev["id"]] = None

        return {
            "contract": dict(c),
            "terms": [dict(t) for t in terms],
            "events": [dict(e) for e in events],
            "tags": [dict(t) for t in tags],
            "reminders": reminder_map,
        }


@app.put("/api/contracts/{contract_id}/terms/{term_key}")
def upsert_term(contract_id: str, term_key: str, payload: TermUpsert):
    if payload.term_key and payload.term_key != term_key:
        raise HTTPException(status_code=400, detail="term_key mismatch")
    payload.term_key = term_key
    _upsert_manual_term(contract_id, payload)
    return get_contract(contract_id)


@app.delete("/api/contracts/{contract_id}/terms/{term_key}")
def delete_term(contract_id: str, term_key: str):
    with db() as conn:
        conn.execute(
            "DELETE FROM term_instances WHERE contract_id = ? AND term_key = ?",
            (contract_id, term_key),
        )
        conn.execute(
            "DELETE FROM events WHERE contract_id = ? AND derived_from_term_key = ?",
            (contract_id, term_key),
        )
    return {"deleted": term_key}


@app.post("/api/contracts/{contract_id}/events")
def create_event(contract_id: str, payload: EventCreate):
    event_date = _normalize_date_string(payload.event_date)
    with db() as conn:
        c = conn.execute(
            "SELECT id FROM contracts WHERE id = ?",
            (contract_id,),
        ).fetchone()
        if not c:
            raise HTTPException(status_code=404, detail="Contract not found")

        ev_id = str(uuid.uuid4())
        conn.execute(
            """
            INSERT INTO events (id, contract_id, event_type, event_date, derived_from_term_key, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (ev_id, contract_id, payload.event_type, event_date, payload.derived_from_term_key, now_iso()),
        )

    return {"event_id": ev_id}


@app.put("/api/events/{event_id}")
def update_event(event_id: str, payload: EventUpdate):
    with db() as conn:
        ev = conn.execute(
            "SELECT * FROM events WHERE id = ?",
            (event_id,),
        ).fetchone()
        if not ev:
            raise HTTPException(status_code=404, detail="Event not found")

        new_date = payload.event_date or ev["event_date"]
        if payload.event_date:
            new_date = _normalize_date_string(payload.event_date)
        new_type = payload.event_type or ev["event_type"]
        derived = payload.derived_from_term_key if payload.derived_from_term_key is not None else ev["derived_from_term_key"]

        conn.execute(
            "UPDATE events SET event_type = ?, event_date = ?, derived_from_term_key = ? WHERE id = ?",
            (new_type, new_date, derived, event_id),
        )

    return {"event_id": event_id, "event_type": new_type, "event_date": new_date}


@app.delete("/api/events/{event_id}")
def delete_event(event_id: str):
    with db() as conn:
        conn.execute("DELETE FROM reminder_settings WHERE event_id = ?", (event_id,))
        conn.execute("DELETE FROM events WHERE id = ?", (event_id,))
    return {"deleted": event_id}


@app.get("/api/contracts/{contract_id}/status")
def get_contract_status(contract_id: str):
    with db() as conn:
        c = conn.execute(
            "SELECT id, status, pages FROM contracts WHERE id = ?",
            (contract_id,),
        ).fetchone()
        if not c:
            raise HTTPException(status_code=404, detail="Contract not found")
        return dict(c)

# ----------------------------
# View / download
# ----------------------------
@app.get("/api/contracts/{contract_id}/original")
def view_original(contract_id: str):
    with db() as conn:
        c = conn.execute(
            "SELECT stored_path, original_filename, mime_type FROM contracts WHERE id = ?",
            (contract_id,),
        ).fetchone()
        if not c:
            raise HTTPException(status_code=404, detail="Contract not found")
    if not os.path.exists(c["stored_path"]):
        raise HTTPException(status_code=404, detail="File missing on disk")
    return FileResponse(
        c["stored_path"],
        media_type=c["mime_type"],
        headers={
            "Content-Disposition": f'inline; filename="{c["original_filename"]}"'
        },
    )


@app.get("/api/contracts/{contract_id}/download")
def download_contract(contract_id: str):
    with db() as conn:
        c = conn.execute(
            "SELECT stored_path, original_filename, mime_type FROM contracts WHERE id = ?",
            (contract_id,),
        ).fetchone()
        if not c:
            raise HTTPException(status_code=404, detail="Contract not found")
    if not os.path.exists(c["stored_path"]):
        raise HTTPException(status_code=404, detail="File missing on disk")
    return FileResponse(
        c["stored_path"],
        media_type=c["mime_type"],
        filename=c["original_filename"],
        headers={
            "Content-Disposition": f'attachment; filename="{c["original_filename"]}"'
        },
    )


@app.get("/api/contracts/{contract_id}/ocr-text")
def get_contract_ocr_text(contract_id: str):
    with db() as conn:
        c = conn.execute(
            "SELECT id FROM contracts WHERE id = ?",
            (contract_id,),
        ).fetchone()
        if not c:
            raise HTTPException(status_code=404, detail="Contract not found")

        rows = conn.execute(
            """
            SELECT page_number, text
            FROM ocr_pages
            WHERE contract_id = ?
            ORDER BY page_number ASC
            """,
            (contract_id,),
        ).fetchall()

    pages = [dict(r) for r in rows]
    combined = "\n\n".join(
        [f"--- Page {p['page_number']} ---\n{p['text']}" for p in pages]
    )
    return {"pages": pages, "text": combined}

# ----------------------------
# Month Events API (month grid)
# ----------------------------
@app.get("/api/events")
def list_events(month: str, event_type: str = "all", sort: str = "date_asc"):
    """
    month: 'YYYY-MM'
    event_type: 'all' | 'renewal' | 'effective' | 'termination' | 'auto_opt_out' etc.
    """
    params: List[Any] = []
    where = "WHERE 1=1"

    if month != "all":
        try:
            y, m = month.split("-")
            y = int(y)
            m = int(m)
            start = date(y, m, 1)
            end = date(y + (m // 12), (m % 12) + 1, 1)
        except Exception:
            raise HTTPException(status_code=400, detail="month must be YYYY-MM or 'all'")

        params = [start.isoformat(), end.isoformat()]
        where = "WHERE e.event_date >= ? AND e.event_date < ?"

    if event_type != "all":
        where += " AND e.event_type = ?"
        params.append(event_type)

    order = "ORDER BY e.event_date ASC"
    if sort == "date_desc":
        order = "ORDER BY e.event_date DESC"
    elif sort == "title_asc":
        order = "ORDER BY c.title ASC, e.event_date ASC"
    elif sort == "title_desc":
        order = "ORDER BY c.title DESC, e.event_date ASC"

    with db() as conn:
        rows = conn.execute(
            f"""
            SELECT e.*, c.title, c.vendor, c.agreement_type
            FROM events e
            JOIN contracts c ON c.id = e.contract_id
            {where}
            {order}
            """,
            tuple(params),
        ).fetchall()

        out = []
        for r in rows:
            rs = conn.execute(
                "SELECT * FROM reminder_settings WHERE event_id = ?", (r["id"],)
            ).fetchone()
            reminder = None
            if rs:
                offsets = sorted(json.loads(rs["offsets_json"]))
                reminder = {
                    "enabled": bool(rs["enabled"]),
                    "offsets": offsets,
                    "recipients": rs["recipients"].split(","),
                }
            out.append({**dict(r), "reminder": reminder})

        return out

# ----------------------------
# Search API
# ----------------------------
@app.get("/api/search")
def search(
    mode: SearchMode,
    q: str = "",
    term_key: Optional[str] = None,
    limit: int = 50,
):
    q = (q or "").strip()
    limit = max(1, min(limit, 200))

    with db() as conn:
        if mode == "quick":
            like = f"%{q}%"
            rows = conn.execute(
                """
                SELECT id, title, vendor, agreement_type,
                       original_filename, uploaded_at, status
                FROM contracts
                WHERE title LIKE ? OR vendor LIKE ? OR original_filename LIKE ?
                ORDER BY uploaded_at DESC
                LIMIT ?
                """,
                (like, like, like, limit),
            ).fetchall()
            return [dict(r) for r in rows]

        if mode == "terms":
            if not term_key:
                raise HTTPException(
                    status_code=400, detail="term_key required for terms mode"
                )
            like = f"%{q}%"
            rows = conn.execute(
                """
                SELECT c.id, c.title, c.vendor, c.agreement_type,
                       c.original_filename, ti.term_key,
                       ti.value_normalized, ti.status, ti.confidence
                FROM term_instances ti
                JOIN contracts c ON c.id = ti.contract_id
                WHERE ti.term_key = ?
                  AND (ti.value_raw LIKE ? OR ti.value_normalized LIKE ?)
                ORDER BY ti.confidence DESC
                LIMIT ?
                """,
                (term_key, like, like, limit),
            ).fetchall()
            return [dict(r) for r in rows]

        if not q:
            return []

        rows = conn.execute(
            """
            SELECT c.id, c.title, c.vendor, c.agreement_type,
                   c.original_filename, c.uploaded_at
            FROM contracts_fts f
            JOIN contracts c ON c.id = f.contract_id
            WHERE contracts_fts MATCH ?
            LIMIT ?
            """,
            (q, limit),
        ).fetchall()
        return [dict(r) for r in rows]

# ----------------------------
# Reminders
# ----------------------------
@app.put("/api/events/{event_id}/reminders")
def update_reminders(event_id: str, payload: ReminderUpdate):
    offsets = sorted(set(int(x) for x in payload.offsets if int(x) >= 0))
    recipients = [r.strip() for r in payload.recipients if r.strip()]
    if payload.enabled:
        if not offsets:
            raise HTTPException(
                status_code=400, detail="offsets must contain non-negative integers"
            )
        if not recipients:
            raise HTTPException(status_code=400, detail="recipients cannot be empty")
    else:
        if not offsets:
            offsets = []
        recipients = []

    with db() as conn:
        ev = conn.execute(
            "SELECT id FROM events WHERE id = ?", (event_id,)
        ).fetchone()
        if not ev:
            raise HTTPException(status_code=404, detail="Event not found")

        conn.execute(
            """
            INSERT INTO reminder_settings (event_id, recipients, offsets_json, enabled, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(event_id) DO UPDATE SET
              recipients = excluded.recipients,
              offsets_json = excluded.offsets_json,
              enabled = excluded.enabled,
              updated_at = excluded.updated_at
            """,
            (
                event_id,
                ",".join(recipients),
                json.dumps(offsets),
                1 if payload.enabled else 0,
                now_iso(),
            ),
        )

    return {
        "event_id": event_id,
        "recipients": recipients,
        "offsets": offsets,
        "enabled": payload.enabled,
    }

# ----------------------------
# Reminder email delivery
# ----------------------------
def _smtp_from_address() -> str:
    from_addr = _env_first("SMTP_FROM", "SMTP_FROM_ADDRESS")
    if from_addr:
        return from_addr
    username = _env_first("SMTP_USERNAME", "SMTP_USER", "SMTP_LOGIN", "SMTPUsers")
    if username:
        return username
    raise RuntimeError("SMTP_FROM or SMTP_USERNAME must be set for email delivery")


def _app_base_url() -> str:
    base = _env_first("APP_BASE_URL", "PUBLIC_APP_URL", "APP_URL")
    return base.rstrip("/") if base else ""


def _format_app_link(label: str, path: str = "") -> Optional[str]:
    base = _app_base_url()
    if not base:
        return None
    return f"{label}: {base}{path}"


def _log_notification_send(
    kind: str,
    recipients: List[str],
    subject: str,
    body: str,
    status: str,
    error: Optional[str] = None,
    related_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    payload = json.dumps(recipients)
    metadata_json = json.dumps(metadata) if metadata else None
    with db() as conn:
        conn.execute(
            """
            INSERT INTO notification_logs (
              id, kind, recipients_json, subject, body, status, error, related_id, metadata_json, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(uuid.uuid4()),
                kind,
                payload,
                subject,
                body,
                status,
                error,
                related_id,
                metadata_json,
                now_iso(),
            ),
        )


def _send_email(recipients: List[str], subject: str, body: str) -> None:
    # SMTP configuration (set as environment variables):
    #   SMTP_HOST        -> SMTP server hostname (e.g., smtp.sendgrid.net)
    #   SMTP_PORT        -> SMTP server port (e.g., 587)
    #   SMTP_USERNAME    -> SMTP login username (SendGrid uses "apikey")
    #   SMTP_PASSWORD    -> SMTP login password (SendGrid API key value)
    # Optional/alternate keys also accepted:
    #   SMTP_SERVER or SMTP_Server (host), SMTPUsers (username), SMTP_Password (password)
    #   SMTP_FROM / SMTP_FROM_ADDRESS (from email), SMTP_FROM_NAME (sender name)
    host = _env_first("SMTP_HOST", "SMTP_SERVER", "SMTP_Server")
    if not host:
        raise RuntimeError("SMTP_HOST is not configured")

    port = int(_env_first("SMTP_PORT") or "587")
    username = _env_first("SMTP_USERNAME", "SMTP_USER", "SMTP_LOGIN", "SMTPUsers")
    password = _env_first("SMTP_PASSWORD", "SMTP_Password")
    use_tls = os.getenv("SMTP_USE_TLS", "true").lower() in {"1", "true", "yes"}
    use_ssl = os.getenv("SMTP_USE_SSL", "false").lower() in {"1", "true", "yes"}
    from_name = _env_first("SMTP_FROM_NAME", "SMTP_SENDER_NAME")
    from_addr = _smtp_from_address()

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"{from_name} <{from_addr}>" if from_name else from_addr
    msg["To"] = ", ".join(recipients)
    msg.set_content(body)

    if use_ssl:
        with smtplib.SMTP_SSL(host, port) as smtp:
            if username and password:
                smtp.login(username, password)
            smtp.send_message(msg)
        return

    with smtplib.SMTP(host, port) as smtp:
        if use_tls:
            smtp.starttls()
        if username and password:
            smtp.login(username, password)
        smtp.send_message(msg)


def _send_email_with_log(
    recipients: List[str],
    subject: str,
    body: str,
    kind: str,
    related_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    try:
        _send_email(recipients, subject, body)
        _log_notification_send(
            kind=kind,
            recipients=recipients,
            subject=subject,
            body=body,
            status="sent",
            related_id=related_id,
            metadata=metadata,
        )
    except Exception as exc:
        error_msg = f"{type(exc).__name__}: {exc}"
        _log_notification_send(
            kind=kind,
            recipients=recipients,
            subject=subject,
            body=body,
            status="error",
            error=error_msg,
            related_id=related_id,
            metadata=metadata,
        )
        raise

def _format_event_subject(event_type: str, title: str, event_date: str, offset_days: int) -> str:
    kind = event_type.replace("_", " ").title()
    if offset_days == 0:
        return f"{kind} today: {title} ({event_date})"
    return f"{kind} in {offset_days} days: {title} ({event_date})"


def _format_event_body(event: sqlite3.Row, offset_days: int) -> str:
    contract_status = event["contract_status"] or "Unknown"
    lines = [
        f"Contract: {event['title']}",
        f"Vendor: {event['vendor'] or 'N/A'}",
        f"Agreement Type: {event['agreement_type'] or 'Uncategorized'}",
        f"Contract Status: {contract_status}",
        f"Event Type: {event['event_type']}",
        f"Event Date: {event['event_date']}",
        f"Reminder Offset: {offset_days} day(s)",
    ]
    app_link = _format_app_link("Open ContractOCR")
    if app_link:
        lines.extend(
            [
                "",
                app_link,
                _format_app_link(
                    "Download contract PDF", f"/api/contracts/{event['contract_id']}/download"
                ),
            ]
        )
    return "\n".join(lines)


def _send_due_reminders(reference_date: date) -> Dict[str, Any]:
    sent = 0
    skipped = 0
    errors: List[Dict[str, str]] = []

    with db() as conn:
        rows = conn.execute(
            """
            SELECT rs.event_id, rs.recipients, rs.offsets_json, rs.enabled,
                   e.event_date, e.event_type, e.contract_id,
                   c.title, c.vendor, c.agreement_type, c.status as contract_status
            FROM reminder_settings rs
            JOIN events e ON e.id = rs.event_id
            JOIN contracts c ON c.id = e.contract_id
            WHERE rs.enabled = 1
            """
        ).fetchall()

        for row in rows:
            offsets = json.loads(row["offsets_json"])
            event_date = date.fromisoformat(row["event_date"])
            recipients = [r.strip() for r in row["recipients"].split(",") if r.strip()]
            if not recipients:
                skipped += 1
                continue

            for offset in offsets:
                try:
                    offset_days = int(offset)
                except (TypeError, ValueError):
                    continue

                scheduled_for = (event_date - timedelta(days=offset_days)).isoformat()
                if scheduled_for != reference_date.isoformat():
                    continue

                existing = conn.execute(
                    """
                    SELECT status FROM reminder_sends
                    WHERE event_id = ? AND offset_days = ? AND scheduled_for = ?
                    """,
                    (row["event_id"], offset_days, scheduled_for),
                ).fetchone()
                if existing and existing["status"] == "sent":
                    skipped += 1
                    continue

                conn.execute(
                    """
                    INSERT OR IGNORE INTO reminder_sends (event_id, offset_days, scheduled_for, status)
                    VALUES (?, ?, ?, 'pending')
                    """,
                    (row["event_id"], offset_days, scheduled_for),
                )

                try:
                    subject = _format_event_subject(
                        row["event_type"],
                        row["title"],
                        row["event_date"],
                        offset_days,
                    )
                    body = _format_event_body(row, offset_days)
                    _send_email_with_log(
                        recipients,
                        subject,
                        body,
                        kind="event_reminder",
                        related_id=row["event_id"],
                        metadata={
                            "event_id": row["event_id"],
                            "contract_id": row["contract_id"],
                            "event_type": row["event_type"],
                            "event_date": row["event_date"],
                            "offset_days": offset_days,
                            "scheduled_for": scheduled_for,
                        },
                    )
                    conn.execute(
                        """
                        UPDATE reminder_sends
                        SET sent_at = ?, status = 'sent', error = NULL
                        WHERE event_id = ? AND offset_days = ? AND scheduled_for = ?
                        """,
                        (now_iso(), row["event_id"], offset_days, scheduled_for),
                    )
                    sent += 1
                except Exception as exc:
                    error_msg = f"{type(exc).__name__}: {exc}"
                    conn.execute(
                        """
                        UPDATE reminder_sends
                        SET status = 'error', error = ?
                        WHERE event_id = ? AND offset_days = ? AND scheduled_for = ?
                        """,
                        (error_msg, row["event_id"], offset_days, scheduled_for),
                    )
                    errors.append(
                        {
                            "event_id": row["event_id"],
                            "offset_days": offset_days,
                            "scheduled_for": scheduled_for,
                            "error": error_msg,
                        }
                    )

    return {"sent": sent, "skipped": skipped, "errors": errors}


def _parse_email_list(values: List[str]) -> List[str]:
    cleaned = [str(v).strip() for v in values if str(v).strip()]
    seen = set()
    unique = []
    for value in cleaned:
        lower = value.lower()
        if lower in seen:
            continue
        seen.add(lower)
        unique.append(value)
    return unique


def _resolve_pending_agreement_recipient(
    conn: sqlite3.Connection, agreement: sqlite3.Row
) -> Optional[str]:
    owner_email = (agreement["owner_email"] or "").strip().lower()
    if owner_email:
        return owner_email
    owner = (agreement["owner"] or "").strip()
    if "@" in owner:
        return owner.strip().lower()
    if owner:
        row = conn.execute(
            "SELECT email FROM notification_users WHERE lower(name) = ? LIMIT 1",
            (owner.lower(),),
        ).fetchone()
        if row and row["email"]:
            return str(row["email"]).strip().lower()
    return None


def _should_send_frequency(frequency: str, reference_date: date) -> bool:
    frequency = (frequency or "").strip().lower()
    if frequency == "daily":
        return True
    if frequency == "weekly":
        return reference_date.weekday() == 0
    if frequency == "monthly":
        return reference_date.day == 1
    return False


def _format_pending_agreement_subject(frequency: str) -> str:
    label = frequency.strip().lower() or "scheduled"
    return f"Pending agreement reminder ({label})"


def _format_pending_agreement_body(
    message: Optional[str], agreements: List[sqlite3.Row]
) -> str:
    lines = []
    if message:
        lines.append(message.strip())
    if message:
        lines.append("")
    if not agreements:
        lines.append("No pending agreements are currently in the queue.")
        return "\n".join(lines)
    lines.append("Pending agreements:")
    for agreement in agreements:
        due_date = agreement["due_date"] or "N/A"
        status = agreement["status"] or "Pending"
        contract_label = agreement["contract_title"] or agreement["contract_id"] or "Unlinked"
        lines.append(
            f"- {agreement['title']} (Owner: {agreement['owner']}, Contract: {contract_label}, Due: {due_date}, Status: {status})"
        )
    app_link = _format_app_link("Open ContractOCR")
    if app_link:
        lines.extend(["", app_link])
    return "\n".join(lines)


def _format_pending_agreement_nudge_body(agreement: sqlite3.Row) -> str:
    due_date = agreement["due_date"] or "N/A"
    status = agreement["status"] or "Pending"
    contract_label = agreement["contract_title"] or agreement["contract_id"] or "Unlinked"
    lines = [
        "A pending agreement is ready for your review.",
        "",
        f"Title: {agreement['title']}",
        f"Owner: {agreement['owner']}",
        f"Contract: {contract_label}",
        f"Due Date: {due_date}",
        f"Status: {status}",
    ]
    app_link = _format_app_link("Open ContractOCR")
    if app_link:
        lines.extend(["", app_link])
    if agreement["contract_id"]:
        contract_link = _format_app_link(
            "Download contract PDF", f"/api/contracts/{agreement['contract_id']}/download"
        )
        if contract_link:
            lines.append(contract_link)
    return "\n".join(lines)


def _format_pending_agreement_action_body(
    agreement: sqlite3.Row, action_label: str
) -> str:
    due_date = agreement["due_date"] or "N/A"
    status = agreement["status"] or "Pending"
    contract_label = agreement["contract_title"] or agreement["contract_id"] or "Unlinked"
    lines = [
        f"Pending agreement {action_label.lower()} notification.",
        "",
        f"Title: {agreement['title']}",
        f"Owner: {agreement['owner']}",
        f"Contract: {contract_label}",
        f"Due Date: {due_date}",
        f"Status: {status}",
    ]
    app_link = _format_app_link("Open ContractOCR")
    if app_link:
        lines.extend(["", app_link])
    if agreement["contract_id"]:
        contract_link = _format_app_link(
            "Download contract PDF", f"/api/contracts/{agreement['contract_id']}/download"
        )
        if contract_link:
            lines.append(contract_link)
    return "\n".join(lines)


def _format_task_nudge_body(task: sqlite3.Row) -> str:
    due_date = task["due_date"] or "N/A"
    reminders = ", ".join(safe_json_list(task["reminders_json"])) or "None"
    description = task["description"] or "No description provided."
    lines = [
        "A task has been nudged for your attention.",
        "",
        f"Title: {task['title']}",
        f"Due Date: {due_date}",
        f"Reminders: {reminders}",
        "",
        f"Description: {description}",
    ]
    app_link = _format_app_link("Open ContractOCR")
    if app_link:
        lines.extend(["", app_link])
    return "\n".join(lines)


@app.post("/api/reminders/send")
def send_reminders(date_str: Optional[str] = None):
    if date_str:
        target_date = _normalize_date_string(date_str)
        reference_date = date.fromisoformat(target_date)
    else:
        reference_date = date.today()
    return _send_due_reminders(reference_date)


@app.post("/api/pending-agreement-reminders/send")
def send_pending_agreement_reminders(date_str: Optional[str] = None):
    if date_str:
        target_date = _normalize_date_string(date_str)
        reference_date = date.fromisoformat(target_date)
    else:
        reference_date = date.today()

    sent = 0
    skipped = 0
    errors: List[Dict[str, str]] = []

    with db() as conn:
        reminders = conn.execute(
            """
            SELECT id, frequency, roles_json, recipients_json, message
            FROM pending_agreement_reminders
            ORDER BY created_at DESC
            """
        ).fetchall()
        agreements = conn.execute(
            """
            SELECT p.id, p.title, p.owner, p.owner_email, p.due_date, p.status, p.contract_id,
                   p.created_at, c.title AS contract_title
            FROM pending_agreements p
            LEFT JOIN contracts c ON c.id = p.contract_id
            ORDER BY created_at DESC
            """
        ).fetchall()

        for reminder in reminders:
            if not _should_send_frequency(reminder["frequency"], reference_date):
                skipped += 1
                continue
            role_ids = safe_json_int_list(reminder["roles_json"])
            role_recipients = _load_role_recipients(conn, role_ids)
            recipients = _parse_email_list(
                safe_json_list(reminder["recipients_json"]) + role_recipients
            )
            if not recipients:
                skipped += 1
                continue

            subject = _format_pending_agreement_subject(reminder["frequency"])
            body = _format_pending_agreement_body(reminder["message"], agreements)
            try:
                _send_email_with_log(
                    recipients,
                    subject,
                    body,
                    kind="pending_agreement_reminder",
                    related_id=reminder["id"],
                    metadata={
                        "frequency": reminder["frequency"],
                        "agreement_count": len(agreements),
                        "reference_date": reference_date.isoformat(),
                    },
                )
                sent += 1
            except Exception as exc:
                errors.append(
                    {
                        "reminder_id": reminder["id"],
                        "error": f"{type(exc).__name__}: {exc}",
                    }
                )

    return {"sent": sent, "skipped": skipped, "errors": errors}


@app.post("/api/pending-agreements/{agreement_id}/nudge")
def nudge_pending_agreement(agreement_id: str):
    with db() as conn:
        agreement = conn.execute(
            """
            SELECT p.id, p.title, p.owner, p.owner_email, p.due_date, p.status,
                   p.contract_id, p.created_at, c.title AS contract_title,
                   c.vendor AS contract_vendor
            FROM pending_agreements p
            LEFT JOIN contracts c ON c.id = p.contract_id
            WHERE p.id = ?
            """,
            (agreement_id,),
        ).fetchone()
        if not agreement:
            raise HTTPException(status_code=404, detail="Pending agreement not found")
        recipient = _resolve_pending_agreement_recipient(conn, agreement)
        if not recipient:
            raise HTTPException(
                status_code=400,
                detail="Pending agreement owner email is missing",
            )

    subject = f"Pending agreement nudge: {agreement['title']}"
    body = _format_pending_agreement_nudge_body(agreement)
    _send_email_with_log(
        [recipient],
        subject,
        body,
        kind="pending_agreement_nudge",
        related_id=agreement_id,
        metadata={
            "agreement_id": agreement_id,
            "title": agreement["title"],
            "due_date": agreement["due_date"],
            "owner_email": recipient,
            "contract_id": agreement["contract_id"],
        },
    )
    return {"nudge": "sent", "agreement_id": agreement_id, "recipients": [recipient]}


@app.post("/api/pending-agreements/{agreement_id}/action")
def action_pending_agreement(agreement_id: str, payload: PendingAgreementAction):
    action = payload.action
    if action not in {"approve", "deny"}:
        raise HTTPException(status_code=400, detail="Action must be approve or deny")
    action_label = "Approved" if action == "approve" else "Denied"

    with db() as conn:
        agreement = conn.execute(
            """
            SELECT p.id, p.title, p.owner, p.owner_email, p.due_date, p.status,
                   p.contract_id, p.created_at, c.title AS contract_title,
                   c.vendor AS contract_vendor
            FROM pending_agreements p
            LEFT JOIN contracts c ON c.id = p.contract_id
            WHERE p.id = ?
            """,
            (agreement_id,),
        ).fetchone()
        if not agreement:
            raise HTTPException(status_code=404, detail="Pending agreement not found")
        conn.execute(
            "UPDATE pending_agreements SET status = ? WHERE id = ?",
            (action_label, agreement_id),
        )
        recipient = _resolve_pending_agreement_recipient(conn, agreement)
        if not recipient:
            raise HTTPException(
                status_code=400,
                detail="Pending agreement owner email is missing",
            )

    subject = f"Pending agreement {action}: {agreement['title']}"
    updated_agreement = dict(agreement)
    updated_agreement["status"] = action_label
    body = _format_pending_agreement_action_body(updated_agreement, action_label)
    _send_email_with_log(
        [recipient],
        subject,
        body,
        kind="pending_agreement_action",
        related_id=agreement_id,
        metadata={
            "agreement_id": agreement_id,
            "action": action,
            "status": action_label,
            "owner_email": recipient,
            "contract_id": agreement["contract_id"],
        },
    )

    response = dict(agreement)
    response["status"] = action_label
    response["owner_email"] = agreement["owner_email"] or recipient
    return {"action": action, "agreement": response, "recipients": [recipient]}


@app.post("/api/tasks/{task_id}/nudge")
def nudge_task(task_id: str):
    with db() as conn:
        task = conn.execute(
            """
            SELECT id, title, description, due_date, reminders_json, assignees_json, completed, created_at
            FROM tasks WHERE id = ?
            """,
            (task_id,),
        ).fetchone()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

    assignees = _parse_email_list(safe_json_list(task["assignees_json"]))
    if not assignees:
        raise HTTPException(status_code=400, detail="Task has no assignees to nudge")

    subject = f"Task nudge: {task['title']}"
    body = _format_task_nudge_body(task)
    _send_email_with_log(
        assignees,
        subject,
        body,
        kind="task_nudge",
        related_id=task_id,
        metadata={
            "task_id": task_id,
            "title": task["title"],
            "due_date": task["due_date"],
        },
    )
    return {"nudge": "sent", "task_id": task_id, "recipients": assignees}

# ----------------------------
# In-app bell notifications
# ----------------------------
@app.get("/api/notifications")
def notifications(window_days: int = 30):
    window_days = max(1, min(window_days, 365))

    with db() as conn:
        rows = conn.execute(
            """
            SELECT e.*, c.title, c.vendor, c.agreement_type
            FROM events e
            JOIN contracts c ON c.id = e.contract_id
            WHERE date(e.event_date) >= date('now')
              AND date(e.event_date) <= date('now', ?)
            ORDER BY e.event_date ASC
            LIMIT 200
            """,
            (f"+{window_days} days",),
        ).fetchall()

        return [dict(r) for r in rows]
