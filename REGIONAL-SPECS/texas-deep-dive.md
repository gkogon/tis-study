# Texas TIA Renderer — Primary-Source Verification Pass

**Date:** 2026-06-12. **Scope:** Verifies regulatory citations baked into `renderTisTexas` (and the Houston / Austin / Dallas / Fort Worth / San Antonio overlays) in [`artifacts/tis-api-server/src/lib/pdf-export.ts`](../artifacts/tis-api-server/src/lib/pdf-export.ts) (function at line 2476). **Sources fetched live:** Cornell LII (22 TAC §137.33), TxDOT TSP Ch. 16 §16.1 / §16.2.1 / §16.2.2 / §16.3.3 / §16.4 / Appendix Q, Houston IDM Ch. 15 (07-01-2022 PDF), Harris County TIA Guidelines (2025-05-08 PDF), CTRMA Resolution 07-58 (2007 PDF), TxDOT TMUTCD page, TxDOT UTP 2026 announcement, San Antonio UDC §35-502 (via authoritative search), Austin TIA Guidelines (06-2022), Tex. Occ. Code Ch. 1001 search.

---

## A. HEADLINE: Two stale Houston citations + one statute-vs-rule mislabel + one CTRMA title typo

Three things are wrong, all small but quotable. Texas is in much better shape than GA or FL — but the **Houston city overlay still ships pre-correction text** that the regional-spec doc has already flagged as wrong (the spec was updated 2026-06-12; the renderer code wasn't).

1. **Houston "2023 IDM, effective Nov 27, 2023"** is wrong. The current IDM Ch. 15 PDF footer reads **"07-01-2022"** verbatim. There is **no 2023 IDM**. Lines 2551, 2559, and 2567 still ship the wrong year and a fabricated effective date.

2. **Houston "VLOS (Vehicle Level of Service)"** is wrong. The term "VLOS" does **not appear in IDM Ch. 15**. The IDM (§15.04.B.6.a) still publishes **"LOS D"** as "the threshold of significance for transportation facilities on the area street system" verbatim. Line 2567 fabricates a metric demotion that never happened.

3. **22 TAC §137.33 is titled "Sealing Procedures"** (verified verbatim against Cornell LII; most recently amended 2022-07-03). The renderer's parenthetical "**(Texas Engineering Practice Act, Tex. Occ. Code Ch. 1001)**" conflates a TBPELS rule (§137.33) with the enabling statute (Ch. 1001). The rule is in Chapter 137 "Compliance and Professionalism for Engineers"; the statute is the Practice Act. Both exist; pairing them in one parenthetical reads as if they are the same instrument. The fix is one extra word: "**22 TAC §137.33 (Sealing Procedures), promulgated under the Texas Engineering Practice Act (Tex. Occ. Code Ch. 1001)**".

4. **CTRMA Resolution 07-58** is titled "**Policies and Procedures for Access Management of Frontage Roads on CTRMA Facilities**" — the renderer drops the "**Policies and**" prefix.

---

## B. Verified-correct citations (no change needed)

| Citation | Verification | Renderer location |
|---|---|---|
| **TSP §16.1** introduction language | "The purpose of conducting a TIA is to determine the ability of the surrounding transportation system to handle the change in demand of traffic introduced by a project." ✓ | line 2617–2620 (paraphrased correctly) |
| **TSP §16.2.1 Table 16-1** — Cat 1 = 100–499 PHT, Cat 2 = 500–1,000 PHT, Cat 3 = >1,000 PHT | ✓ verified verbatim against TxDOT online manual | lines 2526–2528 |
| **TSP §16.2.1 horizon years per category** | Cat 1 = buildout only; Cat 2 = buildout + each phase completion + 5 yrs post; Cat 3 = each phase completion + final completion + 5 + 10 yrs post. ✓ verbatim | lines 2535–2540 |
| **TSP §16.2.2 — 11 preliminary scoping items** | Exact 11-item list confirmed verbatim against the online manual; renderer's list (lines 2634–2646) matches word-for-word. ✓ | lines 2628–2649 |
| **TSP §16.3.3 internal capture / pass-by / multimodal reduction** | Pass-by definition: "trips that are already traveling on the adjacent roadway network but enter the proposed development on their way to another destination." ✓ Multimodal reduction language matches. ✓ Rate-vs-equation: "at least 20 data points or … R² value of at least 0.75." ✓ | lines 2772, 2787, 2734 |
| **TSP §16.4 / §16.4.3 mitigation list** | Auxiliary lane improvements, median modifications, traffic signal modification/installation, road widening, revised striping, turning lane restrictions, alternative intersection/interchange. ✓ Renderer at line 2902 matches the manual's order and wording. | line 2902 |
| **TSP §16.4.3 LOS threshold** | "Thresholds for acceptable operations of various MOEs (LOS, queue lengths, travel times, etc.) are agreed upon with TxDOT during the preliminary scoping process." ✓ verbatim. Renderer's "no statewide LOS mandate" framing is correct. | line 2572 |
| **TSP Ch. 16 Appendix Q** title and structure (Quality Control Checklist · Report Outline · Example Problems · External References) | ✓ verbatim | lines 2588, 2982 |
| **Houston IDM §15.04.A.4.a — 100 PHT scoping trigger** | "If the proposed development … generates 100 or more new peak hour trips (PHT), the Analysis Engineer should meet with the City to determine the requirement for a Traffic Impact Study." ✓ verbatim from 07-01-2022 PDF. | (Need to fix per C.1 below — current renderer says "above 120 vph") |
| **Houston IDM §15.04.A.5 — 80–120 vph technical memo tier** | "The technical memo shall be submitted when the proposed development generates 80 vph -120 vph during AM or PM peak hours" ✓ verbatim | line 2559 (band correct; revision date wrong) |
| **Houston IDM §15.04.B.6.a — LOS D threshold of significance** | "the threshold of significance for transportation facilities on the area street system is LOS D" ✓ verbatim | (Need to fix per C.2 below — current renderer claims VLOS) |
| **Harris County TIA Guidelines (May 8, 2025)** — 50 PHT trigger, 300 PHT corridor-capacity, ¼ / ½ / 1-mile study-area scaling | ✓ all four numbers verbatim from the PDF | line 2665 |
| **TMUTCD 2025 edition, effective Jan 18, 2026** | ✓ verbatim from txdot.gov/business/resources/traffic-design-standards/tmutcd.html | line 2983 |
| **UTP 2026, adopted Aug 2025** | ✓ adopted **Aug 21, 2025**; $146B total / $101.6B over 10 years. Renderer says only "UTP 2026, adopted Aug 2025" — accurate (not wrong, just non-specific). | line 3001 |
| **CTRMA Board Resolution 07-58** — applies to 183A, MoPac Express, 290 Toll frontage roads | Adopted **August 29, 2007** by Board Chairman Robert E. Tesch. Coverage of named facilities ✓. (Title wording — see D.4 below.) | line 2858 |
| **Austin TIA Guidelines (June 2022)** — >2,000 vpd trigger, Transportation Assessment band 2,000–5,000, Full TIA >5,000 | ✓ Austin webpage and search results corroborate; PDF URL 404s in WebFetch but the content lives at the canonical filename `Austin_TIA_Guidelines_06-2022.pdf`. | line 2560 |
| **San Antonio UDC §35-502** — 76 PHT trigger, Roughly Proportionate Determination | ✓ Section title is "**Traffic Impact Analysis and Roughly Proportionate Determination Study**" (renderer drops "Study" — minor; flagging in D.5). 76 PHT ✓. | line 2555, 2563 |
| **San Antonio UDC Appendix B §35-B122** TIA Submittal Contents | ✓ confirmed via authoritative search results | line 2555 |
| **Connect Dallas (Strategic Mobility Plan, adopted Apr 28, 2021)** | ✓ Date matches Dallas City Council adoption record. | line 2553 |

---

## C. Verified-WRONG citations that need fixing

### C.1  Houston "2023 IDM, effective Nov 27, 2023" — fabricated edition

[pdf-export.ts:2551](artifacts/tis-api-server/src/lib/pdf-export.ts:2551):
> "Houston Public Works — Office of the City Engineer (OCE), Traffic Group, per the **2023 Infrastructure Design Manual (IDM) Ch. 15** and the OCE TIA Content Guide."

[pdf-export.ts:2559](artifacts/tis-api-server/src/lib/pdf-export.ts:2559):
> "Technical Memorandum tier 80–120 vph during the AM or PM peak hour; Full TIA above 120 vph (**2023 IDM Ch. 15, effective Nov 27, 2023**; OCE TIA Content Guide)."

The IDM Ch. 15 PDF at `houstonpermittingcenter.org/media/6471/download` shows revision date **"07-01-2022"** in the footer of every page (verified via `pdftotext` extraction). There is **no "2023 IDM" edition** at that URL, and there is **no "effective Nov 27, 2023"** event in the City of Houston's published manual history. The "Nov 27, 2023" date is fabricated.

Additionally, the inline claim that "Full TIA [threshold is] above 120 vph" misreads the manual. The actual scoping trigger at §15.04.A.4.a is **"100 or more new peak hour trips (PHT)"** — not 120. The 80–120 vph band in §15.04.A.5 is the **technical memorandum** tier, **overlapping** the 100-PHT scoping trigger. The renderer's "above 120 vph" implies the Full TIA threshold begins at 121 PHT, which is wrong.

**Fix:** Replace "2023 IDM Ch. 15, effective Nov 27, 2023" with **"IDM Ch. 15, revision 07-01-2022"** everywhere it appears. Replace the threshold text with: **"Technical memorandum tier 80–120 vph during AM or PM peak (IDM §15.04.A.5); ≥100 PHT triggers Full TIA scoping meeting with the City (IDM §15.04.A.4.a). The 80–120 band overlaps the 100-PHT scoping trigger by design — both apply in the overlap."**

### C.2  Houston "VLOS" / "the 2023 IDM demotes letter-grade LOS" — fabricated metric framework

[pdf-export.ts:2567](artifacts/tis-api-server/src/lib/pdf-export.ts:2567):
> "**Vehicle LOS (VLOS) per the 2023 IDM; LOS D was the historical target but the 2023 IDM demotes letter-grade LOS in favor of multimodal metrics.**"

Three errors stacked:

1. **"VLOS"** is not a term in the Houston IDM. Searched the 07-01-2022 PDF text — no occurrence of "VLOS" or "Vehicle Level of Service".
2. **"the 2023 IDM demotes letter-grade LOS"** — the IDM uses traditional LOS A–F throughout; no demotion language exists.
3. **§15.04.B.6.a still publishes LOS D verbatim**: "the qualitative measure Level-of-Service (LOS). The threshold of significance for transportation facilities on the area street system is **LOS D**."

The regional spec file (texas-tis-spec.md lines 152, 186, 286, 452) already flags this exact bug as a "Correction 2026-06-12." The fix has been documented but not applied to the renderer code.

**Fix:** Replace the Houston `cityLos` value with: **"LOS A–F per IDM §15.04.B.6.a; LOS D is the published threshold of significance for the area street system."**

### C.3  Renderer's `cityDeliverables` for Austin claims "two-tier" — actually three-tier

[pdf-export.ts:2576](artifacts/tis-api-server/src/lib/pdf-export.ts:2576) (the dict says **three-tier** correctly):
> "**Three-tier process** — (1) TIA Determination Worksheet → TDS portal, (2) Scope of Work submittal, (3) Full TIA"

[pdf-export.ts:2945](artifacts/tis-api-server/src/lib/pdf-export.ts:2945) (the §6.4 callout contradicts itself):
> "Austin's **two-tier TIA Memo / Full TIA process** determines which deliverable set applies based on the TIA Determination Worksheet outcome…"

The §6.4 Austin callout says "two-tier"; the `cityDeliverables` dict says "three-tier." Internally inconsistent. The Austin TIA Guidelines (June 2022) describe three deliverable tiers: (a) NTA / no-TIA outcome, (b) Transportation Assessment (2,000–5,000 trips/day), (c) Full TIA (>5,000 trips/day) — plus the Determination Worksheet itself as a gate. Most documentation calls this **three-tier**.

**Fix:** Change line 2945 from "two-tier TIA Memo / Full TIA process" to "**three-tier process (NTA / Transportation Assessment / Full TIA)**".

### C.4  22 TAC §137.33 mislabeled as the Practice Act itself

[pdf-export.ts:2976](artifacts/tis-api-server/src/lib/pdf-export.ts:2976):
> "The report must be sealed by a Texas-licensed Professional Engineer per **22 TAC §137.33 (Texas Engineering Practice Act, Tex. Occ. Code Ch. 1001)**, with the seal on the cover and on every sealed sheet."

22 TAC §137.33 is titled **"Sealing Procedures"** (verified verbatim, Cornell LII; most recently amended effective 2022-07-03 per Texas Register Vol. 47 No. 25). It is a TBPELS rule in **Chapter 137 "Compliance and Professionalism for Engineers"**, promulgated by the Texas Board of Professional Engineers and Land Surveyors under the authority of the Texas Engineering Practice Act.

The Practice Act itself is **Tex. Occ. Code Ch. 1001**, whose statutory chapter title is "**Texas Board of Professional Engineers and Land Surveyors**" — §1001.001 establishes the short title "**The Texas Engineering Practice Act**."

So the renderer's parenthetical reads as if §137.33 is the Practice Act. It isn't — it's a rule under the Practice Act. Subtle but important when a TX P.E. sees the citation.

**Fix:** Replace with: **"22 TAC §137.33 (Sealing Procedures), promulgated under The Texas Engineering Practice Act (Tex. Occ. Code Ch. 1001)"**.

Same correction needed at any other location in the codebase that uses this same conflated parenthetical (search for "Texas Engineering Practice Act, Tex. Occ. Code Ch. 1001").

### C.5  CTRMA Resolution 07-58 title missing "Policies and"

[pdf-export.ts:2858](artifacts/tis-api-server/src/lib/pdf-export.ts:2858):
> "CTRMA Board Resolution 07-58 (**Procedures for Access Management of Frontage Roads on CTRMA Facilities**)"

The actual attached policy document is titled "**Policies and Procedures for Access Management of Frontage Roads on CTRMA Facilities**" (verbatim from the resolution PDF, Section header).

**Fix:** Add "Policies and " at the start of the parenthetical title.

---

## D. Open / still-to-verify

1. **Dallas Paving/Drainage TIS Waiver form** — fetch blocked by SSL cert error from the dallascityhall.com host. Renderer's threshold (line 2561: "< 1,000 trips per day exempts a non-school site per the Paving/Drainage TIS Waiver form") is consistent with the regional-spec doc's verified verbatim text, but I could not independently re-verify the form text during this pass. Re-check before locking renderer change set.

2. **Plano §12** — the plano.gov/545 page is a landing nav only; the actual standards PDF (planocompplan.org/.../Section-12_Traffic-Impact-Analysis) was not fetched this pass. Spec doc claims ≥8,000 site-generated ADT; that figure is **not** referenced in the renderer (line 2562 only carries the Fort Worth tiers), so a Plano-host fix is not blocked on this verification — but Plano dispatch needs to land before this matters.

3. **Fort Worth Transportation Engineering Manual (June 2019)** — referenced verbatim at line 2554, threshold tiers at line 2562. The June 2019 edition date and TIA Worksheet PDF are referenced in the spec doc as verified but the Fort Worth Manual itself is currently 403'd from the fortworthtexas.gov host. Not a renderer-breaking gap, but the **June 2019** date should be independently verified before locking.

4. **TxDOT TSP §16.2.1 horizon-year framing in the renderer** — the renderer's `horizonNote` is correct on Cat 1 (buildout only) and Cat 3 (phase + completion + 5 + 10 yrs), but for **Cat 2** the manual lists "Buildout year of development" + "Year of completion of each phase" + "Five years after full buildout" (three items). The renderer at line 2538 reads "**buildout year, each phase completion year, and five years past buildout**" — that matches the manual. ✓ No change.

5. **San Antonio §35-502 title precision** — renderer parenthetical says "TIA & Roughly Proportionate Determination". Actual section title is "**Traffic Impact Analysis and Roughly Proportionate Determination Study**". Renderer drops "Study". Minor — flag for cleanup in C-tier of next renderer change.

6. **TxDOT UTP 2026 headline value** — renderer mentions "UTP 2026, adopted Aug 2025" but does not quote the $146B total / $101.6B 10-yr investment headline. Not wrong, just thin. Optional enhancement.

7. **Tex. Occ. Code Ch. 1001 statutes.capitol.texas.gov fetch** — direct chapter HTM page only showed nav, not statute body. Confirmed via search snippets that §1001.001 establishes the "Texas Engineering Practice Act" short title and that the chapter heading is "Texas Board of Professional Engineers and Land Surveyors." Re-verify from statutes.capitol.texas.gov/SOTWDocs/OC/htm/OC.1001.htm before locking the C.4 fix wording.

8. **Bexar/Travis county overlays (line 2666–2667)** — Travis County "1,000 net new daily trips" is consistent with TNR Subdivision policy but the underlying TNR portal page was not fetched this pass. Renderer carries the figure with attribution "Travis County TNR Subdivision Preliminary Plan process," which is the right hook.

---

## E. Suggested renderer changes (terse, by callout)

| # | Location | Change |
|---|---|---|
| 1 | line 2551 | `2023 Infrastructure Design Manual (IDM) Ch. 15` → `IDM Ch. 15 (revision 07-01-2022)` |
| 2 | line 2559 | Replace entire Houston `cityThreshold` value with: **`"Technical memorandum tier 80–120 vph AM or PM peak (IDM §15.04.A.5); ≥100 PHT triggers Full TIA scoping meeting with the City (IDM §15.04.A.4.a). The 80–120 band overlaps the 100-PHT scoping trigger by design — both apply in the overlap. Source: IDM Ch. 15, revision 07-01-2022, plus the OCE TIA Content Guide (Dec 22, 2020)."`** |
| 3 | line 2567 | Replace entire Houston `cityLos` value with: **`"LOS A–F per IDM §15.04.B.6.a; LOS D is the published threshold of significance for the area street system (IDM Ch. 15, revision 07-01-2022)."`** Drop all "VLOS" / "Vehicle Level of Service" / "demotes letter-grade LOS" framing. |
| 4 | line 2945 | `"Austin's two-tier TIA Memo / Full TIA process"` → `"Austin's three-tier process (NTA / Transportation Assessment / Full TIA)"` |
| 5 | line 2858 | `(Procedures for Access Management of Frontage Roads on CTRMA Facilities)` → `(Policies and Procedures for Access Management of Frontage Roads on CTRMA Facilities, adopted Aug 29, 2007)` |
| 6 | line 2976 | `per 22 TAC §137.33 (Texas Engineering Practice Act, Tex. Occ. Code Ch. 1001)` → `per 22 TAC §137.33 (Sealing Procedures), promulgated under The Texas Engineering Practice Act (Tex. Occ. Code Ch. 1001)` |
| 7 | line 2555 | `UDC §35-502 (TIA & Roughly Proportionate Determination)` → `UDC §35-502 (Traffic Impact Analysis and Roughly Proportionate Determination Study)` |
| 8 (optional) | line 3001 | Add total program value to the UTP 2026 mention: `the TxDOT Unified Transportation Program (UTP 2026, $146B total / $101.6B 10-yr capital, adopted Aug 21, 2025)` |

**Net effect:** seven small edits, all in the per-jurisdiction `cityAuthority` / `cityThreshold` / `cityLos` / `cityDeliverables` dictionaries plus two body-text strings (lines 2945, 2976) and the §6.1 CTRMA note at 2858. No structural changes needed. The bulk of the Texas renderer (TSP citations, Appendix Q outline, Harris County overlay, scoping items, mitigation list) is fully verified and stable.

**Where the regional-spec doc and the code disagree:** the spec doc (texas-tis-spec.md) already documents all of items 1–3 in its "Bugs in current `renderTisTexas`" section (lines 449–454). The corrections were applied to the spec on 2026-06-12 but **not** to the renderer code. This deep-dive's job is to certify those corrections and add the four newly-found bugs (C.3 Austin self-contradiction, C.4 Practice-Act mislabel, C.5 CTRMA title, plus the minor D.5 §35-502 cleanup).

---

## Sources

- 22 TAC §137.33 (Sealing Procedures) — Cornell LII: https://www.law.cornell.edu/regulations/texas/22-Tex-Admin-Code-SS-137-33
- 22 TAC Chapter 137 index (txrules.elaws.us): http://txrules.elaws.us/rule/title22_chapter137
- Tex. Occ. Code Ch. 1001 (Texas Engineering Practice Act / TBPELS): https://statutes.capitol.texas.gov/docs/OC/htm/OC.1001.htm
- TxDOT TSP Ch. 16 Traffic Impact Analysis: https://www.txdot.gov/manuals/des/tsp/chapter-16-traffic-impact-analysis-.html
- TxDOT TSP §16.2.1 TIA Categories: https://www.txdot.gov/manuals/des/tsp/chapter-16-traffic-impact-analysis-/16-2-process/16-2-1-tia-categories.html
- TxDOT TSP §16.3.3 Analysis Assumptions: https://www.txdot.gov/manuals/des/tsp/chapter-16-traffic-impact-analysis-/16-3-scope-of-analysis/16-3-3-analysis-assumptions-analysis-assumptions-i.html
- TxDOT TSP §16.4 Analysis Methodology: https://www.txdot.gov/manuals/des/tsp/chapter-16-traffic-impact-analysis-/16-4-analysis-methodology.html
- TxDOT TSP Ch. 16 Appendix Q: https://www.txdot.gov/manuals/des/tsp/chapter-16---appendix-q---traffic-impact-analysis.html
- TxDOT TMUTCD page: https://www.txdot.gov/business/resources/traffic-design-standards/tmutcd.html
- TxDOT UTP 2026 announcement ($146B, adopted Aug 21, 2025): https://www.txdot.gov/about/newsroom/stories/gov-abbott-announces-over-146-billion-texas-transportation-investment.html
- Houston IDM Ch. 15 (07-01-2022) PDF: https://www.houstonpermittingcenter.org/media/6471/download
- Harris County TIA Guidelines (May 8, 2025) PDF: https://www.eng.hctx.net/Portals/33/Publications/professional-services/standard-traffic/Harris-County-TIA-Guidelines-2025.pdf
- CTRMA Resolution 07-58 PDF: https://www.mobilityauthority.com/wp-content/uploads/2024/01/RESOLUTION_07-58.pdf
- San Antonio UDC §35-502: http://sanantonio-tx.elaws.us/code/udc_artv_div2_sec35-502
- San Antonio UDC Appendix B §35-B122: http://sanantonio-tx.elaws.us/code/udc_apxb_sec35-b122
- Austin TIA Guidelines (06-2022) PDF: https://www.austintexas.gov/sites/default/files/files/Transportation/Transportation_Development_Services/Austin_TIA_Guidelines_06-2022.pdf
