# Florida TIS Build-Spec

State: Florida
Renderer target: `renderTisFlorida()` in `pdf-export.ts`
Spec status: Research-only. Cite primary sources; flag inferences with `[INFERRED]` and unconfirmed items with `[GAP]`.
Spec date: 2026-06-09
Companion specs: `texas-tis-spec.md`, `illinois-tis-spec.md`, `london-ta-spec.md`

---

## 1. Authoritative Sources

### 1.1 FDOT Site Impact Handbook (current edition)

- **Multimodal Transportation Site Impact Handbook (MTSIH), March 25, 2024**
  - URL: https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/planning/systems/systems-management/document-repository/site-impact/mtsih_20240325.pdf
  - Index page: https://www.fdot.gov/planning/systems/systems-management/site-impact-analysis
  - This is the authoritative FDOT document for site impact analysis and supersedes the April 2014 / October 2019 "Transportation Site Impact Handbook (TSIH)." FDOT formally calls the process "MTIA" (Multimodal Transportation Impact Assessment); in practice "TIA," "SIA," and "TIS" are used interchangeably.

- **Multimodal Transportation Site Impact Applications Guide, June 5, 2024** (companion)
  - URL: https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/planning/systems/systems-management/document-repository/site-impact/mtsih_application-guide_20240605.pdf
  - Worked examples: Comp Plan Amendment, Downtown Mixed-Use, Subdivision on Rural High-Speed Road.

- **Predecessor (still cited in some district practice):** Transportation Site Impact Handbook, October 2019 / April 2014.
  - 2019 ed.: https://www.flrules.org/gateway/readRefFile.asp?refId=14944&filename=Oct.+2019+Transportation+Site+Impact+Handbook.pdf
  - 2014 ed. (mirror): https://accessmanagement.info/wp-content/uploads/2017/02/TSIH_April_201404.pdf

### 1.2 FDOT Quality/Level of Service (Q/LOS) Handbook

- **2023 Multimodal Quality/Level of Service Handbook, v6.0 (August 2025 update)**
  - URL: https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/planning/systems/systems-management/document-repository/qlos/fdot_qlos_handbook_v6-0_clean_aug-2025_complete-streets-replaced-with-context-based-solutions.pdf
  - Index page: https://www.fdot.gov/planning/systems/systems-management/quality-level-of-service
  - v6.0 reorganized/updated Generalized Service Volume Tables (GSVTs), includes pedestrian level-of-traffic-stress (PLTS) guidance, and replaced "complete streets" terminology with "context-based solutions."
  - Companion policy: **Policy 000-525-006, "Level of Service Targets for the SHS"** — https://pdl.fdot.gov/api/procedures/downloadProcedure/000-525-006

### 1.3 FDOT Traffic Impact Analysis Procedures (official TIS guidance)

- **MTSIH 2024** (Section 1.1) is the controlling TIS guidance. The **FDOT Traffic Analysis Handbook (TAH)** explicitly defers TIS work to the Site Impact Handbook:

  > "For guidance on conducting traffic impact studies, the analyst should refer to the FDOT Transportation Site Impact Handbook. For guidance on sketch-level planning analysis, the analyst should refer to the FDOT Quality/Level of Service Handbook."
  > — TAH §1.1

  - TAH (Oct 2025 revision of May 2021): https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/planning/systems/systems-management/document-repository/traffic-analysis/traffic-analysis-handbook_10-08-2025.pdf
  - TAH scope: corridor studies, interchange access requests (IARs), PD&E studies — **not** site-impact TIS.
