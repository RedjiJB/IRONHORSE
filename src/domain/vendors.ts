import { pool } from "../db/pool.js";

export type Vendor = {
  id: string;
  name: string;
  contact_method: string | null;
  contact_address: string | null;
  account_number: string | null;
  lead_time_days: number | null;
  created_at: string;
};

export async function registerVendor(args: {
  name: string;
  contactMethod?: string;
  contactAddress?: string;
  accountNumber?: string;
  leadTimeDays?: number;
}): Promise<Vendor> {
  const result = await pool.query(
    `INSERT INTO vendors (name, contact_method, contact_address, account_number, lead_time_days)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [args.name, args.contactMethod ?? null, args.contactAddress ?? null, args.accountNumber ?? null, args.leadTimeDays ?? null],
  );
  return result.rows[0] as Vendor;
}

export async function listVendors(): Promise<Vendor[]> {
  const result = await pool.query("SELECT * FROM vendors ORDER BY name");
  return result.rows as Vendor[];
}

export async function getVendor(id: string): Promise<Vendor | null> {
  const result = await pool.query("SELECT * FROM vendors WHERE id = $1", [id]);
  return (result.rows[0] as Vendor) ?? null;
}
