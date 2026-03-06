-- SmartEmergency full schema (fresh install)
-- This schema reflects the current database structure
CREATE DATABASE IF NOT EXISTS iot_safety
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE iot_safety;

CREATE TABLE IF NOT EXISTS devices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uid VARCHAR(64) NOT NULL UNIQUE,
  label VARCHAR(64) NOT NULL,
  last_ip VARCHAR(64),
  last_rssi INT,
  last_seen TIMESTAMP NULL DEFAULT NULL,
  alarm_last_state TINYINT NULL DEFAULT NULL,
  alarm_consecutive INT NOT NULL DEFAULT 0
);

-- Per-device thresholds (one row per device_id)
CREATE TABLE IF NOT EXISTS thresholds (
  device_id INT PRIMARY KEY,
  gas_threshold INT NOT NULL DEFAULT 400,
  gas_enabled TINYINT NOT NULL DEFAULT 1,
  temp_threshold DECIMAL(5,2) NOT NULL DEFAULT 60.00,
  temp_enabled TINYINT NOT NULL DEFAULT 1,
  flame_enabled TINYINT NOT NULL DEFAULT 1,

  humidity_low_threshold DECIMAL(5,2) NOT NULL DEFAULT 20.00,
  humidity_high_threshold DECIMAL(5,2) NOT NULL DEFAULT 80.00,
  humidity_enabled TINYINT NOT NULL DEFAULT 0,

  -- Safe baselines for prediction system
  gas_safe_baseline INT DEFAULT 100 COMMENT 'Safe baseline for gas (0-baseline = normal)',
  temp_safe_baseline DECIMAL(5,2) DEFAULT 25.00 COMMENT 'Safe baseline for temperature',
  humidity_safe_baseline DECIMAL(5,2) DEFAULT 50.00 COMMENT 'Safe baseline for humidity',

  buzzer_enabled TINYINT NOT NULL DEFAULT 1,
  red_light_enabled TINYINT NOT NULL DEFAULT 1,
  red_led_flash_speed_ms INT NOT NULL DEFAULT 200,
  config_pull_interval_sec INT NOT NULL DEFAULT 30,
  send_interval_sec INT NOT NULL DEFAULT 1,

  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS readings (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  device_id INT NOT NULL,
  ts TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  humidity DECIMAL(5,2) NOT NULL,
  temperature DECIMAL(5,2) NOT NULL,
  gas INT NOT NULL,
  flame TINYINT NOT NULL,

  -- Server-computed alarm and triggers:
  alarm TINYINT NOT NULL,
  triggers JSON NULL,

  -- Device-reported alarm (optional):
  alarm_device TINYINT NOT NULL DEFAULT 0,

  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  INDEX idx_device_ts (device_id, ts)
);

CREATE TABLE IF NOT EXISTS alarm_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  device_id INT NOT NULL,

  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP NULL DEFAULT NULL,
  duration_seconds INT NULL,

  triggers JSON NULL,
  peak_gas INT NULL,
  peak_temp DECIMAL(5,2) NULL,
  peak_humidity DECIMAL(5,2) NULL,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_device_started (device_id, started_at),
  INDEX idx_device_active (device_id, ended_at),

  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);
