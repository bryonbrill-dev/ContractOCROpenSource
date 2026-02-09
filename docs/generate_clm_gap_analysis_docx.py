from zipfile import ZipFile, ZIP_DEFLATED
from pathlib import Path

output = Path(__file__).with_name("CLM_gap_analysis.docx")

content_types = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
'''

rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
'''

document_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Contract OCR Open Source vs LinkSquares-style CLM Gap Outline</w:t></w:r></w:p>
    <w:p><w:r><w:t>This document summarizes observed capabilities in ContractOCROpenSource and highlights likely gaps versus a LinkSquares-style CLM. It also lists the citation locations (file paths + line ranges) for easy reference.</w:t></w:r></w:p>

    <w:p><w:r><w:t>Current Documented Capabilities (from repo docs)</w:t></w:r></w:p>
    <w:p><w:r><w:t>- OCR ingestion and term extraction with manual edits.</w:t></w:r></w:p>
    <w:p><w:r><w:t>- Events/reminders for renewal/termination/opt-out milestones.</w:t></w:r></w:p>
    <w:p><w:r><w:t>- Tags, agreement types, contract metadata management.</w:t></w:r></w:p>
    <w:p><w:r><w:t>- Search, filters, and planner for events.</w:t></w:r></w:p>
    <w:p><w:r><w:t>- Authentication + permissions framework, with planned hardening.</w:t></w:r></w:p>

    <w:p><w:r><w:t>Likely Gaps vs LinkSquares-style CLM</w:t></w:r></w:p>
    <w:p><w:r><w:t>1) Contract lifecycle workflows (intake, approval, negotiation, signature, repository lifecycle).</w:t></w:r></w:p>
    <w:p><w:r><w:t>2) Clause library / playbook enforcement and redlining guidance.</w:t></w:r></w:p>
    <w:p><w:r><w:t>3) Negotiation collaboration with version history and comments.</w:t></w:r></w:p>
    <w:p><w:r><w:t>4) Template-based contract authoring and intake forms.</w:t></w:r></w:p>
    <w:p><w:r><w:t>5) E-signature integrations and signature status tracking.</w:t></w:r></w:p>
    <w:p><w:r><w:t>6) Portfolio analytics and dashboards for KPI/risk views.</w:t></w:r></w:p>
    <w:p><w:r><w:t>7) External integrations (CRM/ERP/Slack) and data sync.</w:t></w:r></w:p>
    <w:p><w:r><w:t>8) Audit trails and compliance reporting for contract changes and permissions.</w:t></w:r></w:p>
    <w:p><w:r><w:t>9) Advanced semantic search / AI insights beyond OCR extraction.</w:t></w:r></w:p>
    <w:p><w:r><w:t>10) Governance UX: role templates, permission explainability, audit history.</w:t></w:r></w:p>

    <w:p><w:r><w:t>Citation Locations (repo files and line ranges)</w:t></w:r></w:p>
    <w:p><w:r><w:t>- README.md (features, workflows, events/reminders, planner): lines 1-289</w:t></w:r></w:p>
    <w:p><w:r><w:t>- docs/permissions-functional-spec.md (permissions model and gaps): lines 1-211</w:t></w:r></w:p>

    <w:p><w:r><w:t>Reference Link</w:t></w:r></w:p>
    <w:p><w:r><w:t>- https://linksquares.com/ (comparison target)</w:t></w:r></w:p>

    <w:sectPr/>
  </w:body>
</w:document>
'''

with ZipFile(output, "w", ZIP_DEFLATED) as docx:
    docx.writestr("[Content_Types].xml", content_types)
    docx.writestr("_rels/.rels", rels)
    docx.writestr("word/document.xml", document_xml)

print(f"Wrote {output}")
