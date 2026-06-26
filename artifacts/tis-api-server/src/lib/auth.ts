/**
 * Session primitives shared across all auth flows (email+password,
 * dev-auth, and any future SSO). No OIDC / Replit dependencies live
 * here anymore — they were removed in the Phase-13 migration off
 * Replit.
 */
import crypto from "crypto";
import { type Request, type Response } from "express";
import { db, sessionsTable } from "@workspace/db";
import { and, eq, ne, sql } from "drizzle-orm";

export interface AuthUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
}

export const SESSION_COOKIE = "tis_sid";
export const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

export interface SessionData {
  user: AuthUser;
  // Legacy fields preserved so middleware doesn't have to change
  // shape; future SSO flows can put real tokens here, email+password
  // leaves them as no-op placeholders.
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
}

export async function createSession(data: SessionData): Promise<string> {
  const sid = crypto.randomBytes(32).toString("hex");
  await db.insert(sessionsTable).values({
    sid,
    sess: data as unknown as Record<string, unknown>,
    expire: new Date(Date.now() + SESSION_TTL),
  });
  return sid;
}

export async function getSession(sid: string): Promise<SessionData | null> {
  const [row] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.sid, sid));
  if (!row || row.expire < new Date()) {
    if (row) await deleteSession(sid);
    return null;
  }
  return row.sess as unknown as SessionData;
}

export async function updateSession(sid: string, data: SessionData): Promise<void> {
  await db
    .update(sessionsTable)
    .set({
      sess: data as unknown as Record<string, unknown>,
      expire: new Date(Date.now() + SESSION_TTL),
    })
    .where(eq(sessionsTable.sid, sid));
}

export async function deleteSession(sid: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.sid, sid));
}

/**
 * Revoke every stored session belonging to a user, optionally keeping one
 * (typically the caller's current session). Used after a password change
 * or reset so a stolen / stale session can't outlive the credential it was
 * minted under — without this, an attacker who already has a live session
 * keeps full access even after the victim resets their password, which
 * defeats the whole point of a reset.
 *
 * There's no `user_id` column on the sessions table (the user lives inside
 * the opaque JSONB `sess` payload), so this matches on the JSONB path
 * `sess -> 'user' ->> 'id'`. Returns the number of sessions removed.
 */
export async function deleteUserSessions(
  userId: string,
  opts?: { exceptSid?: string },
): Promise<number> {
  const matchesUser = sql`${sessionsTable.sess} -> 'user' ->> 'id' = ${userId}`;
  const where = opts?.exceptSid
    ? and(matchesUser, ne(sessionsTable.sid, opts.exceptSid))
    : matchesUser;
  const deleted = await db
    .delete(sessionsTable)
    .where(where)
    .returning({ sid: sessionsTable.sid });
  return deleted.length;
}

export async function clearSession(res: Response, sid?: string): Promise<void> {
  if (sid) await deleteSession(sid);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function getSessionId(req: Request): string | undefined {
  const authHeader = req.headers["authorization"];
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return req.cookies?.[SESSION_COOKIE];
}

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}
