from processor import process_contract

import os
import json
import uuid
import hashlib
import sqlite3
import logging
import traceback
from datetime import datetime, date
from typing import Optional, List, Literal, Dict, Any

from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Optional .env support (won't crash if not installed)
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

# ----------------------------
# Paths / config
# ----------------------------
DB_PATH = os.environ.get("CONTRACT_DB", r"C:\ContractOCR\data\contracts.db")
DATA_ROOT = os.environ.get("CONTRACT_DATA", r"C:\ContractOCR\data\originals")
LOG_DIR = os.environ.get("CONTRACT_LOG", r"C:\ContractOCR\log")

TESSERACT_CMD = os.environ.get("TESSERACT_CMD", r"C:\Program Files\Tesseract-OCR\tesseract.exe")
# IMPORTANT: this must be the folder containing pdfinfo.exe + pdftoppm.exe
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

# ----------------------------
# FastAPI + CORS
# ----------------------------
app = FastAPI(title="Contract OCR & Renewal Tracker")

# UI runs on :3000, API runs on :8080
CORS_ORIGINS = os.environ.get(
    "CORS_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000,http://192.168.149.8:3000"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in CORS_ORIGINS if o.strip()],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
    return "".join(c for c in (name or "") if c.isalnum() or c in keep).strip()[:180] or "upload.bin"

# ----------------------------
# Schema + seed (embedded)
# ----------------------------
SCHEMA_SQL = r"""
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS contracts (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  vendor          TEXT,
  original_filename TEXT NOT NULL,
  sha256          TEXT NOT NULL,
  stored_path     TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  pages           INTEGER DEFAULT 0,
  uploaded_at     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'processed'
);

CREATE INDEX IF NOT EXISTS idx_contracts_uploaded_at ON contracts(uploaded_at);
CREATE INDEX IF NOT EXISTS idx_contracts_vendor ON contracts(vendor);
CREATE UNIQUE INDEX IF NOT EXISTS ux_contracts_sha256 ON contracts(sha256);

CREATE TABLE IF NOT EXISTS ocr_pages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id   TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  page_number   INTEGER NOT NULL,
  text          TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ocr_pages_contract_page ON ocr_pages(contract_id, page_number);

CREATE TABLE IF NOT EXISTS term_definitions (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE,
  key            TEXT NOT NULL UNIQUE,
  value_type     TEXT NOT NULL,
  enabled        INTEGER NOT NULL DEFAULT 1,
  priority       INTEGER NOT NULL DEFAULT 100,
  extraction_hint TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS term_instances (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id     TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  term_key        TEXT NOT NULL REFERENCES term_definitions(key),
  value_raw       TEXT,
  value_normalized TEXT,
  confidence      REAL NOT NULL DEFAULT 0.0,
  status          TEXT NOT NULL DEFAULT 'smart',
  source_page     INTEGER,
  source_snippet  TEXT,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_term_instances_contract ON term_instances(contract_id);
CREATE INDEX IF NOT EXISTS idx_term_instances_termkey ON term_instances(term_key);

CREATE TABLE IF NOT EXISTS events (
  id            TEXT PRIMARY KEY,
  contract_id   TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,
  event_date    TEXT NOT NULL,
  derived_from_term_key TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
CREATE INDEX IF NOT EXISTS idx_events_contract ON events(contract_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);

CREATE TABLE IF NOT EXISTS reminder_settings (
  event_id      TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  recipients    TEXT NOT NULL,
  offsets_json  TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminder_sends (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  offset_days   INTEGER NOT NULL,
  scheduled_for TEXT NOT NULL,
  sent_at       TEXT,
  status        TEXT NOT NULL,
  error         TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_reminder_sends_unique
  ON reminder_sends(event_id, offset_days, scheduled_for);

CREATE TABLE IF NOT EXISTS job_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  job_name     TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  status       TEXT NOT NULL,
  detail       TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS contracts_fts USING fts5(
  contract_id UNINDEXED,
  title,
  vendor,
  ocr_text
);
"""

SEED_TERMS_SQL = r"""
INSERT OR IGNORE INTO term_definitions (id, name, key, value_type, enabled, priority, extraction_hint, created_at)
VALUES
  (lower(hex(randomblob(16))), 'Effective Date', 'effective_date', 'date', 1, 10, 'effective date; effective as of; commencement', datetime('now')),
  (lower(hex(randomblob(16))), 'Renewal Date', 'renewal_date', 'date', 1, 20, 'renewal date; renews on; term ends', datetime('now')),
  (lower(hex(randomblob(16))), 'Termination Date', 'termination_date', 'date', 1, 30, 'termination date; terminates on; expires on', datetime('now')),
  (lower(hex(randomblob(16))), 'Automatic Renewal', 'automatic_renewal', 'bool', 1, 40, 'auto renew; automatically renews; renews automatically', datetime('now')),
  (lower(hex(randomblob(16))), 'Auto-Renew Opt-Out Days', 'auto_renew_opt_out_days', 'int', 1, 50, 'notice; written notice; days prior to renewal', datetime('now')),
  (lower(hex(randomblob(16))), 'Auto-Renew Opt-Out Date (calculated)', 'auto_renew_opt_out_date', 'date', 1, 60, 'calculated from renewal date - opt-out days', datetime('now')),
  (lower(hex(randomblob(16))), 'Governing Law', 'governing_law', 'text', 1, 80, 'governed by the laws of', datetime('now')),
  (lower(hex(randomblob(16))), 'Payment Terms', 'payment_terms', 'text', 1, 90, 'payment; due; net 30; invoice', datetime('now'));
"""

def init_db():
    with db() as conn:
        conn.executescript(SCHEMA_SQL)
        conn.executescript(SEED_TERMS_SQL)

@app.on_event("startup")
def _startup():
    logger.info(f"APP START pid={os.getpid()}")
    init_db()
    logger.info("APP READY")

@app.on_event("shutdown")
def _shutdown():
    logger.info("APP STOP")

# ----------------------------
# Request logging middleware
# ----------------------------
@app.middleware("http")
async def log_requests(request: Request, call_next):
    started = datetime.utcnow()
    try:
        response = await call_next(request)
        ms = int((datetime.utcnow() - started).total_seconds() * 1000)
        logger.info(f"{request.method} {request.url.path} -> {response.status_code} ({ms}ms)")
        return response
    except Exception as e:
        ms = int((datetime.utcnow() - started).total_seconds() * 1000)
        logger.error(f"UNHANDLED {request.method} {request.url.path} -> 500 ({ms}ms) | {e}")
        logger.error(traceback.format_exc())
        return JSONResponse(status_code=500, content={"detail": str(e)})

# ----------------------------
# Models
# ----------------------------
SearchMode = Literal["quick", "terms", "fulltext"]

class ReminderUpdate(BaseModel):
    recipients: List[str] = Field(..., min_items=1)
    offsets: List[int] = Field(default_factory=lambda: [90, 60, 30, 7])
    enabled: bool = True

class UploadResponse(BaseModel):
    contract_id: str
    title: str
    stored_path: str
    sha256: str
    status: str

# ----------------------------
# Upload
# ----------------------------
@app.post("/api/contracts/upload", response_model=UploadResponse)
async def upload_contract(file: UploadFile = File(...), title: Optional[str] = None, vendor: Optional[str] = None):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    file_hash = sha256_bytes(data)
    fn = safe_filename(file.filename or "upload.bin")

    # Duplicate check
    with db() as conn:
        existing = conn.execute("SELECT * FROM contracts WHERE sha256 = ?", (file_hash,)).fetchone()
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

    # Insert contract row + placeholder FTS entry
    with db() as conn:
        conn.execute(
            """INSERT INTO contracts (id, title, vendor, original_filename, sha256, stored_path, mime_type, uploaded_at, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                contract_id,
                contract_title,
                vendor,
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

    # Process (OCR + extraction)
    logger.info(f"PROCESS START contract_id={contract_id} file={fn}")
    try:
        process_contract(
            db_path=DB_PATH,
            contract_id=contract_id,
            stored_path=stored_path,
            tesseract_cmd=TESSERACT_CMD,
            max_pages=8,
            poppler_path=POPPLER_PATH,
        )
        with db() as conn:
            conn.execute("UPDATE contracts SET status='processed' WHERE id=?", (contract_id,))
        logger.info(f"PROCESS SUCCESS contract_id={contract_id}")

        return UploadResponse(
            contract_id=contract_id,
            title=contract_title,
            stored_path=stored_path,
            sha256=file_hash,
            status="processed",
        )

    except Exception as e:
        with db() as conn:
            conn.execute("UPDATE contracts SET status='error' WHERE id=?", (contract_id,))
        logger.error(f"PROCESS FAILED contract_id={contract_id} | {e}")
        logger.error(traceback.format_exc())

        # KISS: return 200 with status=error so UI can mark red
        return UploadResponse(
            contract_id=contract_id,
            title=contract_title,
            stored_path=stored_path,
            sha256=file_hash,
            status="error",
        )

# ----------------------------
# Contract detail
# ----------------------------
@app.get("/api/contracts/{contract_id}")
def get_contract(contract_id: str):
    with db() as conn:
        c = conn.execute("SELECT * FROM contracts WHERE id = ?", (contract_id,)).fetchone()
        if not c:
            raise HTTPException(status_code=404, detail="Contract not found")

        terms = conn.execute(
            """SELECT ti.*, td.name, td.value_type
               FROM term_instances ti
               JOIN term_definitions td ON td.key = ti.term_key
               WHERE ti.contract_id = ?
               ORDER BY td.priority ASC""",
            (contract_id,),
        ).fetchall()

        events = conn.execute(
            "SELECT * FROM events WHERE contract_id = ? ORDER BY event_date ASC",
            (contract_id,),
        ).fetchall()

        return {
            "contract": dict(c),
            "terms": [dict(t) for t in terms],
            "events": [dict(e) for e in events],
        }

@app.get("/api/contracts/{contract_id}/status")
def get_contract_status(contract_id: str):
    with db() as conn:
        c = conn.execute("SELECT id, status FROM contracts WHERE id = ?", (contract_id,)).fetchone()
        if not c:
            raise HTTPException(status_code=404, detail="Contract not found")
        return dict(c)

# ----------------------------
# View original / download
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

    return FileResponse(c["stored_path"], media_type=c["mime_type"], filename=c["original_filename"])

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
        headers={"Content-Disposition": f'attachment; filename="{c["original_filename"]}"'},
    )

# ----------------------------
# Events API (month view)
# ----------------------------
@app.get("/api/events")
def list_events(month: str, event_type: str = "all", sort: str = "date_asc"):
    try:
        y, m = month.split("-")
        y = int(y)
        m = int(m)
        start = date(y, m, 1)
        end = date(y + (m // 12), (m % 12) + 1, 1)
    except Exception:
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")

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
            f"""SELECT e.*, c.title, c.vendor
                FROM events e
                JOIN contracts c ON c.id = e.contract_id
                {where}
                {order}""",
            tuple(params),
        ).fetchall()

    return [dict(r) for r in rows]

# ----------------------------
# Search API (recent contracts list)
# ----------------------------
@app.get("/api/search")
def search(mode: SearchMode, q: str = "", term_key: Optional[str] = None, limit: int = 100):
    q = (q or "").strip()
    limit = max(1, min(limit, 200))

    with db() as conn:
        if mode == "quick":
            like = f"%{q}%"
            rows = conn.execute(
                """SELECT id, title, vendor, original_filename, uploaded_at, status
                   FROM contracts
                   WHERE title LIKE ? OR vendor LIKE ? OR original_filename LIKE ?
                   ORDER BY uploaded_at DESC
                   LIMIT ?""",
                (like, like, like, limit),
            ).fetchall()
            return [dict(r) for r in rows]

        if mode == "terms":
            if not term_key:
                raise HTTPException(status_code=400, detail="term_key required for terms mode")
            like = f"%{q}%"
            rows = conn.execute(
                """SELECT c.id, c.title, c.vendor, c.original_filename, ti.term_key, ti.value_normalized, ti.status, ti.confidence
                   FROM term_instances ti
                   JOIN contracts c ON c.id = ti.contract_id
                   WHERE ti.term_key = ?
                     AND (ti.value_raw LIKE ? OR ti.value_normalized LIKE ?)
                   ORDER BY ti.confidence DESC
                   LIMIT ?""",
                (term_key, like, like, limit),
            ).fetchall()
            return [dict(r) for r in rows]

        if not q:
            return []

        rows = conn.execute(
            """SELECT c.id, c.title, c.vendor, c.original_filename, c.uploaded_at
               FROM contracts_fts f
               JOIN contracts c ON c.id = f.contract_id
               WHERE contracts_fts MATCH ?
               LIMIT ?""",
            (q, limit),
        ).fetchall()
        return [dict(r) for r in rows]
