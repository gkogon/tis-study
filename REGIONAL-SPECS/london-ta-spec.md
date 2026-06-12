# London Transport Assessment — Renderer Build-Spec

**Status:** Research spec, no code. Drives implementation of a UK Transport Assessment renderer to replace the US-conventions output the engine currently emits for London projects.

**Scope:** London (Greater London — 32 boroughs + City of London). Most of this generalises to the rest of England; Scotland/Wales/NI have separate statutory regimes and are out of scope for the first cut.

**Dispatch entry point:** `artifacts/tis-api-server/src/lib/pdf-export.ts` — `renderTisStudy()` already region-dispatches on `region.country / region.stateCode` (Georgia precedent at line 517 / line 331). London adds a `region.country === "GB"` branch routing to a new `renderTransportAssessmentLondon()`.

**Authored:** 2026-06-09. Author should re-verify all `gov.uk`/`legislation.gov.uk`/`tfl.gov.uk` URLs before locking — UK gov pages move frequently.

---

## 0. Headline corrections to the original brief

Research surfaced three concrete corrections to the original task brief that the spec resolves before going further:

1. **DfT 2007 "Guidance on Transport Assessment" was formally withdrawn in October 2014.** It is no longer authoritative. The current statutory hook is the NPPF; the operational guidance is the gov.uk Planning Practice Guidance ("Travel plans, transport assessments and statements"). The 2007 document is still cited in practice for its threshold tables and chapter structure, but the spec must not present it as live policy.
2. **"CONNECT" is not a current TfL strategic model.** TfL's strategic model suite is **MoTiON** (demand), **Railplan** (PT assignment), **LoHAM** + the five sub-regional Highway Assignment Models (**CLoHAM/NoLHAM/SoLHAM/WeLHAM/ELHAM**), **Cynemon** (cycling), **LonLUTI** (land-use/transport), and **ONE** (operational). The spec uses the correct names throughout.
3. **NPPF current edition is December 2024.** The TA/TS paragraph is now **para 118** ("vision-led transport statement or transport assessment"), and the sustainable-modes obligation is at **para 115**. The Dec 2024 edition introduced the "vision-led" framing, which the renderer should adopt verbatim.

A fourth thing worth flagging: **SI 2026/345 (in force 11 May 2026)** added a new PSI **Category 3J — 50+ homes notification trigger** to the Mayor of London Order. Any London TA renderer used after May 2026 needs to treat 50 dwellings as a referral notification trigger in addition to the 150-dwelling Cat 1A trigger.

---

## 1. Authoritative sources

Primary sources only. Edition/year + URL verified 2026-06-09 unless noted.

### Statutory framework

| # | Document | Publisher | Edition | URL | Role |
|---|---|---|---|---|---|
| 1.1 | **National Planning Policy Framework (NPPF)** | MHCLG | December 2024 | https://www.gov.uk/government/publications/national-planning-policy-framework--2 (Ch 9 landing: https://www.gov.uk/guidance/national-planning-policy-framework/9-promoting-sustainable-transport) | Statutory planning policy. Para 115 = "sustainable modes taken up"; para 118 = "vision-led TA/TS"; para 116 = significant-movement trigger. |
| 1.2 | **Planning Practice Guidance — Travel plans, transport assessments and statements** | MHCLG | Published 6 March 2014; **still unrevised in 2026** despite the Dec-2024 NPPF refresh (PPG refresh promised but not delivered as of June 2026 — UK Planning Law Blog Jan 2025) | https://www.gov.uk/guidance/travel-plans-transport-assessments-and-statements | The effective operational replacement for DfT 2007. Reference IDs: 42-004 (TS vs TA), 42-007 (scope), 42-009/013 (significance, travel plans). PPG sets no numerical thresholds and contains no London-specific content — TfL fills the gap by hosting DfT 2007 Appendix B (see 1.8 / 7.0). |
| 1.3 | **Town and Country Planning Act 1990, s.106** | Parliament | As amended | https://www.legislation.gov.uk/ukpga/1990/8/section/106 | Planning-obligation statute. |
| 1.4 | **Highways Act 1980, s.278** | Parliament | As amended | https://www.legislation.gov.uk/ukpga/1980/66/section/278 | Highway-works agreement statute. |
| 1.5 | **Town and Country Planning (Mayor of London) Order 2008** | UK SI | SI 2008/580 + SI 2011/2057 + SI 2026/345 (in force 11 May 2026) | https://www.legislation.gov.uk/uksi/2008/580/contents · https://www.legislation.gov.uk/uksi/2026/345/contents/made | Defines "potential strategic importance" (PSI) referral categories. |
| 1.6 | **Traffic Signs Regulations and General Directions 2016 (TSRGD 2016)** | UK SI | SI 2016/362 | https://www.legislation.gov.uk/uksi/2016/362/contents | UK statutory equivalent of US MUTCD. |
| 1.7 | **GLA Roads Designation Order 2000** | UK SI | SI 2000/1117 | https://www.legislation.gov.uk/uksi/2000/1117/schedule/made | Defined the GLA Roads (TLRN) under TfL's highway-authority powers. |

### National guidance (DfT / National Highways)

| # | Document | Publisher | Edition | URL | Role |
|---|---|---|---|---|---|
| 1.8 | **DfT *Guidance on Transport Assessment*** | DfT + DCLG | March 2007 — **WITHDRAWN October 2014** | Archive only (no live gov.uk landing). Mirror: https://www.nottinghamshire.gov.uk/media/3657603/appendixcdftguidanceontransportassessments.pdf | Historical structural template. Industry still references its chapter 4 sub-headings and Appendix B threshold table; renderer must not cite it as live policy. |
| 1.9 | **Manual for Streets (MfS)** | DfT (TSO) | March 2007 | https://www.gov.uk/government/publications/manual-for-streets | Residential & lightly-trafficked street design — geometry, visibility, place/movement balance. |
| 1.10 | **Manual for Streets 2 (MfS2)** | CIHT (DfT-endorsed) | September 2010 | https://www.ciht.org.uk/knowledge-resource-centre/resources/manual-for-streets-2-mfs2/ | Extends MfS to busier non-trunk roads. MfS3 commissioned 2020, still unpublished as of June 2026. |
| 1.11 | **Design Manual for Roads and Bridges (DMRB)** | National Highways | Live — modern CD/CG/CS/CM/GG structure, 2020+ | https://www.standardsforhighways.co.uk/ | Trunk-road / SRN design. Key TA-touching standards: **CD 116** (roundabouts, v2.1.0 May 2023), **CD 123** (priority + signal junctions, v2.1.0 Nov 2021), **CD 122** (grade-separated), **CD 109** (link design), **GG 119** (road safety audit). |
| 1.12 | **Transport Analysis Guidance (TAG)** — formerly WebTAG | DfT | Live; data book v2.02 (Dec 2025), v2.03FC update Dec 2025; TAG units last updated 28 May 2026 | https://www.gov.uk/guidance/transport-analysis-guidance-tag · Data book https://www.gov.uk/government/publications/tag-data-book | Economic appraisal + modelling standards. TAG Unit A2.3 (Dependent Development) is the most TA-relevant. |
| 1.13 | **DfT Circular 02/2013 — *The Strategic Road Network and the Delivery of Sustainable Development*** | DfT | September 2013 | https://www.gov.uk/government/publications/strategic-road-network-and-the-delivery-of-sustainable-development | National Highways' role as statutory consultee on planning. |

### London (TfL / GLA)

| # | Document | Publisher | Edition | URL | Role |
|---|---|---|---|---|---|
| 1.14 | **The London Plan** | Mayor of London / GLA | March 2021 (current; replacement plan consulted 2025, adoption expected 2027) | https://www.london.gov.uk/programmes-strategies/planning/london-plan · Ch 10: https://www.london.gov.uk/programmes-strategies/planning/london-plan/the-london-plan-2021-online/chapter-10-transport | Spatial Development Strategy. Transport policies T1–T9 with sub-policies T6.1–T6.5 for car parking. |
| 1.15 | **Mayor's Transport Strategy** | Mayor of London | March 2018 | https://www.london.gov.uk/programmes-strategies/transport/our-vision-transport/mayors-transport-strategy-2018 | Underpins T1 (80% mode share by foot/cycle/PT by 2041) and Vision Zero. |
| 1.16 | **TfL Transport Assessment Guide** | TfL | Live suite (no single document) | https://tfl.gov.uk/info-for/urban-planning-and-construction/transport-assessment-guide/transport-assessments (note: the shorter `/transport-assessment-guidance` slug 404s) | Index page for TfL TA expectations. Includes Healthy Streets TA format, ATZ assessment, thresholds PDF. |
| 1.17 | **TfL *Healthy Streets TA Recommended Contents & Chapters*** | TfL | Last updated 17 June 2019 | https://content.tfl.gov.uk/healthy-streets-ta-format.pdf | The 8-chapter TA TOC TfL expects for London referable applications. **This is the operational TOC for the renderer.** |
| 1.18 | **TfL *Healthy Streets for London*** | TfL / Mayor of London | February 2017 | https://content.tfl.gov.uk/healthy-streets-for-london.pdf · landing https://tfl.gov.uk/corporate/about-tfl/how-we-work/planning-for-the-future/healthy-streets | 10 Healthy Streets Indicators framework. |
| 1.19 | **TfL *Traffic Modelling Guidelines* v4** | TfL | September 2021 | https://content.tfl.gov.uk/traffic-modelling-guidelines.pdf | TfL's modelling standards (when LinSig vs TRANSYT vs VISSIM, MAP audit). |
| 1.20 | **TfL Healthy Streets Check for Designers (XLSX)** | TfL | Live | https://tfl.gov.uk/cdn/static/cms/documents/healthy-streets-check-for-designers.xlsx · indicators guide https://content.tfl.gov.uk/guide-to-the-healthy-streets-indicators.pdf | 31-metric workbook required as a TA appendix for London schemes. |
| 1.21 | **TfL strategic models index** | TfL | Live | https://tfl.gov.uk/corporate/publications-and-reports/strategic-transport-and-land-use-models | MoTiON, Railplan, LoHAM (+ sub-regional HAMs), Cynemon, LonLUTI, ONE. |
| 1.22 | **WebCAT** (Planning with WebCAT) | TfL | WebCAT 3.0 (referenced 2025) | https://tfl.gov.uk/info-for/urban-planning-and-construction/planning-applications/planning-with-webcat | Tool for PTAL lookup, travel-time isochrones, Active Travel Zone (ATZ) catchment. |

