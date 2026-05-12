/**
 * Session-lookup endpoints. The Replit OIDC `/login` and `/callback`
 * handlers that previously lived here were removed in the Phase-13
 * migration off Replit; email + password auth is now in
 * `routes/email-auth.ts`. The dev-auth bypass remains here because it
 * predates the migration and is gated by `DEV_AUTH_ENABLED`.
 */
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable } from "@workspace/db";
import {
  clearSession,
  getSessionId,
  createSession,
  SESSION_COOKIE,
  SESSION_TTL,
  type SessionData,
} from "../lib/auth";

const router: IRouter = Router();

function devAuthEnabled(): boolean {
  return process.env.DEV_AUTH_ENABLED === "true";
}

function setSessionCookie(res: Response, sid: string) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

router.get("/auth/user", (req: Request, res: Response) => {
  res.json({ user: req.isAuthenticated() ? req.user : null });
});

router.get("/auth/config", (_req: Request, res: Response) => {
  res.json({ devAuthEnabled: devAuthEnabled() });
});

router.post("/dev-login", async (req: Request, res: Response): Promise<void> => {
  if (!devAuthEnabled()) {
    res.status(404).json({ error: "Not available." });
    return;
  }
  const body = (req.body ?? {}) as {
    email?: unknown;
    firstName?: unknown;
    lastName?: unknown;
  };
  const email = String(body.email ?? "engineer@firm.test").trim().toLowerCase();
  const firstName = body.firstName ? String(body.firstName).trim() : "Test";
  const lastName = body.lastName ? String(body.lastName).trim() : "Engineer";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    res.status(400).json({ error: "Valid email required." });
    return;
  }

  const idSeed = `dev:${email}`;
  const userId = "dev-" + crypto.createHash("sha256").update(idSeed).digest("hex").slice(0, 24);

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);

  let user;
  if (existing) {
    [user] = await db
      .update(usersTable)
      .set({ email, firstName, lastName, updatedAt: new Date() })
      .where(eq(usersTable.id, userId))
      .returning();
  } else {
    [user] = await db
      .insert(usersTable)
      .values({ id: userId, email, firstName, lastName })
      .returning();
  }
  if (!user) {
    res.status(500).json({ error: "Failed to upsert dev user." });
    return;
  }

  const sessionData: SessionData = {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profileImageUrl: user.profileImageUrl,
    },
    access_token: "dev-noop",
    refresh_token: undefined,
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
  };
  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.json({ user: sessionData.user });
});

router.post("/dev-logout", async (req: Request, res: Response): Promise<void> => {
  if (!devAuthEnabled()) {
    res.status(404).json({ error: "Not available." });
    return;
  }
  const sid = getSessionId(req);
  await clearSession(res, sid);
  res.json({ ok: true });
});

export default router;
