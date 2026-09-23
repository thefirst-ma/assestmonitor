CREATE TABLE IF NOT EXISTS user_notifications (
  user_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  secret TEXT NOT NULL,
  destination TEXT NOT NULL DEFAULT '',
  price_alerts INTEGER NOT NULL DEFAULT 1,
  daily_report INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, channel),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
