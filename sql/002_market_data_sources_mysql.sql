-- Market data source schema for MySQL 8+
-- Covers Yahoo Finance, AKShare, BaoStock, TuShare, TongHuaShun/10jqka, Eastmoney, and future providers.

CREATE DATABASE IF NOT EXISTS investment_monitor
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE investment_monitor;

CREATE TABLE IF NOT EXISTS market_data_sources (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  provider_type ENUM('yahoo', 'akshare', 'baostock', 'tushare', 'tonghuashun', 'eastmoney', 'manual', 'other') NOT NULL,
  base_url VARCHAR(512) NULL,
  priority INT NOT NULL DEFAULT 100,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  requires_token TINYINT(1) NOT NULL DEFAULT 0,
  config_json JSON NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  INDEX idx_market_data_sources_enabled_priority (enabled, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_master (
  symbol VARCHAR(32) PRIMARY KEY,
  exchange VARCHAR(32) NOT NULL DEFAULT '',
  market VARCHAR(32) NOT NULL DEFAULT '',
  asset_type ENUM('stock', 'index', 'fund', 'etf', 'convertible_bond', 'other') NOT NULL DEFAULT 'stock',
  name VARCHAR(255) NOT NULL,
  name_en VARCHAR(255) NULL,
  currency VARCHAR(16) NOT NULL DEFAULT '',
  country VARCHAR(64) NOT NULL DEFAULT '',
  industry VARCHAR(128) NULL,
  sector VARCHAR(128) NULL,
  list_date DATE NULL,
  delist_date DATE NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  source_id VARCHAR(64) NOT NULL,
  source_symbol VARCHAR(64) NOT NULL,
  raw_json JSON NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  CONSTRAINT fk_stock_master_source
    FOREIGN KEY (source_id) REFERENCES market_data_sources(id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  INDEX idx_stock_master_market_exchange (market, exchange),
  INDEX idx_stock_master_industry (industry),
  INDEX idx_stock_master_source_symbol (source_id, source_symbol)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_symbol_aliases (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  symbol VARCHAR(32) NOT NULL,
  source_id VARCHAR(64) NOT NULL,
  source_symbol VARCHAR(64) NOT NULL,
  note VARCHAR(255) NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  UNIQUE KEY uk_stock_symbol_aliases_source_symbol (source_id, source_symbol),
  INDEX idx_stock_symbol_aliases_symbol (symbol),
  CONSTRAINT fk_stock_symbol_aliases_stock
    FOREIGN KEY (symbol) REFERENCES stock_master(symbol)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT fk_stock_symbol_aliases_source
    FOREIGN KEY (source_id) REFERENCES market_data_sources(id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_price_history (
  symbol VARCHAR(32) NOT NULL,
  trade_date DATE NOT NULL,
  frequency ENUM('1d', '1w', '1m', '5m', '15m', '30m', '60m') NOT NULL DEFAULT '1d',
  open DECIMAL(20, 6) NULL,
  high DECIMAL(20, 6) NULL,
  low DECIMAL(20, 6) NULL,
  close DECIMAL(20, 6) NOT NULL,
  pre_close DECIMAL(20, 6) NULL,
  change_amount DECIMAL(20, 6) NULL,
  change_percent DECIMAL(12, 6) NULL,
  volume DECIMAL(24, 4) NULL,
  amount DECIMAL(24, 4) NULL,
  turnover_rate DECIMAL(12, 6) NULL,
  adjust_type ENUM('none', 'qfq', 'hfq') NOT NULL DEFAULT 'none',
  source_id VARCHAR(64) NOT NULL,
  raw_json JSON NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (symbol, trade_date, frequency, adjust_type, source_id),
  CONSTRAINT fk_stock_price_history_stock
    FOREIGN KEY (symbol) REFERENCES stock_master(symbol)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT fk_stock_price_history_source
    FOREIGN KEY (source_id) REFERENCES market_data_sources(id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  INDEX idx_stock_price_history_symbol_date (symbol, trade_date),
  INDEX idx_stock_price_history_source_date (source_id, trade_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_financial_metrics (
  symbol VARCHAR(32) NOT NULL,
  report_date DATE NOT NULL,
  fiscal_period VARCHAR(16) NOT NULL DEFAULT '',
  revenue DECIMAL(24, 4) NULL,
  revenue_growth DECIMAL(12, 6) NULL,
  net_profit DECIMAL(24, 4) NULL,
  net_profit_growth DECIMAL(12, 6) NULL,
  gross_margin DECIMAL(12, 6) NULL,
  profit_margin DECIMAL(12, 6) NULL,
  roe DECIMAL(12, 6) NULL,
  roa DECIMAL(12, 6) NULL,
  debt_to_equity DECIMAL(12, 6) NULL,
  operating_cash_flow DECIMAL(24, 4) NULL,
  free_cash_flow DECIMAL(24, 4) NULL,
  eps DECIMAL(20, 6) NULL,
  pe_ttm DECIMAL(20, 6) NULL,
  pb DECIMAL(20, 6) NULL,
  dividend_yield DECIMAL(12, 6) NULL,
  source_id VARCHAR(64) NOT NULL,
  raw_json JSON NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (symbol, report_date, fiscal_period, source_id),
  CONSTRAINT fk_stock_financial_metrics_stock
    FOREIGN KEY (symbol) REFERENCES stock_master(symbol)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT fk_stock_financial_metrics_source
    FOREIGN KEY (source_id) REFERENCES market_data_sources(id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  INDEX idx_stock_financial_metrics_symbol_report (symbol, report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_company_profiles (
  symbol VARCHAR(32) PRIMARY KEY,
  company_name VARCHAR(255) NOT NULL,
  legal_representative VARCHAR(128) NULL,
  chairman VARCHAR(128) NULL,
  ceo VARCHAR(128) NULL,
  main_business TEXT NULL,
  business_summary TEXT NULL,
  moat_summary TEXT NULL,
  leadership_summary TEXT NULL,
  policy_summary TEXT NULL,
  website VARCHAR(512) NULL,
  source_id VARCHAR(64) NOT NULL,
  raw_json JSON NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  CONSTRAINT fk_stock_company_profiles_stock
    FOREIGN KEY (symbol) REFERENCES stock_master(symbol)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT fk_stock_company_profiles_source
    FOREIGN KEY (source_id) REFERENCES market_data_sources(id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_industry_mapping (
  symbol VARCHAR(32) NOT NULL,
  source_id VARCHAR(64) NOT NULL,
  industry_code VARCHAR(64) NOT NULL DEFAULT '',
  industry_name VARCHAR(128) NOT NULL,
  level INT NOT NULL DEFAULT 1,
  is_primary TINYINT(1) NOT NULL DEFAULT 1,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (symbol, source_id, industry_code, level),
  CONSTRAINT fk_stock_industry_mapping_stock
    FOREIGN KEY (symbol) REFERENCES stock_master(symbol)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT fk_stock_industry_mapping_source
    FOREIGN KEY (source_id) REFERENCES market_data_sources(id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  INDEX idx_stock_industry_mapping_industry (industry_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_data_sync_runs (
  id CHAR(36) PRIMARY KEY,
  source_id VARCHAR(64) NOT NULL,
  job_type ENUM('symbol_master', 'price_history', 'financial_metrics', 'company_profile', 'industry_mapping', 'full_refresh') NOT NULL,
  status ENUM('running', 'success', 'failed', 'partial') NOT NULL,
  started_at BIGINT NOT NULL,
  finished_at BIGINT NULL,
  requested_symbols JSON NULL,
  success_count INT NOT NULL DEFAULT 0,
  failure_count INT NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  metadata_json JSON NULL,
  CONSTRAINT fk_stock_data_sync_runs_source
    FOREIGN KEY (source_id) REFERENCES market_data_sources(id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  INDEX idx_stock_data_sync_runs_source_started (source_id, started_at),
  INDEX idx_stock_data_sync_runs_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO market_data_sources
  (id, name, provider_type, base_url, priority, enabled, requires_token, config_json, created_at, updated_at)
VALUES
  ('yahoo-finance', 'Yahoo Finance', 'yahoo', 'https://query2.finance.yahoo.com', 100, 1, 0, JSON_OBJECT(), UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
  ('akshare', 'AKShare', 'akshare', NULL, 20, 1, 0, JSON_OBJECT('preferred_for', JSON_ARRAY('A股历史行情', 'A股基础数据')), UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
  ('baostock', 'BaoStock', 'baostock', NULL, 30, 1, 0, JSON_OBJECT('preferred_for', JSON_ARRAY('A股历史K线')), UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
  ('tushare', 'TuShare', 'tushare', 'https://tushare.pro', 40, 0, 1, JSON_OBJECT('token_env', 'TUSHARE_TOKEN'), UNIX_TIMESTAMP(), UNIX_TIMESTAMP()),
  ('tonghuashun', '同花顺', 'tonghuashun', 'https://www.10jqka.com.cn', 50, 0, 0, JSON_OBJECT('note', '仅在确认稳定、合法、可长期使用的接口后启用'), UNIX_TIMESTAMP(), UNIX_TIMESTAMP())
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  provider_type = VALUES(provider_type),
  base_url = VALUES(base_url),
  priority = VALUES(priority),
  requires_token = VALUES(requires_token),
  config_json = VALUES(config_json),
  updated_at = UNIX_TIMESTAMP();
