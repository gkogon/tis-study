# South Carolina TIS Renderer Spec

Researched 2026-08-06 (web agent, all primary sources verified; working extracts in session scratchpad). Status: READY TO IMPLEMENT.

## 1. Authoritative sources
- **SCDOT ARMS 2008** (Access and Roadside Management Standards), update posted **7/8/2025** + errata same date — THE governing doc; TIS lives inside the encroachment-permit process. [scdot.org/business/access-management.html]
- **TG-21 "Mitigation of Traffic Impacts"** (12/5/2008, reapproved 12/21/2018) — statewide LOS standard.
- ED-17 (encroachment permit directive) — **on hold since 8/20/2021** pending ARMS update; cite ARMS not ED-17.
- SCDOT FFY **2024–2033 STIP** ("as amended"; e-STIP portal) for programmed projects.
- S.C. Code **§40-22-270** + SC Regs Ch. 49 — PE sealing.
- ITE *Transportation Impact Analysis for Site Development* (2006) is ARMS's named methodology reference.

## 2. When a TIS is required (ARMS Ch. 6, p.53)
- **≥100 trips in the peak hour** of generator OR adjacent street (state trigger); expansions adding 100+; below 100 at District Traffic Engineer (DTE) discretion; waivers via DTE.
- County overlays: Anderson **75** PHT; Greenville County **100** (50 in unzoned areas; 25% expansion trigger); Charleston (City) **feature-based**: any drive-through, >6 fuel dispensers, >10k sf non-res coverage, ≥5 ac, restaurant >4k sf, ≥45 SF/two-family units; Horry Table 7-6 size thresholds (100k sf retail, 100+ SFD, 75+ ac PUD...).

## 3. Review structure (renderer prose)
District-based: **District Permit Engineer (DPE)** = permit contact; **District Traffic Engineer (DTE)** = scopes the TIS, evaluates, determines mitigation; RME inspects; State Permit Engineer = HQ QA. Pre-application coordination with DPE recommended; conceptual concurrence valid 1 year. Scope MUST be set with the DTE before study begins (render as hard requirement). Submittal via EPPS. Do NOT reference "Regional Production Groups" (design-side only — verified non-role).

## 4. Analysis conventions
- Scenarios: **Existing / Build-out No-Build / Build-out Build** (matches engine's 3-scenario model 1:1).
- Peaks: AM + PM weekday minimum; midday/Saturday/school when DTE directs.
- Counts ≤12 months old, school in session, seasonally adjusted.
- Capacity: HCM "latest edition" (render HCM 6th), LOS for ALL approaches AND movements; coordinated-system analysis if signal system affected.
- **LOS standard per TG-21: C or better, peak hour, ALL roadway types statewide** ("in lieu of locally preferred thresholds"). If baseline ≤C already: maintain/improve baseline. Baseline F in congested urban: DTE decides. Baseline includes committed funded improvements + non-site growth. **This is stricter than FL/GA's D — render prominently.**
- Charleston (SCDOT District 6) caps: internal capture ≤20% of lesser of enter/exit; pass-by ≤10% of adjacent street traffic — engine's applied credits must be checked against these when in the Charleston box.
- Turn lanes: ARMS Ch. 5 + SCDOT Roadway Design Manual Ch. 9 (storage lengths).
- Signal proposals: MUTCD warrant analysis mandatory.

## 5. Section skeleton (ARMS 6B ten items ∩ real submittals)
Mirror the Columbia exemplars (Congaree Pointe 2021, Bull Street 2025):
Executive Summary → §1 Introduction (background · existing roadway conditions · access/driveways) → §2 Project Traffic (2.1 land uses, 2.2 trip generation, 2.3 distribution & assignment, graphical) → §3 Traffic Volume Development (3.1 existing, 3.2 no-build, 3.3 build) → §4 Traffic Impact Analysis (4.1 turn-lane analysis, 4.2 intersection LOS — per-intersection subsections) → §5 Findings & Recommendations (mitigation table; final determination rests with DTE) → §6 Access Management demonstration (fewest driveways, sight distance) → §7 Signal Warrants (when applicable) → Appendices (trip-gen worksheets, counts, volume development, turn-lane worksheets, capacity outputs per scenario).
Include the **ARMS Technical Completeness Checklist** items as a rendered compliance table — SCDOT returns incomplete studies unreviewed; showing the checklist met is a strong "SC-shaped" signal.

## 6. ITE-clean handling (CRITICAL)
ARMS mandates "latest edition ITE Trip Generation Manual." Renderer must: state the ARMS requirement verbatim as the jurisdiction's expectation; present the engine's public-data screening rates (NHTS 2017 / SANDAG 2002 / NCHRP 716) as the screening basis with every rate tagged for swap-in at submittal; note internal-capture/pass-by credits require justification acceptable to the DTE (and District 6 caps in Charleston). Same pattern as FL renderer's Hillsborough fee-schedule note.

## 7. Jurisdiction dispatch — scJurisdiction(lat, lon)
- `charleston` (Charleston/Berkeley/Dorchester): City TIS Prep Guide (June 2021) feature triggers; District 6 credit caps; MPO = **CHATS (staffed by BCDCOG)**.
- `columbia` (Richland/Lexington): follows "City of Columbia and SCDOT guidelines" (= ARMS + city scoping); MPO = **COATS (CMCOG)**. Richland Co. LDC threshold UNVERIFIED — generic language.
- `greenville` (Greenville/Pickens): County LDR Art. 9 (Apr 2018) on county roads / ARMS on state; 100 PHT (50 unzoned), 3-intersection/½-mi default study area, fee-in-lieu mechanism; UDO §22.8 (adopted Dec 2024, as-adopted text UNVERIFIED — cite LDR as controlling w/ UDO note); MPO = **GPATS**.
- `myrtle_beach` (Horry): County LDR Table 7-6 size thresholds; 5,000+ ADT regional-significance review (partially UNVERIFIED); MPO = **GSATS (bi-state, incl. Brunswick NC)**.
- default `scdot_district`: pure ARMS + TG-21.
- Anderson County note (75 PHT + county-approved consultant list) as extraNote in `greenville` box or default.

## 8. PE seal block
"under the direct charge of and sealed by a registered South Carolina Professional Engineer with expertise in traffic engineering" (ARMS) — seal per §40-22-270: name, license number, signed and dated under/across the face and beyond the circumference of the seal; firm Certificate of Authorization seal; electronic sealing accepted in current practice (2025 exemplar is DocuSign-executed).

## 9. Data sources
STIP: cite "SCDOT FFY 2024–2033 STIP, as amended" + e-STIP. Counts: SCDOT traffic counts portal (AADT stations). Crash: SCDOT/SCDPS collision data — render escape-hatch language (like NY §4) until a wire exists.

## 10. Comparison to GA reference
Same 3-scenario engine mapping; key deltas: LOS C standard (vs D), TIS-inside-encroachment-permit framing (vs rezoning-centric), DTE as the named counterpart (vs GRTA/ARC), completeness-checklist compliance table (no GA analog), 100-PHT bright-line trigger (vs GRTA 7% rule), MUTCD warrant section mandatory when signal proposed.
