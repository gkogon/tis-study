import * as oidc from "openid-client";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable } from "@workspace/db";
import {
  clearSession,
  getOidcConfig,
  getSessionId,
  createSession,
  SESSION_COOKIE,
  SESSION_TTL,
  type SessionData,
} from "../lib/auth";

const OIDC_COOKIE_TTL = 10 * 60 * 1000;

// Local-dev sign-in bypass — only available when `DEV_AUTH_ENABLED=true`.
// Production deployments leave this unset; Replit OIDC remains the only
// path to authentication. The flag is checked at request time so a flag
// flip doesn't require a redeploy.
function devAuthEnabled(): boolean {
  return process.env.DEV_AUTH_ENABLED === "true";
}

const router: IRouter = Router();

function getOrigin(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers["host"] || "localhost";
  return `${proto}://${host}`;
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

function setOidcCookie(res: Response, name: string, value: string) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: OIDC_COOKIE_TTL,
  });
}

function getSafeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

async function upsertUser(claims: Record<string, unknown>) {
  const userData = {
    id: claims.sub as string,
    email: (claims.email as string) || null,
    firstName: (claims.first_name as string) || null,
    lastName: (claims.last_name as string) || null,
    profileImageUrl: (claims.profile_image_url || claims.picture) as string | null,
  };

  const [user] = await db
    .insert(usersTable)
    .values(userData)
    .onConflictDoUpdate({
      target: usersTable.id,
      set: { ...userData, updatedAt: new Date() },
    })
    .returning();
  return user;
}

router.get("/auth/user", (req: Request, res: Response) => {
  res.json({ user: req.isAuthenticated() ? req.user : null });
});

// Lets the frontend feature-flag a Dev Sign-In widget in the UI without
// shipping it to production.
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

  // Stable id derived from email so re-running dev-login keeps the same
  // user (and their firm, their projects, etc.). Hash, not raw, so the
  // id stays opaque if it ever leaks to logs.
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
    // Placeholder tokens — never used because the auth middleware only
    // calls the OIDC refresh path when `expires_at` is in the past.
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

router.get("/login", async (req: Request, res: Response) => {
  const config = await getOidcConfig();
  const callbackUrl = `${getOrigin(req)}/tis-api/callback`;
  const returnTo = getSafeReturnTo(req.query.returnTo);

  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);

  const redirectTo = oidc.buildAuthorizationUrl(config, {
    redirect_uri: callbackUrl,
    scope: "openid email profile offline_access",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "login consent",
    state,
    nonce,
  });

  setOidcCookie(res, "tis_code_verifier", codeVerifier);
  setOidcCookie(res, "tis_nonce", nonce);
  setOidcCookie(res, "tis_state", state);
  setOidcCookie(res, "tis_return_to", returnTo);

  res.redirect(redirectTo.href);
});

router.get("/callback", async (req: Request, res: Response) => {
  const config = await getOidcConfig();
  const callbackUrl = `${getOrigin(req)}/tis-api/callback`;

  const codeVerifier = req.cookies?.tis_code_verifier;
  const nonce = req.cookies?.tis_nonce;
  const expectedState = req.cookies?.tis_state;

  if (!codeVerifier || !expectedState) {
    res.redirect("/tis-api/login");
    return;
  }

  const currentUrl = new URL(
    `${callbackUrl}?${new URL(req.url, `http://${req.headers.host}`).searchParams}`,
  );

  let tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers;
  try {
    tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedNonce: nonce,
      expectedState,
      idTokenExpected: true,
    });
  } catch (err) {
    req.log.warn({ err }, "tis-auth.callback_failed");
    res.redirect("/tis-api/login");
    return;
  }

  const returnTo = getSafeReturnTo(req.cookies?.tis_return_to);

  res.clearCookie("tis_code_verifier", { path: "/" });
  res.clearCookie("tis_nonce", { path: "/" });
  res.clearCookie("tis_state", { path: "/" });
  res.clearCookie("tis_return_to", { path: "/" });

  const claims = tokens.claims();
  if (!claims) {
    res.redirect("/tis-api/login");
    return;
  }

  const dbUser = await upsertUser(claims as unknown as Record<string, unknown>);

  const now = Math.floor(Date.now() / 1000);
  const sessionData: SessionData = {
    user: {
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      profileImageUrl: dbUser.profileImageUrl,
    },
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expiresIn() ? now + tokens.expiresIn()! : claims.exp,
  };

  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.redirect(returnTo);
});

router.get("/logout", async (req: Request, res: Response) => {
  const config = await getOidcConfig();
  const origin = getOrigin(req);
  const sid = getSessionId(req);
  await clearSession(res, sid);

  const endSessionUrl = oidc.buildEndSessionUrl(config, {
    client_id: process.env.REPL_ID!,
    post_logout_redirect_uri: `${origin}/`,
  });

  res.redirect(endSessionUrl.href);
});

export default router;
