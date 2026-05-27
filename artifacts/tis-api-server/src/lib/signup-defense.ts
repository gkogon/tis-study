/**
 * Signup-abuse defenses. Layered cheaply on top of the express-rate-limit
 * per-IP guard so that a coordinated distributed attempt (residential
 * proxies, rotated IPs) can't trivially mass-create accounts.
 *
 * Layers, in increasing cost-to-attacker:
 *   1. Honeypot field — every form has a hidden `website` input. Real
 *      users never fill it. Bots that auto-fill every input do.
 *   2. Form-load timestamp — the client stamps `formLoadedAt` on mount;
 *      submissions in under 2 seconds are bots, not humans.
 *   3. Disposable-email blocklist — common throwaway providers reject.
 *   4. Global signup ceiling — a process-local sliding window caps total
 *      signups per hour across ALL IPs, so even a wide distributed run
 *      can't outpace human-scale legitimate traffic.
 *   5. Optional Cloudflare Turnstile — if TURNSTILE_SECRET_KEY is set,
 *      we verify the client-supplied token via Cloudflare's siteverify
 *      endpoint. Drops in without code changes when the keys are added.
 *
 * Every check returns the same generic error to the API consumer so a
 * scanner can't iterate. The real reason is logged server-side.
 */

import { logger } from "./logger";

/* ----- 1. Disposable-email blocklist ----------------------------------
 *
 * Curated list of the top throwaway-mailbox providers. Not exhaustive —
 * the complete list at github.com/disposable-email-domains/disposable-
 * email-domains has ~3000 entries. This is the ~80 that account for
 * essentially all common abuse patterns we'd see at this scale.
 * --------------------------------------------------------------------- */
const DISPOSABLE_DOMAINS = new Set<string>([
  "mailinator.com", "10minutemail.com", "10minutemail.net", "guerrillamail.com",
  "guerrillamail.net", "guerrillamail.org", "guerrillamail.biz", "guerrillamail.info",
  "sharklasers.com", "grr.la", "spam4.me", "pokemail.net",
  "tempmail.com", "tempmail.net", "tempmail.org", "tmail.ws", "tempr.email",
  "tempmailaddress.com", "temp-mail.org", "temp-mail.ru", "throwawaymail.com",
  "throwaway.email", "mintemail.com", "getairmail.com", "fakeinbox.com",
  "yopmail.com", "yopmail.fr", "yopmail.net", "trashmail.com", "trashmail.net",
  "dispostable.com", "maildrop.cc", "spambog.com", "spambog.de", "spambog.ru",
  "moakt.com", "incognitomail.com", "mailcatch.com", "anonbox.net", "boun.cr",
  "deadaddress.com", "discard.email", "discardmail.com", "easytrashmail.com",
  "emailfake.com", "emailondeck.com", "emailtemporanea.net", "fakemail.net",
  "fakemailgenerator.com", "harakirimail.com", "incognitobox.com", "inbox.lv",
  "jetable.org", "letthemeatspam.com", "mail-temporaire.fr", "mail.com",
  "mailbox.in.ua", "mailcatch.email", "mailexpire.com", "mailforspam.com",
  "mailfreeonline.com", "mailfs.com", "mailimate.com", "mailmoat.com",
  "mailnator.com", "mailnesia.com", "mailnull.com", "mailpoof.com",
  "mailsac.com", "mailtemp.uk", "minutemail.com", "mintmail.com",
  "mohmal.com", "nada.email", "nawmin.info", "neomailbox.com",
  "owlpic.com", "rcpt.at", "recode.me", "rmqkr.net", "rppkn.com",
  "selfdestructingmail.com", "sendspamhere.com", "smapxsmap.net",
  "spamavert.com", "spambox.us", "spamcero.com", "spamday.com",
  "spamex.com", "spamfree24.org", "spamgourmet.com", "spamhereplease.com",
  "spamhole.com", "spaminator.de", "spamspot.com", "supermailer.jp",
  "tafmail.com", "tagyourself.com", "tempemail.co", "tempinbox.com",
  "tempemail.net", "tempmail.eu", "trbvm.com", "tyldd.com", "uggsrock.com",
  "wegwerfemail.de", "yopmail.org",
]);

export function isDisposableEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase().trim();
  return DISPOSABLE_DOMAINS.has(domain);
}

/* ----- 2. Honeypot + 3. form-load time check -------------------------- */

const MIN_FORM_FILL_MS = 2_000;
const MAX_FORM_FILL_MS = 8 * 60 * 60 * 1000; // 8 hr — page left open all day still OK

