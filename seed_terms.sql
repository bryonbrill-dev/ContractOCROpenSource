-- Seed default tags with colors
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

-- Auto-tag keywords for Confidential
INSERT OR IGNORE INTO tag_keywords (tag_id, keyword, created_at)
SELECT id, 'confidential', datetime('now') FROM tags WHERE name = 'Confidential'
UNION ALL SELECT id, 'non-disclosure', datetime('now') FROM tags WHERE name = 'Confidential'
UNION ALL SELECT id, 'nda', datetime('now') FROM tags WHERE name = 'Confidential'
UNION ALL SELECT id, 'proprietary', datetime('now') FROM tags WHERE name = 'Confidential';

-- Auto-tag keywords for Auto-Renew
INSERT OR IGNORE INTO tag_keywords (tag_id, keyword, created_at)
SELECT id, 'automatic renewal', datetime('now') FROM tags WHERE name = 'Auto-Renew'
UNION ALL SELECT id, 'auto-renew', datetime('now') FROM tags WHERE name = 'Auto-Renew'
UNION ALL SELECT id, 'automatically renews', datetime('now') FROM tags WHERE name = 'Auto-Renew';

-- Auto-tag keywords for Insurance
INSERT OR IGNORE INTO tag_keywords (tag_id, keyword, created_at)
SELECT id, 'insurance', datetime('now') FROM tags WHERE name = 'Insurance'
UNION ALL SELECT id, 'certificate of insurance', datetime('now') FROM tags WHERE name = 'Insurance'
UNION ALL SELECT id, 'liability coverage', datetime('now') FROM tags WHERE name = 'Insurance';

-- Auto-tag keywords for Real Estate
INSERT OR IGNORE INTO tag_keywords (tag_id, keyword, created_at)
SELECT id, 'lease', datetime('now') FROM tags WHERE name = 'Real Estate'
UNION ALL SELECT id, 'real estate', datetime('now') FROM tags WHERE name = 'Real Estate'
UNION ALL SELECT id, 'property', datetime('now') FROM tags WHERE name = 'Real Estate'
UNION ALL SELECT id, 'premises', datetime('now') FROM tags WHERE name = 'Real Estate';

-- Auto-tag keywords for Employment
INSERT OR IGNORE INTO tag_keywords (tag_id, keyword, created_at)
SELECT id, 'employment', datetime('now') FROM tags WHERE name = 'Employment'
UNION ALL SELECT id, 'employee', datetime('now') FROM tags WHERE name = 'Employment'
UNION ALL SELECT id, 'offer letter', datetime('now') FROM tags WHERE name = 'Employment';