-- Site Cost Summary (the "5D Cost" chip's real replacement). budget is
-- nullable and admin-settable only via direct value for now -- no admin
-- UI beyond the facade route that reads/writes it. NULL means "no
-- budget set", a distinct state from a $0 budget, never conflated.
ALTER TABLE sites ADD COLUMN budget NUMERIC;
