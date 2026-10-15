-- Anonymous players: no email, no password. A player's sync code is the key; only its SHA-256 is kept.
CREATE TABLE players (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  nickname TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Best time and first day per solved puzzle.
CREATE TABLE solves (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  puzzle_id TEXT NOT NULL,
  best_ms INTEGER NOT NULL,
  first_on TEXT NOT NULL,
  PRIMARY KEY (player_id, puzzle_id)
);
CREATE INDEX solves_puzzle ON solves(puzzle_id);

-- Free-play designs; data is the app's design JSON, or 'null' for a deleted one.
CREATE TABLE designs (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  saved_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, name)
);

CREATE TABLE counters (
  player_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  designs_saved INTEGER NOT NULL DEFAULT 0,
  exports INTEGER NOT NULL DEFAULT 0
);