- **FDOT Project Traffic Forecasting Handbook** and **Procedure Topic No. 525-030-120** govern demand forecasting in TIS work (PDL: https://pdl.fdot.gov/api/procedures/downloadProcedure/525-030-120).
- **FDOT Procedure 525-000-006** "Level of Service Standards and Highway Capacity Analysis for the State Highway System" sets the SHS LOS standards (cited in §3.1.3 below).

### 1.4 FDOT Standard Specifications for Road and Bridge Construction

- **2025 Standard Specifications for Road and Bridge Construction** — index: https://www.fdot.gov/programmanagement/Implemented/SpecBooks
- [INFERRED] Cited primarily for construction details (mitigation cost-estimating in TIS); a TIS deliverable typically references the current edition by year. No version-specific text required in the renderer.

### 1.5 FDOT Plans Preparation Manual (PPM) → FDOT Design Manual (FDM)

- **The PPM was superseded by the FDOT Design Manual (FDM) effective January 2018.** Current edition: **FDM 2026** (Topic No. 625-000-002, dated January 1, 2026).
  - Index: https://www.fdot.gov/roadway/fdm/default.shtm
  - PDF URL pattern: `https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/roadway/fdm/2026/2026fdm{CHAPTER}.pdf`

**TIS-relevant FDM chapter cites (FDM 2026)**:

| Topic | FDM Chapter | URL |
|---|---|---|
| **Context Classification** (C1 Natural through C6 Urban Core, C2T Rural Town — Table 200.4.1) | Ch. 200 §200.4 | https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/roadway/fdm/2026/2026fdm200cntxtbsddsn.pdf |
| **Driveway / connection spacing tables (Tables 201.4.2, 201.4.3)** | Ch. 201 | https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/roadway/fdm/2026/2026fdm201.pdf |
| **Cross-section / lane widths by context class (Table 210.2.1)** | Ch. 210 §210.2 | https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/roadway/fdm/2026/2026fdm210arterialscollectors.pdf |
| **Turn-lane warrants, deceleration / storage / taper lengths, intersection sight distance, median opening design** | Ch. 212 | https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/roadway/fdm/2026/2026fdm212intersections.pdf |
| **Roundabout geometric design** (§213.3; ICE process §213.1.1) | Ch. 213 | https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/roadway/fdm/2026/2026fdm213modroundabout.pdf |
| **Driveway geometry** (§214.1.1: W, R, F, Y, G, Driveway Length, S, I; Categories A–D in 214, E–F–G punt to 212) | Ch. 214 | https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/roadway/fdm/2026/2026fdm214drwys.pdf |
| **Driveway / hydraulic data** | Ch. 250 | https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/roadway/fdm/2026/2026fdm250hydraulicdata.pdf |
| **Typical sections** | Ch. 913 | https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/roadway/fdm/2026/2026fdm913typsect.pdf |

**Context Classification Guide** (companion to FDM Ch. 200): https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/roadway/completestreets/files/fdot-context-classification.pdf

**Off-SHS (local) roads**: FDM 200 explicitly defers to the **Florida Greenbook** ("Manual of Uniform Minimum Standards for Design, Construction and Maintenance for Streets and Highways") — cite Greenbook for non-SHS driveways/turn lanes on city/county facilities.

**FDM 214 cross-references**: FDOT Multimodal Access Management Guidebook (driveway/median guidance); **Rule 14-96 F.A.C.** (permits); **Rule 14-97 F.A.C.** (spacing classes).

### 1.6 District-Level Guidance

**Resolved 2026-06-09**: After auditing each District's planning/permitting pages, the FDOT Systems Management master document list, and the Turnpike Enterprise permits page, **no FDOT district publishes a TIS supplement to MTSIH 2024**. The 2014 TSIH Appendix C (D-2 "Generic TIA Methodology") was dropped in MTSIH 2024 — its content was either folded into the statewide body or delegated to project-specific methodology meetings. District-level practice is administered through pre-application meetings (with District CPC / DIRC / DTOE staff) and methodology letters, not published handbooks.

| District | HQ | TIS Procedure Status |
|---|---|---|
| D-1 | Bartow | No district TIS procedure published. Defers entirely to MTSIH 2024 + statewide Access Management Guidebook 2023. |
| D-2 | Lake City | No district TIS procedure published. TSIH 2014 Appendix C (D-2 Generic TIA Methodology) is **superseded and not preserved** by MTSIH 2024. 25% internal-capture cap previously attributed to D-2 is **not statutory in MTSIH 2024** — defers to ITE Handbook. |
| D-3 | Chipley | No district TIS procedure published. |
| D-4 | Fort Lauderdale | No district TIS procedure published; access-management thresholds (e.g., 25 ft minimum commercial driveway length) administered through AMRC. Broward & Palm Beach county TIS rules dominate (see §1.7). |
| D-5 | DeLand | No district TIS procedure published. |
| D-6 | Miami | No district TIS procedure published. Miami-Dade County guidance dominates (see §1.7). |
| D-7 | Tampa | No district TIS procedure published. Hillsborough mobility fee dominates (see §1.7). |
| Turnpike Enterprise | Statewide | No published TIS template. Turnpike permits page routes applicants through FDOT One-Stop Permitting and case-by-case review with named permit engineers — currently Dan Ekback, P.E. (954-934-1205) and Stephanie Shinabery (407-264-3927). |

District pages: https://www.fdot.gov/agencyresources/districts.shtm
Master systems-management document list (no district supplements): https://www.fdot.gov/planning/systems/systems-management/systems-management-documents

### 1.7 County / MPO TIS Guidance

**MPO note**: All four major MPOs/TPOs (Broward MPO, Palm Beach TPA, MetroPlan Orlando, North Florida TPO) **publish no developer-facing TIS guidance** — each defers to its constituent county. The renderer can ignore MPO-level rules and key off county jurisdiction.

#### Miami-Dade County
Three-instrument concurrency framework (retained after 2011 statewide opt-out):
1. **Comprehensive Development Master Plan (CDMP)** — sets LOS standards, ties concurrency to LRTP.
2. **Administrative Order No. 4-85** — concurrency procedures. https://documents.miamidade.gov/ao-io/AO/AO-04-85.pdf
3. **Chapter 33-G, Code of Miami-Dade County** (Service Concurrency Management Program). https://library.municode.com/fl/miami_-_dade_county/codes/code_of_ordinances
- **Chapter 33E** (Multimodal Mobility Impact Fee) complements (does not replace) Ch. 33-G.
- TPO methodology evaluation (2013): https://miamidadetpo.org/library/studies/evaluation-of-current-methodology-to-determine-traffic-concurrency-final-2013-02.pdf

#### Broward County
- **Transportation Concurrency System Guide** — https://www.broward.org/Planning/FormsPublications/Documents/TransportationConcurrencyGuide.pdf
- **Broward County Trafficways Plan** — https://www.broward.org/PlanningCouncil/Documents/Trafficways.pdf
  - Plan documentation: https://www.broward.org/PlanningCouncil/Documents/TrafficwaysPlan/intro.pdf
  - **Important**: the Trafficways Plan is a **right-of-way preservation plan** (regional roadway network ROW requirements on developing parcels), **not** an LOS-threshold table. LOS standards live in the County Comprehensive Plan Transportation Element and the TCD-specific standards.
- FAQ landing: https://www.broward.org/Planning/Development/FAQs/Pages/TransportationConcurrency.aspx
- **Framework: concurrency, not mobility fee.** 10 Concurrency Districts: 2 (NW/SW) retain link-by-link roadway concurrency; 8 are **Transportation Concurrency Districts** where the assessment is a **$/peak-hour-trip fee** funding TDP transit enhancements, assessed pre-building-permit.
  - **Standard Concurrency District** (NW + SW): roadway improvements are the dominant enhancement form; adequacy determined by link-level v/c against adopted LOS.
  - **Transit Oriented Concurrency District** (8 districts): compact areas with multiple modes; adequacy determined by alternative-mode transit-funding contribution.
- LOS / trip-threshold table: not centrally published; each Concurrency District carries its own adequacy standards. **Renderer must accept LOS standard + fee-per-PHT as runtime config per Broward Concurrency District.**

#### Palm Beach County
- **ULDC Article 12 — Traffic Performance Standards (TPS)** — http://www.pbcgov.com/uldc/pdf/Article12.pdf (HTML index: http://pbcgov.com/uldc/article12.htm)
- Growth-management landing: https://discover.pbcgov.org/engineering/traffic/pages/growth-management.aspx
- **LOS D** for arterials per Table 12.B.2.C (link service volumes / intersection thresholds / speed thresholds).
- **Trip threshold**: ≤20 gross peak-hour trips generally exempt from full TIA; "Test 1 / Test 2" significance methodology determines full TIA.
- **Analysis horizon**: **buildout year + 5 years** (longer than MTSIH default).
- Framework: concurrency. No countywide mobility fee.

#### Hillsborough County (Tampa / D-7)
- **Mobility fee** since 2016 (replaced road-only impact fee). Adopted at 40% of full calculated rates with 5-year phase-in; 80% of full rate as of 2020 study; 100% by ~2022 per Tampa Bay Times. Fee study: https://assets.contentstack.io/v3/assets/blteea73b27b731f985/blt548b55bad22d6a23/Mobility_Fee_Report_5-6-20.pdf
- Methodology: ITE Trip Generation 10th Ed. (2017) blended with the **Florida Trip Characteristics Studies Database** — a **proprietary Tindale Oliver / Stantec corpus**, not an FDOT public asset (see §7.8 for the implementation paths). Vehicle occupancy 1.40 persons from Tampa Bay Regional Planning Model. ITE is on 12th Ed. now; a Hillsborough update study began early 2025.

#### Orange County (Orlando)
- **STAMP (Specific Transportation Analysis Methodology Plan)** — adopted via **Ordinance 2023-11**, effective **2024-02-27**.
- Landing: https://www.orangecountyfl.net/TrafficTransportation.aspx (Plan Review / E-Plan portal; direct STAMP PDF accessed via E-Plan).
- Trip thresholds:
  - **>5 net peak-hour trips → TIA required**
  - **>50 net PM peak-hour trips → operational intersection analysis required**
- **Study area: up to 2.5 miles** from site (broader than MTSIH default).
- Standardized county-specific pass-by reductions by land use.
- Framework: layered on top of existing Orange County concurrency; not a mobility-fee replacement.

#### Duval County / City of Jacksonville
- **Ordinance Code Chapter 655 — Concurrency and Mobility Management System** (Part 5 = Mobility Fee: §§ 655.503, .506, .507): http://jacksonville.elaws.us/code/coor_zose_ch655
- **Land Development Procedures Manual (LDPM), Vol 1, effective 2026-01-30**: https://www.jacksonville.gov/getContentAsset/9c0f2dda-364f-4ddd-8702-123bb096d9f1/135b97c9-84fa-4e82-b956-0fbccec4aa1f/LDPM-Vol1-Eff-2026-01-30-CLEAN-ADA-508.pdf
- CMMSO landing: https://www.jacksonville.gov/departments/planning-and-development/development-services-division/concurrency-and-mobility-management-system-office
- **Framework: mobility fee** (citywide; replaced roadway concurrency). CMMSO established 1991.
- **Required pre-study Traffic Methodology Meeting** with City Traffic Engineer + Chief of Transportation Planning before any TIS is accepted.

#### Summary table — county framework signal for renderer dispatch

| County | Framework | LOS Std | Trip Threshold | Horizon | Notes |
|---|---|---|---|---|---|
| Miami-Dade | Concurrency + 33E mobility fee | Per CDMP | Per Ch. 33-G | Per CDMP | Three-instrument review |
| Broward | District concurrency (10 districts: 2 roadway + 8 TCDs) | Per Comp Plan + per-district | Per Comp Plan | Per Comp Plan | Fee assessed pre-permit |
| Palm Beach | Concurrency | **D** (arterials) | >20 PHT | **Buildout + 5 yr** | LOS triple-table (link/int/speed) |
| Hillsborough | Mobility fee | n/a (fee) | Per LDC | n/a | ITE 10th + FL Trip Char DB |
| Orange | Concurrency + STAMP | Per Comp Plan | **>5 PHT** | Per STAMP | **2.5-mi study area** |
| Duval/Jax | Mobility fee | n/a (fee) | Per LDPM | n/a | Mandatory methodology mtg |

---

## 2. Standard Section Structure

**Confirmed 2026-06-09 from MTSIH 2024 deep-read**: MTSIH 2024 does **not prescribe a fixed TOC/section template** for the deliverable report. What it does prescribe is the **analysis process** (Ch. 4) and a **scoping checklist** in **Appendix A** ("State Highway System Connection Permit Pre-Application Meeting Checklist," pp. A-1 to A-6) that enumerates required content blocks:

- Project Description
- Existing Conditions / Data Collection
- Access Management Spacing
- Project Vehicle Trip Generation
- Project Vehicle Trip Distribution
- Background Motorized Traffic Estimation
- Motorized Traffic Analysis
- Multimodal / Non-motorized Considerations

The MTSIH 2024 Applications Guide case studies (Ch. 3–5) implicitly model a report structure but do not call it normative. **The renderer should therefore default to the consensus practice outline below — derived from the Appendix A checklist + Applications Guide case-study shape + standard Florida agency review practice — and accept overrides per county/district.**

| # | Section | Notes |
|---|---|---|
| 1.0 | Executive Summary | Project description, study area, key findings, mitigation summary. |
| 2.0 | Project Description | Land use, size (units / sq ft / DUs), site plan, surrounding land use, access concept. |
| 3.0 | Methodology | Per MTSIH §4.3 the methodology meeting establishes scope. **Always cite the methodology letter/meeting date with reviewing agency** (FDOT District, county, MPO). |
| 4.0 | Existing Conditions | Roadway network, AADT, existing LOS, turn-lane storage, signal control, transit, ped/bike. |
| 5.0 | Trip Generation | ITE Trip Generation Manual + Handbook (currently 11th Ed., though Hillsborough mobility fee still references 10th). Apply internal capture, pass-by, alt-mode reductions. |
| 6.0 | Trip Distribution and Assignment | Use adopted regional MPO/TPO travel-demand model where available (per TAH §2.7); identify version, base year, horizon year. |
| 7.0 | Future (No-Build) Traffic Analysis | Background growth + committed projects. |
| 8.0 | Future (Build) Traffic Analysis | With-project conditions at opening year and design year. |
| 9.0 | Mitigation Analysis | Geometric, signal, mobility-fee / proportionate-share calculation. |
| 10.0 | Site Access / Ingress-Egress | Driveway spacing per Rule 14-97 access-management class; turn-lane warrants per FDM. |
| 11.0 | Internal Circulation | On-site queuing, internal roadway LOS. |
| 12.0 | Comprehensive Plan / Concurrency Consistency | Required for jurisdictions retaining concurrency; reference CDMP or local comp plan. |
| 13.0 | Conclusions and Recommendations | |
| App. A | Methodology Letter | |
| App. B | Trip Generation Worksheets | |
| App. C | Count Data | |
| App. D | HCS / Synchro / SIDRA Output | |
| App. E | Signal Warrant Analyses | If applicable. |

**Note**: The 1.0–13.0 ordering above is consensus Florida practice — MTSIH 2024 confirms there is no mandatory outline (see Appendix A checklist instead). Confirm with the controlling FDOT District / county during the methodology meeting.

**Real-exemplar evidence (see §9)**: Numbering is NOT uniform across actual Florida deliverables. Miami-Dade large CDMP reports use 1.0–12.0 with three parallel-track end-chapters (Concurrency / CDMP / Zoning). Smaller projects often use unnumbered headings with an Engineer's Certification page as the first section. Palm Beach FLUA amendments collapse to 1.0–6.0. Palm Beach full TPS reports use literal "Test 1 + Test 2" subsection headings. Methodology Letter placement varies (App A canonical vs. App C in Miami-Dade). **Renderer must accept structure variants per jurisdiction.**

For comparison to Georgia DRI structure, see §8.

---

## 3. Methodology Conventions

### 3.1 Traffic Counts and Existing Conditions

- **Roadway-segment count duration:** 72 consecutive hours (Monday afternoon through Friday morning) in **urbanized, transitioning, and urban** areas. **7-day counts** in rural areas. Volumes in **15-minute increments**, typical weekdays, excluding holiday weeks. (Source: TSIH 2014 baseline; MTSIH 2024 does not contradict.)
- **TMC scope (MTSIH 2024 Appendix A, p. A-3):** "AM/PM TMCs — include trucks, pedestrians, and bicycles." TMC duration and bin size are **not prescribed by MTSIH 2024**; agreed at the methodology meeting.
- **TMC duration — reference example only:** Applications Guide Case Study 2 (§3.4.3) uses **8-hour TMCs (3 hr AM + 2 hr midday + 3 hr PM)**, but presents this as a case-study example, not a code-mandated standard. Common Florida practice is 2-hr AM + 2-hr PM with 15-minute bins; confirm with District.
- **Default peak hour (MTSIH 2024 §2.3.1, p. 16):** **Weekday PM Peak Hour of Adjacent Street Traffic, one hour between 4–6 PM**. AM + PM analyses required per Appendix A (p. A-4); midday/Saturday only "where special circumstances require" — **MTSIH 2024 has no blanket Saturday-peak mandate** for retail/restaurant. The Applications Guide fast-food case study analyzes AM + PM + midday instead of Saturday.

### 3.2 Time Horizons (Analysis Years)

Per MTSIH 2024 §4.3 and TSIH 2014 / 2019 §2.2.2, at a minimum analysis horizon years include:

- Existing Year
- Future Background Build Year (without project)
- Future Build Year (with project)
- Future Build Year with Mitigation
- For multi-phase developments: opening year of each phase + final build-out year

**Opening year is canonical** — there is no fixed +5 horizon for DRI / concurrency / driveway-permit work. Years must be explicitly labeled in the report (e.g., "2027 Existing Conditions") and agreed in the methodology meeting.

**Exception:** Local Government Comprehensive Plan Amendment (CPA) analyses require **Existing + short-term (5-year) + long-term (10-year minimum)** horizons per TSIH 2014 Exhibit 5. The renderer should branch on review type.

Per TAH §2.7, the analysis methodology should identify **design year, interim year, and opening year**.

### 3.3 Growth Rate Convention

- Demand projections should use the **adopted regional MPO/TPO travel-demand model (TDM)** with version, base year, and horizon year identified.
- Where TDM is not available or the project is small enough not to warrant model use, **historical AADT trend growth** from FDOT Florida Traffic Online (FTO) is the convention.
- **MTSIH 2024 §4.7.2 (pp. 63–69) requires per-project derivation** from **≥5 years of FTO historical AADT**, fitted with linear / exponential / decaying-exponential via the **FDOT Traffic Trends Analysis Tool** (Excel). No statewide default percentage is published.
- **Worked-example reference**: Applications Guide Case Study 2 (§3.4.4) uses **1% linear AGR** as a worked example — derived from 5-yr FTO history, not a statewide default.
- Practice ranges typically 1.0–3.0% per year by county/corridor; renderer should compute per-project.

### 3.4 LOS Standards

Per **FDOT Procedure 525-000-006** ("Level of Service Standards and Highway Capacity Analysis for the State Highway System"), peak-hour automobile-mode LOS standards on the State Highway System:

| Area Type | SHS LOS Standard |
|---|---|
| Urbanized areas | **D** |
| Outside urbanized areas (rural / transitioning) | **C** |
| Constrained / Backlogged | LOS to be maintained per facility-specific designation |

LOS analysis follows **HCM** methodology via the **FDOT Q/LOS Handbook v6.0 (Aug 2025)**, which provides Generalized Service Volume Tables (GSVTs) for planning-level analysis.

**Context Classification** (replaces "complete streets" terminology per Q/LOS v6.0): Florida uses **FDM Chapter 200 §200.4, Table 200.4.1** (see §1.5) — context classes C1 (Natural), C2 (Rural), **C2T (Rural Town)**, C3R (Suburban Residential), C3C (Suburban Commercial), C4 (Urban General), C5 (Urban Center), C6 (Urban Core). Mode and design treatments are calibrated by context class; cross-section / lane widths per **FDM Table 210.2.1**.

### 3.5 Trip Generation Source

- **ITE Trip Generation Manual + Handbook, latest edition** (currently 11th Ed.) is the FDOT-wide default per MTSIH 2024.
- **Hillsborough County mobility fee** still uses ITE 10th Ed. (2017) blended with **Florida Trip Characteristics Studies Database** (345 studies, 40 land uses, 30 years) — relevant where the renderer outputs a Hillsborough deliverable.
- **Equation vs. rate selection — MTSIH 2024 §4.6.4 (p. 45), explicit decision tree**:

  | Use | When |
  |---|---|
  | **Fitted-curve equation** | Equation provided AND ≥20 data points, OR R² ≥ 0.75 AND fitted curve falls within data cluster AND weighted std dev > 55% of weighted average rate |
  | **Weighted average rate** | ≥3 data points (preferably ≥6), R² < 0.75 or no equation, weighted std dev ≤ 55% of weighted avg, average rate within data cluster |
  | **Collect local data** | ≤2 data points, site doesn't fit ITE LUC definition, std dev > 55%, or independent variable outside data range |

### 3.6 Mixed-Use Reductions

- **Internal capture (MTSIH 2024 §4.6.9, p. 57)**: **NO statewide numeric cap.** Handbook explicitly states "FDOT cannot recommend just one method or one set of internalization factors" and defers to **NCHRP 684 / ITE Trip Generation Handbook**. The previously-cited "25% cap in D-2" came from TSIH 2014 Appendix C and is **not preserved in MTSIH 2024**. Internal capture rate "will need to be discussed and agreed to" at the methodology meeting.
- **New-town / community capture (§4.6.10, p. 59)**: Negotiated, not capped.
- **Pass-by (MTSIH 2024 §4.6.6, pp. 48–55)**: Defers to **ITE Trip Generation Manual 11th Ed.** — illustrative example is ITE LUC 820 (Shopping Center). **No Florida-specific pass-by table.**
- **Pass-by reasonableness check (MTSIH 2024 §4.6.6.6, pp. 50–51)** — **the one FL-specific hard rule**: pass-by trips at a site driveway **cannot exceed 10% of adjacent peak-hour two-way street traffic**, applied per roadway when the site fronts multiple streets. Renderer should compute this check.
- **Alt-mode (transit / walk / bike) reductions:** Permitted where supported by site characteristics and MPO model; quantified at the methodology meeting.

### 3.7 Approved Software

Per FDOT TAH §4.1, common tools used in Florida:

1. Florida's Generalized Service Volume Tables
2. **HCM / Highway Capacity Software (HCS)**
3. **SIDRA INTERSECTION** (roundabouts)
4. **Synchro / SimTraffic**
5. **CORSIM**
6. **Vissim**

**Vistro is NOT listed in the FDOT TAH tool inventory** — a Florida TIS using Vistro should expect agency pushback or extra justification. The renderer should default to HCS or Synchro for capacity analysis output formatting.

District-specific software requirements are no longer published (TSIH 2014's D-2 directive for HCS/Synchro long-form printouts is not preserved in MTSIH 2024); default to providing both HCS long-form and Synchro v/c + queuing output plus electronic files in the technical appendix.

### 3.8 Proportionate Share / Mitigation

**MTSIH 2024 §5.5.1 (pp. 128–129)** does **NOT prescribe a calculation formula**. It restates F.S. 163.3180(5)(h)1.c–4 (the statutory mitigation framework) and enumerates principles:

- Only **deficient** facilities count toward proportionate share
- Dollar-for-dollar credit for impact fees and mobility fees against proportionate-share obligations
- Credit reduced ≤ 20% by project's share of added capacity

The handbook explicitly says it "will only provide general principles and statutory references" — **the actual formula is delegated to the local concurrency ordinance and the FDOT District**. Renderer should compute via local-jurisdiction formula and cite the controlling ordinance.

### 3.9 Driveway Categories and Permit Triggers

**MTSIH 2024 §3.2 Table 5 (p. 21) + Appendix A** define driveway categories that drive TIS scope:

| Category | Trip Volume (vpd, incl. pass-by) | Representative Land Uses |
|---|---|---|
| A | 1–20 | Single-family residence |
| B | 21–600 | Small multifamily, very small commercial |
| C | 601–1,500 | Small/mid retail, small office |
| D | 1,501–4,000 | Mid retail, mid office |
| E | 4,001–15,000 | Large retail, large mixed-use |
| F | 15,001–30,000 | Very large mixed-use, large mall |
| G | 30,001+ | Regional mall, very large generator |

- **Pre-application meeting + traffic study required for Categories C–G** (>600 vpd including pass-by).
- **Permit triggered by change-of-use** when trip generation increases **>25% AND >100 vpd** vs. existing use, per **F.S. 335.182(3)(b)** (MTSIH Appendix A scoping form).
- **Study-area expansion trigger**: 25% single-movement increase (MTSIH §3.4.2 area, p. 29).

**Major Generator note**: MTSIH 2024 does not use the term "Major Generator." The functional equivalent is Driveway Category F/G (>15,000 vpd). The 1990s-era "Major Generator" threshold from earlier TSIH editions is **no longer operative**.

### 3.10 Generalized Service Volume Tables (GSVTs) — Representative Rows

Extracted from Q/LOS Handbook v6.0 (Aug 2025), Appendix B (pp. 79–88). **v6.0 retired "Class I/II" arterial labels** (HCM 5th-ed legacy) and now uses **context classes C1–C6** with C2T = Rural Town. All tables use **D = 0.55 statewide**; K and PHF per context.

**Freeway — Peak-hour two-way service volume (vph) | App. B, Limited Access GSVT**

| Facility / context | LOS B | LOS C | LOS D | LOS E |
|---|---:|---:|---:|---:|
| Urbanized 4-lane freeway | 4,550 | 6,000 | 7,400 | 7,710 |
| Core Urbanized 4-lane freeway | 4,360 | 5,760 | 7,220 | 7,550 |
| Urbanized 6-lane freeway | 6,490 | 8,910 | 11,050 | 11,560 |
| Core Urbanized 6-lane freeway | 6,160 | 8,360 | 10,560 | 11,150 |
| Urbanized 8-lane freeway | 8,580 | 11,820 | 14,710 | 15,440 |
| Core Urbanized 8-lane freeway | 7,890 | 11,020 | 14,000 | 14,850 |
| Rural 4-lane divided (uninterrupted) | 3,650 | 5,040 | 5,950 | 6,640 |

AADT equivalents (Urbanized 4/6/8-lane) at LOS D: 82,200 / 122,800 / 163,400. Rural 4-lane at LOS D: 56,700.

**Arterial (signalized) — Peak-hour two-way service volume (vph) | App. B, C3C/C3R + C2T/C4/C5/C6 GSVTs**

| Context / lanes | LOS C | LOS D | LOS E |
|---|---:|---:|---:|
| C3C (Suburban Commercial), 2-lane undivided | 1,380 | 1,950 | — |
| C4 (Urban General), 2-lane | 1,310 | 1,710 | — |
| C3C, 4-lane divided | 2,760 | 3,290 | — |
| C4, 4-lane divided | 2,070 | 2,980 | — |
| C3R (Suburban Residential), 4-lane divided | 3,090 | 3,360 | — |
| C3C, 6-lane divided | 4,290 | 4,870 | — |
| C4, 6-lane divided | 3,850 | 4,560 | — |
| C2T (Rural Town), 2-lane undivided | 1,310 | 1,710 | — |
| C5 (Urban Center), 4-lane | 2,350 | 3,450 | 3,870 |
| C5, 6-lane | 2,560 | 4,850 | 5,650 |
| C6 (Urban Core), 4-lane | — *(undefined)* | 2,710 | 3,490 |
| C6, 6-lane | — *(undefined)* | 4,960 | 5,350 |

Note: C6 LOS C is **deliberately undefined** in v6.0 — "C6 facilities are neither planned nor designed to achieve auto LOS C." Cells marked "—" past LOS D = F at signal capacity.

**Material adjustment multipliers (every arterial GSVT)**

| Treatment | Multiplier |
|---|---|
| One-way (peak direction) | × 1.2; AADT × 0.6 per directional facility |
| 2-lane divided with exclusive left-turn | × 1.05 |
| Multilane undivided with exclusive LT | × 0.95 |
| Multilane without exclusive LT | × 0.75 |
| 2-lane undivided without exclusive LT | × 0.80 |
| Non-State signalized | × 0.90 |
| Exclusive right-turn lane | × 1.05 |

**K and D defaults (Ch. 6, Tables 2–3, pp. 41–42)**

| Facility / context | K range |
|---|---|
| Freeway — Rural | 8.5–10.5% |
| Freeway — Urban | 7.5–9.5% |
| Freeway — Urban Core | 7.0–9.0% |
| Arterial — C1/C2/C2T | 8.5–10.5% |
| Arterial — C3C/C3R/C4 | 7.5–9.5% |
| Arterial — C5/C6 | 7.0–9.0% |

- **D factor**: GSVT default = 0.55 statewide; minimum acceptable 0.51.
- **PHF defaults**: Freeway Core Urb/Urb 0.95, Transitioning 0.92, Rural 0.88. Arterial C1 0.88, C2/C3R 0.92, C2T/C3C/C4/C5/C6 0.95.

**Pedestrian & Bicycle LTS (App. C)**: Flow-chart-based (no numeric vph threshold).

- **PLTS** decision rule: No continuous sidewalk → LTS 4. Sidewalk + posted ≤25 mph + any separation → LTS 1; no separation → LTS 2. 30–35 mph + vertical separation → LTS 1; without → LTS 2 or 3. ≥40 mph + vertical separation → LTS 2; without → LTS 3 or 4. Sidewalk ≤5 ft → deteriorates by 1 LTS.
- **Bicycle LTS** with facility: separated bike lane / shared-use path → LTS 1. Bike lane at ≥40 mph → LTS 4. <40 mph + AADT ≤7,000 → LTS 1; AADT >7,000 + 35 mph + buffered → LTS 2; unbuffered → LTS 3.

---

## 4. Required Deliverable Elements

[INFERRED — composite of MTSIH 2024 + standard Florida agency review practice]

### 4.1 Required Tables

- Trip Generation Table (ITE land-use code, weekday daily, AM/PM peak hour, internal capture %, pass-by %, alt-mode %, net new external trips)
- Trip Distribution Table (by directional %)
- Intersection LOS Table (Existing / No-Build / Build / Build with Mitigation, AM/PM, by approach + overall)
- Roadway Segment LOS Table (AADT, peak-hour two-way directional, GSVT capacity, v/c, LOS)
- Mobility Fee / Proportionate Share Calculation Table (where applicable)
- Mitigation Summary Table

### 4.2 Required Figures

- Site Location Map
- Site Plan with Access Points
- Existing Lane Geometry and Traffic Control Map
- Trip Distribution Map (directional %)
- Trip Assignment Maps (AM peak, PM peak — Existing, No-Build, Build, Build with Mitigation)
- Proposed Mitigation Geometry

### 4.3 Required Appendices

- Methodology Letter / Meeting Minutes
- Trip Generation Worksheets
- Traffic Count Data
- HCS / Synchro / SIDRA output files
- Signal Warrant Analyses (if applicable)
- Crash Data Analysis (if requested by reviewing agency)

### 4.4 PE Stamp

A Florida TIS must be **signed and sealed by a Florida-licensed Professional Engineer (P.E.)** per **Florida Statutes Chapter 471** and **F.A.C. 61G15-23** (Seals).

**Operative rule — F.A.C. 61G15-23.001 (Signature, Date and Seal Shall Be Affixed)**:

> A professional engineer may only sign, date and seal engineering plans, prints, specifications, reports or other documents if that professional engineer was in responsible charge of the preparation and production of the engineering document and has the expertise in the engineering discipline used in producing the document(s) in question.

- TIS reports fall under "engineering reports or other documents." The rule does not name traffic studies specifically; the general clause covers them.
- **Companion rules**: 61G15-23.002 (seal design — ≥1-7/8" diameter), 61G15-23.003 (physical signing), 61G15-23.004 (digital signing/sealing for electronically transmitted documents).
- **Format**: Seal placed partially overlapping (but not obscuring) the signature; ink-stamp, embossed, or digital image; date adjacent to signature.
- **Government-employed PEs** must additionally indicate name + license number + agency name and address on sealed documents.
- Citation URLs:
  - https://fbpe.org/legal/signing-and-sealing-engineering-documents/
  - https://www.law.cornell.edu/regulations/florida/Fla-Admin-Code-Ann-R-61G15-23-001
  - Full Ch. 61G15 as of 2024-11-27: https://fbpe.org/wp-content/uploads/2024/12/61G15-as-of-11-27-2024.pdf

---

## 5. Florida-Specific Terminology

| Term | Definition |
|---|---|
| **TIA / SIA / TIS / MTIA** | All refer to the same process. Per TSIH 2019 §1.1: "the terms Transportation Impact Analysis and Site Impact Analysis both refer to the process of analyzing the multimodal impacts of development on the transportation system." MTSIH 2024 uses **MTIA** (Multimodal Transportation Impact Assessment). |
| **Concurrency Management System (CMS)** | Local-government regulatory framework requiring transportation capacity be available concurrent with development impacts. **Made optional statewide by HB 7207 (2011)**. Miami-Dade has retained it; many jurisdictions have repealed it or replaced with mobility fees. |
| **Strategic Intermodal System (SIS)** | Florida's high-priority transportation network (Interstates, major airports, ports, rail). Per F.S. 163.3180(5)(h)1.a., local governments **must consult with FDOT whenever a SIS facility is expected to be impacted by a comprehensive plan amendment**. |
| **Major Generator** | **Term not used in MTSIH 2024.** Replaced by **Driveway Category C–G** scoping (see §3.9). Category F (>15,000 vpd) and G (>30,000 vpd) are the functional equivalents of the legacy "Major Generator" classification. |
| **Mobility Plan / Mobility Fee** | Post-2011 alternative to concurrency. Hillsborough adopted 2016 (see §1.7). Allows funding flexibility across modes, not just road capacity. |
| **CRA / CRD review** | Community Redevelopment Area (CRA) — TIF-funded redevelopment districts established under **F.S. 163 Part III**. **CRAs do NOT publish separate TIS procedures**: the CRA is a "body distinct and separate from the governing body which created it," but transportation review continues to flow through the parent municipality's TIS rules — there is no statewide CRA TIS procedure and no pattern of CRA-specific TIS supplements across the major CRAs (Miami CRAs, Downtown Tampa, Downtown Orlando/DDB, Fort Lauderdale, West Palm Beach, Jacksonville DIA). Renderer should ignore CRA boundaries for procedure dispatch and key off the parent municipality. Source: Florida Redevelopment Association, https://redevelopment.net/cra-resources/q-a-for-cras/. |
| **Context Classification** | **FDM Chapter 200 §200.4, Table 200.4.1** / Q/LOS v6.0 classification (C1 Natural, C2 Rural, C2T Rural Town, C3R Suburban Residential, C3C Suburban Commercial, C4 Urban General, C5 Urban Center, C6 Urban Core). Replaced "complete streets" terminology in Aug 2025 Q/LOS update. Cross-section by class in FDM Table 210.2.1. |
| **Generalized Service Volume Tables (GSVTs)** | FDOT-published planning-level capacity tables in Q/LOS Handbook. Updated/reorganized in v6.0 (Aug 2025). |

---

## 6. Thresholds and Review Triggers

### 6.1 DRI (Development of Regional Impact) — Chapter 380 F.S.

**Legislative history (corrected 2026-06-09)**: The 2015 DRI rollback came via **SB 1216 / Ch. 2015-30, Laws of Florida** — not HB 7065/2015, which was an unrelated insurance Assignment-of-Benefits bill. The cleanup was finished by **CS/CS/HB 1151 / Ch. 2018-158** (effective April 9, 2018).

**What the 2015 law actually did**:
- Did NOT repeal Ch. 380. Amended **F.S. 380.06** by adding subsection **(30)**: "*a new proposed development otherwise subject to the review requirements of this section shall be approved by a local government pursuant to s. 163.3184(4) [State Coordinated Review Process] in lieu of proceeding in accordance with this section*."
- DRI track became **non-mandatory**; new projects route through the **State Coordinated Review Process (SCRP)** at F.S. 163.3184(4) instead.
- Transitional election window let pending applicants (concurrent plan-amendment app as of May 14, 2015) opt back into pre-2015 DRI review **until Dec 31, 2018**. That window has closed.

**What the 2018 law did (Ch. 2018-158)**:
- Eliminated substantive NOPC (Notice of Proposed Change) review process and biennial reporting for existing DRIs.
- Directed repeal of Administration Commission DRI-aggregation rules and state-land-planning-agency DRI rules (some 73C-40 rules now show "(Repealed)").
- Removed Regional Planning Councils (RPCs) from review.

**Rule 28-24 F.A.C. (DRI thresholds) — status**: Still on the books but **mostly orphaned for new development**. Treat as historical reference, still cited in existing DRI development orders. Banded structure per Rule 28-24.014:

| Band | Status |
|---|---|
| < 80% of threshold | No DRI review |
| 80–100% | Presumed NOT DRI |
| 100–120% | Presumed DRI |
| > 120% | Mandatory DRI |
| Urban CBD / Regional Activity Center | +50% bonus |

**Historic Rule 28-24 thresholds (100% band)** — for citation in existing-DRI amendments:

| Land Use | Threshold (100% band) | Rule |
|---|---|---|
| Residential | 250–3,000 dwelling units (sliding by county population) | 28-24.021 |
| Retail / service | 400,000 gsf OR 40 acres OR 2,500 parking spaces | 28-24.031 |
| Office | 300,000 gsf OR 30 acres | 28-24.024 |
| Industrial | 320 acres OR 2,500 parking spaces | 28-24.022 |
| Hotel / motel | 350–750 rooms (location-dependent) | 28-24.025 |

**Renderer implication**: A new Florida TIS deliverable is reviewed under **local comp-plan amendment + SCRP + local concurrency / mobility fee + FDOT Rule 14-96 connection permit** — **not DRI**. Renderer should default to non-DRI workflow; DRI mode is a legacy branch only for amendments/abandonments of existing DRIs.

### 6.1.1 State Coordinated Review Process (SCRP) — substitute pathway

Per **F.S. 163.3184(4)** and **F.S. 163.3184(2)(c)**, SCRP is triggered for:
- Areas of critical state concern (s. 380.05)
- Rural land stewardship (s. 163.3248)
- Sector plans (s. 163.3245)
- EAR-based updates (s. 163.3191)
- New-municipality plans (s. 163.3167)
- **Developments subject to SCRP pursuant to s. 380.06** (the 2015 substitute pathway)

Mechanics: transmit ≤10 working days after first hearing; agency comments ≤30 days; state land-planning-agency (Florida Commerce, formerly DEO) report ≤60 days; compliance determination ≤45 days.

### 6.1.2 Sector Plans — F.S. 163.3245

Long-range tool for **≥5,000-acre** areas. Two tiers:
- **Long-term master plan** — adopted in comp plan, SCRP-reviewed via 163.3184(2)(c); requires "general identification of transportation facilities."
- **Detailed Specific Area Plans (DSAPs)** — ≥1,000 acres each, adopted by local development order; requires "detailed identification" of transportation facilities — effectively TIS-grade analysis in practice.

[GAP — unclear in public sources] whether Florida Commerce issues a uniform TIS guideline for DSAPs; practice varies by RPC/MPO.

### 6.1.3 Existing DRIs

- Persist; can be amended.
- **F.S. 380.06(7)** still requires local review of changes with ≥1 public hearing.
- **F.S. 380.06(11)** governs abandonment — developer or local government can initiate; no exaction allowed if no built development; abandonment effective on circuit-court recording.
- Local PUD/zoning processes now do most of the substantive work.

### 6.1.4 F.S. 163.3180 — transportation today

- Transportation concurrency is **optional**; only sewer / solid waste / drainage / potable water are mandatory.
- If a local government keeps concurrency, it must adopt LOS and proportionate-share rules (163.3180(5)(h), (i)) and credit impact fees dollar-for-dollar.
- **F.S. 163.3180(5)(h)1.a. requires local governments to consult FDOT when proposed plan amendments affect SIS facilities.**
- Statute references "traffic analysis" but does not mandate the term "TIS"; TIS is the de facto practice tool satisfying the analysis requirement.

**Statute URLs**:
- F.S. 380.06: https://www.leg.state.fl.us/STATUTES/index.cfm?App_mode=Display_Statute&URL=0300-0399/0380/Sections/0380.06.html
- F.S. 163.3184: https://www.leg.state.fl.us/Statutes/index.cfm?App_mode=Display_Statute&URL=0100-0199/0163/Sections/0163.3184.html
- F.S. 163.3180: https://www.leg.state.fl.us/Statutes/index.cfm?App_mode=Display_Statute&URL=0100-0199/0163/Sections/0163.3180.html
- F.S. 163.3245: https://www.flsenate.gov/laws/statutes/2024/163.3245
- Rule 28-24.014 (banded thresholds): https://www.law.cornell.edu/regulations/florida/Fla-Admin-Code-Ann-R-28-24-014
- Rule 28-24.031 (retail): http://flrules.elaws.us/fac/28-24.031
- CS/CS/HB 1151 (2018) summary: https://www.flsenate.gov/Committees/billsummaries/2018/html/1804

### 6.2 FDOT Permit Triggers

- **State Highway System Connection Permit (Rule 14-96 F.A.C.)** — required for any new driveway/connection to the SHS. **2025 update available.** Permits are categorized by complexity; major connections require TIS.
- **Access Control Classification System (Rule 14-97 F.A.C.)** — sets access-management class (Class 1 through Class 7) for SHS segments; determines driveway spacing, median opening spacing, signal spacing.
- **FDOT Procedure 525-030-155** — Assignment of Access Management Classifications. PDL: https://pdl.fdot.gov/api/procedures/downloadProcedure/525-030-155
- **FDOT Procedure 625-010-021** — Median Opening and Access Management. PDL: https://pdl.fdot.gov/api/procedures/downloadProcedure/625-010-021

### 6.3 Concurrency / Mobility-Fee Triggers (by jurisdiction)

| Jurisdiction | Framework | Threshold |
|---|---|---|
| Miami-Dade | Concurrency (Ch. 33-G) + 33E mobility fee | All concurrency-relevant trips per CDMP |
| Broward | District concurrency (2 roadway + 8 TCDs) | Per Comp Plan + per-District adequacy standards |
| Palm Beach | Concurrency (ULDC Art. 12 TPS) | > 20 gross peak-hour trips → full TIA |
| Hillsborough | Mobility fee | Per LDC |
| Orange | Concurrency + STAMP | **> 5 net peak-hour trips → TIA**; **> 50 net PM PHT → operational analysis** |
| Duval / Jax | Mobility fee | Per LDPM (mandatory methodology meeting) |

### 6.4 District-Specific Triggers

**No FDOT district publishes a separate trip-threshold rule.** Statewide rule (MTSIH 2024 §3.2 / Appendix A) is: **Driveway Category C–G (> 600 vpd including pass-by) triggers pre-application meeting + traffic study**; plus the F.S. 335.182(3)(b) **>25% AND >100 vpd change-of-use** rule for existing permits.

### 6.5 Rule 14-97 Access Management Class — Spacing Tables

Per **Rule 14-97.003 F.A.C.** Spacing values feed §10 Site Access (FDM Ch. 214 driveway geometry + FDM Tables 201.4.2/201.4.3 cross-references all start here).

**Class 1 — Limited Access Facilities (Interstates, Turnpike)** — interchange spacing only; no direct property connections:

| Area Type | Description | Interchange Spacing |
|---|---|---|
| 1 | CBD & CBD Fringe (urbanized cities) | **1 mile** |
| 2 | Existing Urbanized (non-CBD) | **2 miles** |
| 3 | Transitioning Urbanized + Urban | **3 miles** |
| 4 | Rural | **6 miles** |

**Classes 2–7 — Controlled Access Facilities** (distances in feet; "Speed >45" = posted >45 mph):

| Class | Median | Conn. Spacing (>45 / ≤45) | Median Opening — Directional | Median Opening — Full | Signal Spacing | TWLTL | Typical Use |
|---|---|---|---|---|---|---|---|
| **2** | Restrictive (req'd) | 660 / 440 | 1,320 | 2,640 | 2,640 (½ mi) | No | Principal Arterial, undeveloped/long-haul |
| **3** | Restrictive (req'd) | 660 / 440 | 1,320 | 2,640 | 2,640 (½ mi) | No | Principal Arterial, low/probable-change |
| **4** | Non-restrictive | 660 / 440 | N/A | N/A | 2,640 (½ mi) | **Yes** | Principal/Minor Arterial, low/probable-change |
| **5** | Restrictive (req'd) | 440 / 245 | 660 | 2,640 (>45) / 1,320 (≤45) | 2,640 (>45) / 1,320 (≤45) | No | Minor Arterial, extensively developed |
| **6** | Non-restrictive | 440 / 245 | N/A | N/A | 2,640 (>45) / 1,320 (≤45) | **Yes** | Minor Arterial / Collector, extensively developed |
| **7** | Either | 125 | 330 (if restrictive) | 660 (if restrictive) | 1,320 (¼ mi) | **Yes** if non-restrictive | Urban arterial/collector, max-intensity, low-speed |

**Interchange-area override** (Classes 2–7 within ¼ mile of an interchange, per 14-97.003(3)(h)):

| Condition | First Connection | First Full Median Opening |
|---|---|---|
| Class 2, >45 mph | **1,320 ft** | 2,640 ft |
| Other classes, >45 mph | **660 ft** | 2,640 ft |
| Other classes, ≤45 mph | **440 ft** | 2,640 ft |

**Interim standards** (unclassified segments, per 14-97.004(1) — apply until classification assigned):

| Posted Speed | Connection | Full Median Opening | Directional |
|---|---|---|---|
| ≤35 mph | 245 | 1,320 | 660 |
| 36–45 mph | 440 | 1,320 | 660 |
| >45 mph | 660 | 1,320 | 1,320 |

**RCI database codes**: Access Class stored as RCI Feature 146 / ACMANCLS, codes 00–07 plus 99 (unclassified). 99 is **not** a rule class — it's the database placeholder for segments awaiting assignment.

**Classification assignment**: Per FDOT Procedure 525-030-155 and F.S. 335.188 — District Planning determines class from function, posted speed, median type, traffic volume, MPO LRTP designations; notice published in local newspaper; loaded to RCI within 5 working days. Roadside development alone is **not sufficient** to lower a class.

**Rule 14-96 vs. Rule 14-97 — no direct mapping**: Rule 14-97 sets the spacing standards per class; **Rule 14-96 separately categorizes connections as Major (>4,000 vpd or commercial high-volume) vs. Minor** based on trip generation. Permits are reviewed against the spacing standards of whichever Access Class the segment carries.

**Primary sources**:
- Rule 14-97 F.A.C. (FDOT-hosted PDF): https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/planning/systems/systems-management/sm-old-files/am-and-si/1497.pdf
- Rule 14-97.003 (Cornell LII): https://www.law.cornell.edu/regulations/florida/Fla-Admin-Code-r-14-97-003
- **FDOT Multimodal Access Management Guidebook, Oct 2023**: https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/planning/systems/systems-management/document-repository/access-management/fdot-multimodal-access-management-guidebook_oct2023.pdf
- FDOT RCI Handbook Feature 146 (ACMANCLS codes): https://ftp.fdot.gov/public/file/fkhZU2kWkUuOQieyICfgbQ/FDOT_RCI_Handbook_F146.pdf

---

## 7. State-Specific Data Sources

**Hosts**: All FDOT TDA datasets live on two ArcGIS hosts (anonymous/public, no API key, no documented rate limits, standard ArcGIS pagination):
- `gis.fdot.gov/arcgis/rest/services/...` — enterprise server (RCI_Layers master, FTO MapServer, Work Program)
- `services1.arcgis.com/O1JpcwDW8sjYuddV/...` — FDOT-TDA's hosted ArcGIS Online org backing the Open Data Hub TDA datasets

**Canonical join key across all TDA layers**: `ROADWAY` (8-digit RCI roadway ID) + `BEGIN_POST` + `END_POST` (mileposts). Build a single LRS conflation pass and every layer drops in cleanly.

### 7.1 FDOT AADT (current + historical)

| Dataset | Endpoint | Notes |
|---|---|---|
| Current AADT (live polyline segments) | `https://gis.fdot.gov/arcgis/rest/services/RCI_Layers/FeatureServer/0` | Annual; maxRecordCount 1000 |
| Historical AADT TDA | `https://services1.arcgis.com/O1JpcwDW8sjYuddV/arcgis/rest/services/Annual_Average_Daily_Traffic_Historical_TDA/FeatureServer/0` | Multi-year archive |
| Telemetered TMS count stations | `RCI_Layers/FeatureServer/16` | |
| Portable TMS count stations | `RCI_Layers/FeatureServer/9` | |
| FTO MapServer (AADT, Truck, WIM) | `https://gis.fdot.gov/arcgis/rest/services/FTO/fto_PROD/MapServer` | Layer 7 AADT, layer 8 Truck Volume, layer 0 WIM |
| Florida Traffic Online (UI) | https://tdaappsprod.dot.state.fl.us/fto/ | No bulk API |
| Annual Florida Traffic Information bundle | https://www.fdot.gov/statistics/trafficdata/default.shtm | AADT + K/D/T + classification + WIM + historical shapefile — recommended cold-bootstrap |

**Key fields on RCI_Layers/0 (AADT)**: OBJECTID, YEAR_, DISTRICT, COSITE, ROADWAY, DESC_FRM, DESC_TO, AADT, AADTFLG, KFLG, K100FLG, DFLG, TFLG, COUNTYDOT, COUNTY, MNG_DIST, BEGIN_POST, END_POST, KFCTR, K100FCTR, DFCTR, TFCTR.

### 7.2 FDOT Functional Classification

- Primary: `https://gis.fdot.gov/arcgis/rest/services/RCI_Layers/FeatureServer/3`
- Open Data Hub mirror: `https://services1.arcgis.com/O1JpcwDW8sjYuddV/arcgis/rest/services/Functional_Classification_TDA/FeatureServer/0`
- Key fields: `FUNCLASS` (codes 01–19, urban/rural arterial/collector/local — RCI Feature 121), ROADWAY, BEGIN_POST, END_POST, DISTRICT
- Annual updates.

### 7.3 Roadway Characteristics Inventory (lanes, surface, median, posted speed)

**No single public REST layer aggregates RCI lane / median / posted-speed attributes.** RCI_Layers exposes only ~17 derived event layers; the full attribute set (RCI Features 121, 211, 215, 220) is **[GAP — not in public ArcGIS Hub]**.

**Workaround — canonical bulk source**: FDOT publishes annual statewide RCI shapefiles + the full RCI flat file on the TDA FTP:
- `https://ftp.fdot.gov/file/d/FTP/FDOT/co/planning/transtat/gis/shapefiles/` (login: Guest)
- RCI Office page: https://www.fdot.gov/statistics/rci/
- Statewide ZIP; weekly-updated; UTM 17N / NAD83.
- This is the canonical bulk source. **Plan the RCI FTP bulk-shapefile loader before the engine ships FL** — otherwise lane counts will fall back to OSM inference.

Some derived attributes also live in **FLARIS**:
- `https://gis.fdot.gov/arcgis/rest/services/sso/ssogis_flaris/FeatureServer` — segment-level AADT, AADT_YEAR, AADT_SOURCE; ARBM Streets layers.

### 7.4 State Highway System / SIS

- **State Highway System (On-System TDA)**: `https://services1.arcgis.com/O1JpcwDW8sjYuddV/arcgis/rest/services/On_System_TDA/FeatureServer/0` (RCI Feature 140, characteristic STATEXPT)
- Adjacent layers in same org: `Off_System_TDA`, `State_Roads` (`RCI_Layers/FeatureServer/15`), `Interstates` (`RCI_Layers/FeatureServer/7`)
- **Strategic Intermodal System (SIS)**: Hub item `d5fe7fa1c66e47ae9bd05a25fe902603` → `https://services1.arcgis.com/O1JpcwDW8sjYuddV/arcgis/rest/services/Strategic_Intermodal_System_Facilities_SIS/FeatureServer` (multi-layer: highways, rail, ports, airports, terminals, spaceports)
- SIS shapefiles also at: https://www.fdot.gov/planning/systems/sis/maps

### 7.5 Context Classification (C1–C6, C2T) + Access Management

- **Preliminary Context Classification TDA**: `https://services1.arcgis.com/O1JpcwDW8sjYuddV/arcgis/rest/services/Preliminary_Context_Classification_TDA/FeatureServer/0` — RCI Feature 126, fields CCTXTCLS, FCTXTCLS, CCTXTDTE, FCTXTDTE
  - Note: only "Preliminary" statewide layer is publicly published; adopted context classes per district are scattered.
- **Access Management TDA (Rule 14-97)**: `https://services1.arcgis.com/O1JpcwDW8sjYuddV/arcgis/rest/services/Access_Management_TDA/FeatureServer/0` — RCI Feature 146, characteristic ACMANCLS (codes 01–07, 99)
- **Access Control Type TDA**: `https://services1.arcgis.com/O1JpcwDW8sjYuddV/arcgis/rest/services/Access_Control_Type_TDA/FeatureServer/0`

### 7.6 FDOT Historical Growth Data

- **MTSIH 2024 §4.7.2** mandates per-project derivation from ≥5 yrs FTO AADT via the FDOT Traffic Trends Analysis Tool (Excel) — no statewide AGR table is published. (Florida Traffic Online provides the multi-year AADT history per count station for input.)

### 7.7 FDOT Five-Year Work Program (= GA TIP/STIP equivalent)

- **FDOT Work Program** (Five-Year Work Program / Adopted Work Program): https://www.fdot.gov/workprogram
- Work Program Interactive Map / Work Program Online: https://fdotewp1.dot.state.fl.us/FiveYearWorkProgram/
- **REST endpoints**:
  - Current: `https://gis.fdot.gov/arcgis/rest/services/Work_Program_Current/FeatureServer` (21 layers by phase — Construction, PD&E, Planning, ROW, Maintenance, Item Segments, etc.)
  - 10-year horizon: `https://gis.fdot.gov/arcgis/rest/services/Work_Program_current_10years/FeatureServer`
  - Tentative Tbl15: `WorkProgram_Tbl15/FeatureServer` and `WorkProgram_Tbl15_Dissolved/FeatureServer`
- Spatial ref: EPSG:3087 (Florida GDL Albers, meters). maxRecordCount 20,000. JSON only. Refreshed nightly.
- Used to identify "committed projects" for the No-Build network in TIS.

### 7.8 Florida Trip Characteristics Studies Database

**Critical correction — NOT an FDOT public asset.** The "Florida Trip Characteristics Studies Database" (also called "Florida Studies Database") is a **proprietary corpus maintained by Tindale Oliver & Associates (now part of Stantec, Tampa)** — not FDOT, not CUTR/USF, not MPOAC. There is **no public URL, no API, no annual download, no companion handbook**.

**Verbatim description** (Hillsborough 2020 Mobility Fee Study, p. A-7): "The Florida Studies Trip Characteristics Database includes approximately 345 studies on 40 different residential and non-residential land uses collected over the last 30 years. Of these, 285 studies for approximately 30 land uses are included in Hillsborough County's fee schedule."

**Schema per study row** (as it appears in Hillsborough Appendix A):
- Location (county), Size (units / KSF), Date
- Total interviews / trip-length interviews
- Daily trip generation rate (per unit)
- Time period (e.g., 9a–5p)
- Trip length (mi)
- Percent new trips
- VMT
- Source (Tindale Oliver, or specific county DOT)

Note: **no pass-by % or internal-capture columns** in FL Studies rows — those come from ITE / NCHRP 684. **No vehicle occupancy** in the schema (it's a separate input from the regional TDM — 1.40 for Hillsborough per Tampa Bay Regional Planning Model).

**Renderer implementation paths** (in increasing fidelity):
1. **ITE-only fallback**: Use ITE Trip Generation 11th Ed. as the base layer. Sufficient for non-Hillsborough deliverables.
2. **Hand-extract Appendix A** from published Tindale Oliver fee studies (Hillsborough 2020, Collier 2019, Orange 2020, Pasco, Hernando, Seminole) into a project-controlled CSV. Coverage is ~30 LUCs that recur across reports. **This is the practical option for the Hillsborough branch.**
3. **License from Stantec/Tindale Oliver** — typical for jurisdictions adopting a Florida-blended fee. Not feasible for a SaaS renderer.

**What FDOT actually publishes (don't confuse with the Tindale corpus)**:
- **FDOT 2011 "Trip Generation Characteristics of Emerging Land Uses"** (Wilbur Smith, 54 sites, 4 LUCs — LU 813, 862, distribution centers, small box). https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/planning/systems/systems-management/sm-old-files/am-and-si/si/tripgenerationreport02082011mainreport.pdf
- **FDOT 2014 "Trip Generation Recommendations Report"** (Kimley-Horn) — methodology only.
- **FDOT Coffee Shop / Fast Food w/ Drive-Through study** + QTool v1.0.
- **NCHRP 684 internal capture tool** (Excel, hosted by FDOT) — for §3.6 internal-capture calc.

**Defunct**: `tripgeneration.org` (older Sokolow/Hicks/Stafford-attributed site) — returns 404 as of 2026-06; do not link.

**Sample data sources for hand-extraction**:
- [Hillsborough Mobility Fee 2020 (Tindale Oliver) — Appendix A](https://assets.contentstack.io/v3/assets/blteea73b27b731f985/blt548b55bad22d6a23/Mobility_Fee_Report_5-6-20.pdf)
- [Collier Road Impact Fee 2019 (Tindale Oliver)](https://www.collier.gov/files/assets/county/v/1/impact-fees/new-folder/0collier-road-if-study_final_10-14-2019.pdf)
- [Orange Transportation Impact Fee 2020 (Tindale Oliver)](https://www.orangecountyfl.net/Portals/0/Library/Traffic-Transportation/docs/OrangeCountyTIF_FINAL_9-11-2020.pdf)
- [CUTR Verification of Trip Generation and Internalization (Fabregas, Lin)](https://digitalcommons.usf.edu/cutr_facpub/44/)

---

## 8. Comparison to Georgia DRI

| Dimension | Georgia DRI | Florida TIS / MTIA |
|---|---|---|
| Controlling document | GRTA / DCA DRI Procedures; GDOT TIS requirements | FDOT MTSIH 2024 + Q/LOS Handbook v6.0 |
| Process name | DRI (Development of Regional Impact) | Variously TIA / SIA / TIS / MTIA (interchangeable) |
| Statewide review program | Active GA DRI program with threshold table | DRI program curtailed by **SB 1216 / Ch. 2015-30** + **HB 1151 / Ch. 2018-158**; SCRP at F.S. 163.3184(4) is the substitute pathway. Rule 28-24 thresholds orphaned for new development. |
| Concurrency | Not used | Historically mandatory; **made optional by 2011 HB 7207** |
| LOS standard (state highways) | LOS D urban / LOS C rural (typical) | Identical: LOS D urbanized / LOS C non-urbanized (Procedure 525-000-006) |
| LOS methodology | HCM via Synchro / HCS | HCM via HCS / Synchro / SIDRA / CORSIM / Vissim (TAH §4.1). **Vistro not in FDOT inventory.** |
| Section structure | 1.0–13.0 fixed (Project / Methodology / Study Network / Trip Gen / Distribution / Existing-No-Build-Build / Programmed Projects / Ingress-Egress / Internal Circ / Comp Plan / DRI-specific) | No mandatory outline in MTSIH 2024; consensus practice follows similar 1.0–13.0 sequence with Methodology Letter as App A |
| Time horizons | Existing + opening + design year (often +5 / +10) | Existing + Future Background + Future Build + Build with Mitigation; **opening year canonical** (no fixed +5); +5 / +10 only for CPA analyses |
| Trip generation source | ITE latest edition | ITE latest edition; Hillsborough uses ITE 10th + Florida Trip Characteristics Database |
| Internal capture cap | Per ITE Handbook | **No statewide cap** in MTSIH 2024 §4.6.9; negotiated at methodology meeting per NCHRP 684 / ITE Handbook |
| Pass-by | Per ITE Handbook | Per ITE Handbook; **only FL-specific rule: 10% of adjacent-street peak-hour two-way traffic reasonableness check** (MTSIH §4.6.6.6) |
| Mobility fees | Not used | Used in Hillsborough (since 2016), Miami-Dade Chapter 33E, others |
| Access management | GDOT Driveway Manual | Rule 14-96 (Connection Permits, 2025 update) + Rule 14-97 (Access Class) |
| Design manual | GDOT Design Policy Manual | **FDM (Florida Design Manual)** — replaced PPM in 2018 |
| Capital program | GDOT TIP / STIP | **FDOT Five-Year Work Program** |
| Travel demand forecasting | ARC / regional models | **Per TAH §2.7**: adopted MPO/TPO TDM; PTFH + Procedure 525-030-120 |
| PE stamp | Required (GA P.E.) | Required (FL P.E. per F.S. Ch. 471 + F.A.C. 61G15-23.001) |
| Multimodal emphasis | Limited (auto-LOS focus) | **Strong** — MTIA = Multimodal Transportation Impact Assessment; Q/LOS includes PLTS |
| Context classification | Not formal | **FDM Ch. 200 §200.4 context classes C1–C6, C2T** — drives mode/design treatments |
| Comp plan consistency | Yes | Yes; SIS-impact consultation with FDOT required by F.S. 163.3180(5)(h)1.a. |

---

## 9. Real Florida TIS Exemplars (for renderer cross-check)

Four verified, publicly-posted, PE-sealed Florida TIS deliverables — useful for cross-checking the canonical 1.0–13.0 section structure in §2 against what reviewers actually accept. **No public Rule 14-96 FDOT Connection Permit, Orange County STAMP, Hillsborough mobility-fee, or Jacksonville LDPM applicant TIS surfaced in the search** — those review portals appear auth-gated or do not publish applicant submittals.

### 9.1 American Dream Miami & Graham (Miami-Dade CDMP Apps 5 & 6)

- URL: https://www.miamidade.gov/planning/library/reports/planning-documents/cdmp/applicant-transportation-analysis-applications-5-and-6.pdf
- Prepared by Leftwich Consulting Engineers (Orlando), Oct 2016. 192 pp / 15 MB. Synchro w/ HCM 2010. ITE 7th & 9th Ed. + Handbook 2nd & 3rd.
- Horizons: Existing 2015 / Background 2020 & 2040 / Total 2020 & 2040.
- **Closest match to the canonical 1.0–13.0** — **heavyweight Miami-Dade CDMP review**:
  - 1. Overview of CDMP and Supporting Traffic Analyses
  - 2. Description of Proposed Sites
  - 3. Coordination with Review Agencies
  - 4. Analysis Years
  - 5. Study Area
  - 6. Existing Conditions (6.1 Count Sources / 6.2 Link PHPs / 6.3 Link LOS / 6.4 Intersection TMVs / 6.5 Intersection LOS)
  - 7. Trip Generation (by-site sub-sections)
  - 8. Background Conditions (parallel structure to §6 for each horizon year)
  - 9. Project Trip Distribution
  - 10. Project Assignment
  - 11. Bridge Analyses (project-specific)
  - 12. Transit Accommodations
  - Then **three separate parallel chapters** numbered 1.0–3.0 each: Concurrency Analysis / CDMP Analysis / Zoning Analysis
- **Distinctive Miami-Dade convention**: the three-track parallel chapters (Concurrency / CDMP / Zoning) at the end is unique to Miami-Dade CDMP reviews. Renderer should emit these as separate tracks when jurisdiction = Miami-Dade.

### 9.2 Bleau Green Charter School (Miami-Dade CDMP App 7)

- URL: https://www.miamidade.gov/planning/library/reports/planning-documents/2014-11-application-7-transportation-analysis.pdf
- Prepared by Richard Garcia & Associates (FL COA #9592), sealed by Richard Garcia P.E. #54886, Dec 2014 (revised Mar 2015). 103 pp / 15 MB. Synchro 8 + HCM. ITE 9th Ed.
- Horizons: Existing 2014 / Short-term 2017 / Long-term 2030.
- **Unnumbered section headings** (Engineer's Certification → Executive Summary → Introduction → Existing Condition → Project Traffic → Future Condition with Project Traffic → Conclusion → Appendices A–E). Methodology folded into prose; no separate "Study Area" section.
- **Engineer's Certification as the first page** (before Executive Summary) is a notable Miami-Dade convention worth replicating.

### 9.3 Century Park South (Miami-Dade CDMP App 2)

- URL: https://www.miamidade.gov/planning/library/reports/planning-documents/traffic-impact-analysis-app-no.%202.pdf
- Prepared by Langan, May 2017. 41 pp / 2.4 MB. ITE 9th Ed.
- Horizons: Existing 2017 / Build-out 2020.
- Lightweight unnumbered structure (Exec Summary → Intro → Existing Conditions → Future Conditions → Conclusions → Appendices A–F).
- **Methodology Letter as App. C** — Miami-Dade-specific placement; renderer should put the Methodology Letter as App C, not App A, for Miami-Dade deliverables.

### 9.4 Winner's Church FLUA Amendment (Palm Beach County, ULDC Art. 12)

- URL: https://discover.pbc.gov/pzb/planning/PDF/Amendments/Winners-Traffic.pdf
- Prepared by JFO Group; sealed by Dr. Juan F. Ortega P.E., May 2022. 52 pp / 8.4 MB. ITE 11th Ed.
- Horizons: Test 2 Five-Year (2027) / Long-Range (2045) — confirms PBC **buildout + 5 + long-range (2045)** triple-horizon convention from §1.7.
- **6-section thin TIA** (Project Description / Current FLU / Proposed FLU / Traffic Impact / Traffic Analysis with 5.1 Test 2 + 5.2 Long Range / Conclusion + Exhibits 1–7).
- **Distinctive PBC convention**: This is the **FLUA amendment** lite variant — substantially thinner than a full driveway/site-plan TIS. Renderer needs a separate Palm Beach FLUA branch.
- **Companion file (sister project, same template)**: Colony Estates / Coconut Lane, Feb 2022, 46 pp — https://discover.pbc.gov/pzb/planning/PDF/Amendments/ColonyEstates-Traffic.pdf
- **Full-fat PBC Art. 12 TPS reference** (only verified one located, older but structurally complete): Highland Dunes PUD, Pinder Troutman Consulting, Feb 2013 — https://discover.pbc.gov/pzb/zoning/AdminNewsReleases/HD-9-TS-Text-Exhibits.pdf — 30 pp, unnumbered (Exec Summary / Intro / Site Data / Project Traffic / Future Traffic Conditions / **TPS Analysis (Test 1 + Test 2)** / Project Phasing / Conclusions), proportionate-share payments structured as phased $9.8M.

### 9.5 What the exemplars teach about the renderer

1. **Section numbering is NOT uniform**. Miami-Dade large-CDMP reports use 1.0–12.0 + parallel-track sub-chapters. Smaller projects use unnumbered headings. Palm Beach FLUA amendments use 1.0–6.0 only. Renderer must accept a section-structure variant per jurisdiction.
2. **Methodology Letter placement varies**: App A (canonical) vs. App C (Miami-Dade observed) vs. inline (some PBC).
3. **Engineer's Certification before Exec Summary** is common Miami-Dade practice — renderer should output a "Certification" page as Section 0 / front-matter for Miami-Dade.
4. **Three-track parallel chapters** (Concurrency / CDMP / Zoning) are a Miami-Dade-specific convention; emit only when jurisdiction = Miami-Dade.
5. **PBC FLUA amendments are deliberately thin** — 6 sections, no separate trip-distribution or proportionate-share sections (those come later in the full TPS at site-plan stage).
6. **PBC full TPS uses "Test 1 + Test 2"** as named subsections — renderer should emit those literally when jurisdiction = Palm Beach + review type = Art. 12 TPS.

---

## Renderer Implementation Notes

1. **Default to MTSIH 2024** as the controlling reference; do not cite TSIH 2014 / 2019 as primary — cite as historical context only.
2. **Branch on review type**: DRI (legacy only), Comp Plan Amendment (CPA — long-horizon), Local Concurrency (where retained), FDOT Connection Permit (Rule 14-96), County/MPO mobility-fee, **Palm Beach FLUA amendment (thin 6-section variant)**, **Palm Beach full ULDC Art. 12 TPS (Test 1 + Test 2 subsections)**, **Miami-Dade CDMP (three-track parallel chapters)**. Different time-horizon and section requirements apply.
3. **Accept controlling agency as input**: FDOT District (D-1 through D-7 + Turnpike), county, MPO. No district has explicit numeric overrides under MTSIH 2024 — county/MPO rules drive the differences (see §1.7 summary table).
4. **Accept context class as input** (C1 / C2 / C2T / C3R / C3C / C4 / C5 / C6) to drive LOS-standard wording, GSVT row selection (§3.10), and mode mix. **Do NOT use HCM "Class I/II" labels** — Q/LOS v6.0 retired them.
5. **Default software cite**: HCS or Synchro; **never default to Vistro** for Florida deliverables.
6. **PE seal block** required on cover and signature page per F.A.C. 61G15-23.001. For Miami-Dade, emit "Engineer's Certification" as a front-matter page before Executive Summary.
7. **Year labels must be explicit** (e.g., "2027 Existing Conditions", not "Existing Conditions").
8. **Cite Procedure 525-000-006** for SHS LOS standard, **Procedure 525-030-120** for demand forecasting, **Rules 14-96 / 14-97** for access management.
9. **Trip Generation source**: ITE 11th Ed. default; **Hillsborough branch** requires hand-extracted Florida Trip Characteristics rows from §7.8 path 2 — do NOT attempt to fetch a non-existent FDOT database endpoint.
10. **Methodology Letter placement**: App A canonical; **App C for Miami-Dade**; flag jurisdiction-specific variant at render time.
11. **GSVT row selection**: Pick from §3.10 by context class + lane count + facility type (freeway vs. arterial). For C6 LOS C: emit "not applicable per Q/LOS v6.0 — C6 facilities are not planned or designed to achieve auto LOS C."
12. **Pass-by 10% reasonableness check**: Always compute and emit per MTSIH §4.6.6.6, regardless of jurisdiction.

---

## Resolved / Outstanding

### Resolved (2026-06-09 — gap-coverage pass)

- ✅ MTSIH 2024 does **not preserve** District 2's 25% internal-capture cap; no statewide numeric cap (§4.6.9). Renderer should not default to 25%.
- ✅ Broward, Palm Beach, Orange, Duval county TIS procedures pulled — see §1.7 county-by-county block + summary table.
- ✅ "Major Generator" term retired in MTSIH 2024; replaced by Driveway Categories A–G (§3.9). Category C trigger = 600 vpd.
- ✅ Equation-vs-rate selection rule located: MTSIH 2024 §4.6.4 (full decision tree in §3.5 above).
- ✅ TMC duration: MTSIH 2024 does not mandate; Applications Guide case study uses 8-hr (3+2+3); methodology-meeting delegated.
- ✅ DRI / Ch. 380 post-2015 resolved: SB 1216/2015 + HB 1151/2018; SCRP substitute pathway; Rule 28-24 thresholds tabulated as historical reference (§6.1).
- ✅ FDOT GIS Open Data REST endpoints catalogued for AADT, FC, SHS, SIS, Work Program, Context Class, Access Mgmt (§7).
- ✅ FDM 2026 chapter cites mapped for Context Class (Ch. 200), spacing (Ch. 201), cross-section (Ch. 210), intersections + turn lanes + ISD (Ch. 212), roundabouts (Ch. 213), driveways (Ch. 214), hydraulics (Ch. 250), typical sections (Ch. 913). See §1.5.
- ✅ Default peak hour resolved: MTSIH §2.3.1 — Weekday PM Peak of Adjacent Street, 4–6 PM.
- ✅ Growth rate convention: MTSIH §4.7.2 — per-project from ≥5 yrs FTO via FDOT Traffic Trends Analysis Tool; no statewide default.
- ✅ Pass-by reasonableness: MTSIH §4.6.6.6 — 10% of adjacent peak-hour two-way street traffic, per roadway.
- ✅ Proportionate share: MTSIH §5.5.1 — statutory principles only, no formula; local-ordinance computation.

### Resolved (final pass)

- ✅ Broward Trafficways Plan correctly identified as **right-of-way preservation**, not an LOS table. LOS standards live in the County Comprehensive Plan + per-Concurrency-District standards. Confirmed 10-district structure (2 roadway + 8 TCDs).
- ✅ Florida CRAs (F.S. 163 Part III) **do not publish separate TIS procedures** — transportation review flows through the parent municipality. Renderer should not key off CRA boundaries.
- ✅ FBPE PE-stamp citation upgraded from [INFERRED] to confirmed text of F.A.C. 61G15-23.001 + companion rules.

### Resolved (expansion pass — GSVTs, Rule 14-97, Tindale corpus, exemplars)

- ✅ Q/LOS v6.0 GSVT representative rows extracted (freeway + arterial + multipliers + K/D/PHF defaults + PLTS/Bicycle LTS flow rules) — see §3.10. **Q/LOS v6.0 retired "Class I/II" arterial labels**; renderer must map to context classes C1–C6.
- ✅ Rule 14-97 spacing tables extracted for Classes 1–7 + interim standards + interchange-area override + RCI code mapping (ACMANCLS 00–07, 99) — see §6.5. FDOT Multimodal Access Management Guidebook Oct 2023 confirmed as current.
- ✅ **Major correction**: Florida Trip Characteristics Studies Database is **NOT FDOT-maintained** — it's a proprietary Tindale Oliver / Stantec corpus. See §7.8 for the three implementation paths. Renderer cannot ingest directly; hand-extract from published Tindale Oliver fee studies (Hillsborough, Collier, Orange).
- ✅ Four real Florida TIS exemplars located (American Dream Miami, Bleau Green, Century Park South, Winner's Church + Highland Dunes companion) — see §9. **Section numbering is NOT uniform**; renderer must accept per-jurisdiction structure variants (Miami-Dade three-track, Palm Beach FLUA-thin vs full-TPS, etc.).

### Outstanding (genuine gaps — verified absent from public sources)

- **Broward per-Concurrency-District LOS table**: Not centrally published. Each Concurrency District carries its own adequacy standards (per the County Comprehensive Plan Transportation Element). Renderer must accept Broward LOS + fee-per-PHT as runtime config per district.
- **RCI full-attribute REST layer (lanes, posted speed, median, surface)**: Not exposed on public ArcGIS Hub. Use the FDOT FTP bulk shapefile loader (`https://ftp.fdot.gov/...`, Guest login) for the canonical ingest. Plan this loader before shipping FL or fall back to OSM inference.
- **Adopted Context Classification (vs. Preliminary)**: Only the Preliminary TDA layer is statewide; adopted classes are scattered per-District (D-5 maintains its own).
- **DSAP TIS guideline**: Florida Commerce does not appear to publish a uniform TIS guideline for Detailed Specific Area Plans under F.S. 163.3245; practice varies by RPC/MPO.
- **Turnpike Enterprise**: No public TIS template — case-by-case with named permit engineers (Ekback, Shinabery — see §1.6).
