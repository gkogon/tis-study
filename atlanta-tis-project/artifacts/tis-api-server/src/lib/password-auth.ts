/**
 * Email + password authentication primitives.
 *
 * Replaces Replit OIDC as the canonical sign-in path. Existing dev-auth
 * (`DEV_AUTH_ENABLED=true`) and Replit OIDC code paths can remain in
 * place behind feature flags for backwards-compat, but new accounts use
 * this module.
 *
 * Security choices:
 *   - bcrypt with 12 rounds (~100 ms verify time, industry standard).
 *   - Password-reset tokens are 32 random bytes (url-safe base64).
 *   - Reset links expire 1 hour after issue.
 *   - We deliberately don't reveal whether an email is registered on
 *     either signup conflict or reset-request — both return the same
 *     "if an account exists, we sent you a link" response.
 */
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

const BCRYPT_ROUNDS = 12;
const RESET_TTL_MS = 60 * 60 * 1000;  // 1 hour

export const PASSWORD_RESET_TTL_MS = RESET_TTL_MS;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/** Validate password meets minimum strength rules. */
export function validatePasswordStrength(p: string): { ok: true } | { ok: false; reason: string } {
  if (p.length < 10) return { ok: false, reason: "Password must be at least 10 characters." };
  if (p.length > 200) return { ok: false, reason: "Password is too long (max 200 chars)." };
  return { ok: true };
}

export function newResetToken(): { token: string; expiresAt: Date } {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);
  return { token, expiresAt };
}

export function isValidEmail(e: string): boolean {
  // Pragmatic regex — catches obvious bad emails without RFC 5322 madness.
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e.length <= 254;
}
