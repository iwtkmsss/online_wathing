import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const keyLength = 64;

export const hashPassword = (password: string) => {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, keyLength).toString("hex");

  return `scrypt:${salt}:${hash}`;
};

export const verifyPassword = (password: string, storedHash: string) => {
  const [algorithm, salt, hash] = storedHash.split(":");

  if (algorithm !== "scrypt" || !salt || !hash) {
    return false;
  }

  const actual = Buffer.from(scryptSync(password, salt, keyLength).toString("hex"));
  const expected = Buffer.from(hash);

  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
};
