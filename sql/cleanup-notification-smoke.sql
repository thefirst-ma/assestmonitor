USE investment_monitor;
-- Deletes only the disposable account used by the 2026-09-19 browser smoke test.
DELETE FROM users WHERE email = 'notifications-smoke-20260919@example.invalid';