### Professional-body guidance

| # | Document | Publisher | Edition | URL | Role |
|---|---|---|---|---|---|
| 1.23 | **CIHT *Buses in Urban Developments*** | CIHT | January 2018 | https://www.ciht.org.uk/media/4459/buses_ua_tp_full_version_v5.pdf | Bus access design for new developments. |
| 1.24 | **CIHT *Planning for Walking*** | CIHT | April 2015 | https://www.ciht.org.uk/media/4465/planning_for_walking_-_long_-_april_2015.pdf | Walking-environment assessment framework. |
| 1.25 | **CIHT *Planning for Cycling*** | CIHT | 2014 | https://www.ciht.org.uk/media/4461/ciht_-_planning_for_cycling_proof_v2_singles.pdf | Cycle-infrastructure planning. |
| 1.26 | **CIHT *Designing for Walking / Designing for Cycling*** | CIHT | 2015 / 2014 | https://www.ciht.org.uk/knowledge-resource-centre/resources/streets-and-transport-in-the-urban-environment/ | Companions to the Planning-for guides. |

### Data + software

| # | Document | Publisher | Edition | URL | Role |
|---|---|---|---|---|---|
| 1.27 | **TRICS** | TRICS Consortium Ltd | **TRICS 8** (major redesign — **base release March 2025** per Coles, *Tapas Network*, Oct 2024; Time Series Analysis Module added Sept 2025; quarterly updates resumed). 1 Jan 2026 fee schedule revision only — methodology was not republished alongside the fee change. Live methodology authorities are the **TRICS Good Practice Guide 2025** (dated Dec 2024, supersedes 2024 edition), the **TRICS Multi-Modal Methodology 2025** (dated Dec 2024), and the **TRICS Decide & Provide Guidance Note** (2021) for vision-led applications. Subsidiary methodology stream: the **Standardised Assessment Methodology (SAM)** — TRICS-managed multi-modal surveys used for post-permission travel-plan monitoring under S106. | https://trics.org/ · GPG: https://trics.org/wp-content/uploads/2024/12/TRICS-Good-Practice-Guide-2025.pdf · Multi-Modal: https://trics.org/wp-content/uploads/2024/12/TRICS-Multi-Modal-Methodology-2025.pdf · 1 Jan 2026 fees: https://trics.org/2025/10/02/revised-trics-licence-and-bureau-service-fees-from-1st-january-2026/ · Vision-Led TRICS, Coles, Oct 2024: https://tapas.network/67/coles.php · 19 May 2026 licence-monitoring + MFA + IPR: https://trics.org/2026/05/19/trics-licence-monitoring-multi-factor-authentication-the-protection-of-intellectual-property-rights/ | Subscription multi-modal trip-rate database. UK industry standard; ITE not accepted. TRICS-8 generation shipped two process changes that affect the methodology disclosure plus three reporting-discipline elements the renderer surfaces — see §3.1. Material 2026 development: TRICS now actively enforces licence compliance and will contact LPAs to flag TRICS data used by unlicensed organisations as void — the renderer's TA must be prepared by a TRICS-licensed organisation and the methodology disclosure must surface the TRICS licence number + Calculation Reference. |
| 1.28 | **Junctions 11** (incl. ARCADY/PICADY/OSCADY modules) | TRL Software | Junctions 11; J10 launched Feb 2021 | https://trlsoftware.com/software/junctions-signal-design/junctions/ | Roundabout + priority + simple-signal capacity. RFC, MMQ (PCUs), delay outputs. |
| 1.29 | **LinSig 3** | JCT Consultancy | v3.x | https://www.jctconsultancy.co.uk/Software/LinSigV3/linsigv3.php | Signalised junctions + small networks. DOS, PRC, queue. |
| 1.30 | **TRANSYT 16** (TRANSYT 17 announced March 2026) | TRL Software | v16 | https://trlsoftware.com/software/junctions-signal-design/transyt/ | Signal coordination / corridor optimisation. |
| 1.31 | **PTV VISSIM** | PTV Group | Live | https://www.ptvgroup.com/en/products/ptv-vissim | Microsimulation. |

(For data-source URLs see §7.)

---

## 2. Standard section structure

A UK Transport Assessment is a different document from a US TIS. The renderer's TOC follows **TfL's *Healthy Streets TA Recommended Contents & Chapters* (1.17)**, which is the operational standard for London referable applications. Where TfL is silent it falls back to the structural template still widely used from DfT 2007 §4 (1.8).

### 2.1 TOC the renderer emits for London

```
Cover page
Executive Summary                                       ← industry convention; not DfT-mandated

Ch 1  Introduction
        1.1  Purpose & planning context
        1.2  Scoping note + agreed methodology
        1.3  Policy context (NPPF Ch 9; London Plan T1–T9; MTS; Healthy Streets)
        1.4  Vision-led approach (NPPF para 115/118 framing)

Ch 2  Transport planning for people
        2.1  Site demographics
        2.2  Transport Classification of Londoners (ToL) segments
        2.3  Equality & inclusion considerations

Ch 3  Site and surroundings
        3.1  Existing transport network
              - Walking & cycling (CID, OS data)
              - Public transport (TfL Unified API): bus, tube, Overground, DLR, Elizabeth line, rail
              - Highway network (TLRN / SRN / borough)
        3.2  PTAL (cell-level from TfL grid; WebCAT lookup)
        3.3  Access strategy
        3.4  Public realm against 10 Healthy Streets Indicators
        3.5  Servicing & deliveries
        3.6  Cycle parking (London Plan T5 / Table 10.2)
        3.7  Car parking (London Plan T6 — Tables 10.3 / 10.4 / 10.5 PTAL-banded maxima for T6.1 residential / T6.2 office / T6.3 retail; T6.4 hotel & leisure narrative; Table 10.6 disabled persons under T6.5)
        3.8  Stage 1 Road Safety Audit (where TLRN works proposed)
        3.9  Healthy Streets Check for Designers (existing-state)

Ch 4  Active Travel Zone (ATZ)
        4.1  20-minute cycle catchment from WebCAT
        4.2  Walking catchment isochrones
        4.3  Severance / desire-line analysis

Ch 5  London-wide network
        5.1  Trip generation (TRICS multi-modal, 85th-percentile)
              - Person-trips by mode (car / motorcycle / LGV / HGV / taxi / walk / cycle / bus / rail)
              - Linked PT trips (interchange behaviour)
              - Pass-by + internalisation where supported
        5.2  Trip distribution & assignment
        5.3  Assessment years & analysis periods
              - Base year, opening year, design year (DfT 2007 §4.45–4.56)
              - AM peak (08:00–09:00), PM peak (17:00–18:00), Sat peak where relevant
        5.4  Modelling (when required)
              - LinSig / TRANSYT / Junctions 11 / VISSIM
              - TfL strategic models (LoHAM / Railplan / MoTiON / Cynemon)
              - TfL Model Auditing Process (MAP v4) where strategic
        5.5  Design solutions / mitigation
              - S106 planning obligations
              - S278 highway works (boroughs / TfL TLRN / NH SRN)
              - MCIL2 contribution check

Ch 6  Additional borough analysis
        6.1  Borough Local Plan policies
        6.2  Borough SPDs (parking, cycle parking, travel plan, S106 SPD)
        6.3  Local cumulative-impact assessment

Ch 7  Construction
        7.1  Construction Logistics Plan (CLP) summary
        7.2  Construction traffic impacts

Ch 8  Conclusion
        8.1  Summary impacts/solutions table
        8.2  Confirmation of TA scope satisfied

Appendices
        A. Scoping note + agreed methodology (signed by TfL/borough)
        B. TRICS output reports
        C. PTAL calculation sheet (WebCAT export)
        D. Junction modelling results (LinSig/TRANSYT/Junctions 11 .lsg/.lsi files)
        E. Healthy Streets Check workbook
        F. Stage 1 RSA report
        G. Travel Plan (full)
        H. CLP / DSP outline
        I. Drawings package (access, swept-paths, visibility splays)
```

For a **Transport Statement** (lighter form — see §6 thresholds), the renderer drops chapters 4, 5.3, 5.4, 6 (collapses into 3), 7. The TS is effectively chapters 3 + the trip-generation half of chapter 5 + a short conclusion.

### 2.2 What the renderer is *not* responsible for

- TRICS extracts, junction modelling files (.lsg/.lsi/.t10), VISSIM models, CLP detail, Stage 1 RSA → these are appendices the consultant uploads. The renderer slots them in but does not synthesise them.
- The signed scoping note → uploaded.
- Drawings → uploaded.

---

## 3. Methodology conventions

### 3.1 TRICS (1.27)

