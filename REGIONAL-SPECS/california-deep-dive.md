# California TIS / VMT Renderer — Primary-Source Verification Pass

**Date:** 2026-06-12. **Sources fetched:** leginfo.legislature.ca.gov (PRC § 21099, § 21064.3, § 21155), lci.ca.gov (SB 743 hub), dot.ca.gov (TAF/TAC SB 743 hub, HDM, CA MUTCD), OPR Dec 2018 Technical Advisory (curl + pdftotext), caleemod.com (CAPCOA 2024 Handbook), planbayarea.org / mtc.ca.gov, scag.ca.gov, sandag.org, sacog.org, github.com/BayAreaMetro/travel-model-one.

**Scope.** Verifies regulatory, statutory, agency-document, and threshold citations baked into `renderTisCalifornia` and the `californiaJurisdiction` lookup table in `artifacts/tis-api-server/src/lib/pdf-export.ts`, plus the upstream `REGIONAL-SPECS/california-vmt-spec.md` it derives from.

---

## A. HEADLINE: PRC § 21064.3 was amended in 2024 — 15-min → 20-min headway. The renderer's TPA screening criterion is wrong on the face of the statute.

**AB 2553 (Friedman, Stats. 2024, Ch. 275)**, signed by the Governor 2024-09-19, amended **California Public Resources Code § 21064.3** effective **2025-01-01**. The "major transit stop" definition's bus-headway threshold moved from **15 minutes or less** to **20 minutes or less** during morning and afternoon peak commute periods. Verified verbatim from leginfo.legislature.ca.gov, FindLaw, and Justia codifications, all post-amendment.

The renderer cites the **15-minute** figure at [pdf-export.ts:1279](artifacts/tis-api-server/src/lib/pdf-export.ts:1279) inside the `caVmtScreening` cascade:

> "Transit Priority Area (TPA): within ½ mi of a major transit stop (PRC § 21064.3) or high-quality transit corridor (PRC § 21155)"

— the section heading is fine, but the embedded methodology is anchored to the OPR Dec 2018 Tech Advisory's verbatim quote of the **superseded** PRC § 21064.3 (footnote 20, OPR TA p. 13: *"a frequency of service interval of 15 minutes or less during the morning and afternoon peak commute periods"*). The OPR Technical Advisory has **not** been updated since AB 2553 — it still quotes the old 15-min definition. Anyone implementing TPA screening from the Tech Advisory alone (which is what the renderer effectively does) under-counts qualifying transit stops by the share of bus-route intersections that operate at 16–20 minute headways. This is the most consequential under-screen the engine can produce today.

**Three other items have shifted in 2025–2026 since the spec was written:**

1. **MTC's PBA 2050+ has been adopted** (2026-03-19 ABAG / 2026-03-25 MTC). The renderer / spec still call it "slated early 2026." Three jurisdiction entries (SF, San Jose, Oakland) still cite **Plan Bay Area 2050 (Oct 2021)** as the current RTP/SCS — that is now the prior plan, not the current one.
2. **SANDAG 2025 Regional Plan was adopted 2025-12-12.** Renderer says "2025 Regional Plan in development." Stale.
3. **SACOG 2025 Blueprint was adopted 2025-11-20.** Renderer says "adoption Fall 2025." Stale.

**One new statewide CEQA-VMT instrument is now in play and absent from the renderer entirely:**

4. **AB 130 Statewide VMT Mitigation Program.** LCI released draft program guidance 2026-04-08; public comment closed 2026-05-08; statutorily required to finalize by 2026-07-01. Adds a voluntary monetary-contribution-based mitigation pathway in lieu of project-specific VMT reduction measures. The renderer's CAPCOA-only mitigation menu (§3.5) is now outdated as the canonical list of mitigation paths — the AB 130 program is a parallel statutorily-mandated track that lead agencies will routinely consider alongside CAPCOA.

---

## B. Verified-correct citations (no change needed)

