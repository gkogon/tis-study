/**
 * Funnel-event logging. Fire-and-forget: a logging failure must NEVER
 * affect the request that triggered it. Callers do not await this —
 * they call `logEvent(...)` and move on.
 *
 * See lib/db schema/events.ts for the event-type catalogue.
 */
import { db, eventsTable } from "@workspace/db";
import { logger } from "./logger";

export type EventType =
  | "demo_run"
  | "signup"
  | "study_generated"
  | "checkout_started"
  | "quota_hit";

/**
 * Record a funnel event. Intentionally returns void and swallows all
 * errors — analytics is never allowed to break a user-facing path.
 * Not awaited by callers; the insert runs in the background.
 */
export function logEvent(
  eventType: EventType,
  opts?: {
    firmId?: string | null;
    userId?: string | null;
    metadata?: Record<string, unknown>;
  },
): void {
  void db
    .insert(eventsTable)
    .values({
      eventType,
      firmId: opts?.firmId ?? null,
      userId: opts?.userId ?? null,
      metadata: opts?.metadata ?? null,
    })
    .catch((err) => {
      logger.warn({ err, eventType }, "events.log_failed");
    });
}
