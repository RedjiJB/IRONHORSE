-- Re-expressed from v1's `documents` table -- requirements baseline, not
-- copied code. General compliance/record-keeping documents (permits,
-- contracts, insurance certs, disposal tickets, receipts, and every
-- inbound WhatsApp photo, auto-filed as 'photo' and reclassifiable
-- later) -- not damage photos or delivery receipts specifically, and a
-- fully separate concept from checkouts.photo_url (an older, plain-text
-- URL field, never unified with this table in v1 either). Local
-- filesystem storage (UPLOAD_DIR), not S3 or base64-in-DB -- storage_path
-- is a random generated filename, never derived from user input, to
-- prevent path traversal.
CREATE TABLE documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID REFERENCES jobs(id),
  site_id       UUID REFERENCES sites(id),
  type          TEXT NOT NULL, -- 'contract' | 'permit' | 'photo' | 'receipt' | 'disposal_ticket' | 'insurance_cert' -- app-enforced allowlist, not a DB enum, same as v1
  filename      TEXT NOT NULL, -- human-readable original filename
  storage_path  TEXT, -- generated filename on disk; NULL = metadata-only row, no file
  mime_type     TEXT,
  uploaded_by   UUID REFERENCES crew_members(id),
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  tags          TEXT[],
  expiry_date   DATE
);

CREATE INDEX documents_site_id_idx ON documents (site_id);
CREATE INDEX documents_expiry_idx ON documents (expiry_date) WHERE expiry_date IS NOT NULL;
