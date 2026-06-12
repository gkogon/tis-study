# Georgia DRI Module — Primary-Source Verification Pass

**Date:** 2026-06-12. **Sources fetched:** rules.sos.ga.gov (DCA Chapter 110-12-3 + 110-12-7), srta.ga.gov/grta/ (HB 297 update page), atltransit.ga.gov (GTEA confirmation), DCA portal.

**Scope:** Verifies regulatory citations baked into `renderTisGeorgia` and `renderTisGeorgiaDriSections` in `artifacts/tis-api-server/src/lib/pdf-export.ts`. The module currently references GRTA throughout and attributes the "eight non-expedited review criteria" to DCA Chapter 110-12-3. Both claims need fixing.

---

## A. HEADLINE: GRTA was dissolved one month ago

**HB 297**, signed by the Governor on **2026-05-12** (exactly 30 days before this verification pass), dissolves the **Georgia Regional Transportation Authority (GRTA)** and recasts the **Atlanta-region Transit Link Authority (ATL)** into a new consolidated agency:

> **Georgia Transportation Efficiency Authority (GTEA)**

Confirmed independently from two state sources (srta.ga.gov/grta/ and atltransit.ga.gov).

**DRI review authority** transfers wholesale to GTEA. Verbatim from the SRTA/GRTA transition page:

> "GRTA's review of Developments of Regional Impact (DRI) will remain intact and all DRIs currently in-process will continue as scheduled."

**GRTA Xpress** commuter coach services merge with the ATL Xpress fleet under GTEA — single consolidated operator.