- **SB 743** — Stats. 2013, Ch. 386; signed 2013-09-27. ✓ Verified at leginfo bill page.
- **PRC § 21099(b)(2)** verbatim language: *"automobile delay, as described solely by level of service or similar measures of vehicular capacity or traffic congestion, shall not be considered a significant impact on the environment pursuant to this division, except in locations specifically identified in the guidelines, if any."* ✓ Verified verbatim from leginfo.
- **14 CCR § 15064.3** statewide effective date **2020-07-01**. ✓ Verified via OPR / LCI guidance + multiple secondary sources; OAL approval 2018-12-28.
- **OPR Technical Advisory dated December 2018.** Title verified: *"Technical Advisory on Evaluating Transportation Impacts in CEQA."* ✓ Hosted at `lci.ca.gov/ceqa/docs/20190122-743_Technical_Advisory.pdf`. Renderer's framing of the document — Dec 2018, current as of June 2026 — is correct.
- **PRC § 21155(b)** verbatim: *"a high-quality transit corridor means a corridor with fixed route bus service with service intervals no longer than 15 minutes during peak commute hours."* ✓ Verified verbatim from leginfo. NOTE: this stayed 15 minutes; AB 2553 only moved § 21064.3 (major transit stop), NOT § 21155 (HQTC). The two thresholds are now **different** values for two different definitions. The renderer must not collapse them.
- **OPR 15%-below-baseline threshold language** verbatim from Dec 2018 Tech Advisory p. 10: *"OPR recommends that a per capita or per employee VMT that is fifteen percent below that of existing development may be a reasonable threshold."* ✓ Verified verbatim via curl + pdftotext extraction.
- **OPR 110-trip screening language** verbatim from Tech Advisory p. 12: *"projects that generate or attract fewer than 110 trips per day generally may be assumed to cause a less-than-significant transportation impact."* ✓ Verified verbatim. Renderer's `screeningTripCount: 110` default + the OPR-floor framing in [pdf-export.ts:1270](artifacts/tis-api-server/src/lib/pdf-export.ts:1270) is correct.
- **OPR TPA-exclusion list** (FAR <0.75, excess parking, SCS-inconsistent, replaces affordable units with fewer market-rate units) verbatim at OPR TA p. 14. ✓ The renderer note at [pdf-export.ts:1281](artifacts/tis-api-server/src/lib/pdf-export.ts:1281) is faithful to the source.
- **Caltrans TAF 2nd Edition, Sept 2025** and **TAC 2nd Edition, Sept 2025.** ✓ Both verified from the official Caltrans SB 743 resource hub: *"In September 2025, the Department released the second editions of the Transportation Analysis Framework (TAF) and Transportation Analysis under CEQA (TAC)."*
- **CA MUTCD 2026 effective 2026-01-18, replaces 2014 Rev. 9.** ✓ Verified verbatim from dot.ca.gov: *"Effective January 18, 2026, the California Department of Transportation (Caltrans) has issued the California Manual on Uniform Traffic Control Devices (CA MUTCD) 2026."*
- **Caltrans HDM 7th Edition.** ✓ Confirmed as current edition; HDM landing page shows chapters with rolling revision dates through 2025.
- **CAPCOA 2024 Handbook adopted 2024-11-21.** ✓ Verified; full title *"Handbook for Analyzing Greenhouse Gas Emission Reductions, Assessing Climate Vulnerabilities, and Advancing Health and Equity."* Supersedes Dec 2021 edition. Adopted unanimously by CAPCOA Board of Directors at 2024-11-21 meeting.
- **MTC Travel Model One v1.6.1, released 2025-05-02.** ✓ Verified at github.com/BayAreaMetro/travel-model-one (tag TM1.6.1 dated May 2, 2025).
- **SCAG Connect SoCal 2024 adopted 2024-04-04.** ✓ Verified verbatim from SCAG: *"On April 4, 2024, the SCAG Regional Council unanimously approved and adopted the Connect SoCal 2024 Regional Transportation Plan/Sustainable Communities Strategy."*
- **San Diego TSM revised 2022-09-19** (original adoption Sept 29, 2020). ✓ Verified.
- **"MTSO" / "Manual on Traffic Signal Operations" is a phantom citation.** ✓ Verified that no Caltrans document carries that title. The correct artifacts the renderer cites at [pdf-export.ts:1729](artifacts/tis-api-server/src/lib/pdf-export.ts:1729) ("Caltrans Traffic Signal Operations Manual, Jan 2020") + signal warrants in CA MUTCD Part 4C are the right call.

