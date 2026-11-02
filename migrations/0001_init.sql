-- Momentum Cloud Sync — schemat D1 (etap 1).
-- Funkcja /api tworzy te tabele automatycznie przy pierwszym zapytaniu,
-- więc ten plik jest opcjonalny: możesz go wkleić w konsoli D1 (zakładka Console)
-- albo użyć: npx wrangler d1 migrations apply momentum --remote

CREATE TABLE IF NOT EXISTS sync_accounts (
  user_id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,          -- SHA-256 kodu odzyskiwania (sam kod nie trafia na serwer w bazie)
  revision INTEGER NOT NULL DEFAULT 0,    -- rośnie o 1 przy każdym zapisie migawki
  write_id TEXT,
  snapshot_size INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_snapshot_chunks (
  user_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  data TEXT NOT NULL,                     -- fragment JSON (≤ 400 tys. znaków; limit D1 to 2 MB na wartość)
  PRIMARY KEY (user_id, revision, idx)
);

CREATE TABLE IF NOT EXISTS sync_rate_limits (
  bucket TEXT PRIMARY KEY,                -- skrót IP + dzień, limit zakładania kont
  hits INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
