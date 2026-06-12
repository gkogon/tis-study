# New York Traffic Impact Study — Renderer Build-Spec

**Status:** Research spec for the New York traffic impact study (TIS) renderer at `artifacts/tis-api-server/src/lib/pdf-export-ny.ts` (`renderTisNewYork`). The renderer ships in the active codebase; this document is the missing source-of-truth backing it — analogous to `london-ta-spec.md`, `florida-tis-spec.md`, etc.

**Scope:** New York State (all 62 counties, all 11 NYSDOT regions). New York City (Region 11, the 5 boroughs) carries a CEQR layer that does not apply elsewhere in the state — the spec treats NYC as a sub-track inside the state framework rather than as a separate jurisdiction.

**Dispatch entry point:** `artifacts/tis-api-server/src/lib/pdf-export-ny.ts` — `renderTisNewYork()` is invoked from `renderStudyPdf` in `pdf-export.ts` when `region.country === "US"` and `region.stateCode === "NY"`. Sub-region routing inside the renderer (`nysdotRegion()` at pdf-export-ny.ts:170) picks NYSDOT Region 1/3/4/5/8/10/11 from lat/lon for NYC-metro vs Hudson Valley vs Long Island vs upstate.

**Authored:** 2026-06-12. Re-verify NYSDOT / NYC / NYCRR URLs before locking — agency URLs migrate.

---

## 0. Headline framings to surface before going further

1. **Dual statutory track.** NY has two layered environmental-review regimes for any project that touches transportation:
   - **SEQRA** (State Environmental Quality Review Act, ECL Article 8 + 6 NYCRR Part 617) — applies statewide for any discretionary government action, including by NYC city agencies.
   - **CEQR** (City Environmental Quality Review, NYC Mayoral Executive Order 91 of 1977 + NYC Charter §192) — overlays SEQRA inside the five boroughs; the operational guidance is the **CEQR Technical Manual**, Chapter 16 Transportation.
   - The renderer must know which regime governs the site and emit the appropriate chapter set. Outside NYC, CEQR does not apply; inside NYC, CEQR is the practical primary, with SEQRA findings folded in.
2. **NYC CEQR Technical Manual was updated December 2025.** The prior baseline was Dec 2021. The 2025 edition is current; the renderer must cite 2025 in its methodology disclosure and not the prior edition. The transportation chapter remains Ch 16; the headline thresholds (50 peak-hour vehicle trips, 200 peak-hour transit riders, 200 peak-hour pedestrians) carry forward at the policy level — confirm Table 16-1 per-land-use development-density thresholds against the 2025 PDF before the renderer asserts them.
3. **NYSDOT HDM Chapter 5 is at Revision 103.** Recent revisions touch **§5.2.3.2** (allowable software for traffic analyses) and **§5.2.3.4** (microsimulation procedure requirements). Appendix 5D is the formal TIS-requirement determination; Appendix 5A is the NYSDOT Policy & Standards for Entrances to State Highways. The renderer's "engine ran on Region X HDM Ch 5 framing" boilerplate must name the revision in force.
4. **Congestion pricing is operational in Manhattan below 60th Street.** The Central Business District Tolling Program (CBDTP) went live **5 January 2025** and is the first cordon-pricing program in the United States. CBD vehicle speeds rose 15–25% in the first year and CBD vehicle volumes fell by ~11%. **Practical consequence for any TIS that uses pre-2025 NYSDOT or NYC DOT counts inside or feeding the CBDTP cordon**: the baseline overstates today's vehicle volumes. The renderer must surface a CBDTP-adjustment caveat when the site is in or adjacent to the cordon zone.
5. **MUTCD-NY 2011 Supplement is the current published version**, but the federal **2009 MUTCD** that it supplemented was superseded by the **2023 (11th Edition) National MUTCD**. FHWA's compliance deadline for state adoption / supplement reissue is **18 January 2026**. As of June 2026, NYSDOT's MUTCD landing still names the 2011 Supplement; treat any NY-prefix device (NYR1-1 etc.) as live, but verify against an updated NY supplement once it lands.
6. **`renderTisNewYork` exists and ships.** This spec is retrospectively documenting it, not greenfielding it. The renderer's NYSDOT-region-routing, K-factor convention, and HCM 2010 LOS threshold tables (signalized/unsignalized/freeway) are already in place. Gaps the spec flags (crash data, CBDTP adjustment, CEQR Ch 16 expansion) are the next iteration's work — see §8 + §12.

---

## 1. Authoritative sources

Primary sources only. Edition/year + URL verified 2026-06-12 unless noted.

### Statutory framework — statewide

| # | Document | Publisher | Edition | URL | Role |
|---|---|---|---|---|---|
| 1.1 | **SEQRA — Environmental Conservation Law Article 8** | NY State Legislature | As amended | https://www.nysenate.gov/legislation/laws/ENV/A8 | Statutory hook for state environmental review. |
| 1.2 | **6 NYCRR Part 617** (SEQRA implementing regulations) | NYSDEC | Current | https://dec.ny.gov/regulatory/permits-licenses/seqr | Defines Type I, Type II, Unlisted; lead-agency process; EAF / EIS thresholds. No standalone numeric TIS threshold — traffic significance is judgement-led by the lead agency. |
| 1.3 | **Vehicle and Traffic Law (V&T Law)** | NY State Legislature | As amended | https://www.nysenate.gov/legislation/laws/VAT | Defines traffic-control authority, posted-speed rules, right-of-way. |
| 1.4 | **General Municipal Law §239-f, §239-m, §239-n** | NY State Legislature | As amended | https://www.nysenate.gov/legislation/laws/GMU/A12-B | County planning-board referral process for site-plan and special-permit decisions impacting state or county roads. |
| 1.5 | **Highway Law §52** (driveway access to state highways) | NY State Legislature | As amended | https://www.nysenate.gov/legislation/laws/HAY/52 | Statutory basis for NYSDOT highway work permits (HWP). |
| 1.6 | **17 NYCRR Subpart 131-4** (Highway Work Permits) | NYSDOT | Current | https://govt.westlaw.com/nycrr/Browse/Home/NewYork/NewYorkCodesRulesandRegulations | HWP application + review procedure for any work in NYSDOT ROW. |

### NYSDOT — design, traffic engineering, environment

