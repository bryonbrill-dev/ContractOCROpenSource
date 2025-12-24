import os
import re
import sqlite3
import logging
import subprocess
from datetime import datetime, date, timedelta
from typing import Dict, Any, List, Optional, Tuple

from PIL import Image
import pytesseract
from pdf2image import convert_from_path
from dateutil import parser as dtparser

logger = logging.getLogger("contractocr")

KEYWORDS = {
    "effective_date": [
        "effective date",
        "effective as of",
        "effective on",
        "commencement",
        "made and entered into",
        "entered into",
        "agreement is made",
        "agreement date",
        "date of this agreement",
        "date of agreement",
    ],
    "renewal_date": ["renewal date", "renews on", "renewed on", "term ends", "expires on", "expiration date", "renewal term"],
    "termination_date": [
        "termination date",
        "terminates on",
        "end date",
        "expires on",
        "expiration date",
        "termination on",
        "terminate on",
        "terminated on",
        "shall terminate",
        "termination",
    ],
    "automatic_renewal": ["auto renew", "automatically renew", "renews automatically", "auto-renew"],
    "auto_renew_opt_out_days": ["written notice", "notice", "days prior", "days before", "prior to renewal"],
    "termination_notice_days": ["terminate", "termination", "written notice", "notice"],
    "governing_law": ["governed by the laws of", "governing law", "jurisdiction"],
    "payment_terms": ["payment", "invoice", "due", "net ", "payment schedule"],
    "term_length": ["initial term", "term of", "term shall", "term will", "term is", "renewal term"],
}

DATE_PATTERNS = [
    r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b",
    r"\b\d{4}-\d{2}-\d{2}\b",
    r"\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b",
    r"\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{4}\b",
    r"\b\d{1,2}(?:st|nd|rd|th)?\s+day\s+of\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*,?\s+\d{4}\b",
]
DAYS_PATTERN = r"\b(\d{1,3})\s+day(s)?\b"
TERM_LENGTH_PATTERN = r"\b(?:(\d{1,3})|([a-z]+))\s*(?:\(\s*(\d{1,3})\s*\))?\s*(month|months|year|years)\b"
DAY_OF_MONTH_YEAR_PATTERN = (
    r"\bday\s+of\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*,?\s+\d{4}\b"
)
WORD_NUMBER_MAP = {
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
    "thirteen": 13,
    "fourteen": 14,
    "fifteen": 15,
    "sixteen": 16,
    "seventeen": 17,
    "eighteen": 18,
    "nineteen": 19,
    "twenty": 20,
    "thirty": 30,
    "forty": 40,
    "fifty": 50,
    "sixty": 60,
    "seventy": 70,
    "eighty": 80,
    "ninety": 90,
    "hundred": 100,
}

def now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"

