CREATE TABLE IF NOT EXISTS rate_limits (
  ip     TEXT    NOT NULL,
  minute INTEGER NOT NULL,
  count  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (ip, minute)
);
