/**
 * Hand-written contract for the proofread surface. The documented escape hatch
 * while the finding shape is still moving: nothing under generated/ may be
 * hand-edited (orval runs with clean: true). Promote to openapi.yaml once the
 * shape settles.
 */
import { z } from "zod";

export const ProofreadType = z.enum(["BLOCKER", "DEFECT", "DISCLOSE", "NOTE", "UNVERIFIED", "CONTESTED"]);

export const ProofreadDisposition = z.enum([
  "FIXED",
  "BUG_FILED",
  "DISCLOSED",
  "WITHDRAWN",
  "CONTESTED_PE",
  "ACCEPTED_RISK",
]);

const DECISION = ProofreadDisposition.enum;

/**
 * Which decision a firm member may record on a finding, by the finding's type.
 * The disposition route refuses any other pair with a 422, and the panel offers
 * exactly these (OFFERED in artifacts/atlanta-tis/src/lib/proofread.ts, which
 * verify-proofread-copy.mjs pins equal to this map). The log is append-only, so a
 * decision that does not fit its finding, once written, would stay written.
 *
 * TIS-PROOFREAD-PROTOCOL.md, Logging: a BLOCKER is a wrong number, a wrong
 * source or a missing input, and disclosing a wrong number does not make it
 * right, so only FIXED or WITHDRAWN (on a named source) fits one. A CONTESTED
 * item waits for the sealing engineer's ruling, and a DEFECT is a software
 * fault routed to the software team, so neither takes a firm member's decision.
 * BUG_FILED is the software team's; ACCEPTED_RISK and CONTESTED_PE are the
 * sealing engineer's, a role phase 1 does not have.
 *
 * Plain JavaScript on purpose, like the rest of this module:
 * verify-proofread-routes.mjs evaluates it against the real zod.
 */
export const OFFERED_DISPOSITIONS = {
  BLOCKER: [DECISION.FIXED, DECISION.WITHDRAWN],
  DISCLOSE: [DECISION.DISCLOSED, DECISION.FIXED, DECISION.WITHDRAWN],
  NOTE: [DECISION.DISCLOSED, DECISION.FIXED, DECISION.WITHDRAWN],
  UNVERIFIED: [DECISION.DISCLOSED, DECISION.FIXED, DECISION.WITHDRAWN],
  CONTESTED: [],
  DEFECT: [],
};

/**
 * A disposition a firm member records against one finding. Deliberately
 * carries no actor, finding, run or firm: those come from the session and the
 * URL, and an object schema strips any key it does not name.
 */
export const ProofreadDispositionBody = z
  .object({
    disposition: ProofreadDisposition,
    note: z.string().max(2000).optional(),
    /**
     * Required for WITHDRAWN: Datum withdraws on a source, never on an argument.
     * Trimmed before the length check, so a blank is not a source.
     */
    sourceLabel: z.string().trim().min(1).max(500).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.disposition === "WITHDRAWN" && !val.sourceLabel) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceLabel"],
        message: "WITHDRAWN requires the source the finding was withdrawn on.",
      });
    }
  });

export type ProofreadDispositionBodyT = z.infer<typeof ProofreadDispositionBody>;

/**
 * What GET /projects/:id/proofread answers: the project's newest run, or
 * `status: "none"` (with `withheld: 0` and empty lists) when it has none.
 *
 * Findings and dispositions are audience-filtered. A finding whose audience is
 * admin — a DEFECT, a software fault routed to the software team — is never
 * sent, and neither is any disposition of it. It is not silent either: a
 * DEFECT holds the study until a re-run no longer raises it
 * (TIS-PROOFREAD-PROTOCOL.md, rule 2), so `withheld` is how many such findings
 * the run carries, and that number is all that leaves the server — no type,
 * clause, path or message of a withheld finding. Strict objects: a key not
 * named here (an audience, an actor, a run's error text) is not part of the
 * answer.
 *
 * The route does not parse its own answer with this; verify-proofread-routes.mjs
 * pins the route's two answers to these keys and evaluates this schema.
 */
export const ProofreadReadResponse = z
  .object({
    status: z.enum(["none", "queued", "running", "rules_ready", "ready", "failed"]),
    runId: z.string().uuid().optional(),
    revision: z.number().int().positive().optional(),
    protocolVersion: z.string().optional(),
    rulesVersion: z.string().optional(),
    engineStamp: z.string().optional(),
    inputManifest: z.record(z.string(), z.boolean()).optional(),
    coverage: z.array(
      z
        .object({
          clauseId: z.string(),
          section: z.number().int(),
          status: z.enum(["ran", "not-run"]),
          reason: z.string().optional(),
          note: z.string().optional(),
        })
        .strict(),
    ),
    createdAt: z.string().optional(),
    finishedAt: z.string().nullable().optional(),
    withheld: z.number().int().nonnegative(),
    findings: z.array(
      z
        .object({
          id: z.string().uuid(),
          clauseId: z.string(),
          section: z.number().int(),
          type: ProofreadType,
          title: z.string(),
          detail: z.string(),
          sourceLabel: z.string(),
          readPaths: z.array(
            z.object({ path: z.string(), value: z.union([z.string(), z.number(), z.boolean(), z.null()]) }).strict(),
          ),
          remedy: z.string(),
          fingerprint: z.string(),
        })
        .strict(),
    ),
    dispositions: z.array(
      z
        .object({
          findingId: z.string().uuid(),
          disposition: ProofreadDisposition,
          note: z.string().nullable(),
          sourceLabel: z.string().nullable(),
          createdAt: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

export type ProofreadReadResponseT = z.infer<typeof ProofreadReadResponse>;
