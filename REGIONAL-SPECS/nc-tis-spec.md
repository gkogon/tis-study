# North Carolina TIA Renderer Spec

Researched 2026-08-06 — primary sources read in full (NCDOT Standards 3/2022, Best Practices 11/20/2024, Driveway Manual 7/2003, sealed Buncombe TIA 2022, Raleigh Z-021-20 packet). Status: READY TO IMPLEMENT.

## 1. Authoritative sources
- **NCDOT Capacity Analysis Guidelines — Standards** (FINAL March 2022) + **Best Practices** (Nov 20, 2024) — Congestion Management Section. THE methodology docs.
- **NCDOT Policy on Street and Driveway Access to North Carolina Highways** (July 2003 — still current) — trigger + report outline + mitigation criteria.
- **NCDOT TIA Checklist** (7-21-2017) + online TIA Request Form — scoping instruments; an **Approved Scoping Document is a required TIA submittal element**.
- **NCDOT 2026–2035 STIP** (adopted by Board of Transportation July 2025; ~2,900 projects; supersedes 2024–2033).
- 21 NCAC 56 .1103 (seal) + N.C.G.S. 89C.
- Naming: NCDOT Congestion Management says **"Traffic Impact Analysis (TIA)"** (the 2003 manual says TIS — same instrument; render "TIA").

## 2. Triggers (Driveway Manual Ch. 4.C / 1.B)
- **TIS/TIA may be required at ≥3,000 vpd** estimated trip generation (average weekday, ITE rates, NO reductions allowed in the threshold test) — render the engine's raw daily total against this line.
- Also triggerable: access within 1,000 ft of interchange; high-crash location; major arterial; median crossover; site near TIP-programmed/under-construction project; District Engineer discretion. Waivable by Division Engineer.
- **≥15,000 vpd** at build-out → District Engineer forwards to Division Traffic Engineer / TESSB (render note for large sites).

## 3. Scenarios + scoping (Standards table)
Existing Base Year · No-Build Design Year · Design Year Build w/o Improvements (when scoped) · Intermediate-year Builds for phases (when scoped) · **Design Year Build with Improvements (all alternatives)**. Horizon = build-out year (or local-jurisdiction year approved by District Engineer). STIP-coordination: if an impacted STIP project is in planning/design/construction or ≤5 yrs post-construction and site traffic wasn't in the forecast → additional STIP design-year analysis (render as conditional note). Growth factor + background developments must be agreed in the scoping doc BEFORE submittal. Phased sites: earlier-phase trips stay site trips, never background.

## 4. Hard methodology defaults (Standards — render in Methodology + Deviations sections)
- HCM-based; NCDOT currently uses **Synchro 11** (+ mandatory SimTraffic simulation, min 10 runs); HCS for freeway/ramp; Sidra for roundabouts (HCM 6th detailed report).
- **PHF 0.90** future; heavy vehicles avg of duals+TTSTs, **min 2%**; protected-only lefts in future analysis per rules (dual lefts / >240 vph / ≥3 opposing lanes / cross-products 50k/90k/110k); **no RTOR in future analysis**; storage = max(Synchro 95th, SimTraffic max) rounded to 25 ft, **min 100 ft**; taper 100 ft; roundabout fails at **v/c 0.85**; seasonal factors in high-variation areas.
- Counts: TMCs at every study intersection, Tue–Thu, school in session, ≤12 months old; AM+PM minimum.
- Trip gen: ITE latest + NCDOT "Rate vs Equation" spreadsheet; internal capture via **NCHRP 684** spreadsheet (occupancy 1.1, 4,000-ft walk max, no transit splits); pass-by retail-only, multi-use total **≤10% of adjacent street volume**. (ITE-clean handling: state the requirement; engine rates presented as public-data screening basis tagged for swap-in. NCHRP 684 is fine to cite — never NCHRP 365.)
- Study area: intersections where site trips ≥10% of background on any approach/movement.

## 5. MOE reporting format (Best Practices pp.38–40 — the "NCDOT-shaped" signature)
Approach order **EB, WB, NB, SB**; movements L→T→R; signals: control delay + LOS overall AND per lane group, **v/c>1 ⇒ LOS F** (footnote); **unsignalized: NO overall LOS** — per lane group w/ conflicting movement; yield: queues only. Table columns: Int. No. / Intersection / Approach / Lane Group / Delay AM|PM / LOS AM|PM / 95th Queue AM|PM / Max Queue AM|PM. Render engine data into this exact shape (engine lacks SimTraffic max queue — column noted "SimTraffic — at submittal").

