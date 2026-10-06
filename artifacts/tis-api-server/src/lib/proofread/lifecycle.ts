/**
 * Run-claim policy, as pure predicates.
 *
 * This service runs on several instances (lib/redis.ts:5-9, .replit
 * deploymentTarget="autoscale") and the repo has no jobs table, no scheduler
 * and no locking primitive, so this is the first one. Two rules do the work:
 *
 *   - A claim is a LEASE. A row claimed longer ago than the lease is
 *     reclaimable, which is what recovers a container recycled mid-run.
 *   - Redis is never load-bearing: REDIS_URL is optional and unset in dev, and
 *     every existing use fails open. The claim is a Postgres row.
 *
 * There is no scheduler, so the sweep is opportunistic — attempted on enqueue
 * and on each read, one claim per call.
 *
 * Nothing here connects to anything (importing @workspace/db would, whenever
 * DATABASE_URL is set), so the decisions can be tested without a database.
 * The I/O is proofread-store.ts's.
 */
export const LEASE_MS = 600_000; // 10 minutes
export const MAX_ATTEMPTS = 3;

export type RunRowState = { status: string; claimedAt: Date | null; attempts: number };

/**
 * Is this row up for claiming? Mirrors the WHERE clause of CLAIM_PREDICATE_SQL
 * below, which proofread-store.ts's claim interpolates verbatim, so the
 * predicate this function mirrors is the one Postgres evaluates; the guard
 * translates that predicate and holds it to this function cell by cell.
 *
 * `attempts` is deliberately not consulted. A running row whose lease expired
 * after its last permitted attempt must still be CLAIMABLE, so the runner can
 * fail it (nextStatusAfterFailure) instead of leaving it 'running' for good.
 */
export function isReclaimable(row: RunRowState, now: Date): boolean {
  if (row.status === "queued") return true;
  if (row.status !== "running") return false;
  // A running row with no claim time holds no lease: nobody is on it, and
  // nothing will ever stamp it. It is reclaimable — returning false here would
  // strand it forever, because the next sweep sees exactly the same row.
  // The planned writer cannot produce it (status and claimed_at are set in one
  // UPDATE), so reaching it means an operator edit or a future writer's bug,
  // and a duplicate run of a pure, idempotent pass costs far less than a run
  // that never ends.
  if (!row.claimedAt) return true;
  // Strict: a claim exactly one lease old is still held (SQL: claimed_at < now() - lease).
  return now.getTime() - row.claimedAt.getTime() > LEASE_MS;
}

/**
 * What a failed attempt becomes. `row` is the CLAIMED row, whose `attempts`
 * already counts this execution (the claim increments it), so attempts 1 is the
 * first run and attempts === MAX_ATTEMPTS is the last one permitted.
 *
 * `>=`, not `===`: a row reclaimed after MAX_ATTEMPTS lease-expiry crashes
 * arrives with attempts above MAX_ATTEMPTS and must fail, not requeue.
 */
export function nextStatusAfterFailure(row: RunRowState): "queued" | "failed" {
  return row.attempts >= MAX_ATTEMPTS ? "failed" : "queued";
}

/**
 * Which rows a claim may take: a queued row, or a running row whose lease has
 * expired (including one that was never stamped — see isReclaimable).
 *
 * This string states the predicate a claim must implement, and since
 * proofread-store.ts interpolates it (`sql.raw(CLAIM_PREDICATE_SQL)`) it also
 * literally supplies it: the predicate the guard pins against isReclaimable,
 * cell by cell, is the predicate Postgres evaluates in production. Keeping one
 * string is the point — a second copy is how a lease silently diverges.
 *
 * The interval is derived from LEASE_MS so the SQL and the policy cannot name
 * two different leases, and the comparison is strict (`<`), so a claim exactly
 * one lease old is still held. The whole predicate is parenthesised: it is a
 * top-level OR, and a condition appended by a later caller (`... AND x`) would
 * otherwise bind to the second arm alone and quietly widen the claim.
 */
export const CLAIM_PREDICATE_SQL = `(status = 'queued'
       OR (status = 'running' AND (claimed_at IS NULL OR claimed_at < now() - interval '${LEASE_MS / 1000} seconds')))`;

/**
 * Claim one row for this instance. $1 is the instance id.
 *
 * The statement is stated here and composed from CLAIM_PREDICATE_SQL, so the
 * whole claim can be read in one place; the UPDATE itself is still not what
 * runs. proofread-store.ts builds it through drizzle's query builder, because
 * `db.execute(sql.raw(...))` hands back rows keyed by the raw Postgres column
 * names rather than drizzle's camelCase — but its predicate is this predicate,
 * not a restatement of it. The guard asserts the pieces that matter here: the
 * row lock, SKIP LOCKED, one row, RETURNING, the strict lease edge, and that
 * the interval is LEASE_MS. claimed_at is stamped with now(), the same clock
 * the lease is compared on.
 */
export const CLAIM_SQL = `
UPDATE study_proofread_runs
   SET status = 'running', claimed_at = now(), claimed_by = $1, attempts = attempts + 1
 WHERE id = (
   SELECT id FROM study_proofread_runs
    WHERE ${CLAIM_PREDICATE_SQL}
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
 )
RETURNING *;`;
