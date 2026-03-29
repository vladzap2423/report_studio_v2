import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  try {
    const parts = storedHash.split("$");
    if (parts.length !== 3 || parts[0] !== "scrypt") return false;

    const [, salt, digestHex] = parts;
    const storedDigest = Buffer.from(digestHex, "hex");
    const derived = (await scrypt(password, salt, storedDigest.length)) as Buffer;

    if (storedDigest.length !== derived.length) return false;
    return timingSafeEqual(storedDigest, derived);
  } catch {
    return false;
  }
}