---

## C. Verified-WRONG citations that need fixing

### C.1 PRC § 21064.3 headway value — 15 min → 20 min (AB 2553, eff. 2025-01-01)

Critical and load-bearing. The renderer's TPA screening criterion implicitly inherits the **old** 15-minute headway from OPR Dec 2018 Tech Advisory footnote 20. Today, **major transit stop** under PRC § 21064.3 means *"the intersection of two or more major bus routes with a frequency of service interval of 20 minutes or less during the morning and afternoon peak commute periods"* (post-AB-2553).

The renderer at [pdf-export.ts:1279](artifacts/tis-api-server/src/lib/pdf-export.ts:1279) names PRC § 21064.3 directly. The note at [pdf-export.ts:1281](artifacts/tis-api-server/src/lib/pdf-export.ts:1281) doesn't quote a specific headway, so the prose itself isn't wrong on its face — but anyone wiring the GIS query under "requires verification" will default to the 15-min headway because that's what the OPR Tech Advisory (the renderer's stated source) still says. The renderer must (1) name the AB 2553 amendment explicitly and (2) document that PRC § 21064.3 (major transit stop) and PRC § 21155 (high-quality transit corridor) now use **different** headway thresholds: **20 min** for § 21064.3, **15 min** for § 21155.

The corresponding spec line in [california-vmt-spec.md §2.6](REGIONAL-SPECS/california-vmt-spec.md) says: *"Major transit stop defined in PRC § 21064.3 (rail, ferry, OR intersection of two major bus routes ≤15-min peak headway)"* — this needs the same fix.

Also affected: the §7 glossary line in the spec: *"**Major transit stop** — defined in PRC § 21064.3: rail, ferry, **OR** intersection of two major bus routes with ≤15-min peak headway."* — same fix.

### C.2 MTC RTP/SCS — Plan Bay Area 2050 (2021) is no longer current

Plan Bay Area 2050+ was adopted by ABAG **2026-03-19** and by MTC **2026-03-25**. The renderer at three jurisdiction entries still says **"Plan Bay Area 2050 (adopted Oct 2021); PBA 2050+ update slated early 2026"** — that future-tense framing was correct when the spec was written but is now stale by ~3 months.

Affected lines:
- [pdf-export.ts:1037](artifacts/tis-api-server/src/lib/pdf-export.ts:1037) — San Francisco entry
- [pdf-export.ts:1148](artifacts/tis-api-server/src/lib/pdf-export.ts:1148) — San Jose entry
- [pdf-export.ts:1163](artifacts/tis-api-server/src/lib/pdf-export.ts:1163) — Oakland entry

All three need to flip to **"Plan Bay Area 2050+ (adopted Mar 25, 2026 by MTC; ABAG Mar 19, 2026); supersedes PBA 2050 (Oct 2021)."**

### C.3 SANDAG RTP/SCS — 2025 Regional Plan is adopted (renderer says "in development")

SANDAG Board adopted the 2025 Regional Plan **2025-12-12** with EIR certification. Renderer at [pdf-export.ts:1117](artifacts/tis-api-server/src/lib/pdf-export.ts:1117) (San Diego entry) says:

> "Final Amended 2021 Regional Plan (CARB-approved Feb 2025); 2025 Regional Plan in development"

