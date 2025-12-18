# Contract OCR & Renewal Tracker

This FastAPI + vanilla JS app ingests contracts, runs OCR, extracts key dates/terms, and lets you curate events and reminders for renewals or terminations.

## Getting started
1. Ensure Tesseract and Poppler are installed (paths are configurable via `TESSERACT_CMD` and `POPPLER_PATH` environment variables).
2. Install dependencies: `pip install -r requirements.txt`.
3. Run the API: `uvicorn app:app --host 0.0.0.0 --port 8080`.
4. Open `ui/index.html` in your browser (or serve it from any static host) and set the API base to your running server (default `http://localhost:8080`).

## Contracts page – manual controls
The Contracts page now exposes several manual editing tools for cases where OCR did not detect terms or events:

* **Contract Info** – Directly edit Title, Vendor, and Agreement Type. “Uncategorized” is always available if no type fits.
* **Tags**
  * Attach/detach existing tags.
  * Create a new tag (name + color) and attach it immediately. Auto-generated tags are labeled “(auto)”.
* **Terms**
  * Each extracted term shows its key, value, status, and confidence. You can overwrite values or delete the term.
  * **Add/Update Term** form:
    * **Term**: choose from known definitions (includes “Extraction Sensitivity” seed).
    * **Value**: free text or date (dates should be ISO `YYYY-MM-DD`).
    * **Status**: manual/smart/inconclusive.
    * **Event Type**: optionally link a term to an event (Effective, Renewal, Termination, Auto opt-out, or none).
    * **Event Date**: optional override; defaults to the term value for date terms.
* **Events**
  * Edit or delete any event (Effective, Renewal, Termination, Auto opt-out, or custom).
  * **Add Event**: create an event with a date and type.
  * **Reminders**: set recipients (comma-separated emails) and offsets in days (e.g., `90,60,30,7`). Reminders can be saved per event.

## Events page – planning filters
* **Show all months** toggle lets you browse events beyond the current month grid.
* Filters by month, event type, sort order, search, and “Expiring-focused only” (renewal/termination/auto opt-out).

## Planner tab – bulk event editor
Use the Planner to manage events across all contracts:
* Select a contract, choose an event type (including “Custom”), pick a date, and add the event.
* View all events (or a single month) in a table and edit type/date inline or delete.

## Reference data
* Agreement types are available at `GET /api/agreement-types` and include “Uncategorized”.
* Term definitions are available at `GET /api/terms/definitions`; seeds include Effective Date, Renewal Date, Termination Date, Auto-Renew Opt-Out, Governing Law, Payment Terms, and “Extraction Sensitivity”.

## Testing
Run a quick syntax check:

```bash
python -m compileall app.py processor.py
```
