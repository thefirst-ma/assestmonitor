-- Apply on the VPS after enabling server TLS. Replace the password placeholder
-- with a freshly generated random value using sql/provision-tokyo.cjs.
CREATE USER IF NOT EXISTS 'investment_monitor_app'@'%' IDENTIFIED BY '{{APP_PASSWORD}}' REQUIRE SSL;
ALTER USER 'investment_monitor_app'@'%' IDENTIFIED BY '{{APP_PASSWORD}}' REQUIRE SSL;
GRANT SELECT, INSERT, UPDATE, DELETE ON investment_monitor.* TO 'investment_monitor_app'@'%';