Should now read: **"2025 Regional Plan (adopted Dec 12, 2025; CARB SCS evaluation pending as of 2026-06-12); supersedes Final Amended 2021 Regional Plan."** Also flip the `mpoModel` line to lead with ABM3 (2022 base year) rather than ABM2+.

### C.4 SACOG RTP/SCS — 2025 Blueprint is adopted (renderer says "adoption Fall 2025")

SACOG adopted the 2025 Blueprint **2025-11-20**. Renderer at [pdf-export.ts:1132](artifacts/tis-api-server/src/lib/pdf-export.ts:1132) (Sacramento entry):

> "2025 Blueprint (MTP/SCS) — adoption Fall 2025"

Should read: **"2025 Blueprint (MTP/SCS) — adopted Nov 20, 2025."**

### C.5 San Diego TSM URL typo — `sandego.gov` (missing `i`)

The upstream spec at `REGIONAL-SPECS/california-vmt-spec.md` line 58 and again in the Appendix A source index (line 651) has the URL `https://www.sandego.gov/sites/default/files/10-transportation-study-manual.pdf` — should be `www.sandiego.gov`. This doesn't propagate to the renderer (which doesn't bake the URL), but the spec itself is incorrect. Verified the correct URL `https://www.sandiego.gov/sites/default/files/10-transportation-study-manual.pdf` resolves to the actual TSM dated 2022-09-19.

### C.6 Missing — AB 130 Statewide VMT Mitigation Program (April 2026)

Not a wrong citation but a missing one. The §3.5 CAPCOA-only mitigation framing at [pdf-export.ts:1532–1559](artifacts/tis-api-server/src/lib/pdf-export.ts:1532) presents CAPCOA 2024 as **the** VMT mitigation menu. As of 2026-04-08, LCI released draft AB 130 guidance for a **Statewide VMT Mitigation Program** — a voluntary monetary-contribution pathway in lieu of project-specific reduction measures. Final guidance due by **2026-07-01** (statutory deadline). The renderer should add a §3.5.2 (or footnote in §3.5) naming the AB 130 program and the LCI guidance URL, with an "[verify finalization status]" inline tag until July.

---

## D. Open / still-to-verify

1. **AB 130 final guidance.** Draft released 2026-04-08; final due 2026-07-01. Re-pull at that date — credit pricing per region ranged $1,515 (Madera CTC area) up to $6,682 (Santa Barbara CAG area) in the draft. The final values may shift after the comment-period response.
2. **OPR Technical Advisory supplemental memo.** As of 2026-06-12, the Dec 2018 Tech Advisory is still the current guidance and has NOT been amended to reflect AB 2553's 15→20-min change to PRC § 21064.3. If LCI issues a corrective memo (likely once AB 130 finalizes), the renderer should pull the updated TPA-screening language verbatim.
3. **SANDAG 2025 Regional Plan — CARB SB 375 SCS evaluation.** The plan is adopted (2025-12-12) but CARB hasn't yet posted an SCS-evaluation determination as of the verification cutoff. Check ww2.arb.ca.gov/our-work/programs/sustainable-communities-program/regional-plans-evaluations/san-diego-association.
4. **PBA 2050+ implementation — Priority Development Areas (PDA) overlay updates.** The renderer's §3.7 row "Priority Development Area (PDA) eligibility — MTC region: PBA 2050 PDA overlay confers SCS-consistency presumption" needs the overlay reference updated to PBA 2050+. Verify whether the PDA layer was re-published with the new plan adoption or whether the 2021 overlay was retained.
5. **AMBAG 2022-base ABM** — slated for June 2026 per upstream spec. Verify whether AMBAG has shipped the new model (if so, the model name + base-year value in the renderer's AMBAG entry — which currently isn't dispatched but would be needed for Monterey / Santa Cruz / San Benito — would need to update).
6. **Caltrans Traffic Signal Operations Manual** — the 2024-08 notice referenced in upstream spec may have triggered a manual update. The Aug 2024 notice PDF was inaccessible via WebFetch (binary garble). Confirm the manual's current version against dot.ca.gov directly.
7. **CHP CCRS / TIMS** — verify whether CCRS has launched a public query interface by the time the renderer ships. As of the spec's writing, TIMS remained the only practical crash wire; no change has surfaced to contradict that.
8. **City of Anaheim TIA Guidelines** — Feb 2025 "final draft" status. Verify whether Anaheim Council has formally adopted the draft as of 2026-06-12; renderer flags it as "final draft" which is conservatively correct but may now be a finalized adopted document.

