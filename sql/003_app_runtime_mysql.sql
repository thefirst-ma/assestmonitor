-- App runtime schema for MySQL 8+
-- Required by auth, asset monitoring, and local price history.

CREATE DATABASE IF NOT EXISTS investment_monitor
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE investment_monitor;

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  plan ENUM('free', 'pro') NOT NULL DEFAULT 'free',
  stripe_customer_id VARCHAR(255) NULL,
  stripe_subscription_id VARCHAR(255) NULL,
  created_at BIGINT NOT NULL,
  UNIQUE KEY uk_users_email (email),
  INDEX idx_users_stripe_customer_id (stripe_customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS assets (
  id VARCHAR(160) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  type ENUM('crypto', 'stock', 'metal', 'forex') NOT NULL,
  symbol VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  interval_ms INT NULL,
  threshold DECIMAL(12, 6) NULL,
  created_at BIGINT NOT NULL,
  INDEX idx_assets_user_enabled (user_id, enabled),
  INDEX idx_assets_type_symbol (type, symbol)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS prices (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  asset_id VARCHAR(160) NOT NULL,
  price DECIMAL(20, 8) NOT NULL,
  timestamp BIGINT NOT NULL,
  CONSTRAINT fk_prices_asset
    FOREIGN KEY (asset_id) REFERENCES assets(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  INDEX idx_prices_asset_timestamp (asset_id, timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
