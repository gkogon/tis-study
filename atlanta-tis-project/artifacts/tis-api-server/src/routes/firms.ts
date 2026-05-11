/**
 * Firm-account management endpoints. All routes here are authenticated;
 * write routes additionally check the caller's role on the target firm.
 *
 *   POST   /firms                       create firm + owner membership
 *   GET    /firms/me                    current user's firm + role
 *   PATCH  /firms                       owner/admin: rename, logo URL
 *   GET    /firms/members               list members + invites
 *   DELETE /firms/members/:userId       owner: remove a member
 *   POST   /firms/invites               owner/admin: create invite token
 *   POST   /firms/invites/accept        any authed user: redeem token
 */
import crypto from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  db,
  firmsTable,
  firmMembersTable,
  firmInvitesTable,
  usersTable,
} from "@workspace/db";
import {
  getOrCreateFirmForUser,
  getActiveFirmForUser,
  getMembership,
  listFirmMembers,
  TRIAL_SEAT_LIMIT,
  TRIAL_STUDY_LIMIT,
} from "../lib/firms";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ---------- helpers ----------

function slugifyFirmName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base || "firm"}-${suffix}`;
}

function newInviteToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

function requireRole(role: string | null | undefined, allowed: string[]): boolean {
  return !!role && allowed.includes(role);
}

// ---------- routes ----------

router.post("/firms", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in to create a firm." });
    return;
  }
  const user = req.user!;
  const name = String((req.body as { name?: unknown })?.name ?? "").trim();
  if (!name || name.length > 120) {
    res.status(400).json({ error: "Firm name must be 1–120 characters." });
    return;
  }

  // If this user already belongs to a firm, return that — keeps the
  // signup endpoint idempotent across double-submits.
  const existing = await getActiveFirmForUser(user.id);
  if (existing) {
    res.json({ firm: existing.firm, role: existing.role, alreadyExisted: true });
    return;
  }

  try {
    const [firm] = await db
      .insert(firmsTable)
      .values({
        name,
        slug: slugifyFirmName(name),
        planTier: "trial",
        seatLimit: TRIAL_SEAT_LIMIT,
        studyLimit: TRIAL_STUDY_LIMIT,
      })
      .returning();
    if (!firm) throw new Error("Firm insert returned no row");

    await db.insert(firmMembersTable).values({
      firmId: firm.id,
      userId: user.id,
      role: "owner",
    });

    logger.info({ firmId: firm.id, userId: user.id }, "firms.created");
    res.status(201).json({ firm, role: "owner" });
  } catch (err) {
    req.log.error({ err }, "firms.create_failed");
    res.status(500).json({ error: "Failed to create firm." });
  }
});

router.get("/firms/me", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }
  const user = req.user!;
  const result = await getActiveFirmForUser(user.id);
  if (!result) {
    res.json({ firm: null, role: null });
    return;
  }
  res.json({ firm: result.firm, role: result.role });
});

router.patch("/firms", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }
  const user = req.user!;
  const { firm, role } = await getOrCreateFirmForUser(user.id, {
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
  });
  if (!requireRole(role, ["owner", "admin"])) {
    res.status(403).json({ error: "Only owners or admins can update firm settings." });
    return;
  }

  const body = req.body as { name?: unknown; logoUrl?: unknown };
  const updates: Partial<typeof firmsTable.$inferInsert> = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name || name.length > 120) {
      res.status(400).json({ error: "Firm name must be 1–120 characters." });
      return;
    }
    updates.name = name;
  }
  if (body.logoUrl !== undefined) {
    if (body.logoUrl === null || body.logoUrl === "") {
      updates.logoUrl = null;
    } else if (typeof body.logoUrl === "string" && /^https?:\/\//.test(body.logoUrl) && body.logoUrl.length <= 1024) {
      updates.logoUrl = body.logoUrl;
    } else {
      res.status(400).json({ error: "Logo URL must be a valid http(s) URL." });
      return;
    }
  }

  if (Object.keys(updates).length === 0) {
    res.json({ firm });
    return;
  }

  const [updated] = await db
    .update(firmsTable)
    .set(updates)
    .where(eq(firmsTable.id, firm.id))
    .returning();
  res.json({ firm: updated });
});

router.get("/firms/members", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }
  const user = req.user!;
  const { firm } = await getOrCreateFirmForUser(user.id, {
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
  });

  const members = await db
    .select({
      userId: firmMembersTable.userId,
      role: firmMembersTable.role,
      joinedAt: firmMembersTable.joinedAt,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
    })
    .from(firmMembersTable)
    .innerJoin(usersTable, eq(firmMembersTable.userId, usersTable.id))
    .where(eq(firmMembersTable.firmId, firm.id));

  const pendingInvites = await db
    .select({
      id: firmInvitesTable.id,
      email: firmInvitesTable.email,
      role: firmInvitesTable.role,
      createdAt: firmInvitesTable.createdAt,
      expiresAt: firmInvitesTable.expiresAt,
      token: firmInvitesTable.token,
    })
    .from(firmInvitesTable)
    .where(
      and(
        eq(firmInvitesTable.firmId, firm.id),
        isNull(firmInvitesTable.acceptedAt),
      ),
    )
    .orderBy(desc(firmInvitesTable.createdAt));

  res.json({
    members: members.map((m) => ({
      userId: m.userId,
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
      email: m.email,
      firstName: m.firstName,
      lastName: m.lastName,
    })),
    pendingInvites: pendingInvites.map((p) => ({
      id: p.id,
      email: p.email,
      role: p.role,
      createdAt: p.createdAt.toISOString(),
      expiresAt: p.expiresAt.toISOString(),
      // Token is shown to the admin so they can copy/paste the
      // /invites/accept link manually until we add transactional email.
      token: p.token,
    })),
    seatLimit: firm.seatLimit,
  });
});

router.delete("/firms/members/:userId", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }
  const user = req.user!;
  const targetUserId = String(req.params.userId);
  const { firm, role } = await getOrCreateFirmForUser(user.id, {
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
  });
  if (!requireRole(role, ["owner"])) {
    res.status(403).json({ error: "Only the firm owner can remove members." });
    return;
  }
  if (targetUserId === user.id) {
    res.status(400).json({ error: "Owners cannot remove themselves. Transfer ownership first." });
    return;
  }

  await db
    .delete(firmMembersTable)
    .where(
      and(
        eq(firmMembersTable.firmId, firm.id),
        eq(firmMembersTable.userId, targetUserId),
      ),
    );

  res.json({ ok: true });
});

router.post("/firms/invites", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }
  const user = req.user!;
  const { firm, role } = await getOrCreateFirmForUser(user.id, {
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
  });
  if (!requireRole(role, ["owner", "admin"])) {
    res.status(403).json({ error: "Only owners or admins can invite." });
    return;
  }
  const body = req.body as { email?: unknown; role?: unknown };
  const email = String(body.email ?? "").trim().toLowerCase();
  const inviteRole = body.role === "admin" || body.role === "member" ? body.role : "member";
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    res.status(400).json({ error: "Valid email required." });
    return;
  }

  // Check seat limit: existing members + pending invites must not exceed.
  const members = await listFirmMembers(firm.id);
  const pendingInvites = await db
    .select()
    .from(firmInvitesTable)
    .where(
      and(
        eq(firmInvitesTable.firmId, firm.id),
        isNull(firmInvitesTable.acceptedAt),
      ),
    );
  if (members.length + pendingInvites.length >= firm.seatLimit) {
    res.status(400).json({
      error: `Seat limit reached (${firm.seatLimit}). Upgrade your plan or remove a member.`,
    });
    return;
  }

  const token = newInviteToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const [invite] = await db
    .insert(firmInvitesTable)
    .values({
      firmId: firm.id,
      email,
      role: inviteRole,
      token,
      invitedByUserId: user.id,
      expiresAt,
    })
    .returning();
  res.status(201).json({ invite });
});

router.post("/firms/invites/accept", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in to accept the invite." });
    return;
  }
  const user = req.user!;
  const token = String((req.body as { token?: unknown })?.token ?? "");
  if (!token) {
    res.status(400).json({ error: "Token required." });
    return;
  }

  const [invite] = await db
    .select()
    .from(firmInvitesTable)
    .where(eq(firmInvitesTable.token, token))
    .limit(1);
  if (!invite) {
    res.status(404).json({ error: "Invite not found." });
    return;
  }
  if (invite.acceptedAt) {
    res.status(400).json({ error: "Invite already accepted." });
    return;
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    res.status(400).json({ error: "Invite expired." });
    return;
  }

  // If the user already belongs to a firm, refuse — keeps the model
  // single-firm-per-user for now.
  const existing = await getActiveFirmForUser(user.id);
  if (existing) {
    res.status(400).json({
      error: "You already belong to a firm. Leave it before accepting a new invite.",
    });
    return;
  }

  // Idempotent membership insert (PK = firmId+userId so a duplicate would error).
  const alreadyMember = await getMembership(invite.firmId, user.id);
  if (!alreadyMember) {
    await db.insert(firmMembersTable).values({
      firmId: invite.firmId,
      userId: user.id,
      role: invite.role,
      invitedByUserId: invite.invitedByUserId,
    });
  }
  await db
    .update(firmInvitesTable)
    .set({ acceptedAt: new Date() })
    .where(eq(firmInvitesTable.id, invite.id));

  res.json({ firmId: invite.firmId, role: invite.role });
});

export default router;
