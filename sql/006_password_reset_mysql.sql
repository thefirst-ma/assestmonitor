-- Run once after 003_app_runtime_mysql.sql. Existing accounts keep version 0.
USE investment_monitor;

ALTER TABLE users ADD COLUMN auth_version BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS password_reset_codes (
  user_id CHAR(36) PRIMARY KEY,
  code_hash CHAR(64) NOT NULL,
  expires_at BIGINT NOT NULL,
  resend_after BIGINT NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  send_count INT NOT NULL DEFAULT 1,
  window_started_at BIGINT NOT NULL,
  status ENUM('pending', 'active', 'failed') NOT NULL,
  CONSTRAINT fk_password_reset_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS password_reset_rate_limits (
  source_hash CHAR(64) PRIMARY KEY,
  window_started_at BIGINT NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  INDEX idx_password_reset_rate_limits_window (window_started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
