-- historic_seconds already exists on traffic_samples from 0001_traffic_samples.sql.
-- Keep this migration as a tracked no-op so D1 databases that already applied the
-- previous ADD COLUMN version stay consistent, and fresh installs do not fail.
SELECT 1;