## 6. Mitigation criteria (Driveway Manual Ch. 5.J)
Improvement required when project vs base shows: **delay +25%** at same LOS · **LOS drops one letter** · **LOS F** · 95th queue > existing storage (turn lanes). Signal-timing changes alone ≠ mitigation. Final determination = District Engineer. Render as an explicit criteria-check table per intersection (maps 1:1 onto engine's LOS-drop/delay-delta data — strongest possible NC signal).

## 7. Report skeleton (merge: 2003 Ch. 5.A outline × Best Practices 12-section outline × Creekside TIA)
Exec Summary → §1 Introduction (project, area map, site plan, phasing) → §2 Base Conditions (network/lanes, modes, volumes, signal phasing, safety, capacity) → §3 Background/No-Build Conditions (growth, approved developments, STIP improvements, volumes, capacity) → §4 Project/Build Conditions (site trips, distribution/assignment, capacity, alt-mode impact) → §5 Build with Improvements → §6 Auxiliary Turn Lane Analysis → §7 Mitigation Criteria Check (Ch. 5.J table) → §8 Conclusions & Recommendations → Appendices (counts, capacity worksheets, warrants, correspondence, Approved Scoping Document placeholder). Methodology section must name analysis software + release (engine: "HCM-consistent computation; Synchro 11 files to be provided at submittal").

## 8. Jurisdiction dispatch — ncJurisdiction(lat, lon)
- `charlotte`: UDO Art. 32.1 **Comprehensive Transportation Review** (eff. 6/1/2023) = Multimodal Assessment + TDM + TIS, thresholds per **Charlotte Streets Manual Table 3.1** (secondary-source: >1,500 vpd or >150 PHT low-intensity; >2,000/>200 med-high — mark "confirm against Table 3.1", primary was 403-blocked); CTR applies at permitting even by-right; MPO = CRTPO (2026–2035 TIP).
- `raleigh`: RSDM §7.1.3 triggers (**≥150 PHT; ≥100 PHT on 2-lane primary access; >100 peak-direction; ≥3,000 vpd**); UDO §8.2.2 sufficiency + 8.2.2.E.5 mitigation plan; process: RDOT+NCDOT joint scoping (since 7/1/2024), consultant-reviewed, **$5,500/submittal + $1,000/addendum** (render fee note); rezoning mode = current-entitlement vs proposed-entitlement trip comparison (Z-021-20 pattern); MPO = CAMPO.
- default `ncdot_district`: pure Driveway Manual + Congestion Management; counterpart = **District Engineer** (scoping) + Congestion Management (review).

## 9. Terminology / data blocks
DHV/K: NCDOT forecasts give AADT, %duals/TTSTs, D, K — peak-hour conversion via Intersection Analysis Utility (IAU) in the NCDOT Traffic Engineering Suite. AADT: NCDOT ArcGIS AADT mapping (cite as the Creekside TIA does). Crash: **TEAAS** (statewide reportable crashes since 1990) — escape-hatch language until wired. STC/CTP conformity note for Strategic Transportation Corridors.

## 10. Seal block (Creekside pattern)
"Prepared under the direct charge of and sealed by a licensed North Carolina Professional Engineer with expertise in traffic engineering" (Driveway Manual verbatim). Title block: firm name/address + **NC firm license number ("NC Business License #C-XXXX")** + PE name/number; seal 1½–1¾", signature over/adjacent + date per 21 NCAC 56 .1103. Confidentiality note: TIAs remain confidential until permit request/public announcement.

## 11. Comparison to GA reference
Same 3-scenario core + Build-with-Improvements as 4th; deltas: the Ch. 5.J mitigation-criteria table (no GA analog — highest-value NC signal), NCDOT MOE table format (EB/WB/NB/SB, no overall unsignalized LOS), 3,000-vpd raw-trips trigger vs GRTA 7%, Approved-Scoping-Document as appendix placeholder, "TIA" naming, Synchro-11/SimTraffic software disclosure, STIP 2026–2035 for programmed projects.
