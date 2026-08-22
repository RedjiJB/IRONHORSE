// Re-expressed from v1's money_instruments/money_instrument_custody
// domain logic -- requirements baseline, not copied code. balance is
// hand-adjusted, never auto-derived from spend_records -- no automatic
// reconciliation between recorded spends and the instrument's tracked
// balance, same real limitation v1 has. Custody periods are not
// DB-enforced against overlap, same real gap v1 has -- app-layer
// discipline (end the current custody before assigning a new one), not a
// constraint.
import { pool } from "../db/pool.js";

export type MoneyInstrumentType = "company_card" | "petty_cash";

export type MoneyInstrument = {
  id: string;
  type: MoneyInstrumentType;
  label: string;
  balance: string | null;
  active: boolean;
};

export async function registerMoneyInstrument(args: { type: MoneyInstrumentType; label: string; initialBalance?: number }): Promise<MoneyInstrument> {
  const result = await pool.query(
    `INSERT INTO money_instruments (type, label, balance) VALUES ($1, $2, $3) RETURNING *`,
    [args.type, args.label, args.type === "petty_cash" ? args.initialBalance ?? 0 : null],
  );
  return result.rows[0] as MoneyInstrument;
}

export type AdjustBalanceResult = { ok: true; instrument: MoneyInstrument } | { ok: false; reason: "not_found" | "not_petty_cash" };

export async function adjustMoneyInstrumentBalance(id: string, delta: number): Promise<AdjustBalanceResult> {
  const existing = await pool.query("SELECT * FROM money_instruments WHERE id = $1", [id]);
  const instrument = existing.rows[0] as MoneyInstrument | undefined;
  if (!instrument) return { ok: false, reason: "not_found" };
  if (instrument.type !== "petty_cash") return { ok: false, reason: "not_petty_cash" };

  const result = await pool.query(
    "UPDATE money_instruments SET balance = COALESCE(balance, 0) + $2 WHERE id = $1 RETURNING *",
    [id, delta],
  );
  return { ok: true, instrument: result.rows[0] as MoneyInstrument };
}

export async function listMoneyInstruments(filter?: { active?: boolean }): Promise<MoneyInstrument[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter?.active !== undefined) {
    params.push(filter.active);
    conditions.push(`active = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(`SELECT * FROM money_instruments ${where} ORDER BY label`, params);
  return result.rows as MoneyInstrument[];
}

export type CustodyRecord = {
  id: string;
  instrument_id: string;
  held_by: string;
  started_at: string;
  ended_at: string | null;
  assigned_by_user_id: string | null;
};

export async function assignCustody(args: { instrumentId: string; heldBy: string; assignedByUserId?: string }): Promise<CustodyRecord> {
  const result = await pool.query(
    `INSERT INTO money_instrument_custody (instrument_id, held_by, assigned_by_user_id) VALUES ($1, $2, $3) RETURNING *`,
    [args.instrumentId, args.heldBy, args.assignedByUserId ?? null],
  );
  return result.rows[0] as CustodyRecord;
}

export async function endCustody(custodyId: string): Promise<CustodyRecord | null> {
  const result = await pool.query(
    "UPDATE money_instrument_custody SET ended_at = now() WHERE id = $1 AND ended_at IS NULL RETURNING *",
    [custodyId],
  );
  return (result.rows[0] as CustodyRecord) ?? null;
}

export async function getCurrentCustody(instrumentId: string): Promise<CustodyRecord | null> {
  const result = await pool.query(
    "SELECT * FROM money_instrument_custody WHERE instrument_id = $1 AND ended_at IS NULL LIMIT 1",
    [instrumentId],
  );
  return (result.rows[0] as CustodyRecord) ?? null;
}
