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

## Glossary & behaviors
The UI and API use the following domain terms and actions. This section is meant to answer “what does this word mean in this app?”

### Core data
* **Contract**: An uploaded agreement record. Contracts can store title, vendor, agreement type, tags, and OCR text.
* **Agreement Type**: A classification label for contracts (for example, “Uncategorized”); managed via `GET /api/agreement-types`.
* **Tag**: A label with a color. Tags can be manually attached/detached or auto-applied based on keyword matches.
* **Term Definition**: A catalog entry describing a term you want to extract or manage (name, key, value type, and extraction hint).
* **Term Instance**: A term value attached to a specific contract. Each instance carries status, confidence, and a normalized value.
* **Term Key**: The unique identifier for a term definition (for example, `renewal_date`).
* **Value Type**: The expected datatype for a term (for example, `date`, `int`, `text`, `bool`).
* **Status**: How a term was obtained: `smart` (OCR/extraction), `manual` (user-entered), or `inconclusive`.
* **Confidence**: A numeric score (0–1) representing extraction certainty.

### Events & scheduling
* **Event**: A dated milestone associated with a contract (for example, renewal or termination).
* **Event Type**: The category of the event. Standard types include `effective`, `renewal`, `termination`, and `auto_opt_out`. Custom types are allowed.
* **Derived From Term**: The term key that produced an event (for example, an event with `derived_from_term_key = termination_date`).
* **Reminder**: A scheduled notification tied to an event.
* **Offset (Reminder Offset / Offset Days)**: The number of days **before** the event date that a reminder should be scheduled.  
  *Example*: For a renewal event on 2025-06-30 and an offset of `30`, the reminder is scheduled for 2025-05-31.
* **Scheduled For**: The computed calendar date when a reminder is due, derived from `event_date - offset_days`.
* **Recipients**: Comma-separated email addresses that receive reminder messages.

### Seeded term definitions
The application ships with the following term definitions (all are editable or extendable):
* **Effective Date** (`effective_date`, `date`)
* **Renewal Date** (`renewal_date`, `date`)
* **Termination Date** (`termination_date`, `date`)
* **Extraction Sensitivity** (`extraction_sensitivity`, `text`)
* **Automatic Renewal** (`automatic_renewal`, `bool`)
* **Auto-Renew Opt-Out Days** (`auto_renew_opt_out_days`, `int`)
* **Auto-Renew Opt-Out Date (calculated)** (`auto_renew_opt_out_date`, `date`)
* **Termination Notice Days** (`termination_notice_days`, `int`)
* **Governing Law** (`governing_law`, `text`)
* **Payment Terms** (`payment_terms`, `text`)
* **Term Length** (`term_length`, `text`)

### Common actions the app supports
* **Ingest & OCR**: Upload contracts, run OCR, and extract terms/events.
* **Curate terms**: Add, update, or delete term instances; optionally link a term to an event.
* **Manage events**: Add, edit, or delete events; attach reminders with offsets and recipients.
* **Tagging**: Create tags, attach/detach them, and leverage auto-tag keywords.
* **Search & filter**: Browse by month, event type, and search terms; toggle expiring-focused views.

## Testing
Run a quick syntax check:

```bash
python -m compileall app.py processor.py
```
