-- Core recommendation schema for MySQL 8+
-- Rule: every schema change or database operation script must be placed under sql/.

CREATE DATABASE IF NOT EXISTS investment_monitor
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE investment_monitor;

CREATE TABLE IF NOT EXISTS research_profiles (
  symbol VARCHAR(32) PRIMARY KEY,
  moat_score INT NOT NULL,
  moat_label VARCHAR(64) NOT NULL,
  moat_summary TEXT NOT NULL,
  leadership_score INT NOT NULL,
  leadership_label VARCHAR(64) NOT NULL,
  leadership_summary TEXT NOT NULL,
  industry_score INT NOT NULL,
  industry_label VARCHAR(64) NOT NULL,
  industry_summary TEXT NOT NULL,
  policy_score INT NOT NULL,
  policy_label VARCHAR(64) NOT NULL,
  policy_summary TEXT NOT NULL,
  confidence INT NOT NULL DEFAULT 60,
  notes TEXT NOT NULL,
  updated_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recommendation_factors (
  id VARCHAR(80) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  weight DECIMAL(10, 4) NOT NULL DEFAULT 1.0000,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  INDEX idx_recommendation_factors_enabled_sort (enabled, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_factor_values (
  symbol VARCHAR(32) NOT NULL,
  factor_id VARCHAR(80) NOT NULL,
  score INT NOT NULL,
  label VARCHAR(64) NOT NULL,
  summary TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (symbol, factor_id),
  CONSTRAINT fk_stock_factor_values_factor
    FOREIGN KEY (factor_id) REFERENCES recommendation_factors(id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  INDEX idx_stock_factor_values_factor (factor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recommendation_runs (
  id CHAR(36) PRIMARY KEY,
  generated_at BIGINT NOT NULL,
  source VARCHAR(64) NOT NULL,
  INDEX idx_recommendation_runs_generated_at (generated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recommendation_items (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  run_id CHAR(36) NOT NULL,
  horizon ENUM('monthly', 'quarterly', 'yearly') NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  name VARCHAR(255) NOT NULL,
  score INT NOT NULL,
  action ENUM('buy', 'watch', 'avoid') NOT NULL,
  price DECIMAL(20, 6) NULL,
  payload_json JSON NOT NULL,
  factor_contributions_json JSON NOT NULL,
  CONSTRAINT fk_recommendation_items_run
    FOREIGN KEY (run_id) REFERENCES recommendation_runs(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  INDEX idx_recommendation_items_run (run_id),
  INDEX idx_recommendation_items_symbol (symbol),
  INDEX idx_recommendation_items_horizon_score (horizon, score)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recommendation_reviews (
  run_id CHAR(36) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  horizon ENUM('monthly', 'quarterly', 'yearly') NOT NULL,
  outcome ENUM('accurate', 'inaccurate', 'mixed', 'pending') NOT NULL,
  reason TEXT NOT NULL,
  actual_return DECIMAL(12, 6) NULL,
  reviewed_at BIGINT NOT NULL,
  PRIMARY KEY (run_id, symbol, horizon),
  CONSTRAINT fk_recommendation_reviews_run
    FOREIGN KEY (run_id) REFERENCES recommendation_runs(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  INDEX idx_recommendation_reviews_symbol (symbol),
  INDEX idx_recommendation_reviews_outcome (outcome)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO recommendation_factors
  (id, name, description, weight, enabled, sort_order, created_at, updated_at)
VALUES
  ('moat', '企业护城河', '品牌、网络效应、规模、技术壁垒、转换成本和渠道优势。', 0.3000, 1, 10, UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
  ('leadership', '负责人质量', '主要负责人的战略判断、执行节奏、资本配置、风险意识和长期主义。', 0.2200, 1, 20, UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
  ('industryTrend', '行业趋势', '行业需求、技术路线、竞争格局和未来增速。', 0.2800, 1, 30, UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
  ('policyImpact', '政策影响', '监管、税收、贸易、产业政策和地缘限制对公司的影响。', 0.2000, 1, 40, UNIX_TIMESTAMP(), UNIX_TIMESTAMP())
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  weight = VALUES(weight),
  enabled = VALUES(enabled),
  sort_order = VALUES(sort_order),
  updated_at = UNIX_TIMESTAMP();
