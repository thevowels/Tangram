-- When the nickname was last changed, so the latest change wins when devices sync.
ALTER TABLE players ADD COLUMN nickname_at INTEGER;
