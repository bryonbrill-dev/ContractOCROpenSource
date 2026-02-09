# Contract OCR Open Source vs LinkSquares-style CLM Gap Outline

This document summarizes observed capabilities in ContractOCROpenSource and highlights likely gaps versus a LinkSquares-style CLM. It also lists the citation locations (file paths + line ranges) for easy reference.

A Word version of this outline can be generated locally by running:

```bash
python docs/generate_clm_gap_analysis_docx.py
```

## Current Documented Capabilities (from repo docs)
- OCR ingestion and term extraction with manual edits.
- Events/reminders for renewal/termination/opt-out milestones.
- Tags, agreement types, contract metadata management.
- Search, filters, and planner for events.
- Authentication + permissions framework, with planned hardening.

## Likely Gaps vs LinkSquares-style CLM
1) Contract lifecycle workflows (intake, approval, negotiation, signature, repository lifecycle).
2) Clause library / playbook enforcement and redlining guidance.
3) Negotiation collaboration with version history and comments.
4) Template-based contract authoring and intake forms.
5) E-signature integrations and signature status tracking.
6) Portfolio analytics and dashboards for KPI/risk views.
7) External integrations (CRM/ERP/Slack) and data sync.
8) Audit trails and compliance reporting for contract changes and permissions.
9) Advanced semantic search / AI insights beyond OCR extraction.
10) Governance UX: role templates, permission explainability, audit history.

## Citation Locations (repo files and line ranges)
- README.md (features, workflows, events/reminders, planner): lines 1-289
- docs/permissions-functional-spec.md (permissions model and gaps): lines 1-211

## Reference Link
- https://linksquares.com/ (comparison target)