- **Replaces ITE entirely.** ITE is not accepted by UK reviewers. (No multi-modal data; US-suburban bias.)
- 125 land-use sub-categories (per TRICS v7.11.3, Sept 2024; GPG §4.1) and >9,500 survey days. ~36% of sites carry multi-modal counts.
- **85th-percentile rate is the conventional UK starting point** for TA work — citation lineage is DfT 2007 *Guidance on Transport Assessment* §4.62, which was formally withdrawn October 2014 but remains the de-facto reference. Important qualification per the **TRICS Good Practice Guide 2025 §14.5** (verified 2026-06-12): TRICS itself is methodologically neutral on which percentile to use — "there are varying opinions and policies when it comes to the applicability of 15th and 85th percentile trip rates, and TRICS merely provides the facility to use this feature at the discretion of our users". TRICS surfaces the 15th/85th figures whenever ≥6 surveys are present and recommends ≥20 surveys before they are quoted in reports (GPG §14.6–14.7). Renderer reports mean + 85th, calls out the survey count, and frames the 85th-percentile as DfT-2007-lineage convention rather than a TRICS-mandated default.
- Multi-modal output (per **TRICS Multi-Modal Methodology 2025** and GPG §19 / Figure 31):
  - Outside London: Cars, Taxis, Motor Cycles, LGVs, **OGVs** (note: TRICS uses OGV — "Other Goods Vehicle" — not HGV), PSVs (buses), Cyclists, **Scooters** (added 2021), Pedestrians, Vehicle Occupants, plus public-transport aggregates (Public Transport Users, Bus/Tram Passengers, Total Rail Passengers, Coach Passengers).
  - Greater London additionally splits PT into Bus Passengers, Tram Passengers, Underground Passengers, Overground Passengers, National Rail Passengers, DLR Passengers, and Water Service Passengers — the London renderer must surface the per-mode split, not the aggregate.
- Subscription-only — renderer accepts TRICS rate set as user input (CSV or scoped-and-locked TRICS rank/filter parameters), does not query TRICS directly. Recording the TRICS scenario filter in the methodology section is non-negotiable for reviewer audit; the filter the renderer should record (revised against TRICS-8 / GPG §5.5–5.7) is **date band, TRICS Main Location Type, day type, parking provision, GFA range, and any survey-day exclusions** — *not* "region". Per GPG §5.5–5.7, regional exclusion was demoted in TRICS 8: "regional selection should not be a major consideration when applying trip rate calculation filtering criteria, whilst TRICS location type appears to be one of the most influential factors" — and TRICS 8 enforces this by no longer allowing surveys to be excluded from the trip rate calculation on the basis of Region or Area alone.
- **TRICS-8 changes the renderer's methodology disclosure needs to reflect** (verified 2026-06-12):
  1. **Default 8-year survey-date cut-off removed** (GPG §10.5). In TRICS 7 the trip-rate filter pre-loaded a minimum date of "1 January, 8 years prior to release year" (e.g. 2016-01-01 for v7.11.3). TRICS 8 removed this default in tandem with the Time Series Analysis Module (Sept 2025); users still set min/max dates manually. Practical consequence: COVID-restriction surveys (March 2020 onward) are no longer auto-trimmed by the default lower bound, so the renderer must record the explicit date band actually selected.
  2. **COVID-restriction surveys are flagged, not excluded.** Per GPG §16.6, TRICS has flagged COVID-period surveys since 2021 (blue/green highlight in site lists; yes/no indicator on the Location Details screen; advisory text in the trip-rate calculation output) but does not recommend a default exclusion: "TRICS cannot provide guidance on whether sites undertaken during restrictions should be included or excluded in sets of data for trip generation. Therefore, TRICS users are encouraged to apply their own professional judgement in terms of site inclusion, and in cases of site exclusion should always provide their own reasons within their reports." No surveys exist during full UK lockdowns (March 2020+ peak). Renderer must surface (a) whether COVID-flagged sites are included or excluded in the user's selected set and (b) the user's stated reason if excluded.
