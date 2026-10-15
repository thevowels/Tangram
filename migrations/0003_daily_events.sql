-- Anonymous gameplay analytics: daily counters only. No player id, IP or device is stored.
CREATE TABLE daily_events (
  day TEXT NOT NULL,            -- UTC date, YYYY-MM-DD
  event TEXT NOT NULL,          -- start | solve | quit | export | design_save | free_open
  puzzle_id TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  ms_sum INTEGER NOT NULL DEFAULT 0,   -- total time, for averages (solve and quit)
  pct_sum INTEGER NOT NULL DEFAULT 0,  -- total best match %, for averages (quit)
  PRIMARY KEY (day, event, puzzle_id)
);
