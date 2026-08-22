-- Task #156 slice B. alerts.resolved_by and notifications.acknowledged_by
-- were built (Phase 2 slice 5) before the users table existed (slice 6)
-- -- so a dashboard admin has no way to resolve an alert or acknowledge a
-- notification today. Adds the second half of the dual-actor pair, same
-- pattern already established on spend_records/checkouts/purchase_orders:
-- a nullable crew-member FK alongside a nullable dashboard-user FK.
ALTER TABLE alerts ADD COLUMN resolved_by_user_id UUID REFERENCES users(id);
ALTER TABLE notifications ADD COLUMN acknowledged_by_user_id UUID REFERENCES users(id);
