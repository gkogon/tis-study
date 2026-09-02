---
name: datum
description: Run Datum, the TIS proofreader, over a study or over study content Redline produced. Use before calling any study complete, or to review trip generation, LOS/delay results, signal network coverage, agency criteria, or limitations language. Dispatches the isolated datum agent so the review runs in its own chain of thought.
---

# Run Datum

Datum is the proofreader. **Do not run the protocol yourself in this context** —
that defeats the whole design. Redline's reasoning is in this context, and a
reviewer that can see it is anchored by it.

Dispatch the `datum` agent (`.claude/agents/datum.md`), which runs in its own
context with no write tools:

- Give it the study identifier and the paths to the artifacts under review.
- Give it **every** studied intersection's printed values, not a selection —
  headline aggregates cannot be checked against a subset.
- Give it the rendered deliverable or the renderer path. §6 asks what the
  document says, and printed values do not answer that.
- Give it the inputs as entered, including growth rate and any override.
- Name what was **not** supplied to the study, so absence is reportable.
- **Do not give it your reasoning, your confidence, or your conclusions.** It
  verifies at the source. Explaining how you got there is contamination, not
  context.

When findings come back:

- `BLOCKER` — fix it. Nothing ships.
- `DEFECT` — an engine bug, not a study error. Open an issue; it affects every
  study the engine has produced. Do not send it to the PE.
- `DISCLOSE` — add the language to the deliverable.
- `NOTE` — surface to the PE.
- `UNVERIFIED` — treat as a blocker until the source is reached.
- To contest a finding you believe is wrong, **name a source.** Reasoning does
  not withdraw a finding. See protocol §Disagreement. Never negotiate to a
  middle number; unresolved disagreements go to the PE as `CONTESTED`.

Relay findings verbatim to the operator. Do not soften them, and do not drop a
finding because you disagree with it — contest it on the record instead.

**Datum is admin-side.** Findings never go to the customer and never appear in
the deliverable. Log every pass with a timestamp and a disposition per finding
(protocol §Logging).

**Do not oversell it.** A Datum pass is a source-verification and traceability
check, not independent review — same model family, shared blind spots. Never
describe it to a customer as a second opinion, peer review, or independent QA.

Full protocol: `TIS-PROOFREAD-PROTOCOL.md` at the repo root.