---

## E. Suggested renderer changes (terse)

1. **PRC § 21064.3 — 15 min → 20 min (AB 2553).** Update the TPA screening criterion in `caVmtScreening` at [pdf-export.ts:1279](artifacts/tis-api-server/src/lib/pdf-export.ts:1279) to add an explicit note: *"Per AB 2553 (Stats. 2024, Ch. 275), the PRC § 21064.3 'major transit stop' definition now uses a 20-minute headway threshold (eff. 2025-01-01); the OPR Dec 2018 Tech Advisory still quotes the superseded 15-min figure in footnote 20 and has not been updated to reflect AB 2553. PRC § 21155 high-quality-transit-corridor remains 15 min."*
2. **MTC RTP/SCS — flip from PBA 2050 → PBA 2050+.** Replace the `rtpScs` string in the SF [pdf-export.ts:1037](artifacts/tis-api-server/src/lib/pdf-export.ts:1037), San Jose [pdf-export.ts:1148](artifacts/tis-api-server/src/lib/pdf-export.ts:1148), and Oakland [pdf-export.ts:1163](artifacts/tis-api-server/src/lib/pdf-export.ts:1163) entries to **"Plan Bay Area 2050+ (adopted Mar 25, 2026 by MTC, Mar 19, 2026 by ABAG; supersedes PBA 2050 of Oct 2021)."**
3. **SANDAG RTP/SCS — flip from "2025 in development" → "2025 adopted."** Update the San Diego entry at [pdf-export.ts:1117](artifacts/tis-api-server/src/lib/pdf-export.ts:1117) `rtpScs` to **"2025 Regional Plan (adopted Dec 12, 2025; CARB SCS evaluation pending); supersedes Final Amended 2021 Regional Plan."** Also re-order `mpoModel` to lead with ABM3 (2022 base year) since that's now the operative model.
4. **SACOG RTP/SCS — concrete adoption date.** Sacramento entry at [pdf-export.ts:1132](artifacts/tis-api-server/src/lib/pdf-export.ts:1132) — change `rtpScs` to **"2025 Blueprint (MTP/SCS) — adopted Nov 20, 2025."**
5. **AB 130 Statewide VMT Mitigation Program — add to §3.5.** Either as a §3.5.2 subsection or a prominent paragraph after the CAPCOA table at [pdf-export.ts:1549](artifacts/tis-api-server/src/lib/pdf-export.ts:1549), noting: AB 130 (Stats. 2025), LCI draft guidance released 2026-04-08, final due 2026-07-01, voluntary monetary-contribution pathway as alternative to project-specific CAPCOA mitigation. URL: `https://lci.ca.gov/ceqa/` for current status.
6. **PBA 2050 vs. PBA 2050+ overlay** — §3.7 row in [pdf-export.ts:1592](artifacts/tis-api-server/src/lib/pdf-export.ts:1592) updates from "PBA 2050 PDA overlay" to "PBA 2050+ PDA overlay (verify whether re-issued post-adoption Mar 2026 or whether 2021 overlay grandfathered)."
7. **Spec file URL typo fix.** Fix `sandego.gov` → `sandiego.gov` in `REGIONAL-SPECS/california-vmt-spec.md` (two occurrences: line 58 and line 651).
8. **One-paragraph "Regulatory currency note" up front.** Mirror the GA deep-dive recommendation. Lead the California renderer with a 4-bullet currency block: AB 2553 PRC § 21064.3 amendment (eff. 2025-01-01); PBA 2050+ adoption (Mar 2026); SANDAG 2025 + SACOG 2025 adoptions (late 2025); AB 130 program (final due Jul 2026). The reader knows what's already shifted under their feet since the OPR Tech Advisory was written.

