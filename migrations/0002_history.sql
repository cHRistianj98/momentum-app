-- Momentum Cloud Sync — historia wersji (30 dni).
-- Worker tworzy te tabele automatycznie przy pierwszym zapytaniu, więc ten plik jest opcjonalny:
-- możesz go wkleić w konsoli D1 (zakładka Console) albo użyć:
-- npx wrangler d1 migrations apply momentum --remote

CREATE TABLE IF NOT EXISTS sync_history (
  user_id TEXT NOT NULL,
  revision INTEGER NOT NULL,              -- rewizja zarchiwizowanej migawki
  saved_at TEXT NOT NULL,                 -- kiedy ta migawka została zapisana na serwerze
  archived_at TEXT NOT NULL,              -- kiedy trafiła do historii
  day TEXT NOT NULL,                      -- dzień archiwizacji (kalendarz użytkownika, YYYY-MM-DD)
  reason TEXT NOT NULL,                   -- 'daily' | 'shrink' (dużo mniej danych) | 'manual' (przed przywróceniem)
  size INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  PRIMARY KEY (user_id, revision)
);

CREATE TABLE IF NOT EXISTS sync_history_chunks (
  user_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  data TEXT NOT NULL,                     -- fragment JSON, jak w sync_snapshot_chunks
  PRIMARY KEY (user_id, revision, idx)
);