**Status of administrative rules:** Both DCA Chapter 110-12-3 (general statewide DRI rules) and Chapter 110-12-7 (ARC alternative DRI requirements) **still reference "GRTA" verbatim** as of 2026-06-12. They have not been amended to reflect HB 297. Statutory authority cited in both chapters is still O.C.G.A. § 50-32-14 et seq. (GRTA's enabling statute, now superseded). DCA will presumably reissue these chapters; until then, a renderer that cites the rules text honestly should say "GRTA (now GTEA per HB 297, 2026-05-12; DCA rule text not yet amended)."

---

## B. Verified-correct citations (no change needed)

- **O.C.G.A. § 50-8-7.1(b)** — authorizing statute for DRI rules. ✓ Verified against DCA portal.
- **DCA Chapter 110-12-3 is the general statewide DRI rules chapter.** ✓ Confirmed via Cornell LII + GA Secretary of State rules portal + DCA "Governing Statutes, Regulations, and Guidance" page.
- **30-day Regional Commission DRI review window.** ✓ Codified in Rule 110-12-3-.02.
- **Rule 110-12-3-.05(1)(a) threshold table.** ✓ Comprehensive thresholds by metro/non-metro and use type. The renderer references the rough size-based detector — keep, but cite this rule explicitly.

---

## C. Verified-WRONG citations that need fixing

### C.1  The "eight non-expedited review criteria" are NOT in Chapter 110-12-3

The renderer says at [pdf-export.ts:3210](artifacts/tis-api-server/src/lib/pdf-export.ts:3210):

> "Per GA DCA Chapter 110-12-3, DRI submittals must address the eight non-expedited review criteria below."

This is **incorrect**. Chapter 110-12-3 consists of seven rules (.01 Purpose, .02 Communication, .03 Local Govt, .04 Regional Commission, .05 Determining DRI, .06 Definitions, .07 Repealed) and **does not articulate any "eight non-expedited review criteria."** Neither does Chapter 110-12-7. The eight criteria the renderer enumerates (§11.1 Quality/Character/Convenience, §11.2 VMT, §11.3 Regional Mobility, §11.4 Transit, §11.5 TMA, §11.6 Trip Reduction, §11.7 Jobs/Housing, §11.8 Infrastructure) almost certainly originate from a **GRTA DRI Review Procedures** internal procedures document (now under GTEA), not a DCA rule.

**Action:** Locate the current GRTA/GTEA DRI Review Procedures PDF (likely at srta.ga.gov or atltransit.ga.gov) and re-source the eight criteria to it. The citation must be the procedures document, not the DCA chapter. Until the procedures doc is located, frame the eight criteria as "the headline review criteria GRTA (now GTEA) has applied to non-expedited DRI submittals in the ARC region — re-verify against the post-HB 297 GTEA DRI Procedures."

### C.2  Chapter 110-12-7 (ARC alternative rules) is the more applicable chapter for metro Atlanta — and the renderer doesn't mention it

The renderer cites only Chapter 110-12-3. For ARC-region DRIs (everything `renderTisGeorgia` is currently used for), the controlling chapter is **110-12-7 — Developments of Regional Impact: Alternative Requirements: Atlanta Regional Commission**. It contains six rules and **identifies three expedited-eligibility categories** rather than non-expedited criteria:

1. Livable Centers Initiative (LCI) developments
2. Transit-Oriented Development
3. Projects generating fewer than 1,000 daily trips

**Action:** Add a §10.5 (or equivalent) callout in the renderer noting that for ARC-region DRIs, Chapter 110-12-7 governs procedures and identifies the three expedited-eligibility categories above. Pre-application methodology meetings should determine whether the project qualifies for expedited review before defaulting to the eight non-expedited criteria flow.

### C.3  "GRTA's standard 6-mile AOI" — NOT in DCA rules

The renderer at [pdf-export.ts:3305](artifacts/tis-api-server/src/lib/pdf-export.ts:3305) says:

> "The Area of Influence (AOI) for this DRI is defined as the area within a 6-mile radius of the project site, consistent with GRTA's standard AOI definition for DRI review."

Neither Chapter 110-12-3 nor Chapter 110-12-7 contains a "6-mile AOI" or any specific radius. This figure originates from the GRTA DRI Review Procedures document, not a rule. Same fate as C.1 — cite the procedures document, not the rules; re-verify against the post-HB 297 GTEA reissue.

### C.4  "GRTA's 7-percent rule" — NOT in DCA rules

The renderer at [pdf-export.ts:723](artifacts/tis-api-server/src/lib/pdf-export.ts:723) says:

> "GRTA's 7-percent rule (which extends the network to any intersection or segment where project-generated trips exceed 7 percent of the service volume) should be applied."

Same provenance: GRTA procedures document, not a DCA rule. Citation chain must point to the procedures document.

---

## D. Open / still-to-verify

1. **GTEA branding precision.** Two sources used the phrase "Georgia Transportation Efficiency Authority" — confirm verbatim against the HB 297 text on legis.ga.gov (search: `HB 297 2026`) before committing the renderer to the acronym. The bill text is the authoritative naming source.
2. **GTEA DRI Procedures document.** Locate and link the current procedures PDF. Pre-HB 297 it lived on the GRTA / SRTA site. Post-HB 297 it may be reissued on atltransit.ga.gov or a new gtea.ga.gov domain. Until reissued, the GRTA version is still the operative procedural document by HB 297's grandfathering clause.
3. **ARC Air Quality Benchmark methodology** — the renderer's §13 references this rubric. Confirm against ARC's "Plan 2050" / current RTP appendices that the rubric still exists in its current form, and whether ARC re-issues credits when DRI authority transfers to GTEA.
4. **ARC jobs/housing 1.3–1.7 ratio target.** Renderer cites this as an "ARC activity-center target" — verify against ARC's published Activity Center / Town Center methodology document. Source uncited in the current renderer text.
5. **Eight-criteria verbatim text.** Once the GRTA/GTEA DRI Review Procedures document is located, verify the renderer's eight §11.1–§11.8 subsection titles match the procedures' verbatim criteria order and wording.

---

## E. Suggested renderer changes (terse)

- s/GRTA/GTEA/ everywhere in `renderTisGeorgia` + `renderTisGeorgiaDriSections`, EXCEPT where citing historical procedures documents that are still labelled "GRTA DRI Review Procedures" until reissued. Use the phrasing **"GTEA (successor to GRTA per HB 297, 2026-05-12)"** on first occurrence in each section, then **"GTEA"** on subsequent occurrences.
- Keep "GRTA Xpress" references as a brand/route name (the routes haven't been renumbered yet); footnote that the Xpress fleet now operates under GTEA.
- Re-cite the eight non-expedited criteria to the GRTA/GTEA DRI Review Procedures document (D.2 above) instead of DCA Chapter 110-12-3.
- Add a §10 preface paragraph for ARC-region DRIs naming **Chapter 110-12-7** as the controlling alternative procedure and listing the three expedited-eligibility categories.
- Re-cite the 6-mile AOI and 7-percent rule to the GRTA/GTEA DRI Review Procedures document (not DCA rules).
- Add a one-paragraph "Regulatory currency note" up front: HB 297 dissolution date, GTEA successor name, in-process DRI grandfathering, and the fact that DCA Chapter 110-12-3 / 110-12-7 still reference GRTA verbatim as of 2026-06-12 (rules not yet amended to reflect HB 297).

---

## Sources

- DCA Chapter 110-12-3: https://rules.sos.ga.gov/gac/110-12-3
- DCA Chapter 110-12-7 (ARC alternative): https://rules.sos.ga.gov/gac/110-12-7
- DCA DRI Rules PDF: https://dca.georgia.gov/document/document/new-dri-rules-developments-regional-impact/download
- DCA Governing Statutes page: https://dca.georgia.gov/community-assistance/coordinated-planning/governing-statutes-regulations-and-guidance
- SRTA / GRTA HB 297 transition page: https://srta.ga.gov/grta/
- The ATL → GTEA page: https://atltransit.ga.gov/
- Cornell LII Rule 110-12-3-.01: https://www.law.cornell.edu/regulations/georgia/Ga-Comp-R-Regs-R-110-12-3-.01
