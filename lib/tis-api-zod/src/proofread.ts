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
