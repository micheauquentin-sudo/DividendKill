-- DividendKill D1 Schema
-- Apply with: wrangler d1 execute dividendkill --file=schema.sql

CREATE TABLE IF NOT EXISTS transactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT    NOT NULL CHECK(type IN ('buy','sell','dividend')),
  ticker      TEXT    NOT NULL,
  shares      REAL,
  price       REAL,
  amount      REAL,              -- EUR amount for dividends
  date        TEXT    NOT NULL,  -- ISO date: '2025-01-15'
  currency    TEXT    NOT NULL DEFAULT 'USD',
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_tx_ticker ON transactions(ticker);
CREATE INDEX IF NOT EXISTS idx_tx_date   ON transactions(date);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT NOT NULL PRIMARY KEY,
  value TEXT NOT NULL
);

-- Default settings
INSERT OR IGNORE INTO settings (key, value) VALUES ('target_monthly', '1500');
INSERT OR IGNORE INTO settings (key, value) VALUES ('base_currency',  'EUR');