| # | Document | Publisher | Edition | URL | Role |
|---|---|---|---|---|---|
| 1.7 | **NYSDOT Highway Design Manual (HDM)** | NYSDOT | Live (chapter-by-chapter revisions) | https://www.dot.ny.gov/divisions/engineering/design/dqab/hdm | Statewide design manual; Chapter 5 is the operational source for TIS. |
| 1.8 | **HDM Chapter 5 — Basic Design** | NYSDOT | **Revision 103** (current as of 2026-06-12) | https://www.dot.ny.gov/divisions/engineering/design/dqab/hdm/chapter-5 (current PDF: chapt_05.pdf) | The TIS chapter. §5.2 covers traffic studies. **Recent revisions per Rev 103**: §5.2.3.2 (allowable traffic-analysis software list) and §5.2.3.4 (microsimulation procedure requirements). Design year currently **2030** (raised from 2025). |
| 1.9 | **HDM Chapter 5 Appendix 5D — TIS requirement determination** | NYSDOT | Per Rev 103 | https://www.dot.ny.gov/divisions/engineering/design/dqab/hdm/hdm-repository/HDM_Ch_5_Appendix_5D_0.pdf | Decision tree for when a full TIS is required vs scoping memo vs trip-generation-only memo. Spec §6.1 reproduces the trigger logic. |
| 1.10 | **HDM Chapter 5 Appendix 5A — Policy & Standards for Entrances to State Highways** | NYSDOT | Per Rev 103 | https://www.dot.ny.gov/divisions/engineering/design/dqab/hdm/hdm-repository/HDM_Ch_5_Appendix_5A.pdf | Standards for new driveway connections to state highways; binding under §1.5 + §1.6. |
| 1.11 | **NYS MUTCD Supplement** | NYSDOT | **2011 Supplement** (per https://www.dot.ny.gov/mutcd, current as of 2026-06-12; FHWA conformance deadline 18 Jan 2026 for re-issue against 11th-Ed 2023 National MUTCD) | https://www.dot.ny.gov/divisions/operating/oom/transportation-systems/repository/B-2011Supplement-adopted.pdf · 17 NYCRR Title B index https://www.dot.ny.gov/divisions/operating/oom/transportation-systems/traffic-operations-section/mutcd | NY-prefix devices (NYR1-1, NYW3-1 etc.). Currently sits on top of the 2009 federal MUTCD; expect re-issue against the 2023 11th Edition National MUTCD. |
| 1.12 | **NYSDOT Project Development Manual (PDM)** | NYSDOT | Live (chapter revisions) | https://www.dot.ny.gov/divisions/engineering/design/dqab/pdm-repository | Procedure for state-let projects; references SEQRA + NEPA integration. |
| 1.13 | **NYSDOT Environmental Procedures Manual (EPM)** | NYSDOT | Live | https://www.dot.ny.gov/divisions/engineering/environmental-analysis/manuals-and-guidance/epm | Chapter 2-1 covers SEQRA implementation by NYSDOT. |
| 1.14 | **NYSDOT Traffic Data Report** (annual)| NYSDOT | Latest (typically 12–18 mo lag) | https://www.dot.ny.gov/divisions/engineering/applied-research/transportation-data/traffic-data-report | Statewide annual AADT compendium. |

### NYC — city agency guidance

| # | Document | Publisher | Edition | URL | Role |
|---|---|---|---|---|---|
| 1.15 | **CEQR Technical Manual** | NYC Mayor's Office of Environmental Coordination (OEC) | **December 2025 Edition** (current; supersedes December 2021 Edition) | https://www.nyc.gov/site/oec/environmental-quality-review/technical-manual.page · Full PDF https://www.nyc.gov/assets/oec/technical-manual/2025_ceqr_technical_manual.pdf · What's Changed PDF https://www.nyc.gov/assets/oec/technical-manual/2025_ceqr_tm_whats_changed.pdf | Operational CEQR guidance for NYC discretionary actions. Twenty-plus chapters; Ch 16 is Transportation. |
| 1.16 | **CEQR Technical Manual Chapter 16 — Transportation** | NYC OEC | December 2025 Edition | https://www.nyc.gov/assets/oec/technical-manual/16_Transportation_2025.pdf | The operational source for any NYC TIS. **Headline thresholds**: 50 peak-hour vehicle trips, 200 peak-hour transit riders (subway/rail + bus), 200 peak-hour pedestrians; below all three → no further numerical transportation analysis (except unusual circumstances). Table 16-1 lists per-land-use development-density thresholds that map to those trip levels by zone. |
| 1.17 | **NYC DOT Street Design Manual (SDM)** | NYC DOT | 3rd Edition (Sept 2020; in force as of June 2026) | https://www.nycstreetdesign.info/ | NYC's analogue of MfS / DMRB; geometry + pedestrian-realm + complete-streets standards for city streets. The TIS mitigation menu (curb extensions, neckdowns, raised crossings) draws from SDM. |
| 1.18 | **NYC Zoning Resolution** | NYC Department of City Planning (DCP) | Current consolidated | https://zr.planning.nyc.gov/ | Parking, loading, and curb-cut requirements that bound TIS conclusions. |
| 1.19 | **NYC DOT Truck Route Network** | NYC DOT | Current | https://www.nyc.gov/html/dot/html/motorist/trucks.shtml | Required truck routing for any project generating HGV trips. |
| 1.20 | **NYC Vision Zero Action Plan + Borough Pedestrian Safety Plans** | NYC DOT | Live | https://www.nyc.gov/site/visionzero/index.page | Drives high-crash-corridor + priority-intersection lists relevant to TIS sites. |
| 1.21 | **NYC DCP CEQR Technical Manual EAS / EIS preparer-of-record filings** | NYC DCP | Public records | NYC OEC document portal | Search-corpus for benchmark trip rates and mitigation choices used in prior CEQR filings in the same neighbourhood. |

### CBDTP (Congestion Pricing) — Manhattan below 60th Street

| # | Document | Publisher | Edition | URL | Role |
|---|---|---|---|---|---|
| 1.22 | **Central Business District Tolling Program (CBDTP)** | MTA Bridges & Tunnels (TBTA) | In force from 5 January 2025 | https://congestionreliefzone.mta.info/ | Cordon-priced zone Manhattan south of 60th St. Pricing schedule (passenger vehicles, taxis/FHVs, trucks) varies by time of day. **Material to any TIS in or feeding the cordon** — pre-Jan-2025 counts overstate today's CBD vehicle volumes by ~11%; CBD vehicle speeds rose 15–25%. |
| 1.23 | **CBDTP environmental assessment + Finding of No Significant Impact (FONSI)** | FHWA + MTA | June 2023 (EA) → Nov 2024 (FONSI revisitation) | https://new.mta.info/project/CBDTP | Modal-shift assumptions, baseline counts, and forecast methodology that underpin the program. Useful as a benchmark for any TIS that needs to defend a CBDTP-adjusted baseline. |

### Professional standards (same in NY as nationally)

| # | Document | Publisher | Edition | URL | Role |
|---|---|---|---|---|---|
| 1.24 | **ITE Trip Generation Manual** | Institute of Transportation Engineers | 11th Edition (2021) — current | https://www.ite.org/technical-resources/topics/trip-and-parking-generation/ | Standard US trip-rate source. NYC CEQR Tech Manual Ch 16 Appendix C also provides CEQR-specific NYC-survey-based rates for use **in lieu of** ITE inside the five boroughs where the CEQR rate exists. |
| 1.25 | **Highway Capacity Manual (HCM)** | Transportation Research Board (TRB) | **HCM 7th Edition** (2022, current) — but NYSDOT HDM Ch 5 Rev 103 still references HCM 2010 procedures + exhibit numbers in places (renderer's LOS-threshold tables at pdf-export-ny.ts:206 use HCM 2010 thresholds; verify whether NYSDOT has issued a Rev-104 update to HCM 6/7 before changing them) | https://www.trb.org/Main/Blurbs/180693.aspx | Capacity + LOS framework. Signalized (Ch 19), unsignalized (Ch 20/21/22), freeway (Ch 12). |
| 1.26 | **HCS** (Highway Capacity Software) | McTrans Center, U. Florida | Current | https://mctrans.ce.ufl.edu/mct/index.php/hcs/ | The reference HCM implementation. Synchro 11 (Trafficware) is the dominant commercial tool; SIDRA Intersection 9 (Akcelik) is used for roundabouts; VISSIM 2024 for microsim. |
| 1.27 | **AASHTO Green Book** (A Policy on Geometric Design of Highways and Streets) | AASHTO | 7th Edition (2018) | https://store.transportation.org | Geometric design fallback where NYSDOT HDM Ch 2/3/4 is silent. |

### MPOs (Metropolitan Planning Organizations) — for cumulative impact + planned-projects context

| # | MPO | Region | URL | NYSDOT Region(s) |
|---|---|---|---|---|
| 1.28 | **NYMTC** (New York Metropolitan Transportation Council) | NYC + Nassau + Suffolk + Westchester + Rockland + Putnam | https://www.nymtc.org/ | 8, 10, 11 |
| 1.29 | **CDTC** (Capital District Transportation Committee) | Albany + Rensselaer + Saratoga + Schenectady | https://www.cdtcmpo.org/ | 1 |
| 1.30 | **GBNRTC** (Greater Buffalo-Niagara Regional Transportation Council) | Erie + Niagara | https://www.gbnrtc.org/ | 5 |
| 1.31 | **GTC** (Genesee Transportation Council) | Rochester / 9-county Finger Lakes | https://www.gtcmpo.org/ | 4 |
| 1.32 | **SMTC** (Syracuse Metropolitan Transportation Council) | Onondaga + Oswego + Madison | https://www.smtcmpo.org/ | 3 |
| 1.33 | **BMTS** (Binghamton Metropolitan Transportation Study) | Broome + Tioga | https://bmtsonline.com/ | 9 |
| 1.34 | **ITCTC** (Ithaca-Tompkins Council of Governments) | Tompkins | https://tompkinscountyny.gov/itctc | 3 |
| 1.35 | **HOCTS** (Herkimer-Oneida Counties Transportation Study) | Herkimer + Oneida | https://www.ocgov.net/hocts | 2 |
| 1.36 | **A/GFTC** (Adirondack/Glens Falls Transportation Council) | Warren + Washington + Saratoga | https://agftc.org/ | 1 |
| 1.37 | **ECTC** (Elmira-Chemung Transportation Council) | Chemung | https://www.chemungcountyny.gov/departments/planning_economic_development/transportation/index.php | 6 |
| 1.38 | **PDCTC** (Poughkeepsie-Dutchess County Transportation Council) | Dutchess | https://www.pdctc.org/ | 8 |
| 1.39 | **OCTC** (Orange County Transportation Council) | Orange | https://www.orangecountygov.com/176/Transportation-Council | 8 |
| 1.40 | **UCTC** (Ulster County Transportation Council) | Ulster | https://ulstercountyny.gov/planning/ulster-county-transportation-council | 8 |

(MPO-specific cumulative-project lists drive the No-Build assignment in §5.)

---

## 2. Standard section structure

The renderer emits **NYSDOT HDM Ch 5 §5 four-block shell** for any site outside NYC, and the **CEQR Tech Manual Ch 16 outline** for NYC sites. Both share the same engine output upstream (trip generation, distribution, assignment, LOS) — the section labels and review-test framing differ.

### 2.1 NYSDOT HDM Ch 5 outline (state-highway track) — current `renderTisNewYork` shape

```
Cover page (NYSDOT-region-stamped: "Region X — <Planning Group>")

§1   Existing Conditions
       1.1  Site description + study area
       1.2  Adjacent roadway network (functional class, posted speed, AADT, lanes)
       1.3  Existing intersection LOS (signalized + unsignalized, per HCM 2010 thresholds)
       1.4  Existing pedestrian / bicycle / transit context

§2   Proposed Development + Trip Generation
       2.1  Land use, scale, opening year
       2.2  ITE Trip Generation 11th Ed rates (or CEQR Ch 16 Appendix C rates inside NYC)
       2.3  Internal capture + pass-by per ITE Trip Generation Handbook (3rd Ed)
       2.4  Modal split (NYC: per CEQR Ch 16 — Manhattan / non-Manhattan)
       2.5  Trip distribution + assignment (gravity / market-share / O-D-survey)

§3   Future Conditions + Level of Service
       3.1  Background growth rate (NYSDOT TDV trend; default 1.0–1.5%/yr if no data)
       3.2  K-factor + DDHV conversion (NYSDOT statewide default K = 0.10)
       3.3  No-Build LOS (Opening Year, AM + PM peak)
       3.4  Build LOS (Opening Year, AM + PM peak)
       3.5  Design Year LOS (Opening + 5 to +20 yr per HDM Ch 5; commonly +10 yr or +20 yr for state highways)

§4   Mitigation + Recommendations
       4.1  Geometric (turn lanes, taper, AASHTO sight-distance)
       4.2  Signal (timing, phasing, NYSDOT signal warrant per MUTCD §4C)
       4.3  Pedestrian / bicycle / transit
       4.4  Permitting hooks — NYSDOT Highway Work Permit (HWP) per 17 NYCRR Subpart 131-4; County 239-f referral; local site-plan
       4.5  Crash history review (NYSDOT TSSR + NYC OpenData inside NYC) — required when site sits within or near a high-crash corridor
```

The renderer's existing four-section shape (existing → proposed → future LOS → mitigation) maps cleanly to HDM Ch 5 §5 — the section headers in `renderTisNewYork` should track this verbatim.

### 2.2 NYC CEQR Tech Manual Ch 16 outline (NYC track)

For NYC projects, the renderer should re-label and re-order to match Chapter 16:

```
Cover page (NYC-stamped: "Five-borough NYC CEQR Transportation Analysis")

§A   Preliminary Transportation Screening
       A.1  Project description + screening assumptions
       A.2  Trip generation against Table 16-1 — assess whether the project
            crosses the 50 peak-hour vehicle trip / 200 peak-hour transit
            rider / 200 peak-hour pedestrian thresholds
       A.3  If all three are below threshold → no further numerical analysis
            required (except unusual circumstances); CEQR transportation
            conclusion is "no significant adverse impact."

§B   Detailed Trip Generation (if any threshold crossed)
       B.1  Daily + peak-hour person trips
       B.2  Modal split — per CEQR Ch 16, NYC-survey-based, by zone
            (Manhattan CBD / Manhattan non-CBD / Outer Boroughs / Rest of NYC)
       B.3  Vehicle occupancy (per CEQR Ch 16 Table 16-3 conventions)
       B.4  Vehicle / transit / pedestrian / bicycle trip counts

§C   Detailed Analysis (per mode crossing its threshold)
       C.1  Traffic operations (intersection LOS, HCM)
       C.2  Transit — subway-line-haul + bus-route-capacity analyses
            where >200 peak-hour transit riders generated
       C.3  Pedestrian — sidewalk + corner + crosswalk LOS where >200
            peak-hour pedestrians generated (CEQR uses the Pushkarev /
            Zupan pedestrian-flow procedure, not HCM 2010 Ch 18)
       C.4  Parking — accumulation analysis vs zoning maxima/minima
       C.5  Safety — Vision Zero high-crash-location review

§D   Impacts + Mitigation
       D.1  Significant-adverse-impact determination per CEQR thresholds
            (delay, LOS drop, queue, transit capacity, pedestrian LOS)
       D.2  Mitigation measures per mode
       D.3  CEQR finding (positive declaration, conditioned negative
            declaration, or negative declaration)

§E   Appendices
       E.1  Counts (manual classified, ATR, pedestrian)
       E.2  HCM worksheets (or Synchro / HCS files)
       E.3  Modal split derivation
       E.4  Pedestrian LOS worksheets
       E.5  Transit ridership memo
```

### 2.3 What the renderer is *not* responsible for

- Manual classified counts (MCC), ATR tubes, pedestrian counts — uploaded.
- Synchro / Vissim / HCS files — uploaded.
- Signed scoping memo (NYSDOT or NYC OEC) — uploaded.
- Crash reports beyond NYSDOT TSSR + NYC OpenData — uploaded.

---

## 3. Methodology conventions

### 3.1 Trip generation

- **Default source: ITE Trip Generation Manual 11th Ed** (2021). Same as the rest of the US engine.
- **Inside NYC**: the CEQR Tech Manual Ch 16 directs the use of **CEQR-derived trip rates** for selected land uses where the CEQR rate is available — these are based on NYC-specific surveys and tend to differ materially from ITE rates because NYC modal split is very different from the suburban / mixed-urban sites in the ITE corpus. The renderer should accept a "use CEQR rates" toggle for NYC projects.
- **Pass-by + internal capture** per ITE Trip Generation Handbook (3rd Ed, 2017). NYC has supplemental pass-by rates for specific NYC retail formats in CEQR Ch 16.
- **Mode split**: outside NYC, ITE rates default to person-trip + vehicle-trip; inside NYC, the modal split per CEQR Ch 16 is mandatory and zone-specific (Manhattan CBD, Manhattan north of 60th, Outer Boroughs).

### 3.2 NYSDOT region assignment + K-factor

- **Region routing** (per pdf-export-ny.ts:170 `nysdotRegion()`):
  - Buffalo metro → Region 5 (GBNRTC)
  - Rochester metro → Region 4 (GTC)
  - Syracuse metro → Region 3 (SMTC)
  - Albany metro → Region 1 (CDTC)
  - NYC metro, lat ≥ 40.92 → Region 8 Hudson Valley (NYMTC) — covers Westchester, Rockland, Putnam, Orange, Dutchess, Ulster, Sullivan, Columbia
  - NYC metro, lon > -73.83 below the Westchester line → Region 10 Long Island (NYMTC) — Nassau, Suffolk
  - NYC metro, else → Region 11 NYC five boroughs (NYMTC)
- **K-factor** (peak hour of AADT): NYSDOT statewide default K = **0.10**. Rural and freeway facilities tend higher (0.10–0.12); urban arterials slightly lower. Renderer surfaces the assumed K in the §3.2 / §1.2 caption per the existing `renderTisNewYork` code.
- **D-factor** (directional split at peak): NYSDOT default 55/45 unless local count data demonstrates otherwise.

### 3.3 Capacity + LOS

- **HCM 2010 thresholds** are the framing the existing `renderTisNewYork` uses (verified at pdf-export-ny.ts:206 `nyLosThresholdTables()`). The renderer prints all three tables for reviewer audit:
  - Signalized (HCM 2010 Exhibit 18-4): A ≤10 / B 10-20 / C 20-35 / D 35-55 / E 55-80 / F >80 sec/veh; any v/c >1.0 is F.
  - Unsignalized — 2-way stop / all-way stop / roundabout (Exhibits 19-1, 20-2, 21-1): A ≤10 / B 10-15 / C 15-25 / D 25-35 / E 35-50 / F >50 sec/veh; any v/c >1.0 is F.
  - Freeway basic / weaving / merge-diverge (Exhibit 10-7): A ≤11 / B 11-18 / C 18-26 / D 26-35 / E 35-45 / F >45 pc/mi/ln; any vd/c >1.00 is F.
- **HCM 7th Ed** (2022) is now current at TRB. The renderer should be ready to switch when NYSDOT HDM Ch 5 issues a revision that adopts the 7th-Ed exhibit numbers; until then, HCM 2010 is what reviewers expect.
- **Software** (per HDM Ch 5 §5.2.3.2 as updated in Rev 103): NYSDOT accepts **HCS**, **Synchro / SimTraffic** (Trafficware), **SIDRA Intersection** (for roundabouts), **VISSIM** (for microsimulation). The renderer should record which tool was used.
- **Microsimulation** is governed by HDM Ch 5 §5.2.3.4 (as updated in Rev 103) — model calibration thresholds, GEH statistic targets, animation review.

### 3.4 Background growth rate

- **Source of truth**: NYSDOT Traffic Data Viewer (TDV) — pull historical AADT for the nearest station(s) and compute a station-anchored compound annual growth rate (CAGR). The IL renderer's `fetch-il-growth-rate.ts` pattern (commit 2e7e727) is the precedent worth porting to NY: per-region median + IQR over 5-year window, with outlier trim.
- **Screening default**: in the absence of measured data, NYSDOT HDM Ch 5 commonly accepts a 1.0–1.5%/yr default with documented justification. The renderer's current 1.5%/yr screening-default echo should be replaced with measured rates per region when a NY fetcher is built.

### 3.5 Congestion pricing (CBDTP) adjustment — Manhattan below 60th Street

- **Effective 5 January 2025.** The CBDTP cordon is Manhattan south of 60th Street (excluding the FDR Drive, West Side Highway, Battery Park Underpass, and Hugh L. Carey Tunnel connections).
- **Impact on baseline counts**: CBD vehicle volumes fell ~11% in the first year of operation; CBD vehicle speeds rose 15–25% (RPA + NBER independent analyses, 2025–2026).
- **TIS practical consequence**: any pre-Jan-2025 NYSDOT or NYC DOT counts inside or feeding the cordon overstate today's vehicle baseline. For a CBDTP-zone TIS in 2026 the renderer should:
  - Flag the count vintage and the CBDTP status (pre/post Jan 2025).
  - If the count is pre-CBDTP, surface a caveat that the baseline overstates current vehicle volumes by an order-of-magnitude 10–15%.
  - Recommend supplemental post-CBDTP counts at affected intersections before the TIS is locked.
  - For projects forecasting a build year after 2025 the No-Build assignment should be drawn from post-CBDTP counts, not interpolated from pre-2025 trend.
- **Renderer status**: not implemented today. Surfaced as §11 follow-up.

### 3.6 Crash data

- **Statewide**: NYSDOT TSSR (Transportation Safety System Repository) is the canonical 3-year crash corpus by location. Access is through NYSDOT Regional Traffic Engineering. The CLEAR / TSDR consolidated system is the data warehouse.
- **NYC**: NYC OpenData Vision Zero crashes (https://data.cityofnewyork.us/Public-Safety/Motor-Vehicle-Collisions-Crashes/h9gi-nx95) is publicly queryable. The crash-data ingest module landed in commit 21db6d8 (per `git log`).
- **Threshold for inclusion in a TIS**: any project that adds >50 peak-hour vehicles to a corridor or that proposes a new full-movement driveway within 250 ft of a documented high-crash location (HCL) should include a 3-year crash review.

### 3.7 Pedestrian + bicycle analysis (NYC only)

- **CEQR Pedestrian LOS** uses a **flow-rate / corner-density** procedure based on **Pushkarev & Zupan** (1975) thresholds, not HCM 2010 Chapter 18. Sidewalk + corner reservoir + crosswalk LOS are evaluated separately.
- **CEQR Ch 16 trigger**: if the project generates >200 peak-hour pedestrians, a detailed pedestrian analysis is required at every affected sidewalk segment, corner, and crosswalk within the study area.
- **Bicycle**: CEQR Ch 16 does not impose a numeric LOS procedure for bicycles; the analysis is qualitative (network connectivity, conflict points, bicycle parking provision per NYC Zoning Resolution §25-80).

### 3.8 Subway + bus capacity (NYC only)

- **Subway line-haul capacity**: where the project generates >200 peak-hour subway riders entering or exiting a single station, the CEQR Ch 16 procedure compares forecast peak-load-point ridership to NYC Transit (NYCT) capacity benchmarks for the line at the time of analysis.
- **Bus route capacity**: where the project generates >200 peak-hour bus riders on a route, the procedure compares to MTA Bus / NYCT Bus capacity guidelines (~50 seated + 30 standing per bus per minute headway at peak load point).
- Both rely on MTA-supplied data — not produced by the engine.

---

## 4. Required deliverable elements

### 4.1 Figures the renderer should auto-generate

1. Site location map (NYSDOT region overlay, planning-group label).
2. Existing roadway classification + functional class (NYSDOT functional class shapefile).
3. Existing AADT bubble map per NYSDOT TDV count points within the study radius.
4. Existing intersection LOS map (signal vs unsignalized symbology).
5. Trip distribution arrows per direction.
6. Build LOS map (No-Build vs Build vs Design Year).
7. CBDTP cordon overlay (when site is in Manhattan below 60th St).
8. NYC subway + bus network map (NYC sites).
9. High-crash-location overlay (NYSDOT TSSR or NYC OpenData).

### 4.2 Tables the renderer auto-generates

- Existing AADT + peak-hour DDHV per study link.
- Trip-generation matrix (rate, raw, pass-by, internal capture, net new, by mode).
- LOS comparison table (Existing / No-Build / Build / Design Year × AM Peak / PM Peak × per-intersection delay + LOS + queue).
- Mitigation summary table.
- Permitting summary (HWP / 239-f / local site-plan / CEQR action type).

### 4.3 Submission pathway summary

- **Local lead agency**: town / village / city planning board (SEQRA lead) and county planning board (per GML §239-m / §239-n referral) for non-NYC; **NYC City Planning Commission** or **Board of Standards and Appeals** with **OEC technical review** for NYC.
- **NYSDOT involvement**: required when work touches state ROW (HWP per 17 NYCRR Subpart 131-4) or when site impacts state highways (Regional Traffic Engineer scoping).
- **NYC DOT involvement**: required for any new curb cut, signalized intersection modification, or NYC-managed corridor.
- **MTA / NYC Transit involvement**: where the TIS triggers a transit-capacity analysis under CEQR Ch 16.

---

## 5. NY-specific terminology

| Term | Meaning |
|---|---|
| **NYSDOT** | New York State Department of Transportation. |
| **HDM** | Highway Design Manual (NYSDOT). |
| **TIS** | Traffic Impact Study (NYSDOT term). "TIA" and "Traffic Study" used interchangeably. |
| **HWP** | Highway Work Permit (17 NYCRR Subpart 131-4). |
| **DDHV** | Directional Design-Hour Volume = AADT × K × D. |
| **K-factor** | Design-hour-volume / AADT ratio. NYSDOT statewide default 0.10. |
| **D-factor** | Peak-hour directional split. NYSDOT default 55/45. |
| **SEQRA** | State Environmental Quality Review Act. ECL Art. 8 + 6 NYCRR Pt 617. |
| **EAF** | Environmental Assessment Form (SEQRA Short / Full). |
| **DEC** | NYS Department of Environmental Conservation. |
| **TSSR** | Transportation Safety System Repository (NYSDOT 3-yr crash data). |
| **TDV** | Traffic Data Viewer (NYSDOT AADT + counts portal). |
| **CEQR** | City Environmental Quality Review (NYC analogue of SEQRA). |
| **OEC** | NYC Mayor's Office of Environmental Coordination (CEQR coordinating agency). |
| **CPC** | NYC City Planning Commission. |
| **BSA** | NYC Board of Standards and Appeals. |
| **CBDTP** | Central Business District Tolling Program (Manhattan congestion pricing, in force 5 Jan 2025). |
| **TBTA** | Triborough Bridge & Tunnel Authority (MTA Bridges & Tunnels — operates CBDTP). |
| **PANYNJ** | Port Authority of New York & New Jersey. |
| **NYCT** | New York City Transit (the MTA subsidiary that runs subways + NYC buses). |
| **CMP** | Congestion Management Process (federally required for NYMTC + CDTC). |
| **TOD** | Transit-Oriented Development. |
| **§239-f referral** | GML §239-f / -m / -n — county planning board referral on site-plans within 500 ft of a state or county road. |
| **NY-prefix sign** | NYS MUTCD Supplement device unique to NY (e.g. NYR1-1). |
| **NYCDOT** | NYC Department of Transportation. |
| **NYCDCP** | NYC Department of City Planning. |
| **EIS / EAS** | Environmental Impact Statement / Environmental Assessment Statement (CEQR). |

---

## 6. Thresholds and review triggers

### 6.1 NYSDOT HDM Ch 5 — full TIS vs scoping memo vs no study

Per HDM Ch 5 Appendix 5D (which the renderer should reproduce verbatim once the PDF is re-fetched and parsed), the determination is judgement-led by the Regional Traffic Engineer but the indicative triggers are:

- **Full TIS required** when any one of:
  - >100 peak-hour vehicle trips generated by the proposed action.
  - New full-movement driveway on a state highway.
  - Material change to access on a state highway already operating at LOS D or worse.
  - Project requires a new traffic signal on a state highway.
  - Project sits within 1,000 ft of a documented high-crash corridor (TSSR HCL).
- **Scoping memo or trip-generation-only memo** for projects below the full-TIS threshold but above a 50 peak-hour vehicle trip floor.
- **No study** for projects below the 50 peak-hour vehicle trip floor and with no driveway access to a state highway.

The renderer should expose the threshold logic and prompt for the Regional Traffic Engineer's scoping confirmation.

### 6.2 NYC CEQR Table 16-1 — preliminary screening

The CEQR Ch 16 preliminary screening uses **trip-end thresholds** rather than land-use thresholds directly. The headline conclusion: if the project's projected peak-hour trip generation falls below all three of:

- **50 peak-hour vehicle trips** (vehicle trip-ends)
- **200 peak-hour transit riders** (subway/rail + bus combined)
- **200 peak-hour pedestrian trips**

…then no detailed transportation analysis is required (except in unusual circumstances per Ch 16).

**Table 16-1** in the CEQR Tech Manual translates those trip-end thresholds into per-land-use development-density thresholds by zone. The renderer should reproduce Table 16-1 once re-verified against the December 2025 edition PDF — §11 follow-up.

### 6.3 SEQRA Type I / Type II / Unlisted

- **Type II** (statutorily exempt — 6 NYCRR Part 617.5) — no environmental review needed. Most small-residential and routine repair/maintenance falls here.
- **Type I** (more likely to require an EIS — 6 NYCRR Part 617.4) — nonresidential >10 acres, residential >250 units, parking >1,000 spaces, height >100 ft + various contextual triggers. A Type I action requires a Full Environmental Assessment Form (EAF) and the lead agency must consider whether an EIS is needed.
- **Unlisted** (everything else) — Short EAF; lead agency determines significance.
- There is **no SEQRA numeric TIS threshold**. The lead agency assesses traffic impact as part of the broader environmental review; the renderer must surface the SEQRA classification and let the lead agency reach its own significance finding.

### 6.4 GML §239-f / §239-m / §239-n referral

- **§239-m** — site-plan, special permit, variance, or zoning amendment within **500 ft of a state or county road, state or county park, state-owned land, or intermunicipal boundary** must be referred to the county planning board (or regional planning agency where the county has none) for review.
- **§239-n** — subdivision review with the same triggers.
- **§239-f** — county planning agency may make findings on regional impact; local board can override only by supermajority.

Practical TIS consequence: outside NYC, any project within 500 ft of a state/county road requires §239-m referral, and the county planning board often demands TIS-level traffic analysis as part of the referral package.

---

## 7. Region-specific data sources

### 7.1 NYSDOT Traffic Data Viewer (TDV)

- **URL**: https://www.dot.ny.gov/tdv (legacy) · https://gis.dot.ny.gov/tdv (current ArcGIS interface).
- **Format**: interactive map + station-level CSV export. Underlying data layer: NYSDOT Roadway Inventory.
- **Access**: free, no key.
- **Coverage**: AADT at ~50,000 stations statewide; updated annually with 12–18 month lag.
- **Renderer use**: AADT baseline + growth-rate fetch (see §3.4 + IL pattern).

### 7.2 NYSDOT Roadway Data Management (RDM) FeatureServer

- **URL**: https://gis.dot.ny.gov/hostingny/rest/services/Roadways/RDM_Roadway_Current/FeatureServer/0.
- **Format**: ArcGIS REST FeatureServer; query-able by bbox + WHERE.
- **Access**: free, no key.
- **Fields**: posted speed, functional class, roadway name, number of lanes, surface type.
- **Renderer use**: **already wired** — `nysdot-data.ts` ingests posted speed by intersection (commit 1b2fafa). Functional class + lane count are next-iteration extensions.

### 7.3 NYSDOT Functional Class shapefile

- **URL**: NYSDOT GIS Hub.
- **Format**: Shapefile / GeoJSON.
- **Renderer use**: classify each study-area link as Interstate / Other Freeway / Principal Arterial / Minor Arterial / Major Collector / Minor Collector / Local — drives default K/D, LOS thresholds, and access-management expectations.

### 7.4 NYSDOT TSSR / CLEAR (crash data)

- **Access**: NYSDOT Regional Traffic Engineering; restricted release.
- **Format**: report-level CSV; geocoded.
- **Renderer use**: 3-year crash review at affected intersections + HCL identification within study radius.

### 7.5 NYC OpenData

| Dataset | Endpoint | Use |
|---|---|---|
| Motor Vehicle Collisions — Crashes | https://data.cityofnewyork.us/Public-Safety/Motor-Vehicle-Collisions-Crashes/h9gi-nx95 | NYC crash record for Vision Zero review. Already wired in commit 21db6d8. |
| Traffic Volume Counts | https://data.cityofnewyork.us/Transportation/Traffic-Volume-Counts/btm5-ppia | NYC DOT manual classified counts. |
| Bicycle Counts (Eco-Counter automated) | https://data.cityofnewyork.us/Transportation/Bicycle-Counts/uczf-rk3c | NYC bike network volume baseline. |
| LION (NYC Street Centerline) | https://data.cityofnewyork.us/City-Government/LION/2v4z-66xt | NYC street centerline with attributes — preferred over OS-style basemaps for NYC TIS work. |
| PLUTO (Primary Land Use Tax Lot Output) | https://www.nyc.gov/site/planning/data-maps/open-data.page | Parcel-level land use + zoning + FAR. Useful for cumulative-development trip-generation memos. |
| Vision Zero View | https://www.nyc.gov/site/visionzero/maps/vz-view.page | Interactive HCL + corridor map; supports the §4.5 crash review. |

### 7.6 MTA + NYCT data

| Dataset | URL | Use |
|---|---|---|
| MTA Subway turnstile counts (legacy) | http://web.mta.info/developers/turnstile.html | Pre-2023 station-entry baseline. Now superseded by per-line ridership reports. |
| MTA GTFS feeds | https://new.mta.info/developers | Static + realtime GTFS for subway, NYCT bus, MTA bus, LIRR, Metro-North. |
| MTA bus + subway ridership | https://new.mta.info/agency/new-york-city-transit/subway-bus-ridership | Headline ridership by line / route. |
| CBDTP toll-zone data | https://congestionreliefzone.mta.info/ | Cordon-pricing rates, exemptions, post-implementation traffic counts. |

### 7.7 Functional / contextual datasets

- **NYS GIS Clearinghouse** — https://gis.ny.gov/ — statewide layers (county boundaries, hydrography, parcel index).
- **NYC DCP MapPLUTO** — parcel + land-use polygon.
- **NYS DEC SEQR Decision History** — partial; useful for benchmarking how similar projects were classified.

---

## 8. Where the existing `renderTisNewYork` stands

The renderer was scoped to the NYSDOT HDM Ch 5 Shell shape and ships today. Audit of `pdf-export-ny.ts` as of 2026-06-12:

| Element | Status | Notes |
|---|---|---|
| NYSDOT region routing | ✅ shipped (`nysdotRegion()`, pdf-export-ny.ts:170) | Covers Buffalo (R5), Rochester (R4), Syracuse (R3), Albany (R1), Hudson Valley (R8), LI (R10), NYC (R11). Default fallback "Region to be confirmed" for non-NY metros that somehow hit the NY branch. |
| HCM 2010 LOS threshold tables | ✅ shipped (`nyLosThresholdTables()`, pdf-export-ny.ts:206) | Signalized + unsignalized + freeway. Need a Rev-104 update if NYSDOT moves to HCM 7. |
| K-factor convention | ✅ surfaced (statewide 0.10 default in §3.2 caption) | Currently a fixed echo; should vary by NYSDOT functional class once §7.3 is wired. |
| Posted-speed ingest | ✅ shipped (commit 1b2fafa, lib/nysdot-data.ts) | Tier-1 only — 6-second timeout, 4-way concurrent, 25-second budget, fails open. |
| Crash module | ✅ Tier-1 shipped (commit 21db6d8 — NYC OpenData; NY State Police county-level for non-NYC) | Tier-2 (TSSR HCL match per intersection) not wired. |
| Growth-rate ingest | ❌ screening default only | The IL pattern (`fetch-il-growth-rate.ts`, commit 2e7e727) is the precedent — port it to NYSDOT TDV. |
| CEQR Ch 16 outline | ❌ not implemented | Renderer emits HDM Ch 5 shape even for NYC sites. CEQR Table 16-1 screening + pedestrian LOS + transit-capacity sections all missing. |
| CBDTP adjustment | ❌ not implemented | No baseline-count CBDTP-status flag. |
| GML §239-m referral surfacing | ❌ not implemented | Renderer doesn't compute "site within 500 ft of state/county road" → no §239 referral prompt. |
| SEQRA classification surfacing | ❌ not implemented | No Type I / II / Unlisted determination prompt. |
| ITE Trip Generation 11th Ed | ✅ used (upstream engine) | Same as the rest of the US engine. |
| CEQR trip rates (alternative for NYC) | ❌ not exposed | A "use CEQR Ch 16 Appendix C rates" toggle for NYC projects is the right next step. |

In short: the renderer is a **NYSDOT HDM Ch 5 shell that ships** for any NY site. For NYC sites it is technically valid for SEQRA-style review but is not a CEQR document — and most NYC discretionary actions need CEQR-shaped output, not HDM Ch 5 shape.

---

## 9. Comparison to other state renderers

| Aspect | NY (HDM Ch 5 shell) | London TA | Georgia DRI |
|---|---|---|---|
| Statutory hook | SEQRA (ECL Art 8 / 6 NYCRR Pt 617) + CEQR (NYC only, Mayor EO 91 + Charter §192) | NPPF Dec 2024 + PPG + London Plan 2021 | Georgia Planning Act + ARC RTP + GRTA |
| Document name | "Traffic Impact Study" (NYSDOT) / "CEQR Transportation Analysis" (NYC) | Transport Assessment / Transport Statement | TIS / DRI Transportation Analysis |
| Trigger (state) | HDM Ch 5 App 5D: >100 peak-hr veh-trips / new state-hwy driveway / signal warrant / HCL within 1,000 ft. SEQRA classification overlay (Type I/II/Unlisted). | NPPF para 118 + LPA discretion + DfT 2007 App B floorspace + ≥30 vph / ≥100 vpd / ≥100 spaces / AQMA. | O.C.G.A. § 50-8-7.1 DRI thresholds + local TIS thresholds. |
| Trigger (city overlay) | NYC CEQR Table 16-1: 50 peak-hr veh / 200 peak-hr transit / 200 peak-hr peds. | PSI categories 1A–3J for Mayor referral. | — |
| Trip generation source | ITE 11th Ed (default); CEQR Ch 16 Appendix C inside NYC where rate exists. | TRICS 8 multi-modal (85th-percentile, mean+85, Cross Test, licensed organisation attestation). | ITE 11th Ed. |
| Capacity methodology | HCM 2010 (per Rev 103) — HCS / Synchro / SIDRA / VISSIM per HDM §5.2.3.2. | DMRB CD 116/123 + LinSig / Junctions 11 / TRANSYT / VISSIM. RFC / DOS / PRC / MMQ. | HCM 6th Ed + Synchro. |
| Modes assessed | Vehicle + (NYC only) transit + pedestrian + bicycle. CEQR Ch 16 mandates the multi-modal split inside NYC. | Walking + cycling + bus + rail + car + taxi + motorcycle + LGV + HGV; mandatory throughout. | Vehicle-dominant; multi-modal optional. |
| Accessibility metric | None statewide; CEQR Ch 16 implicitly via station-entry counts + sidewalk LOS inside NYC. | PTAL 0–6b mandatory in every London TA. | None. |
| Crash data | NYSDOT TSSR (statewide); NYC OpenData Vision Zero (NYC). | Stage 1 RSA (TfL TLRN); borough crash records. | GDOT crash records. |
| Cumulative impact | MPO project lists (NYMTC, CDTC, GBNRTC, GTC, SMTC, etc.); CEQR EAS/EIS pipeline (NYC). | Planning London Datahub (PLD) committed-development pipeline. | ARC RTP / TIP / STIP. |
| Funding mechanism | NYSDOT cost-share (HWP) + local impact fees where adopted (sparse in NY) + NYC mitigation conditions. | S106 / S278 / MCIL2. | Developer-built; DRI impact fees. |
| Cover convention | NYSDOT region stamp; signature block uses NY PE seal. | CEng MCIHT signature. | GA PE seal. |
| Driving side | Right. | Left. | Right. |
| Units | Imperial — miles, feet. | Metric — km, m, PCUs. | Imperial. |

**Bottom line**: NY is a US-engine native fit *outside* NYC — the existing renderer's NYSDOT HDM Ch 5 shape is correct. Inside NYC, the CEQR layer changes the document shape, the trip-generation rates, the pedestrian methodology, and the transit-capacity expectations. The current renderer ships an HDM Ch 5 doc for NYC sites, which is technically valid for SEQRA but not a CEQR document — that gap is what §12 step 2 closes.

---

## 10. Wrapper vs separate renderer for NYC

The question worth answering before further CEQR build-out: does the NY renderer fork at "in NYC vs out of NYC" or stay as a single function with conditional CEQR sections?

A **single-function-with-conditionals** approach (extend `renderTisNewYork` to branch on `region.code === "new_york_metro" && lat ≤ 40.92 && lon ≤ -73.83`) keeps the dispatch simple and shares the trip-generation / LOS engine output between SEQRA and CEQR tracks. The drawback is that the CEQR sections (pedestrian LOS, subway capacity, Table 16-1 screening) are structurally different — the renderer becomes a maze of `if (isNyc)` branches.

A **`renderCeqrNyc` separate function** mirrors the GA-DRI sub-template pattern (`renderTisGeorgiaDriSections`) — same engine output, dispatched into a NYC-specific section emitter. This is the cleaner architectural shape and matches how the Georgia DRI branch is already structured.

**Recommendation**: keep `renderTisNewYork` as the HDM Ch 5 emitter; add `renderCeqrNyc` as a sibling for the CEQR overlay. Route by NYSDOT region: Region 11 (NYC five boroughs) → both, with CEQR sections rendered after the HDM Ch 5 shell so a reviewer gets the full picture without having to choose document shape upfront.

---

## 11. Open follow-ups before locking the renderer

1. **CEQR Tech Manual December 2025 What's-Changed PDF** (`2025_ceqr_tm_whats_changed.pdf`) — the URL returned HTTP 403 on the 2026-06-12 fetch (likely User-Agent gating on nyc.gov). Re-fetch via browser session, extract the Ch 16 delta vs the Dec 2021 baseline, and surface in §3.7 / §3.8.
2. **CEQR Ch 16 Table 16-1 exact per-land-use thresholds** — currently quoted at the policy level (50 / 200 / 200) but the Table 16-1 development-density values per land use × zone are not in this spec. Pull from the December 2025 PDF before the renderer asserts them.
3. **NYSDOT HDM Ch 5 Appendix 5D current text** — Rev 103 PDF was found at https://www.dot.ny.gov/divisions/engineering/design/dqab/hdm/hdm-repository/HDM_Ch_5_Appendix_5D_0.pdf — extract the verbatim TIS-required-vs-scoping-memo decision tree and reproduce here.
4. **MUTCD-NY re-issue against 2023 11th-Edition National MUTCD** — FHWA compliance deadline 18 January 2026. As of 2026-06-12 the NYSDOT MUTCD page still lists the 2011 Supplement. Re-check at deployment; if a new supplement has landed, refresh §1.11 + the renderer's sign-warrant citations.
5. **HCM 7th Edition adoption by NYSDOT** — the renderer's LOS threshold tables are HCM 2010. NYSDOT HDM Ch 5 Rev 103 §5.2.3 was updated in 2025+ but the exhibit numbers cited may still be HCM 2010. If Rev 104 lands with HCM 7 references, update §3.3 + the threshold tables.
6. **CBDTP toll schedule + exempted classes** — pull the current rates from congestionreliefzone.mta.info before the renderer asserts dollar values; the schedule was indexed at launch and may change.
7. **NYSDOT TSSR access pattern** — the renderer's Tier-2 HCL match per intersection requires Regional Traffic Engineering access. Document the request path (form, expected turnaround, data format) for build-time.
8. **NYC modal-split values per CEQR zone** — CEQR Ch 16 Appendix C carries the canonical modal split table. Extract for each of (Manhattan CBD / Manhattan non-CBD / Outer Boroughs) by land-use class.
9. **NYC DOT Street Design Manual 4th Edition** — the current 3rd Edition is Sept 2020. NYC DOT has signalled a 4th Edition in the 2024 Annual Report; track release.
10. **SEQRA Workbook 2025 Draft** — NYSDEC released a Draft SEQRA Workbook in 2025. Verify status and incorporate any new Type I / II clarifications.

---

## 12. Implementation hooks (for the next iteration)

Concrete work the build can take on, ordered by leverage:

- **CBDTP cordon flag**. Add `isInCbdtpCordon(lat, lon)` to `nysdot-data.ts` (Manhattan south of 60th, exclude FDR / West Side Hwy / Battery Park Underpass corridors). Surface in §1.2 and §3 of `renderTisNewYork` when true. Single-day work.
- **NYSDOT TDV growth-rate fetcher**. Port `scripts/src/fetch-il-growth-rate.ts` pattern to NYSDOT TDV. Per-region median + IQR, outlier trim, 5-year window. Drop-in replacement for the current 1.5%/yr screening echo. 1–2 day work.
- **CEQR Ch 16 section emitter**. New function `renderCeqrNyc(doc, r, project, region)` dispatched after `renderTisNewYork` when NYSDOT region = 11. Implements §A preliminary screening → §B trip generation (CEQR rates) → §C detailed analysis (incl. pedestrian LOS) → §D mitigation. 1-week work; needs Table 16-1 PDF parse first.
- **NYSDOT functional class layer**. Fetch from NYSDOT GIS Hub, store as static layer, classify study-area links. Drives K/D defaults and access-management expectations. 1-day work.
- **GML §239-m referral detection**. Spatial join site point against state-and-county-road buffer (500 ft); if within → surface "GML §239 referral required" in §4.4 permitting summary. 1-day work.
- **SEQRA classification prompt**. Input-validation toggle: Type I / Type II / Unlisted. Surface in §1.1 with the lead agency name. 0.5-day work.
- **NYC DOT Bicycle + Pedestrian count integration**. Pull the NYC OpenData bicycle counts + DOT pedestrian counts into the existing-conditions tables when in NYC. 1-day work.
- **MTA GTFS station + bus-route catchment**. Compute 5-min / 10-min walk catchment to subway stations + bus stops for NYC sites; surface in §1.4 transit context. 2-day work.
- **Tier-2 NYSDOT TSSR HCL match**. Once TSSR access is confirmed, ingest the HCL dataset and flag intersections within the study radius. 1-week work after access landed.

---

## 13. Map to the existing renderer code

Where each piece of this spec lives (or should live) in `pdf-export-ny.ts`:

| Spec section | Code reference | State |
|---|---|---|
| §2.1 HDM Ch 5 shell | `renderTisNewYork()` body (pdf-export-ny.ts:246+) | shipped |
| §3.2 NYSDOT region routing | `nysdotRegion()` (pdf-export-ny.ts:170) | shipped |
| §3.3 HCM 2010 LOS threshold tables | `nyLosThresholdTables()` (pdf-export-ny.ts:206) | shipped |
| §3.4 NYSDOT TDV growth-rate fetcher | (none) | not started |
| §3.5 CBDTP cordon flag + adjustment | (none) | not started |
| §3.6 NYSDOT TSSR + NYC OpenData crash ingest | NYC OpenData shipped (commit 21db6d8); TSSR not | partial |
| §3.7 CEQR pedestrian LOS | (none) | not started |
| §3.8 Subway + bus capacity | (none) | not started |
| §6.1 HDM Ch 5 App 5D trigger logic | (none — boilerplate inline only) | not started |
| §6.2 CEQR Ch 16 Table 16-1 screening | (none) | not started |
| §7.2 NYSDOT RDM ingest (posted speed) | `lib/nysdot-data.ts` (commit 1b2fafa) | shipped |

---

**End of spec.**

Companion artifacts:
- `NEW-YORK-PROSPECTS.md` (private; gitignored) — 37-firm Wave-1 prospect corpus, per memory `[TIS NY Wave-1 corpus]`.
- `private/contacts-ny.json` (private; gitignored) — 115 contact rows.
- `private/drafts-ny/*.txt` (private; gitignored) — 115 per-contact personalised cold-outbound drafts.
- `private/build_instantly_ny_csv.py` (private; gitignored) — campaign CSV builder.