def _normalize_ws(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()

def _split_chunks(text: str) -> List[str]:
    parts = re.split(r"[\r\n]+|(?<=[.])\s+", text or "")
    return [_normalize_ws(p) for p in parts if _normalize_ws(p)]

def _parse_date(s: str) -> Optional[str]:
    try:
        dt = dtparser.parse(s, fuzzy=True)
        return dt.date().isoformat()
    except Exception:
        return None

def _compute_opt_out_date(renewal_iso: str, opt_out_days: int) -> str:
    d = date.fromisoformat(renewal_iso) - timedelta(days=opt_out_days)
    return d.isoformat()

def _db(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn

def _find_best_date_near(text: str, keywords: List[str]) -> Tuple[Optional[str], float, Optional[str], Optional[int]]:
    chunks = _split_chunks(text)
    best: Optional[Tuple[str, float, str, Optional[int]]] = None
    for ch in chunks:
        lc = ch.lower()
        if any(k in lc for k in keywords):
            raw_dates: List[str] = []
            for pat in DATE_PATTERNS:
                raw_dates.extend(re.findall(pat, ch, flags=re.IGNORECASE))
            for raw in raw_dates:
                iso = _parse_date(raw)
                if iso:
                    conf = 0.80
                    if any(k in lc for k in ["renewal date", "effective date", "termination date"]):
                        conf += 0.10
                    conf = min(conf, 0.95)
                    cand = (iso, conf, ch[:350], None)
                    best = cand if best is None else (cand if cand[1] > best[1] else best)
    if best:
        return best
    return None, 0.0, None, None

def _find_opt_out_days(text: str) -> Tuple[Optional[int], float, Optional[str], Optional[int]]:
    chunks = _split_chunks(text)
    best: Optional[Tuple[int, float, str, Optional[int]]] = None
    for ch in chunks:
        lc = ch.lower()
        if any(k in lc for k in KEYWORDS["auto_renew_opt_out_days"]):
            m = re.search(DAYS_PATTERN, ch, flags=re.IGNORECASE)
            if m:
                days = int(m.group(1))
                conf = 0.75
                if "renew" in lc:
                    conf += 0.10
                conf = min(conf, 0.90)
                cand = (days, conf, ch[:350], None)
                best = cand if best is None else (cand if cand[1] > best[1] else best)
    if best:
        return best
    return None, 0.0, None, None

def _find_termination_notice_days(text: str) -> Tuple[Optional[int], float, Optional[str], Optional[int]]:
    chunks = _split_chunks(text)
    best: Optional[Tuple[int, float, str, Optional[int]]] = None
    for ch in chunks:
        lc = ch.lower()
        if "notice" in lc and any(k in lc for k in ["terminate", "termination"]):
            m = re.search(DAYS_PATTERN, ch, flags=re.IGNORECASE)
            if m:
                days = int(m.group(1))
                conf = 0.78
                if "written notice" in lc:
                    conf += 0.08
                conf = min(conf, 0.90)
                cand = (days, conf, ch[:350], None)
                best = cand if best is None else (cand if cand[1] > best[1] else best)
    if best:
        return best
    return None, 0.0, None, None

def _find_agreement_date(text: str) -> Tuple[Optional[str], float, Optional[str], Optional[int]]:
    chunks = _split_chunks(text)
    best: Optional[Tuple[str, float, str, Optional[int]]] = None
    prev_chunk: Optional[str] = None
    for ch in chunks:
        lc = ch.lower()
        if (
            "made and entered into" in lc
            or "entered into" in lc
            or "day of" in lc
            or "agreement date" in lc
            or "date of this agreement" in lc
            or "date of agreement" in lc
        ):
            raw_dates: List[str] = []
            for pat in DATE_PATTERNS:
                raw_dates.extend(re.findall(pat, ch, flags=re.IGNORECASE))
            if not raw_dates and "day of" in lc:
                month_year = re.search(DAY_OF_MONTH_YEAR_PATTERN, ch, flags=re.IGNORECASE)
                if month_year:
                    day_match = re.search(r"\b(\d{1,2})(?:st|nd|rd|th)?\b", ch)
                    if not day_match and prev_chunk:
                        day_match = re.search(r"\b(\d{1,2})(?:st|nd|rd|th)?\b", prev_chunk)
                    if day_match:
                        raw_dates.append(f"{day_match.group(1)} {month_year.group(0)}")
            for raw in raw_dates:
                iso = _parse_date(raw)
                if iso:
                    conf = 0.86
                    if "made and entered into" in lc:
                        conf += 0.06
                    conf = min(conf, 0.95)
                    cand = (iso, conf, ch[:350], None)
                    best = cand if best is None else (cand if cand[1] > best[1] else best)
        prev_chunk = ch
    if best:
        return best
    return None, 0.0, None, None

def _find_governing_law(text: str) -> Tuple[Optional[str], float, Optional[str], Optional[int]]:
    chunks = _split_chunks(text)
    for ch in chunks:
        lc = ch.lower()
        if "governed by the laws of" in lc:
            idx = lc.find("governed by the laws of")
            tail = ch[idx:]
            return tail[:200], 0.70, ch[:350], None
    return None, 0.0, None, None

def _parse_term_length_match(match: re.Match) -> Optional[str]:
    digit = match.group(1)
    word = match.group(2)
    paren_digit = match.group(3)
    unit = match.group(4)

    if digit:
        count = int(digit)
    elif paren_digit:
        count = int(paren_digit)
    elif word:
        count = WORD_NUMBER_MAP.get(word.lower())
    else:
        return None

    if not count or count <= 0:
        return None

    unit_norm = "year" if unit.lower().startswith("year") else "month"
    unit_label = unit_norm if count == 1 else f"{unit_norm}s"
    return f"{count} {unit_label}"

def _find_term_length(text: str) -> Tuple[Optional[str], float, Optional[str], Optional[int]]:
    chunks = _split_chunks(text)
    best: Optional[Tuple[str, float, str, Optional[int]]] = None
    for ch in chunks:
        lc = ch.lower()
        if any(k in lc for k in KEYWORDS["term_length"]):
            for match in re.finditer(TERM_LENGTH_PATTERN, ch, flags=re.IGNORECASE):
                normalized = _parse_term_length_match(match)
                if not normalized:
                    continue
                conf = 0.70
                if "initial term" in lc:
                    conf += 0.10
                if "renewal term" in lc:
                    conf += 0.05
                conf = min(conf, 0.90)
                cand = (normalized, conf, ch[:350], None)
                best = cand if best is None else (cand if cand[1] > best[1] else best)
    if best:
        return best
    return None, 0.0, None, None

def _set_contract_status(conn: sqlite3.Connection, contract_id: str, status: str) -> None:
    conn.execute("UPDATE contracts SET status = ? WHERE id = ?", (status, contract_id))

def _set_contract_pages(conn: sqlite3.Connection, contract_id: str, pages: int) -> None:
    conn.execute("UPDATE contracts SET pages = ? WHERE id = ?", (pages, contract_id))

def _clear_previous_processing(conn: sqlite3.Connection, contract_id: str) -> None:
    conn.execute("DELETE FROM ocr_pages WHERE contract_id = ?", (contract_id,))
    conn.execute("DELETE FROM term_instances WHERE contract_id = ?", (contract_id,))
    conn.execute("DELETE FROM events WHERE contract_id = ?", (contract_id,))

def _insert_ocr_page(conn: sqlite3.Connection, contract_id: str, page_number: int, text: str) -> None:
    conn.execute(
        "INSERT INTO ocr_pages (contract_id, page_number, text, created_at) VALUES (?, ?, ?, ?)",
        (contract_id, page_number, text, now_iso()),
    )

def _insert_term(conn: sqlite3.Connection, contract_id: str, term_key: str,
                 value_raw: Optional[str], value_norm: Optional[str],
                 confidence: float, status: str,
                 source_page: Optional[int], source_snippet: Optional[str]) -> None:
    conn.execute(
        """INSERT INTO term_instances
           (contract_id, term_key, value_raw, value_normalized, confidence, status, source_page, source_snippet, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (contract_id, term_key, value_raw, value_norm, float(confidence), status, source_page, source_snippet, now_iso()),
    )

def _insert_event(conn: sqlite3.Connection, contract_id: str, event_type: str, event_date_iso: str, derived_from_term_key: str) -> None:
    import uuid
    conn.execute(
        """INSERT INTO events (id, contract_id, event_type, event_date, derived_from_term_key, created_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (str(uuid.uuid4()), contract_id, event_type, event_date_iso, derived_from_term_key, now_iso()),
    )

def _upsert_fts(conn: sqlite3.Connection, contract_id: str, ocr_text_all: str) -> None:
    cur = conn.execute("SELECT contract_id FROM contracts_fts WHERE contract_id = ?", (contract_id,))
    if cur.fetchone():
        conn.execute("UPDATE contracts_fts SET ocr_text = ? WHERE contract_id = ?", (ocr_text_all, contract_id))
    else:
        conn.execute("INSERT INTO contracts_fts (contract_id, title, vendor, ocr_text) VALUES (?, ?, ?, ?)",
                     (contract_id, "", "", ocr_text_all))

def _status_for(conf: float) -> str:
    if conf >= 0.80:
        return "smart"
    if conf > 0:
        return "inconclusive"
    return "inconclusive"

def _test_poppler(poppler_path: Optional[str]) -> None:
    if not poppler_path:
        raise RuntimeError("POPPLER_PATH is not set")
    pdfinfo = os.path.join(poppler_path, "pdfinfo.exe")
    if not os.path.exists(pdfinfo):
        raise RuntimeError(f"pdfinfo.exe not found at: {pdfinfo}")
    # run a lightweight help call
    subprocess.run([pdfinfo, "-h"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)

def process_contract(
    db_path: str,
    contract_id: str,
    stored_path: str,
    tesseract_cmd: str,
    max_pages: int = 150,
    dpi: int = 250,
    poppler_path: Optional[str] = None,
) -> Dict[str, Any]:
    pytesseract.pytesseract.tesseract_cmd = tesseract_cmd

    if not os.path.exists(stored_path):
        raise FileNotFoundError(stored_path)

    ext = os.path.splitext(stored_path.lower())[1]

    with _db(db_path) as conn:
        _set_contract_status(conn, contract_id, "processing")
        _clear_previous_processing(conn, contract_id)

    page_texts: List[str] = []

    if ext == ".pdf":
        _test_poppler(poppler_path)
        images = convert_from_path(stored_path, dpi=dpi, poppler_path=poppler_path)[:max_pages]
        logger.info("Poppler test successful: OK")
        logger.info(f"Converted {len(images)} pages from PDF")
    else:
        images = [Image.open(stored_path)]

    with _db(db_path) as conn:
        for i, img in enumerate(images, start=1):
            logger.info(f"OCR processing page {i}/{len(images)}")
            text = pytesseract.image_to_string(img) or ""
            page_texts.append(text)
            _insert_ocr_page(conn, contract_id, i, text)
        _set_contract_pages(conn, contract_id, len(images))

    ocr_all = "\n".join(page_texts)

    with _db(db_path) as conn:
        _upsert_fts(conn, contract_id, ocr_all)

    eff, eff_conf, eff_snip, eff_page = _find_best_date_near(ocr_all, KEYWORDS["effective_date"])
    if not eff:
        eff, eff_conf, eff_snip, eff_page = _find_agreement_date(ocr_all)
    ren, ren_conf, ren_snip, ren_page = _find_best_date_near(ocr_all, KEYWORDS["renewal_date"])
    ter, ter_conf, ter_snip, ter_page = _find_best_date_near(ocr_all, KEYWORDS["termination_date"])
    opt_days, opt_conf, opt_snip, opt_page = _find_opt_out_days(ocr_all)
    termination_notice_days, termination_notice_conf, termination_notice_snip, termination_notice_page = _find_termination_notice_days(ocr_all)
    law, law_conf, law_snip, law_page = _find_governing_law(ocr_all)
    term_length, term_length_conf, term_length_snip, term_length_page = _find_term_length(ocr_all)

    with _db(db_path) as conn:
        if eff:
            _insert_term(conn, contract_id, "effective_date", eff, eff, eff_conf, _status_for(eff_conf), eff_page, eff_snip)
            _insert_event(conn, contract_id, "effective", eff, "effective_date")

        if ren:
            _insert_term(conn, contract_id, "renewal_date", ren, ren, ren_conf, _status_for(ren_conf), ren_page, ren_snip)
            _insert_event(conn, contract_id, "renewal", ren, "renewal_date")

        if ter:
            _insert_term(conn, contract_id, "termination_date", ter, ter, ter_conf, _status_for(ter_conf), ter_page, ter_snip)
            _insert_event(conn, contract_id, "termination", ter, "termination_date")

        if opt_days is not None:
            _insert_term(conn, contract_id, "auto_renew_opt_out_days", str(opt_days), str(opt_days), opt_conf, _status_for(opt_conf), opt_page, opt_snip)

        if termination_notice_days is not None:
            _insert_term(conn, contract_id, "termination_notice_days", str(termination_notice_days), str(termination_notice_days), termination_notice_conf, _status_for(termination_notice_conf), termination_notice_page, termination_notice_snip)

        if ren and opt_days is not None:
            opt_date = _compute_opt_out_date(ren, opt_days)
            _insert_term(conn, contract_id, "auto_renew_opt_out_date", opt_date, opt_date, 0.95, "smart", None, "calculated: renewal_date - opt_out_days")
            _insert_event(conn, contract_id, "auto_opt_out", opt_date, "auto_renew_opt_out_date")

        if law:
            _insert_term(conn, contract_id, "governing_law", law, law, law_conf, _status_for(law_conf), law_page, law_snip)

        if term_length:
            _insert_term(conn, contract_id, "term_length", term_length, term_length, term_length_conf, _status_for(term_length_conf), term_length_page, term_length_snip)

        _set_contract_status(conn, contract_id, "processed")

    return {
        "ocr_text": ocr_all,
        "effective_date": eff,
        "renewal_date": ren,
        "termination_date": ter,
        "auto_renew_opt_out_days": opt_days,
        "termination_notice_days": termination_notice_days,
        "auto_renew_opt_out_date": _compute_opt_out_date(ren, opt_days) if (ren and opt_days is not None) else None,
        "governing_law": law,
        "term_length": term_length,
        "pages_ocrd": len(images),
    }