---

## Sources

### Statutes & regulations (primary)
- PRC § 21099 (SB 743 codification): https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=PRC&sectionNum=21099.
- PRC § 21064.3 (post-AB 2553, 20-min): https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=PRC&sectionNum=21064.3.
- PRC § 21155 (HQTC, 15-min, unchanged): https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=PRC&sectionNum=21155.
- AB 2553 (Friedman, 2024) bill text: https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202320240AB2553
- Cox Castle on AB 2553 impact: https://www.coxcastle.com/publication-ab-2553-a-small-change-with-big-consequences-how-five-more-minutes-could-increase-transit-oriented-development
- 14 CCR § 15064.3 (Cornell LII): https://www.law.cornell.edu/regulations/california/14-CCR-15064.3

### OPR / LCI
- OPR Dec 2018 Technical Advisory (PDF, downloaded + pdftotext): https://lci.ca.gov/ceqa/docs/20190122-743_Technical_Advisory.pdf
- LCI SB 743 hub (lists AB 130 April 2026 guidance + statewide VMT mitigation bank): https://lci.ca.gov/ceqa/sb-743/
- AB 130 draft guidance (April 2026): https://www.lci.ca.gov/wp-content/uploads/20260407-FinalDraftGuidance-ADA.pdf
- AB 130 Allen Matkins explainer: https://www.allenmatkins.com/real-ideas/governors-office-of-land-use-and-climate-innovation-releases-draft-guidance-for-voluntary-statewide-vehicle-miles-traveled-mitigation-program.html

### Caltrans
- SB 743 resource hub (TAF/TAC 2nd Ed. Sept 2025 confirmation): https://dot.ca.gov/programs/sustainability/sb-743/resources
- HDM 7th Ed.: https://dot.ca.gov/programs/design/manual-highway-design-manual-hdm
- CA MUTCD 2026 landing (effective 2026-01-18 verification): https://dot.ca.gov/programs/safety-programs/camutcd

### MPOs
- MTC PBA 2050+ adoption (Mar 19/25, 2026): https://www.prnewswire.com/news-releases/mtc-abag-adopt-final-plan-bay-area-2050-and-environmental-impact-report-302725277.html
- PBA 2050+ landing: https://planbayarea.org/plan-bay-area-2050-plus
- MTC TM1 v1.6.1 (May 2, 2025): https://github.com/BayAreaMetro/travel-model-one
- SCAG Connect SoCal 2024 adoption (Apr 4, 2024): https://scag.ca.gov/news/scag-regional-council-approves-connect-socal-2024-southern-californias-regional-plan
- SANDAG 2025 Regional Plan landing (adopted Dec 12, 2025): https://www.sandag.org/regional-plan/2025-regional-plan
- SANDAG adoption news (SD Chamber): https://sdchamber.org/2025/12/sandag-adopts-2025-regional-plan/
- SACOG 2025 Blueprint (adopted Nov 20, 2025): https://www.sacog.org/planning/blueprint

### Cities (URL correction)
- City of San Diego TSM (correct URL): https://www.sandiego.gov/sites/default/files/10-transportation-study-manual.pdf

### CAPCOA
- CAPCOA 2024 Handbook (adopted Nov 21, 2024): https://www.caleemod.com/handbook/index.html
- CAPCOA handbook update project: https://www.airquality.org/businesses/ceqa-land-use-planning/ghg-handbook-caleemod