type AntiBotCheck = { ok: true } | { ok: false; reason: string };

/**
 * Validate the two client-side bot-detection fields:
 *
 *   - `website` (honeypot): must be empty or absent. Hidden from real
 *      users by CSS + aria; bots that fill every input expose
 *      themselves here.
 *   - `formLoadedAt` (number, ms epoch): must be present and the page
 *      must have been open for at least MIN_FORM_FILL_MS before submit.
 *      A timestamp claiming the future, or one absurdly far in the past,
 *      also fails (clock-skew tolerant but not infinite).
 */
export function validateAntiBotFields(body: Record<string, unknown>): AntiBotCheck {
  // Honeypot must be empty/missing. If it's a string with any
  // non-whitespace content, that's a bot.
  const honeypot = body.website;
  if (typeof honeypot === "string" && honeypot.trim().length > 0) {
    return { ok: false, reason: "honeypot_filled" };
  }

  // Form-load timestamp must be present and well-formed.
  const formLoadedAt = Number(body.formLoadedAt);
  if (!Number.isFinite(formLoadedAt) || formLoadedAt <= 0) {
    return { ok: false, reason: "form_load_timestamp_missing" };
  }
  const elapsed = Date.now() - formLoadedAt;
  if (elapsed < MIN_FORM_FILL_MS) {
    return { ok: false, reason: "form_submitted_too_fast" };
  }
  if (elapsed > MAX_FORM_FILL_MS) {
    // Reasonable user could leave the form open for hours, but a
    // submission claiming the page was loaded last week is replay-y.
    return { ok: false, reason: "form_load_timestamp_stale" };
  }
  // Reject future timestamps too (clock-skew tolerated up to 5 min).
  if (elapsed < -5 * 60 * 1000) {
    return { ok: false, reason: "form_load_timestamp_in_future" };
  }
  return { ok: true };
}

/* ----- 4. Global signup ceiling --------------------------------------- *
 *
 * Sliding window: keep one bucket per UTC hour, drop buckets older than
 * the window. Threshold is the maximum signups/hour we'd ever expect
 * from honest traffic. At this scale (single-digit signups/week today)
 * a value of 30 is generous-but-tight; a coordinated attack that wanted
 * hundreds of accounts in an hour would have to pace itself below this
 * across all IPs.
 *
 * Single-process in-memory state. If the API scales to multiple
 * replicas this will undercount across instances — fine at our scale,
 * worth migrating to Redis later.
 * --------------------------------------------------------------------- */
const GLOBAL_WINDOW_MS = 60 * 60 * 1000; // 1 hour rolling
const GLOBAL_CEILING = 30;               // max signups per rolling hour, globally

let globalSignupTimes: number[] = [];

export function checkGlobalSignupCeiling(): AntiBotCheck {
  const now = Date.now();
  // Drop timestamps older than the window.
  globalSignupTimes = globalSignupTimes.filter((t) => now - t < GLOBAL_WINDOW_MS);
  if (globalSignupTimes.length >= GLOBAL_CEILING) {
    return { ok: false, reason: "global_signup_ceiling_reached" };
  }
  return { ok: true };
}

export function recordSuccessfulSignup(): void {
  globalSignupTimes.push(Date.now());
}

/* ----- 5. Optional Cloudflare Turnstile ------------------------------- *
 *
 * If TURNSTILE_SECRET_KEY is set, every signup must include a
 * `turnstileToken` field that Cloudflare can verify. When the env var
 * is unset (today's state), this check is skipped so we can ship the
 * other layers immediately and wire CAPTCHA when keys are issued.
 * --------------------------------------------------------------------- */
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstileToken(token: unknown, remoteIp?: string): Promise<AntiBotCheck> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Turnstile not configured — bypass. The other layers carry us
    // until keys are added.
    return { ok: true };
  }
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, reason: "turnstile_token_missing" };
  }
  try {
    const params = new URLSearchParams();
    params.set("secret", secret);
    params.set("response", token);
    if (remoteIp) params.set("remoteip", remoteIp);
    const r = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    const j = (await r.json()) as { success?: boolean; "error-codes"?: string[] };
    if (j.success) return { ok: true };
    logger.warn({ errors: j["error-codes"] }, "turnstile_verify_failed");
    return { ok: false, reason: "turnstile_verify_failed" };
  } catch (err) {
    // A network blip on CF's side shouldn't lock out every signup;
    // log and let the user through. Other layers still apply.
    logger.error({ err }, "turnstile_verify_error");
    return { ok: true };
  }
}