- **Connectivity Scoring data (announced 1 May 2026, https://trics.org/2026/05/01/trics-to-introduce-connectivity-scoring-data/)**: not a methodology change. New DfT Connectivity Tool data fields being retrofitted to ~380 transport surveys through 2026 to "enhance the TRICS trip rate filtering process". Trip-rate calculation, percentile basis and multi-modal split are unchanged. No renderer action required until the field becomes filter-eligible — re-verify at the 23 June 2026 TRICS Training & Development Forum and at the 24 Nov 2026 TRICS User Meeting.
- **Three reporting-discipline elements the renderer must surface in any TRICS-citing methodology disclosure** (verified 2026-06-12 from the GPG and the 19 May 2026 licence-monitoring notice):
  1. **TRICS PDF outputs carry a Calculation Reference code** (e.g. `AUDIT-700101-241112-1132`) at the top of page 1 and the **TRICS licence number + licensee organisation name** on the page header of every page (GPG §13.8 + §22.7). The renderer's TA methodology section must include these so the data trail is auditable end-to-end. Reports lacking either field are inadmissible per TRICS T&Cs.
  2. **Cross Test** (mean vs median variation, GPG §14.8) — TRICS includes a one-click Cross Test that reports the percentage variation between mean trip rates (from the calculation results table) and median trip rates (from the rank-order list). TRICS recommends Cross Test results be included alongside trip-rate results in every report. A variation > ~30% should trigger review of the inclusion criteria. Note: Cross Test is not applicable when the rank-order list is computed by the "Site-by-Site Peak Hour" method (GPG §14.11) — renderer should record which rank-order method was used.
  3. **Vision-Led factoring distinction** (GPG §10.7 + §13.2 + §23.6): users running a vision-led TA may apply post-calculation factoring to TRICS trip-generation results (e.g. to reflect modal shift targets per Decide & Provide), but the report must (a) present the raw TRICS data first, (b) present the factored data second, with the factoring method and reasoning explicit, and (c) make clear that the factored figures are no longer TRICS data. Manual deselection of individual surveys to influence results is explicitly not legitimate (GPG §13 + §16.4 — "TRICS does not generally recommend the manual removal of individual sites from selected data sets" and any manually removed surveys are listed in the PDF output with the reason given).
- **SAM (Standardised Assessment Methodology) — separate stream for travel-plan monitoring** (GPG §23, Multi-Modal Methodology §2.2): SAM is the TRICS-managed multi-modal survey methodology used to monitor the effect of travel plans, introduced in 2005. SAM surveys are otherwise known as **Level 3 surveys** (standard multi-modal = Level 2; vehicle-only = Level 1). London boroughs routinely require SAM surveys via S106 planning agreements — typically at years 1, 3 and 5 of the operational life — so the travel plan target ladder can be measured against actual trip activity. The TRICS **Travel Plan Monitoring Report (TPMR)** module (introduced Dec 2012; substantially refreshed 2023) is the recommended deliverable for SAM-site reporting. The renderer's Travel Plan chapter should (a) reference SAM as the preferred monitoring methodology for any S106-secured travel plan and (b) note that SAM surveys must be commissioned through TRICS-approved data collection contractors or self-managed under the Multi-Modal Methodology with TRICS validation. SAM-eligible land-use sub-categories include Employment and Residential; SAM-only optional counts include Journey Purpose and Origin & Destination (Multi-Modal §4.16). SAM commission windows are Spring (March-June) and Autumn (Sept-Nov) with annual cut-off dates published at www.trics.org (GPG §24.6).
- **19 May 2026 licence-monitoring + MFA notice (https://trics.org/2026/05/19/trics-licence-monitoring-multi-factor-authentication-the-protection-of-intellectual-property-rights/)** — material to TA reliability and the renderer's audit trail:
  - TRICS has implemented automated monitoring to identify TRICS data being used by unlicensed organisations. **"If illegitimate TRICS data appears in documents submitted to Local Authorities, TRICS will contact the Local Authority to advise that the data is to be rejected as void"** — i.e. a London TA submitted with TRICS data not produced by a licensed organisation is exposed to having TfL or the borough flatly reject the trip-generation evidence base.
  - **Multi-Factor Authentication will become mandatory for all TRICS users**, with implementation date "in due course". The renderer should not assert a deadline until TRICS announces one.
  - **Data sharing**: TRICS data may not be passed to a third-party organisation for them to re-use. Renderer should make this explicit in the methodology disclosure so a downstream consultant cannot inadvertently breach by lifting TRICS rates from an earlier study.
  - Renderer-level consequence: the TA's methodology section must name the TRICS-licensed organisation, the TRICS licence number, and the Calculation Reference, and must state that the TRICS rates were produced by that licensed organisation (not lifted from an earlier report).

### 3.2 PTAL (Public Transport Accessibility Level)

- TfL's accessibility metric on a **100 m × 100 m grid** covering Greater London.
- Scale: **0, 1a, 1b, 2, 3, 4, 5, 6a, 6b** (worst → best). Note the "a/b" subdivision at 1 and 6.
- Inputs:
  - **SAP** = Service Access Point — bus stops within **640 m (8 min walk)** and rail/tube/Overground/DLR/Elizabeth/tram/river-bus stations within **960 m (12 min walk)**, both at the standard assumed walking speed of **80 m/min** (= 4.8 km/h). Walk-speed and distance/time constants re-verified 2026-06-12 against three independent secondary mirrors of the TfL methodology (Wikipedia "Public transport accessibility level"; the Podaris methodology summary; and Advanced Infrastructure's PTAL dataset page) which all agree. The primary PDF URL cited earlier in this spec — `s3-eu-west-1.amazonaws.com/londondatastore-upload/PTAL-methodology.pdf` — now returns 301 then AccessDenied on the live S3 bucket; the dataset-page methodology link (7.3) is the canonical pointer to re-verify on next refresh.
  - **EDF** = Equivalent Doorstep Frequency — AM-peak service frequency window **08:15–09:15**, adjusted for walk time and reliability.
  - **AI** = Accessibility Index — sum of weighted EDFs across all SAPs. The TfL banding (full nine-band table; the spec's previous "AI 0–5 → PTAL 1, ≥40 → PTAL 6b" collapsed the 1a/1b sub-bands and omitted bands 0, 2, 3, 4, 5, 6a):

    | PTAL band | AI lower | AI upper |
    |---|---|---|
    | 0  | 0     | 0 (no SAP in range) |
    | 1a | 0.01  | 2.50  |
    | 1b | 2.51  | 5.00  |
    | 2  | 5.01  | 10.00 |
    | 3  | 10.01 | 15.00 |
    | 4  | 15.01 | 20.00 |
    | 5  | 20.01 | 25.00 |
    | 6a | 25.01 | 40.00 |
    | 6b | > 40.00 | — |

- **Required in every London TA.** Drives the PTAL-banded car-parking maxima under **London Plan policy T6** sub-policies. **Caveat on the "car-free starting point" framing:** Policy T6 Part B (verified verbatim against the London Plan 2021 PDF mirrored at `bromley.gov.uk/downloads/file/3642/cd6-10-the-developmental-plan-london-plan-t6-car-parking`) reads — *"Car-free development should be the starting point for all development proposals in places that are (or are planned to be) well-connected by public transport, with developments elsewhere designed to provide the minimum necessary parking ('car-lite')"* — the policy text itself does **not** name a hard PTAL band cut-off. The "PTAL 5/6a/6b → car-free" formulation in earlier drafts of this spec (and a wide swathe of practitioner sources) is a shorthand inferred from the T6.1–T6.5 PTAL-banded maxima tables, where higher PTAL bands cap general parking at zero. The only explicit numeric PTAL hook in the policy text is **Part K**, which restricts Outer London boroughs adopting *minimum* residential parking standards to **PTAL 0–1** parts of London (Inner London boroughs may not adopt minimum standards at all). The renderer must reproduce the policy's "well-connected by public transport" wording rather than asserting a hard PTAL 5/6a/6b cut-off as if it were policy text.
- Data sources for the renderer: TfL grid (1.22 / 7.3) — display the site's PTAL band + AI value.

### 3.3 Active Travel Zone (ATZ)

- The 20-minute cycle catchment from the site, generated via **WebCAT**.
- Required in TfL Healthy Streets TA chapter 4.
- Used to demonstrate sustainable-mode opportunities consistent with NPPF para 115.

### 3.4 Junction capacity analysis

Software stack, mapped to junction type:

| Junction type | Tool | Vendor | Output metrics |
|---|---|---|---|
| Roundabout | **ARCADY** (now Junctions 11 module) | TRL | RFC, MMQ (PCUs), delay (s/veh) |
| Priority / give-way | **PICADY** (Junctions 11 module) | TRL | RFC, MMQ, delay |
| Isolated signal (simple) | **OSCADY** (Junctions 11 module) | TRL | DOS, queue, delay |
| Signalised junction / small signalised network | **LinSig 3** | JCT Consultancy | DOS, PRC, queue, total delay |
| Signal corridor / signal coordination | **TRANSYT 16** (17 announced Mar 2026) | TRL | DOS, PRC, network delay |
| Complex network / microsimulation | **VISSIM** | PTV | Journey time, queue, delay |

**Reporting conventions — what the renderer outputs:**

- **RFC (Ratio of Flow to Capacity)** — roundabouts + priority. Threshold of concern **≥ 0.85**.
- **DOS (Degree of Saturation, %)** — signals. Threshold of concern **≥ 90%**.
- **PRC (Practical Reserve Capacity, %)** — signals. Desirable **≥ 5%**; negative = capacity exceeded.
- **MMQ (Mean Maximum Queue, in PCUs)** — note **PCU not vehicles**, and **not feet**.
- **Delay** — seconds per vehicle.

**Do not emit LOS A–F.** That is a HCM convention; UK reviewers reject it.

### 3.5 TfL strategic models — when referenced

For schemes affecting the TLRN materially or generating major PT-flows, the TA references TfL's strategic suite (1.21). The renderer does not run these; it cites them. Names:

- **MoTiON** — Model of Travel in London (demand).
- **Railplan** — PT assignment.
- **LoHAM** + **CLoHAM (Central)**, **NoLHAM**, **SoLHAM**, **ELHAM**, **WeLHAM** — SATURN-based highway assignment, sub-regional cuts.
- **Cynemon** — cycling.
- **LonLUTI** — land-use / transport interaction.
- **ONE** — Operational Network Evaluator.

(The original task brief named "CONNECT" — that is not a current TfL model. The closest valid analogue for strategic London reference is **LoHAM** for highway and **Railplan** for PT.)

TfL's modelling expectations are codified in TfL **Traffic Modelling Guidelines v4 (Sept 2021)** (1.19), and any TfL-submitted model goes through the **Model Auditing Process (MAP) v4** (up to 28 days per stage).

### 3.6 Multi-modal split — the structural difference vs US TIS

UK TAs explicitly assess **walking, cycling, bus, rail, car, taxi, motorcycle, LGV, HGV** — every mode. The "car-only" framing of the current US engine is non-compliant out of the box.

The structural lever is **NPPF 2024 para 115**:

> Decisions on planning applications must "ensure that … appropriate opportunities to promote sustainable transport modes can be – or have been – taken up, given the type of development and its location".

A TA that does not demonstrate sustainable-mode uptake before discussing highway capacity will be rejected.

### 3.7 Travel Plan

- **Required alongside TA/TS** for any "significant amount of movement" development (NPPF 2024 para 118).
- DfT 2007 §4.80–4.84 + DfT 2005 *Good Practice Guidelines: Delivering Travel Plans through the Planning Process* are the structural templates.
- Required contents:
  - Baseline modal split (site survey or TRICS-derived).
  - Modal-shift **targets** with time-bound milestones (typically 5-year).
  - Action measures (cycle parking, season-ticket loans, car-club membership, EV charging, bus-stop upgrades).
  - Monitoring — annual travel survey.
  - **Travel Plan Coordinator (TPC)** — named, funded role.
  - Funding mechanism (typically S106-secured).
  - Remedial-measure ladder if targets missed.
- The renderer **emits a Travel Plan template chapter** but does not synthesise contents from rates — TPC, action measures, and remedial ladder are bespoke.

### 3.8 S106 vs S278 vs CIL/MCIL2

| Mechanism | Statute | Used for |
|---|---|---|
| **Section 106** | Town and Country Planning Act 1990 s.106 | Planning obligation — affordable housing, transport contributions, travel plan funding, monitoring fees. |
| **Section 278** | Highways Act 1980 s.278 | Physical works on the existing public highway (junction signalisation, right-turn lanes, footways, bus stops). Counterpart is **Section 38** for adoption of new estate roads. |
| **CIL (Community Infrastructure Levy)** | Planning Act 2008 + CIL Regs 2010 | Borough-charged tariff per sqm. Increasingly displaces S106 for generic infrastructure. |
| **MCIL2 (Mayoral CIL)** | London-wide | Funds Crossrail / Elizabeth line and Bakerloo extension. Charging schedule per zone. |

The London Healthy Streets TA chapter 5 explicitly calls out MCIL2 — renderer surfaces it for the conclusion table.

---

## 4. Required deliverable elements

### 4.1 Figures (the renderer should auto-generate where data permits)

1. **Site location plan** — OS Open Roads or Open Zoomstack basemap, site polygon, study area buffer.
2. **PTAL context map** — site point + 100 m grid PTAL coloured layer (TfL grid 7.3).
3. **Walking catchment** — 5/10/15-minute isochrones from WebCAT or built-in network walk.
4. **Cycling catchment / ATZ** — 20-minute cycle isochrone (WebCAT).
5. **Public transport network plan** — bus stops, rail/tube/Overground/DLR/Elizabeth line stations (TfL Unified API 7.2).
6. **Cycle infrastructure plan** — CID layers within 1 km (lanes, parking, ASLs, signals).
7. **Existing highway network classification** — TLRN red routes, SRN, borough A/B-classified, local distributor.
8. **Existing baseline traffic** — DfT count-point AADF labelled on link geometry.
9. **Modelled junction layouts** — uploaded from LinSig/Junctions 11 outputs.
10. **Trip distribution arrows / flows** — auto-generated from assignment.
11. **Proposed access plan** — uploaded.
12. **Swept-path drawings** — uploaded.
13. **Visibility splays** — uploaded.
14. **Healthy Streets Check before/after radar chart** — from the XLSX (1.20).

### 4.2 Tables (renderer auto-generates)

- TRICS rank summary (filter parameters + rate set chosen).
- Multi-modal trip-generation matrix (mode × period × in/out × raw/net).
- Person-trip mode-share comparison: existing area vs. proposed.
- Assessment-year scenario table (Base / Opening / Design × AM peak / PM peak / Saturday peak).
- Junction-capacity results table (per junction × scenario × RFC or DOS / MMQ / Delay / PRC).
- Cycle-parking provision vs. London Plan T5 Table 10.2.
- Car-parking provision vs. London Plan T6 sub-policies — Tables 10.3 (T6.1 residential), 10.4 (T6.2 office), 10.5 (T6.3 retail) banded by PTAL; T6.4 hotel & leisure is PTAL-band narrative with no numbered table; Table 10.6 (T6.5) covers non-residential disabled persons provision.
- Healthy Streets Indicators score table (existing / proposed / Δ across all 10 indicators).
- Mitigation / S106 / S278 / MCIL2 summary table.

### 4.3 Submission pathway

Renderer should print a submission summary page identifying:

- **Local Planning Authority** — the relevant London borough (or City of London Corporation).
- **Highway authorities consulted**:
  - Borough (off-site borough-road works) — S278 + S38.
  - TfL (TLRN works, PT impacts, any referable scheme) — S278.
  - National Highways (SRN works — limited to M25 and a handful of A-roads in Greater London) — S278 + Circular 02/2013 consultation.
- **GLA / Mayor referral** — Stage 1 referral if any PSI category triggered (see §6.2).
- **TfL referral stages** — Stage 1 / Stage 2 / Stage 3 (call-in) — see §6.3.

---

## 5. UK-specific terminology

The renderer's text-generation layer must not emit any of the US-convention strings the current `renderTis()` produces. Substitutions:

| US convention (current engine) | UK convention (London renderer) |
|---|---|
| "Traffic Impact Study" / "TIS" | "Transport Assessment" / "TA" (or "Transport Statement" / "TS" for lighter form) |
| "TIA" | (not used in UK; "TA" only) |
| "Intersection" | **"Junction"** |
| "Stop sign" | "Give-way" |
| "Traffic signal" | "Signals" |
| "Roundabout" (US "traffic circle") | "Roundabout" (UK) — but capacity by ARCADY, not HCM Ch 22 |
| "LOS A through F" | (not used) — UK reports **RFC / DOS / PRC / MMQ** |
| "Delay (s)" | "Delay (s/veh)" — same units, different framing |
| "Queue (95th percentile, ft)" | "MMQ (PCUs)" — **note units: PCU not feet/vehicles** |
| "Distance (mi)" | **"Distance (m)" or "(km)"** — metric throughout |
| "AADT" | "AADT" (same term) or "AADF" (DfT's annual average daily *flow*) |
| "Peak hour" | Same — but AM peak conventionally **08:00–09:00**, PM peak **17:00–18:00** |
| "ITE Trip Generation" | "TRICS multi-modal trip rates" (85th percentile) |
| "HCM 6th Edition" | "DMRB CD 116 / CD 123" + the modelling tool used |
| "MUTCD warrant" | "TSRGD 2016" + DfT signal warranting (no formal warrant equivalent — UK is judgement-led) |
| "AASHTO Green Book" | "DMRB CD 109 / CD 116 / CD 122 / CD 123" or "MfS / MfS2" |
| "Synchro" | "LinSig 3" |
| "SimTraffic" | (no equivalent; UK uses LinSig + VISSIM) |
| "DOT" | "Highway authority" — TfL (TLRN), borough (borough roads), National Highways (SRN) |
| "Pass-by capture" | "Pass-by" (same concept) |
| "Internal capture" | "Internalisation" or "Linked trips" |
| "Right-in/right-out" | "Left-in/left-out" — **drive on the left** |
| **Driving side** | LHS — junction geometry, turn directions, swept paths all mirror |

Other UK-only terms the renderer should know:

- **TRO** — Traffic Regulation Order.
- **TPC** — Travel Plan Coordinator.
- **CLP** — Construction Logistics Plan.
- **DSP** — Delivery and Servicing Plan.
- **PCU** — Passenger Car Unit.
- **GFA** — Gross Floor Area (UK usage; not GSF).
- **B1 / A1 / C3 / D1** — pre-2020 Use Classes (Use Classes Order 1987) — still cited in DfT 2007 thresholds; modern Use Classes Order 2020 collapsed many into Class E (commercial, business, service). Renderer should accept both.
- **LPA** — Local Planning Authority.
- **GLA** — Greater London Authority.
- **PSI** — Potential Strategic Importance (Mayor of London Order trigger).
- **MAP** — TfL Model Auditing Process.
- **ATZ** — Active Travel Zone.
- **MCC / ATC** — Manual Classified Count / Automatic Traffic Count.
- **SCOOT / MOVA** — adaptive signal control systems on TfL signals.

---

## 6. Thresholds and review triggers

### 6.1 TA vs TS vs neither

**No statutory numeric national threshold exists.** PPG (1.2) defers to the LPA. The widely-cited reference is DfT 2007 Appendix B (1.8) — withdrawn but still reproduced by TfL and many boroughs. The renderer should treat these as **indicative**, prompt for LPA SPD overrides, and explicitly flag the withdrawal.

DfT 2007 Appendix B (indicative; format `< lower` → no assessment, `lower–upper` → TS, `> upper` → TA + Travel Plan):

| Use Class | TS threshold | TA threshold |
|---|---|---|
| A1 food retail (supermarket) | 250 sqm GFA | 800 sqm GFA |
| A1 non-food retail | **800 sqm GFA** ✓ | **1,500 sqm GFA** ✓ |
| A2 financial / professional | 1,000 sqm | 2,500 sqm |
| A3 restaurants / cafés | 300 sqm | 2,500 sqm |
| A4 drinking establishments | 300 sqm | 600 sqm |
| A5 hot food takeaway | 250 sqm | 500 sqm |
| B1 business / office | **1,500 sqm GFA** ✓ | **2,500 sqm GFA** ✓ |
| B2 general industrial | 2,500 sqm | 4,000 sqm |
| B8 storage / distribution | 3,000 sqm | 5,000 sqm |
| C1 hotels | 75 bedrooms | 100 bedrooms |
| C2 residential institutions | 30 beds | 50 beds |
| C3 dwellings | 50 units | 80 units |
| D1 non-residential institutions | 500 sqm | 1,000 sqm |
| D2 assembly / leisure | 500 sqm | 1,500 sqm |

Lines marked ✓ were directly confirmed against TfL's mirror of Appendix B in earlier research; the full table was line-by-line re-verified against `content.tfl.gov.uk/thresholds-for-transport-assessments.pdf` in a follow-up deep-research pass on 2026-06-12 (every cited TA-column row matched the PDF). Caveats the renderer must surface alongside the table:

- The literal Appendix B wording is `< lower → no assessment`, `lower < x < upper → TS`, `> upper → TA + Travel Plan` — i.e. strict inequalities. A naive `≥` restatement silently closes the gap at the boundary values (exactly 50 dwellings, exactly 80 dwellings). The renderer must use the same strict-inequality semantics or explicitly call out the boundary handling.
- The table preamble states thresholds *"should not be read as absolutes"* — LPA discretion can lower (e.g. stretched capacity) or raise (e.g. high-PTAL) the trigger.
- **Use Class labels A1 / A2 / A3 / A4 / A5 / B1 / D1 / D2 are pre-2020 nomenclature.** The Town and Country Planning (Use Classes) (Amendment) (England) Regulations 2020 (SI 2020/757, in force 1 September 2020) collapsed most into the new Class E (commercial, business and service). The GFA figures remain the de facto reference, but a modern Class E proposal must be mapped to the legacy class for threshold lookup. The renderer needs an explicit Class E → legacy A1/A2/A3/B1/D1/D2 mapping at input time.

**Second Appendix B table — TA required regardless of size** (the spec's earlier version missed this; surfaced via deep-research 2026-06-12). The same `thresholds-for-transport-assessments.pdf` PDF contains a "Thresholds based on other considerations" table that forces a **TA (not TS)** regardless of land-use floorspace whenever any one of:

| Trigger | Threshold |
|---|---|
| Two-way vehicle movements, any hour | ≥ 30 |
| Two-way vehicle movements per day | ≥ 100 |
| Off-street parking spaces | ≥ 100 |
| Location in or adjacent to an Air Quality Management Area (AQMA) | yes |
| Local transport infrastructure inadequate to serve the proposal | yes |

A floorspace-only screen will under-trigger if these qualitative / volume-based escalators are not also implemented. The renderer can compute the first two from its own trip-generation output and the third from a parking-spaces input; AQMA and "inadequate infrastructure" require external lookup or LPA scoping confirmation.

**General PPG language** (Reference 42-009-20140306) — significance is judgement-led:
> "Significance may be a lower threshold where road capacity is already stretched or a higher threshold for a development in an area of high public transport accessibility."

The renderer should expose all three: floorspace table + regardless-of-size triggers + reviewer-discretion note.

### 6.2 GLA / Mayor of London referral (PSI — Potential Strategic Importance)

Per SI 2008/580 + SI 2011/2057 + SI 2026/345 (1.5), the categories of PSI that trigger Mayoral referral:

**Part 1 — Large-scale**
- **1A Residential:** > 150 dwellings.
- **1B Commercial floorspace:**
  - City of London: > 100,000 sqm
  - Central London (excl. City): > 20,000 sqm
  - Outside Central London: > 15,000 sqm
- **1C Building height:**
  - Adjacent to River Thames: > 25 m
  - City of London: > 150 m
  - Outside City of London: > 30 m
- **1D Alterations:** height increase > 15 m where completed building falls within 1C.

**Part 2 — Major infrastructure**
- 2A Mining > 10 ha; 2B Waste (hazardous > 5,000 t/yr, general > 50,000 t/yr, site > 1 ha); 2C Transport infrastructure (rail/tram/bus stations, runways, heliports, Thames crossings, piers, bus/coach storage 70+ vehicles or > 0.7 ha); 2D Non-conforming waste.

**Part 3 — Strategic policy impact**
- 3A Residential loss > 200 dwellings / prejudicing 4+ ha residential land; 3B Affecting 4+ ha B1/B2/B8; 3C Playing fields > 2 ha; 3D Green Belt / MOL > 1,000 sqm; 3E Non-conforming commercial > 2,500 sqm; 3F Car parking > 200 non-residential spaces; 3G–3I waste/transport variants.
- **3J (NEW — effective 11 May 2026, SI 2026/345, art. 10 inserting after 3I):** Verbatim Schedule wording: *"Development which comprises or includes the provision of 50 or more houses, flats, or houses and flats."* I.e. ≥ 50 houses, ≥ 50 flats, or ≥ 50 houses-and-flats combined — **"mixed" here means mixed-residential (houses + flats), NOT mixed-use**. Lighter-touch mechanism than the Stage 1/Stage 2 process for Categories 1–3I: LPA must notify Mayor at receipt; LPA cannot refuse without either (i) 21 days having elapsed from the date notified in writing by the Mayor, or (ii) the Mayor having notified the LPA in writing that he is content for the LPA to determine. The Mayor may direct (within that 21-day window) that he determine the application himself. Primary-verified against legislation.gov.uk uksi/2026/345 on 2026-06-12.

The renderer should evaluate the project against every category and emit a PSI-trigger summary.

**Part 4 — Secretary of State directions.**

**Mayor's powers on a PSI application:** (i) direct refusal; (ii) call-in (take over as LPA). Three policy tests for call-in: significant impact on London Plan; cross-borough effects; sound planning reasons.

### 6.3 TfL referral stages

Source: London City Hall "Referral process for LPAs" + SI 2008/580 + practitioner guidance (Planning Aid for London).

| Stage | Trigger | Mayor's window | Outputs |
|---|---|---|---|
| **Stage 1** | Application meets a PSI category. LPA submits to Mayor at validation. | **6 weeks** | Stage 1 report ("Strategic Issues") or "No Strategic Issues" letter. |
| **Stage 2** | After LPA resolves to grant/refuse. LPA submits officer report, draft S106, proposed conditions. | **14 days** | (a) allow LPA decision to stand; (b) direct refusal; (c) call-in (→ Stage 3). |
| **Stage 3 (call-in)** | Mayor takes over as LPA. | n/a — public representation hearing | Mayor determines the application. |

**Cat 3J exception (SI 2026/345, effective 11 May 2026).** A **Cat-3J-only** application (50+ houses/flats/houses-and-flats that does *not* also hit any of Cat 1A / 1B / 1C / 1D / 2A–2D / 3A–3I) **does not enter Stage 1 / Stage 2**. Instead it follows a single-stage notification path — LPA notifies Mayor at receipt; LPA cannot refuse without giving the Mayor 21 days (from the date the Mayor notifies in writing) to direct that he determine the application, or obtaining the Mayor's written consent to determine. If the project also hits one of Cat 1A–3I (e.g. a 200-dwelling scheme that is both 1A *and* 3J), the standard Stage 1/Stage 2 path applies and the Cat 3J mechanism is subsumed. The renderer's PSI-trigger summary should distinguish "Cat 3J only" from "Cat 1A (or other) + Cat 3J" so the consenting flow rendered downstream is correct.

TfL itself acts as statutory consultee for the Mayor on transport matters at every stage. For schemes affecting TLRN, TfL highway-works consent (S278) is required regardless of referral.

### 6.4 Highway-authority split

| Network | Authority | London scope | Consent for development works |
|---|---|---|---|
| **Strategic Road Network (SRN)** | National Highways | M25 + short sections of A1, A2, A3, A40 at the London fringe. Small footprint inside Greater London. | **S278 with National Highways**. NH is statutory consultee per DfT Circular 02/2013 (1.13). |
| **Transport for London Road Network (TLRN)** | TfL | ~580 km / ~360 mi of "red routes" + key arterials (A102, parts of A2/A12/A40 inside London) + major bridges + Blackwall/Silvertown tunnels. ~5% of London's road length, ~30% of traffic, ~50% of HGV traffic. Defined by GLA Roads Designation Order 2000 (1.7). | **S278 with TfL.** TfL requires before S278: (i) full planning permission; (ii) Abortive Costs Undertaking (ACU) signed; (iii) public benefit; (iv) developer controls all necessary land. |
| **Borough roads** | The 33 highway authorities — 32 boroughs + the City of London Corporation. | ~95% of London road length. | **S278 with the borough** (or City of London Corporation in the Square Mile). **S38** to adopt new estate roads. |

The 33 borough highway authorities the renderer must enumerate:

Barking & Dagenham · Barnet · Bexley · Brent · Bromley · Camden · Croydon · Ealing · Enfield · Royal Greenwich · Hackney · Hammersmith & Fulham · Haringey · Harrow · Havering · Hillingdon · Hounslow · Islington · Royal Kensington & Chelsea · Royal Kingston upon Thames · Lambeth · Lewisham · Merton · Newham · Redbridge · Richmond upon Thames · Southwark · Sutton · Tower Hamlets · Waltham Forest · Wandsworth · City of Westminster · City of London Corporation.

---

## 7. Region-specific data sources

### 7.1 DfT Road Traffic Statistics / count points

- **URL:** https://roadtraffic.dft.gov.uk/ — interactive count-point map at https://roadtraffic.dft.gov.uk/count-points; bulk downloads at https://roadtraffic.dft.gov.uk/downloads. Data.gov.uk mirror: https://www.data.gov.uk/dataset/208c0e7b-353f-4e2d-8b7a-1a7118467acc/gb-road-traffic-counts.
- **Format:** Zipped CSV (AADF + raw 12-hour MCC). No public REST API.
- **Access:** Free, OGL. No key.
- **Coverage:** Whole of GB. London borough-filterable. **Sparse on minor roads** — TA practice supplements with site-specific MCC at affected junctions.
- **Update:** Annual full release; rolling re-counts by tier. Currently to 2024.
- **Renderer use:** TA baseline AADT layer. AADF on the classified network only; manual junction counts uploaded separately for non-DfT junctions.

### 7.2 TfL Open Data / Unified API

- **URL:** https://api.tfl.gov.uk/ · Swagger UI https://api.tfl.gov.uk/swagger/ui/index.html · portal https://api-portal.tfl.gov.uk/.
- **Format:** REST / JSON.
- **Access:** Free. Registration (app_id + app_key as query params) recommended for higher rate limits.
- **Endpoints relevant to TA:**
  - `StopPoint` — bus stops + station nodes, step-free flags.
  - `Line` — routes by mode (bus, tube, dlr, overground, elizabeth-line, tram, river-bus, national-rail).
  - `Line/Mode/{mode}/Status` — disruption status.
  - `AccessibilityCenter` — step-free station data.
  - `Place` — POIs.
- **PTAL not in Unified API** — separate dataset (7.3).
- **Renderer use:** PT network map (Ch 3.1); station/stop list with frequency band + step-free status; cache aggressively.

### 7.3 PTAL grid

- **URLs:**
  - TfL GIS Open Data Hub (ArcGIS): https://gis-tfl.opendata.arcgis.com/datasets/0646faf45243463aa04ca685e598f471/about — "PTAL 2023 Grid 100mx100m Data".
  - London Datastore mirror: https://data.london.gov.uk/dataset/public-transport-accessibility-levels-24rz6/.
  - WebCAT (interactive): https://tfl.gov.uk/info-for/urban-planning-and-construction/planning-applications/planning-with-webcat — WebCAT 3.0 (2025+).
  - Methodology: https://s3-eu-west-1.amazonaws.com/londondatastore-upload/PTAL-methodology.pdf.
- **Format:** CSV, KML, Shapefile/Zip, GeoJSON, GeoTIFF, PNG; WMS/WFS feeds.
- **Access:** Free, open licence.
- **Current baseline:** 2023 (named in dataset). Earlier baselines 2014/15, 2021.
- **Renderer use:** Display site PTAL band + AI; overlay PTAL on context map; feed parking-standard determination under T6.

### 7.4 TfL Manual / Automatic Counts (MCC / ATC)

- No single open-data download. Patchwork:
  - Borough scheme counts on London Datastore (e.g. Lambeth ATC https://data.london.gov.uk/dataset/baseline-and-post-scheme-implementation-traffic-count-for-london-borough-of-lambeth).
  - Cycle counts: https://data.london.gov.uk/dataset/cycle-flows-tfl-road-network/.
  - Legacy bucket: `cycling.data.tfl.gov.uk`.
  - Bulk MCC/ATC: via TfL FoI responses (no SLA, no key).
- **Renderer use:** Treat as user upload, not live feed.

### 7.5 Ordnance Survey

| Product | URL | Format | Access |
|---|---|---|---|
| OS Open Roads | https://osdatahub.os.uk/downloads/open/OpenRoads | GeoPackage / Shapefile / GeoJSON | Free, OGL |
| OS Open Greenspace | https://osdatahub.os.uk/downloads/open/OpenGreenspace | GeoPackage / Shapefile / GeoJSON | Free, OGL |
| OS Open Zoomstack | OS Data Hub | Vector tiles / GeoPackage | Free, OGL |
| **OS MasterMap Highways — Roads** | https://www.ordnancesurvey.co.uk/products/os-mastermap-highways-network-roads | GML / GeoPackage | **Licensed** — PSGA covers most LPAs; SaaS needs Premium Partner or per-customer licence |
| **OS MasterMap Highways — Paths** | https://www.ordnancesurvey.co.uk/products/os-mastermap-highways-network-paths | GML / GeoPackage | Licensed (as above) |

The default renderer build should constrain to **free OS Open products** (Open Roads + Open Greenspace + Open Zoomstack) unless a customer licence is provided.

### 7.6 London Datastore

- https://data.london.gov.uk/. Transport hub at /topic/transport/.
- **Relevant datasets:**
  - **Planning London Datahub (PLD)** — all London LPAs' planning data + approved-development pipeline (https://www.london.gov.uk/programmes-strategies/planning/digital-planning/planning-london-datahub). Used for cumulative-impact / committed-development trip generation.
  - GLA demographics / population projections (MSOA / ward).
  - 2021 Census origin–destination + method-of-travel-to-work (ONS, mirrored).
  - Cycle Flows on TLRN.
  - TfL Live Traffic Disruptions.
  - Borough LTN baseline + post-scheme counts.

### 7.7 TAG (WebTAG) data book

- https://www.gov.uk/government/publications/tag-data-book · TAG Unit A1.3 https://assets.publishing.service.gov.uk/media/6939d0b4cfacd5e888491d9a/tag-unit-a1-3-user-and-provider-impacts-may-2026.pdf.
- Current: data book v2.02 (Dec 2025); v2.03FC update Dec 2025; TAG units last updated 28 May 2026.
- Free, OGL. Version-stamp into the renderer's appendix for auditability.

### 7.8 TfL Cycle Infrastructure Database (CID)

- https://cycling.data.tfl.gov.uk/ · Datastore mirror https://data.london.gov.uk/dataset/cycling-infrastructure-database-23n1k/ · GeoJSON conversion https://github.com/cyclestreets/tflcid-conversion.
- Layers: cycle parking, signals, traffic calming, signage, restricted points/routes, cycle lanes, cycle crossings, ASLs.
- Free, open.
- Renderer use: active-travel chapter — cycle lane / parking / ASL within walking & cycling catchment.

### 7.9 TfL Strategic Cycling Analysis (SCA)

- 2017 report: https://content.tfl.gov.uk/tfl-strategic-cycling-analysis.pdf. 2022 update as interactive corridor map.
- Renderer use: flag whether site sits on or near an SCA top-potential corridor — supports active-travel mode-share assumption + S106 cycle-infra contribution case.

### 7.10 TfL Healthy Streets Check for Designers

- XLSX: https://tfl.gov.uk/cdn/static/cms/documents/healthy-streets-check-for-designers.xlsx · indicators guide https://content.tfl.gov.uk/guide-to-the-healthy-streets-indicators.pdf.
- 31-metric workbook across the 10 Healthy Streets Indicators.
- Renderer: accept the completed XLSX as user upload, surface scoring deltas (existing vs proposed) in Ch 3.4 and the conclusion table.

### 7.11 GLA / TfL spatial reference

- TLRN: https://gis-tfl.opendata.arcgis.com/datasets/transport-for-london-road-network-tlrn-1/about.
- SRN: https://nationalhighways.co.uk/our-roads/planning-and-the-strategic-road-network-in-england/.

---

## 8. Where the current engine fails for London

The current `renderTis()` (pdf-export.ts:347) and the upstream TIS computation are US-conventions throughout. For a London project, every one of these is wrong:

| Engine assumption / output | Why wrong for London | Required UK output |
|---|---|---|
| **HCM 6th Edition Chapter 19** intersection methodology | DMRB + LinSig / Junctions 11 is the UK convention; HCM is not accepted by UK reviewers. | DMRB CD 116 (roundabouts) + CD 123 (priority & signal junctions); modelling via LinSig / Junctions 11 / TRANSYT / VISSIM. |
| **ITE Trip Generation Manual** 11th Edition rates | ITE is not accepted by UK reviewers (no multi-modal; US-suburban bias). | TRICS multi-modal database, 85th-percentile rate as starting point. Scenario filter (date band, region, day type, parking, GFA) recorded in methodology. |
| **Car-only mode** | UK TAs assess walking, cycling, bus, rail, car, taxi, motorcycle, LGV, HGV. NPPF para 115 requires sustainable-mode demonstration *before* highway capacity. | Multi-modal trip generation, mode-share table, PTAL-driven car parking, Healthy Streets check, ATZ. |
| **LOS A–F** reporting | UK does not use LOS letters. Reviewers reject. | RFC (≥ 0.85 concerning) for roundabouts/priority; DOS (≥ 90% concerning) + PRC (≥ 5% desirable) for signals; MMQ in PCUs; delay s/veh. |
| **MUTCD signal warrants** | No statutory UK signal-warrant equivalent. TSRGD 2016 governs sign/signal designs; signal warranting is judgement-led against DfT guidance. | Drop warrant section. Replace with qualitative justification + LinSig modelling. |
| **AASHTO Green Book geometric** | UK uses DMRB CD 109 / 116 / 122 / 123 (trunk) and MfS / MfS2 (urban). | Cite DMRB volume + MfS standard, not AASHTO. |
| **Distance in miles** | UK is metric. | Metres + kilometres. |
| **Queue 95th percentile in feet** | UK uses Mean Maximum Queue in **PCUs**, not vehicles or feet. | MMQ (PCUs). |
| **"Intersection" terminology** | UK term is **junction**. | Junction. |
| **Right-side driving assumptions** in geometry / swept paths | UK drives on the left. | Left-side everywhere — turn movements, swept paths, access geometry. |
| **AM/PM peak windows** assumed 7:00–9:00 / 16:00–18:00 (US convention) | UK AM peak conventionally 08:00–09:00; PM peak 17:00–18:00. | UK-specific peak windows; Saturday peak where retail/leisure. |
| **DOT consultation** boilerplate | No DOT in UK. | TfL + borough + (rarely) National Highways. Per-project authority mix output. |
| **GA-style mitigation table** ("recommended mitigations") | UK convention is "design solutions and mitigation" tied to S106 / S278 / MCIL2 mechanism. | Mitigation table per junction with mechanism + responsible authority + indicative cost. |
| **DRI / GRTA review section** in Georgia renderer | Irrelevant. | Replace with PSI / GLA referral evaluation + TfL stage 1/2/3 status. |
| **Pass-by + internal capture** terminology | "Internal capture" is a US TIS term. UK convention is "linked trips" / "internalisation". | Rename labels. |
| **No PTAL** | London Plan T6 requires PTAL-banded parking; absent PTAL the assessment fails. | PTAL grid lookup + AI value + parking-standard derivation. |
| **No Healthy Streets check** | TfL's Healthy Streets TA format requires it. | Accept XLSX upload, surface scores. |
| **No ATZ** | TfL Healthy Streets TA chapter 4 requires it. | WebCAT 20-minute cycle isochrone. |
| **No travel plan** | Required alongside any TA per NPPF para 118. | Travel Plan template chapter with TPC, modal targets, monitoring, S106 funding hook. |
| **No multi-period assessment-year scenarios** structured to DfT 2007 §4.45–4.56 framing | UK reviewers expect Base / Opening / Design year × peak periods. | Scenario matrix. |
| **Cover page conventions** — "PE stamp box, signature line" | UK doesn't stamp engineering documents. Chartered Engineer (CEng) + Member of CIHT (MCIHT) signature is the convention. | UK cover with CEng MCIHT signature box, not PE. |
| **Citation footer** "HCM 6th Ed; ITE Trip Generation 11th Ed; MUTCD" | All wrong for London. | "NPPF (Dec 2024); PPG Travel plans, TAs and TSs; London Plan 2021; TfL Healthy Streets TA format; TRICS; DMRB CD 116/123; LinSig 3 / Junctions 11; TAG (May 2026)". |

In short: the current engine produces a US TIS that name-checks London. A UK TA is a different document with different inputs, methods, and outputs. Region-conditional formatting of the existing engine's outputs is not sufficient — the inputs themselves (TRICS vs ITE, multi-modal vs car-only, PTAL, Healthy Streets) are not produced by the engine today.

---

## 9. Comparison to Georgia DRI sample

Side-by-side. The Georgia renderer (`renderTisGeorgia()`, pdf-export.ts:517) is the closest engine analogue and shows the dispatch pattern London should follow.

| Aspect | Georgia DRI (US TIS) | London TA |
|---|---|---|
| **Statutory hook** | Georgia Planning Act (O.C.G.A. § 50-8-7.1); GRTA review; ARC RTP | NPPF Dec 2024 Ch 9 (statutory); PPG Travel plans, TAs and TSs (operational); London Plan 2021 Ch 10 |
| **Document name** | Traffic Impact Study (TIS) / DRI Transportation Analysis | Transport Assessment (TA) or Transport Statement (TS) |
| **Trigger** | DRI thresholds in O.C.G.A. § 50-8-7.1; local TIS thresholds per jurisdiction | "Significant amounts of movement" (NPPF para 118); LPA-set local thresholds; PSI categories for Mayor referral; DfT 2007 Appendix B indicative |
| **Reviewing authorities** | Local jurisdiction (city/county); GDOT; ARC; GRTA | LPA (borough); TfL (TLRN + PSI); National Highways (SRN only — limited London footprint); GLA (Mayor) |
| **Section structure** | §1 Project Description → §10 Comprehensive Plan Analysis; DRI adds §11–13 (Non-Expedited Criteria, AoI, Air Quality) | TfL Healthy Streets TA Ch 1–8 (see §2.1); Ch 4 ATZ is unique; Ch 6 borough analysis replaces Comp Plan |
| **Trip generation source** | **ITE Trip Generation Manual 11th Ed**, average or fitted rates | **TRICS** multi-modal, 85th-percentile starting point |
| **Modes assessed** | Car-only by default; ITE captures vehicles | Walking + cycling + bus + rail + car + taxi + motorcycle + LGV + HGV; person-trip mode-share required |
| **Capacity methodology** | HCM 6th Edition Ch 19 (signals), Ch 20/21/22 (others); Synchro / SimTraffic; LOS A–F | DMRB CD 116 / 123; LinSig 3 (signals); Junctions 11 with ARCADY/PICADY (roundabouts/priority); TRANSYT (coordination); VISSIM (microsim); RFC / DOS / PRC / MMQ |
| **Reporting metric** | LOS letter, average delay s/veh, 95th-percentile queue (ft) | RFC or DOS, PRC, MMQ in PCUs, delay s/veh |
| **Accessibility metric** | None / informal | **PTAL 0–6b mandatory in every London TA** |
| **Active-mode requirement** | Optional, often token | Mandatory; ATZ; Healthy Streets Check; T5 cycle parking; T2 Healthy Streets compliance |
| **Geometric design citation** | AASHTO Green Book; GDOT Design Policy | DMRB CD 109 / 116 / 122 / 123 (trunk); MfS / MfS2 (urban) |
| **Signs / signals** | MUTCD warrants | TSRGD 2016; judgement-led signal warranting; no statutory warrant equivalent |
| **Mitigation funding mechanism** | Developer-built; impact fees where applicable | S106 (planning obligation), S278 (highway works), S38 (road adoption), CIL, MCIL2 |
| **Cover convention** | PE stamp + signature | CEng MCIHT signature (no stamp tradition) |
| **Units** | Imperial — miles, feet | Metric — km, m, PCUs |
| **Driving side** | Right | **Left** — affects geometry, swept paths, turn movements |
| **Pre-application process** | DRI pre-app coordination with GRTA + ARC + GDOT + local | Scoping note with LPA + TfL (Stage 1 if PSI); signed methodology |
| **Cumulative impact** | "Programmed projects" review (TIP, STIP, RTP, GDOT CWP) | Planning London Datahub (PLD) committed-development pipeline |
| **Post-decision** | DRI tracking via ARC; local conditions of approval | S106 monitoring; Travel Plan annual survey; MAP audit for TfL-submitted models |

**Bottom line:** the Atlanta engine's GA renderer is a US TIS with GA-flavoured chapter ordering and citation set. A London TA is structurally different — different inputs (TRICS not ITE; multi-modal not car), different methodology (PTAL + ATZ + Healthy Streets), different metrics (RFC/DOS/PRC/MMQ not LOS), different consenting (S106/S278/MCIL2 not impact fees), and a different consenting authority stack (LPA + TfL + GLA + occasionally NH). It is not a re-labelled TIS.

---

## 10. Roadmap implication: wrapper vs separate engine

The question the spec opens for the user to close: **is London a US-engine-with-UK-report-wrapper, or a separate engine?**

A US-engine wrapper would translate the existing renderer's outputs into UK terminology (LOS → DOS, miles → km, intersection → junction). It is the cheapest path and produces a London TA-shaped document, but:

- The inputs are still wrong — the engine computes ITE rates (no UK TA reviewer will accept) and HCM capacity (no UK reviewer will accept).
- It produces no PTAL, no ATZ, no Healthy Streets check, no multi-modal mode share.
- A wrapper might satisfy a non-referable application in a low-PTAL borough fringe location for a tiny scheme. It will not satisfy TfL referral or any borough with a developed transport SPD.

A separate engine would compute TRICS multi-modal rates, look up PTAL, run capacity through LinSig/Junctions 11 results (uploaded), generate ATZ catchments, and emit the Healthy Streets TA structure. This is the only path that produces a defensible TA for a London referable scheme.

**Recommendation in the spec:** the renderer's PDF dispatch *can* take a wrapper-style first cut to stop emitting LOS letters for UK projects (a 1-week change in `renderTis()`). But the actual TA product requires the engine inputs to change — TRICS integration, PTAL lookup, multi-modal trip generation, Healthy Streets workbook ingestion. Decide which deliverable London customers are buying before committing engineering time.

---

## 11. Open questions / follow-ups before locking implementation

**Resolved in the 2026-06-12 deep-research pass:**
- ✓ **DfT 2007 Appendix B threshold table** — full table line-by-line verified against `content.tfl.gov.uk/thresholds-for-transport-assessments.pdf`. **New finding:** the second Appendix B table ("Thresholds based on other considerations") forces a TA regardless of size when ≥ 30 two-way movements/hr OR ≥ 100/day OR ≥ 100 parking spaces OR AQMA OR inadequate infrastructure — incorporated into §6.1 above.
- ✓ **NPPF paras 115 / 116 / 118** — verified verbatim against the Dec-2024 PDF on assets.publishing.service.gov.uk. "Vision-led" was a Dec-2024 insertion. Sub-clauses a–d on para 115 confirmed.
- ✓ **PPG 2014 status** — still unrevised in 2026 despite the Dec-2024 NPPF refresh; corrected in row 1.2 above.
- ✓ **London Plan 2021 currency** — still the adopted plan; replacement plan only at draft consultation Summer 2026, adoption 2027 (or 2027/early 2028 per Lichfields March 2026). Policy T6 sub-policy structure T6.1–T6.5 + Part B car-free starting point confirmed verbatim.
- ✓ **London Plan Chapter 10 table numbering** — verified directly against the London Plan 2021 PDF (Chapter 10) on 2026-06-12: Table 10.1 transport schemes; **Table 10.2** Minimum cycle parking standards under T5; **Table 10.3** Maximum residential parking standards under T6.1; **Table 10.4** Maximum office parking standards under T6.2; **Table 10.5** Maximum retail parking standards under T6.3; **Table 10.6** Non-residential **disabled persons** parking standards under **T6.5** (NOT hotel & leisure). Policy **T6.4 Hotel and leisure uses parking has no numbered maxima table** — it is PTAL-band narrative (CAZ + PTAL 4-6: operational only; PTAL 0-3: case-by-case under Healthy Streets). Earlier spec/renderer phrasing "Tables 10.3–10.6" conflated these and has been corrected.
- ✓ **Healthy Streets TA Recommended Contents & Chapters** — `content.tfl.gov.uk/healthy-streets-ta-format.pdf` confirmed real and current (last-modified 23 May 2025), authored by TfL 19 June 2019 — 9-page document with the 8-chapter TOC the spec claims.
- ✓ **SI 2026/345 Cat 3J 50-home trigger** — primary-verified against legislation.gov.uk uksi/2026/345 on 2026-06-12. Confirmed: in force 11 May 2026; art. 10 inserts new Cat 3J after 3I; verbatim threshold *"Development which comprises or includes the provision of 50 or more houses, flats, or houses and flats"*; mechanism is notification-at-receipt with a 21-day pre-refusal Mayor-direction window (per amended arts. 5 and 7 of the 2008 Order). §6.2 Part 3 3J entry expanded accordingly.
- ✓ **PTAL methodology — SAP / EDF / AI bandings + the "car-free starting point" framing** (2026-06-12 follow-up pass): SAP constants (640 m bus / 960 m rail, 8 min / 12 min at 80 m/min) and the EDF AM-peak window (08:15–09:15) re-verified against three independent secondary mirrors of TfL methodology (Wikipedia; Podaris; Advanced Infrastructure) — all consistent, no correction needed. The previously-cited primary PDF at `s3-eu-west-1.amazonaws.com/londondatastore-upload/PTAL-methodology.pdf` is **dead** as of June 2026 (S3 returns 301 then AccessDenied); §3.2 now flags this and points re-verification at the dataset-page methodology link under 7.3. The full nine-band AI → PTAL table is now in §3.2 (the prior "AI 0–5 → PTAL 1, ≥40 → PTAL 6b" was incomplete — collapsed the 1a/1b split and omitted bands 0/2/3/4/5/6a). **The "PTAL 5 / 6a / 6b → car-free starting point" framing was wrong as a policy claim:** Policy T6 Part B (verified verbatim against the Bromley mirror of the London Plan 2021 PDF) reads "well-connected by public transport" with no hard PTAL cut-off; the only explicit PTAL hook in the policy text is Part K (boroughs may adopt minimum residential standards only in PTAL 0–1). §3.2 and the §3.2 renderer paragraph were corrected to drop the inferred-as-policy cut-off and reproduce the actual policy wording.
- ✓ **TRICS 2026 update** — verified 2026-06-12. The 1 January 2026 announcement was a licence + bureau-fee revision only, with no concurrent methodology republication. Underlying methodology authorities remain the **TRICS Good Practice Guide 2025** and **TRICS Multi-Modal Methodology 2025** (both dated Dec 2024). Separately, the TRICS-8 generation (initial release 2025; Time Series Analysis Module Sept 2025) ships two changes the renderer's disclosure must reflect: (a) removal of the default 8-year survey-date cut-off (GPG §10.5), and (b) demotion of Region/Area as a stand-alone exclusion filter in favour of TRICS Main Location Type (GPG §5.5–5.7; TRICS 8 enforces this in the UI). COVID-restriction surveys are flagged but not auto-excluded (GPG §16.6 — user judgement, reason for any exclusion must be stated in the report). 85th-percentile starting point is unchanged at this release (DfT-2007 lineage; TRICS itself remains methodologically neutral per GPG §14.5, recommending ≥20 surveys before quoting). Multi-modal categories unchanged; spec now covers Scooters (added 2021) and the OGV-not-HGV convention. Connectivity Scoring data announced 1 May 2026 is a future dataset addition retrofitted to ~380 surveys through 2026, not a methodology change. Row 1.27 + §3.1 updated; renderer `renderTisLondon` §1.2, §5.1 and §8.0 updated to match.

**Still open:**
1. **TRICS Connectivity Scoring go-live** — announced 1 May 2026 (https://trics.org/2026/05/01/trics-to-introduce-connectivity-scoring-data/). DfT Connectivity Tool data being retrofitted to ~380 surveys through 2026. Re-verify after the 23 June 2026 TRICS Training & Development Forum and at the 24 Nov 2026 TRICS User Meeting — if Connectivity Score becomes a filter parameter, the renderer's recorded scenario filter list should be extended.
2. **TRICS Multi-Factor Authentication implementation date** — announced 19 May 2026 (https://trics.org/2026/05/19/trics-licence-monitoring-multi-factor-authentication-the-protection-of-intellectual-property-rights/) but date is "in due course". When TRICS publishes the cut-over date, surface it in the renderer's methodology disclosure so London consultants know when MFA is enforced for accessing TRICS to produce TA rates.
3. **PSI Cat 3G/3H/3I exact wording** — recheck SI 2008/580 Schedule text on legislation.gov.uk.
4. **Stage 3 nomenclature** — the GLA "Referral process for LPAs" page presents the process as 2 stages plus call-in; practitioner usage labels it Stage 3. Renderer should support both labels.
5. **TfL strategic-modelling referral threshold** — no single canonical numeric threshold table was extracted; the heuristic is "PSI + TLRN-impacting". Confirm with TfL Strategic Modelling (strategicmodelling@tfl.gov.uk) before publishing.
6. **PTAL data freshness** — TfL's "PTAL 2023" is the published baseline as of June 2026. WebCAT 3.0 (2025+) implies a refresh — confirm at deployment.
7. **OS licensing** — default to OS Open products only; PSGA / commercial licence is per-customer.
8. **MfS3** — commissioned 2020, still unpublished as of June 2026. Renderer cites MfS (2007) + MfS2 (2010); refresh when MfS3 lands.

---

## 12. Implementation hooks (for the next stage)

Not part of the deliverable, but flagged for whoever picks up the build:

- New dispatch arm in `renderTisStudy()` (pdf-export.ts ~line 330) for `region.country === "GB"` → `renderTransportAssessmentLondon()`.
- New renderer module mirroring `renderTisGeorgia()` shape — separate file under `artifacts/tis-api-server/src/lib/pdf/london-ta.ts` is probably cleaner than continuing to grow `pdf-export.ts`.
- New `tis-calibration` profile for UK (TRICS-driven), parallel to the current ITE-driven profile.
- Inputs the renderer needs that the current engine doesn't compute:
  - PTAL band + AI for site centroid.
  - Multi-modal trip table from TRICS extract (user upload, schema TBD).
  - ATZ polygon from WebCAT or a built-in 20-min cycle isochrone.
  - Healthy Streets Check workbook (XLSX upload).
  - TLRN / SRN intersection detection (spatial join against 7.11 datasets).
- A `region.country === "GB"` filter in the `regions.ts` lookup that flips downstream defaults (metric units, left-side driving, peak windows).
