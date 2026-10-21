import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Self-describing format so parameters can evolve without a migration:
//   scrypt$<N>$<r>$<p>$<saltBase64>$<hashBase64>
// Values stored before hashing was introduced are plain text and are handled
// by the legacy branch of verifyPassword (and rehashed on successful login).
const SCRYPT_PREFIX = "scrypt";
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export const hashPassword = (plain: string): string => {
  const salt = randomBytes(SALT_LENGTH);
  const hash = scryptSync(plain, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });

  return [
    SCRYPT_PREFIX,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64"),
    hash.toString("base64"),
  ].join("$");
};

export const isHashedPassword = (stored: string): boolean =>
  stored.startsWith(`${SCRYPT_PREFIX}$`);

export const verifyPassword = (plain: string, stored: string | null): boolean => {
  if (stored === null || stored === "") {
    return false;
  }

  if (!isHashedPassword(stored)) {
    // Legacy plaintext row; caller should rehash after a successful match.
    return stored === plain;
  }

  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = stored.split("$");
  if (!nRaw || !rRaw || !pRaw || !saltB64 || !hashB64) {
    return false;
  }

  const expected = Buffer.from(hashB64, "base64");
  const actual = scryptSync(plain, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number.parseInt(nRaw, 10),
    r: Number.parseInt(rRaw, 10),
    p: Number.parseInt(pRaw, 10),
  });

  return actual.length === expected.length && timingSafeEqual(actual, expected);
};
