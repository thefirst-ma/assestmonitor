USE investment_monitor;

CREATE TABLE IF NOT EXISTS user_notifications (
  user_id CHAR(36) NOT NULL,
  channel VARCHAR(16) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  secret TEXT NOT NULL,
  destination VARCHAR(100) NOT NULL DEFAULT '',
  price_alerts TINYINT(1) NOT NULL DEFAULT 1,
  daily_report TINYINT(1) NOT NULL DEFAULT 1,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, channel),
  CONSTRAINT fk_user_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
