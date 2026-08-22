// Password hashing for dashboard-user login. Node's built-in scrypt, not
// a new dependency (bcryptjs would be the obvious pick, but this project
// has been deliberate about minimizing dependencies -- Node's own
// crypto.scrypt is a well-regarded, standard KDF and needs nothing new).
// Stored as "salt:derivedKeyHex" -- never the plaintext password, same
// never-store-plaintext convention every credential in this system
// follows (see src/identity/keys.ts's private key storage, by contrast
// -- that's genuinely custodial key material, this is a one-way hash).
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;
  const derivedKey = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  const storedBuffer = Buffer.from(hashHex, "hex");
  return derivedKey.length === storedBuffer.length && timingSafeEqual(derivedKey, storedBuffer);
}
