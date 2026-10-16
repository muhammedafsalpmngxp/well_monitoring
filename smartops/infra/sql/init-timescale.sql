-- TimescaleDB initialisation for time-series sensor data used by the
-- Predictive and Anomaly services.
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS sensor_readings (
    well_id      TEXT      NOT NULL,
    sensor       TEXT      NOT NULL,
    ts           TIMESTAMPTZ NOT NULL,
    value        DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (well_id, sensor, ts)
);
SELECT create_hypertable('sensor_readings', 'ts', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS ix_sensor_readings_well_sensor ON sensor_readings (well_id, sensor, ts DESC);

CREATE TABLE IF NOT EXISTS progress_snapshots (
    well_id      TEXT      NOT NULL,
    ts           TIMESTAMPTZ NOT NULL,
    progress_pct DOUBLE PRECISION NOT NULL,
    daily_rate   DOUBLE PRECISION,
    spi          DOUBLE PRECISION,
    cpi          DOUBLE PRECISION,
    PRIMARY KEY (well_id, ts)
);
SELECT create_hypertable('progress_snapshots', 'ts', if_not_exists => TRUE);
