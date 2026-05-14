/**
 * Public unsubscribe endpoints. CAN-SPAM compliance: anyone with a
 * working email can opt themselves out from outbound marketing emails
 * without signing in. Transactional emails (auth, billing, invites)
 * keep sending — only marketing is gated by isOptedOut().
 *
 *   GET  /api/unsubscribe?email=...      Resolve current opt-out status
 *                                        without mutating. Used by the
 *                                        /unsubscribe page to render the
 *                                        confirmation state.
 *
 *   POST /api/unsubscribe                body: { email, reason?, source? }
 *                                        Idempotent — duplicate opts return
 *                                        success without erroring.
 *
 * Mounted under /api (not /tis-api) so the unsubscribe URL we
 * include in cold-email footers stays short + memorable.
 */
import { Router, type IRouter } from "express";
import { optOutEmail, isOptedOut } from "../lib/email-optouts";

const router: IRouter = Router();

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

router.get("/api/unsubscribe", async (req, res): Promise<void> => {
  const email = String(req.query.email ?? "").trim();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    res.status(400).json({ error: "Provide a valid email address." });
    return;
  }
  try {
    const optedOut = await isOptedOut(email);
    res.json({ email, optedOut });
  } catch (err) {
    req.log.error({ err }, "unsubscribe.lookup_failed");
    res.status(500).json({ error: "Lookup failed. Try again." });
  }
});

router.post("/api/unsubscribe", async (req, res): Promise<void> => {
  const body = (req.body as { email?: unknown; reason?: unknown; source?: unknown }) ?? {};
  const email = String(body.email ?? "").trim();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    res.status(400).json({ error: "Provide a valid email address." });
    return;
  }
  const reason = typeof body.reason === "string" ? body.reason : undefined;
  const source = typeof body.source === "string" ? body.source.slice(0, 64) : "unsubscribe_page";
  try {
    const { alreadyOpted } = await optOutEmail(email, { source, reason });
    res.json({ email, optedOut: true, alreadyOpted });
  } catch (err) {
    req.log.error({ err }, "unsubscribe.opt_failed");
    res.status(500).json({ error: "Could not process your request. Try again." });
  }
});

export default router;
