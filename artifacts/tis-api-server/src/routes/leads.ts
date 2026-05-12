import { Router, type IRouter } from "express";
import { CreateLeadBody } from "@workspace/tis-api-zod";
import { saveLead, getAllLeads } from "../lib/atlanta-leads";
import { isAdminEmail } from "../lib/auth";
import { leadsRateLimiter } from "../lib/security";

const router: IRouter = Router();

router.post("/leads", leadsRateLimiter, async (req, res): Promise<void> => {
  const parsed = CreateLeadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid lead payload" });
    req.log.warn({ issues: parsed.error.issues }, "lead.invalid_body");
    return;
  }
  // Honeypot — silently accept then drop. Returning 201 prevents trivial
  // bot detection / retry loops.
  const honeypot = parsed.data.website;
  if (typeof honeypot === "string" && honeypot.trim().length > 0) {
    req.log.warn({ ip: req.ip }, "lead.honeypot_triggered");
    res.status(201).json({ id: "discarded", createdAt: new Date().toISOString() });
    return;
  }
  // Drop the honeypot before persisting so it never lands in our store.
  const { website: _website, ...leadInput } = parsed.data;
  void _website;
  try {
    const lead = await saveLead(leadInput);
    req.log.info(
      { leadId: lead.id, source: lead.source ?? "unknown", organization: lead.organization, city: lead.city },
      "lead.captured",
    );
    res.status(201).json({ id: lead.id, createdAt: lead.createdAt });
  } catch (err) {
    req.log.error({ err }, "lead.persist_failed");
    res.status(500).json({
      error: "Failed to persist lead. Please email us directly so we don't lose it.",
    });
  }
});

router.get("/leads/list", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (!isAdminEmail(req.user!.email)) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  const leads = getAllLeads().map((l) => ({
    id: l.id,
    name: l.name,
    email: l.email,
    organization: l.organization,
    city: l.city,
    role: l.role ?? null,
    message: l.message ?? null,
    productInterest: l.productInterest ?? null,
    source: l.source ?? "other",
    createdAt: l.createdAt,
  }));
  res.json(leads);
});

export default router;
