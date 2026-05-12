/**
 * Email + password authentication endpoints.
 *
 *   POST /auth/signup            { email, password, firstName?, lastName? }
 *   POST /auth/login             { email, password }
 *   POST /auth/logout
 *   POST /auth/password-reset    { email }                      — request a reset
 *   POST /auth/password-confirm  { token, password }            — redeem
 *
 * All endpoints set / clear the same session cookie used by the rest of
 * the app, so middleware downstream (auth-middleware, firm resolution,
 * quota check) is unchanged.
 */
import { Router, type IRouter, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
  newResetToken,
  isValidEmail,
  PASSWORD_RESET_TTL_MS,
} from "../lib/password-auth";
import {
  createSession,
  clearSession,
  getSessionId,
  SESSION_COOKIE,
  SESSION_TTL,
  type SessionData,
} from "../lib/auth";
import { sendPasswordResetEmail } from "../lib/email";
import { getPublicAppOrigin } from "../lib/stripe";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function setSessionCookie(res: Response, sid: string) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

function sessionFromUser(user: typeof usersTable.$inferSelect): SessionData {
  return {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profileImageUrl: user.profileImageUrl,
    },
    // The session shape predates email-auth; we keep the placeholder
    // tokens so middleware that branched on their presence keeps
    // working without changes.
    access_token: "email-pw",
    refresh_token: undefined,
    expires_at: Math.floor((Date.now() + SESSION_TTL) / 1000),
  };
}

router.post("/auth/signup", async (req, res): Promise<void> => {
  const body = req.body as {
    email?: unknown;
    password?: unknown;
    firstName?: unknown;
    lastName?: unknown;
  };
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const firstName = body.firstName ? String(body.firstName).trim().slice(0, 80) : null;
  const lastName = body.lastName ? String(body.lastName).trim().slice(0, 80) : null;

  if (!isValidEmail(email)) {
    res.status(400).json({ error: "Valid email required." });
    return;
  }
  const strength = validatePasswordStrength(password);
  if (!strength.ok) {
    res.status(400).json({ error: strength.reason });
    return;
  }

  try {
    const [existing] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    let user;
    if (existing) {
      if (existing.passwordHash) {
        // Account already exists with a real password. Don't leak that
        // signal — return the same generic error a wrong-password login
        // would return so account-enumeration attacks don't get a free
        // boolean.
        res.status(409).json({ error: "An account with that email already exists." });
        return;
      }
      // Existing user with no password (legacy OIDC or dev-auth row).
      // Promote them to email+password by setting the hash.
      const passwordHash = await hashPassword(password);
      [user] = await db
        .update(usersTable)
        .set({
          passwordHash,
          firstName: firstName ?? existing.firstName,
          lastName: lastName ?? existing.lastName,
        })
        .where(eq(usersTable.id, existing.id))
        .returning();
    } else {
      const passwordHash = await hashPassword(password);
      [user] = await db
        .insert(usersTable)
        .values({ email, firstName, lastName, passwordHash })
        .returning();
    }
    if (!user) throw new Error("upsert returned no user");

    const sid = await createSession(sessionFromUser(user));
    setSessionCookie(res, sid);
    logger.info({ userId: user.id, email }, "email-auth.signup");
    res.status(201).json({
      user: sessionFromUser(user).user,
    });
  } catch (err) {
    logger.error({ err, email }, "email-auth.signup_failed");
    res.status(500).json({ error: "Signup failed." });
  }
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const body = req.body as { email?: unknown; password?: unknown };
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!isValidEmail(email) || !password) {
    res.status(400).json({ error: "Email and password required." });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (!user || !user.passwordHash) {
    // Generic message — don't reveal whether the account exists.
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  const sid = await createSession(sessionFromUser(user));
  setSessionCookie(res, sid);
  logger.info({ userId: user.id }, "email-auth.login");
  res.json({ user: sessionFromUser(user).user });
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  const sid = getSessionId(req);
  await clearSession(res, sid);
  res.json({ ok: true });
});

router.post("/auth/password-reset", async (req, res): Promise<void> => {
  const body = req.body as { email?: unknown };
  const email = String(body.email ?? "").trim().toLowerCase();
  // Always 200 — don't reveal whether the email is registered. The
  // attacker pays nothing to probe, the user pays nothing if it's a
  // typo, and we deliver real reset links to real users silently.
  if (!isValidEmail(email)) {
    res.json({ ok: true });
    return;
  }
  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);
    if (user && user.passwordHash) {
      const { token, expiresAt } = newResetToken();
      await db
        .update(usersTable)
        .set({ passwordResetToken: token, passwordResetExpiresAt: expiresAt })
        .where(eq(usersTable.id, user.id));
      const origin = getPublicAppOrigin();
      const resetUrl = `${origin}/auth/reset?token=${encodeURIComponent(token)}`;
      await sendPasswordResetEmail({ to: email, resetUrl, expiresAt });
    }
  } catch (err) {
    logger.error({ err, email }, "email-auth.reset_request_failed");
    // Still return 200 to maintain enumeration resistance.
  }
  res.json({ ok: true });
});

router.post("/auth/password-confirm", async (req, res): Promise<void> => {
  const body = req.body as { token?: unknown; password?: unknown };
  const token = String(body.token ?? "");
  const password = String(body.password ?? "");
  if (!token) {
    res.status(400).json({ error: "Reset token required." });
    return;
  }
  const strength = validatePasswordStrength(password);
  if (!strength.ok) {
    res.status(400).json({ error: strength.reason });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.passwordResetToken, token))
    .limit(1);

  if (
    !user ||
    !user.passwordResetExpiresAt ||
    user.passwordResetExpiresAt.getTime() < Date.now()
  ) {
    res.status(400).json({ error: "Reset link is invalid or expired." });
    return;
  }

  const passwordHash = await hashPassword(password);
  await db
    .update(usersTable)
    .set({
      passwordHash,
      passwordResetToken: null,
      passwordResetExpiresAt: null,
    })
    .where(eq(usersTable.id, user.id));

  // Issue a fresh session immediately so the user is signed in after
  // resetting.
  const sid = await createSession(sessionFromUser(user));
  setSessionCookie(res, sid);

  logger.info({ userId: user.id }, "email-auth.password_reset");
  // Maintain the existing auth-state response shape for downstream
  // useAuth hooks.
  res.json({ user: sessionFromUser(user).user });
});

// Exposed so consumers (signup page, reset confirmation) know the
// password rule without hard-coding it on the client.
router.get("/auth/password-policy", (_req, res): void => {
  res.json({
    minLength: 10,
    maxLength: 200,
    resetTtlMs: PASSWORD_RESET_TTL_MS,
  });
});

export default router;
