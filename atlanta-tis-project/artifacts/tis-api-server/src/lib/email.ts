/**
 * Transactional email via Resend. Gated by `RESEND_API_KEY`; when unset
 * the email functions log the would-be email and return ok so the rest
 * of the app keeps working in local dev.
 *
 * The "from" address comes from `RESEND_FROM_EMAIL` (e.g.
 * "noreply@yourfirm.com"). Until a custom domain is verified in Resend,
 * use the sandbox value "onboarding@resend.dev" to send to your own
 * verified address only.
 */
import { Resend } from "resend";
import { logger } from "./logger";

let _resend: Resend | null = null;
function client(): Resend | null {
  if (_resend) return _resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  _resend = new Resend(key);
  return _resend;
}

function fromAddress(): string {
  return process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";
}

export type SendInviteEmailArgs = {
  to: string;
  firmName: string;
  inviterName: string | null;
  acceptUrl: string;
  expiresAt: Date;
};

export async function sendInviteEmail(args: SendInviteEmailArgs): Promise<{ delivered: boolean }> {
  const c = client();
  const subject = `${args.inviterName ?? "Your colleague"} invited you to ${args.firmName} on Atlanta TIS`;
  const html = inviteHtml(args);
  const text = inviteText(args);

  if (!c) {
    // No key configured — keep dev flows working. The admin can still
    // copy the link from the firm settings UI.
    logger.info(
      { to: args.to, firm: args.firmName, acceptUrl: args.acceptUrl },
      "email.invite_skipped_no_key",
    );
    return { delivered: false };
  }

  try {
    const { error } = await c.emails.send({
      from: fromAddress(),
      to: args.to,
      subject,
      html,
      text,
    });
    if (error) {
      logger.warn({ err: error, to: args.to }, "email.invite_failed");
      return { delivered: false };
    }
    logger.info({ to: args.to, firm: args.firmName }, "email.invite_sent");
    return { delivered: true };
  } catch (err) {
    logger.error({ err, to: args.to }, "email.invite_throw");
    return { delivered: false };
  }
}

function inviteHtml(args: SendInviteEmailArgs): string {
  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:24px auto;padding:0 16px;color:#1a1a1a;">
  <h2 style="color:#2563eb;margin:0 0 8px;">${escapeHtml(args.firmName)} on Atlanta TIS</h2>
  <p style="margin:0 0 16px;">${escapeHtml(args.inviterName ?? "Your colleague")} has invited you to join <strong>${escapeHtml(args.firmName)}</strong> on Atlanta TIS — the screening-level Traffic Impact Study tool for Atlanta-metro engineering firms.</p>
  <p style="margin:0 0 24px;">
    <a href="${args.acceptUrl}" style="display:inline-block;background:#2563eb;color:white;font-weight:600;padding:12px 18px;border-radius:6px;text-decoration:none;">Accept invitation</a>
  </p>
  <p style="margin:0 0 16px;font-size:13px;color:#555;">This invite expires on ${args.expiresAt.toLocaleString()}. If you don't recognize this firm, you can ignore the email.</p>
  <p style="margin:24px 0 0;font-size:12px;color:#888;">Or copy this link: ${args.acceptUrl}</p>
</body></html>`;
}

function inviteText(args: SendInviteEmailArgs): string {
  return [
    `${args.inviterName ?? "Your colleague"} has invited you to join ${args.firmName} on Atlanta TIS.`,
    "",
    `Accept the invitation: ${args.acceptUrl}`,
    "",
    `This invite expires on ${args.expiresAt.toLocaleString()}.`,
  ].join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
