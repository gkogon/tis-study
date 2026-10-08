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
