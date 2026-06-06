CREATE TABLE IF NOT EXISTS bookmarklet_tokens (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label      TEXT NOT NULL DEFAULT 'My Bookmarklet',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bm_tokens_user    ON bookmarklet_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_bm_tokens_expires ON bookmarklet_tokens(expires_at);
