# California TIS / VMT Build Spec — State-Dispatched Renderer

**Scope.** This spec defines what a California-flavored transportation impact deliverable must contain when produced for a site located in California. It is consumed by the state-dispatch renderer in [`artifacts/tis-api-server/src/lib/pdf-export.ts`](../artifacts/tis-api-server/src/lib/pdf-export.ts).

**Terminology.** California still uses the label "TIA" or "Transportation Study," but post-2020 the *substance* shifted: vehicle delay / LOS is no longer a CEQA-recognized environmental impact. **Vehicle Miles Traveled (VMT)** is the default CEQA transportation metric. Many local agencies preserve LOS in parallel for **non-CEQA operational review** (site access, signal warrants, queueing). The renderer must produce both with **explicit, unambiguous labels distinguishing CEQA from non-CEQA analysis** — a CA deliverable that bundles LOS into the CEQA findings is legally non-compliant.

**Authority pattern.** California is a stack of three layers:

1. **State CEQA framework** — SB 743 / Pub. Resources Code § 21099 / CEQA Guidelines 14 CCR § 15064.3 / OPR Technical Advisory (Dec 2018). Sets the floor: VMT, not LOS, is the CEQA metric. Effective statewide **2020-07-01**.
2. **Caltrans** — owns the **State Highway System (SHS)**. TAF/TAC govern *CEQA* significance on SHS projects (induced-travel / VMT). HDM, Encroachment Permits Manual, CA MUTCD, Signal Operations Manual govern **non-CEQA** design, permits, and operations (LOS retained).
3. **Local agency (city or county)** — sets its own VMT thresholds, screening tools, and report content. Each major California city adopted its own SB 743 implementation between 2019 and 2024; the thresholds and screening triggers diverge materially.

The renderer therefore must produce a **CEQA-VMT section** (per local lead-agency threshold, MPO-baseline-anchored) **plus** an optional **non-CEQA operational section** (legacy LOS, signal warrants, queueing, sight distance — useful for Caltrans encroachment review, site-access design, and traffic-engineering operations).

> **Headline strategic recommendation: Option C — Hybrid, phased.** Ship the existing LOS engine immediately into a clearly-labeled **"Non-CEQA Operational Analysis"** section for California sites. In parallel, add a **Tier-1 VMT screening engine** (~3–4 engineering-weeks) that covers the OPR screening criteria + 15%-below-baseline determination using published per-jurisdiction baselines. Wire Tier-2 jurisdiction calculators (LA, San Diego, San Jose, San Francisco) as paid integrations over the next 6–9 months. **Do not attempt a Tier-3 MPO-equivalent VMT generator from scratch** — that is a multi-year, multi-engineer commitment that PhD modeling teams take a decade to build. Detailed rationale in [§4](#4-recommended-renderer-architecture) and [§10](#10-honest-scope-assessment).

---

## 1. Authoritative Sources

### 1.1 State CEQA / VMT Framework

| Doc | Edition / Date | URL | TIS-relevant content |
|---|---|---|---|
| **SB 743 (Steinberg, 2013)** — chaptered text | Stats. 2013, Ch. 386; signed 2013-09-27 | https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=201320140SB743 | The law. Directs OPR to amend CEQA Guidelines so LOS is no longer a CEQA significance metric. |
| **Pub. Resources Code § 21099** | live | https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=PRC&sectionNum=21099. | Codifies SB 743. **§ 21099(b)(2)**: *"automobile delay, as described solely by level of service or similar measures of vehicular capacity or traffic congestion, shall not be considered a significant impact on the environment …"* |
| **CEQA Guidelines 14 CCR § 15064.3** — Determining the Significance of Transportation Impacts | Adopted Dec 28, 2018; **statewide effective 2020-07-01** | Final rulemaking text: https://resources.ca.gov/ceqa/docs/2018_ceqa_final_text_122818.pdf · SB 743 program page (LCI): https://lci.ca.gov/ceqa/sb-743/ | Establishes VMT as the default transportation metric. § 15064.3(b)(1): projects within ½-mile of a major transit stop are *presumed* less-than-significant. |
| **OPR / LCI Technical Advisory on Evaluating Transportation Impacts in CEQA** | **December 2018** (current; no formal updates as of June 2026) | https://lci.ca.gov/ceqa/docs/20190122-743_Technical_Advisory.pdf | **THE governing methodology document.** Recommends 15%-below-baseline thresholds, lists screening criteria, defines major transit stop (§ 21064.3) and high-quality transit corridor (§ 21155) by reference. |
| **Pub. Resources Code § 21064.3** | live | https://leginfo.legislature.ca.gov/ | Defines *"major transit stop"* — used in TPA screening. |
| **Pub. Resources Code § 21155** | live | https://leginfo.legislature.ca.gov/ | Defines *"high-quality transit corridor"* (fixed-route bus ≤15 min peak headway) — used in TPA screening. |
| **California Vehicle Code (CVC)** | live | https://leginfo.legislature.ca.gov/faces/codesTOCSelected.xhtml?tocCode=VEH | Statutory basis for signs/signals/markings authority referenced by CA MUTCD. |

> **OPR hosting note.** The Governor's Office of Planning and Research's CEQA functions were folded into the **Governor's Office of Land Use and Climate Innovation (LCI)**. Canonical URLs are now `lci.ca.gov` (not `opr.ca.gov`). Legacy citations both forms appear; renderer footer should use `lci.ca.gov`.

### 1.2 Caltrans

| Doc | Edition / Date | URL | TIS-relevant content |
|---|---|---|---|
| **Transportation Analysis Framework (TAF)** | **2nd Edition, Sept 2025** (1st Ed. Sept 2020) | https://dot.ca.gov/-/media/dot-media/programs/sustainability/documents/vmt/202509-taf-2nd-edition-final-a11y.pdf | Caltrans method for **induced-travel / VMT** analysis on SHS projects. |
| **Transportation Analysis under CEQA (TAC)** | **2nd Edition, Sept 2025** (1st Ed. Sept 2020) | https://dot.ca.gov/-/media/dot-media/programs/sustainability/documents/vmt/202509-tac-2nd-edition-final-a11y.pdf | Caltrans CEQA-significance framework. **TAF and TAC are companion docs**: TAC = significance determination, TAF = method invoked inside TAC for capacity-increasing SHS projects. Non-capacity SHS projects (maintenance, ops fixes) are screened out (TAC § 5.1). |
| **Caltrans SB 743 resource hub** | live | https://dot.ca.gov/programs/sustainability/sb-743/resources | Index page for current TAF/TAC + bulletins. |
| **Highway Design Manual (HDM)** | **7th Edition** (current) | https://dot.ca.gov/programs/design/manual-highway-design-manual-hdm | **LOS still used for state highway design.** Ch. 100 Topic 102 — Design Capacity & Level of Service. Ch. 400 — Intersections at Grade. Chapter PDFs: [Ch. 100](https://dot.ca.gov/-/media/dot-media/programs/design/documents/chp0100-a11y.pdf), [Ch. 400](https://dot.ca.gov/-/media/dot-media/programs/design/documents/chp0400-a11y.pdf). |
| **California MUTCD** | **CA MUTCD 2026**, **effective 2026-01-18** (replaces CA MUTCD 2014 Rev. 9) | https://dot.ca.gov/programs/safety-programs/camutcd · Full PDF: https://dot.ca.gov/-/media/dot-media/programs/safety-programs/documents/ca-mutcd/2026/camutcd-2026-all.pdf | Signs, signals, markings. **Signal warrants in Part 4C.** Substantial conformance with National MUTCD 2023. |
| **Encroachment Permits Manual (EPM)** | Updated chapter-by-chapter; most recent revisions Sept 2023 | Landing: https://dot.ca.gov/programs/traffic-operations/ep/ep-manual · Combined PDF: https://dot.ca.gov/-/media/dot-media/programs/traffic-operations/documents/encroachment-permits/epm-chapters-all-ada-a11y.pdf | **LOS still used here.** Governs work in state ROW; non-CEQA permitting context. This is where the existing LOS engine remains directly useful for Caltrans review. |
| **Traffic Signal Operations Manual** | 2020-01-31 (current) | https://dot.ca.gov/-/media/dot-media/programs/traffic-operations/documents/mobility/traffic-signal-operatons-manual-1-31-2020-a11y.pdf · 2024-08 notice: https://dot.ca.gov/-/media/dot-media/programs/traffic-operations/documents/mobility/202408-notice-signal-ops-manual-a11y.pdf | Signal timing & operations. **Not a "MTSO"** — no Caltrans document carries that title. Use this + CA MUTCD Part 4C for signal warrant analyses. |
| **Caltrans Traffic Operations Manual hub** | live | https://dot.ca.gov/programs/traffic-operations/traffic-ops-manual | Umbrella for the signal-ops material above. |

> **Phantom citation: "MTSO" / "Manual on Traffic Signal Operations".** No Caltrans document carries that title. The closest primary artifacts are the **Traffic Signal Operations Manual (Jan 2020)** + signal **warrants in CA MUTCD Part 4C**. The renderer must **not** cite a non-existent "MTSO" — drop from the canonical citation list.

### 1.3 Major Local Agencies — Adopted VMT Guidelines

Each California city/county set its own VMT thresholds. The eleven below cover roughly 60% of statewide development volume.

| Jurisdiction | Document | Edition | URL | Adopted VMT threshold | Screening trigger |
|---|---|---|---|---|---|
| **City of Los Angeles** | Transportation Assessment Guidelines (TAG) | **July 2020** | https://ladot.lacity.gov/sites/default/files/documents/2020-transportation-assessment-guidelines_final_2020.07.27.pdf | **15% below APC area average** (sub-area baseline, not regional) | 250 daily trips |
| **City of San Francisco** | Transportation Impact Analysis Guidelines for Environmental Review | **Oct 2019** (VMT threshold via Planning Commission Reso. 2016-03-03) | https://sfplanning.org/project/transportation-impact-analysis-guidelines-environmental-review-update · VMT memo: https://default.sfplanning.org/publications_reports/TIA_Guidelines_VMT_Memo.pdf | **15% below Bay Area regional avg** | <100 daily trips; TAZ map screen |
| **City of San Diego** | Transportation Study Manual (TSM) | Adopted **Sept 29, 2020**; current rev **Sept 19, 2022** | https://www.sandego.gov/sites/default/files/10-transportation-study-manual.pdf | **≥15% below SANDAG regional avg** | **Mobility Zones 1/2/3** map screen + Mobility Evaluation Tool (MET) |
| **City of Sacramento** | VMT Thresholds of Significance (2040 General Plan) | **2024** (Council Ord. 2024-0017, June 25, 2024) | https://www.cityofsacramento.gov/community-development/planning | **15% below citywide existing** | <250 daily trips; small/infill/TPA screens |
| **City of San Jose** | Transportation Analysis Handbook (TAH); CEQA thresholds via Council Policy 5-1 | **April 2023** (TAH) | https://www.sanjoseca.gov/your-government/departments-offices/public-works/development-services/transportation-analysis | **15% below citywide** existing | Residential + office screening maps |
| **City of Oakland** | Transportation Impact Review Guidelines for Land Use Development Projects | **April 2017** (supersedes 2013 + 2016 Interim) | https://www.oaklandca.gov/documents/transportation-impact-review-guidelines-for-land-use-development-projects | **15% below MTC regional avg** | <100 daily trips; map screen |
| **City of Long Beach** | CEQA Transportation Methodology / VMT Standards for Development Review (CM Memo) | **June 30, 2020** | https://www.longbeach.gov/lbcd/planning/environmental/ceqa-transportation-methodology/ | **15% below LA County (SCAG) regional avg** | **<500 daily trips** ("low trip generator") |
| **City of Anaheim** | Traffic Impact Analysis Guidelines for CEQA | **Feb 2025 (final draft)** | https://www.anaheim.net/DocumentCenter/View/58979/Anaheim-Draft-TIA-Guidelines-022025-FINAL | **15% below Orange County avg, VMT per service population** (OC-wide convention) | <110 daily trips (per OPR) |
| **City of Fresno** | CEQA Guidelines for VMT Thresholds; **2025 VMT Reduction Program & Nexus Study** Draft EIR (July 2025 public review) | Original Council adoption June 25, 2020; mitigation program mid-2025 | https://www.fresno.gov/planning/plans-projects-under-review/vehicle-miles-traveled/ · Program PDF: https://www.fresno.gov/wp-content/uploads/2025/08/VMT-Reduction-Program-8-8-25-10w916.pdf | **13% below baseline** (Central Valley GHG math — NOT the 15% used in coastal metros) | <500 daily trips; TPA + local-serving-retail <50 ksf |
| **City of Bakersfield** | **No separately adopted city-level TIA/VMT guidelines.** Defers to OPR Dec 2018 defaults on project EIRs. Kern COG workshopping regional guidance | n/a | Environmental docs: https://www.bakersfieldcity.us/279/Environmental-Documents | Effective **15% below baseline** (OPR default) | <110 daily trips (OPR default) |
| **LA County (DPW)** | Transportation Impact Analysis Guidelines | **July 23, 2020** | https://pw.lacounty.gov/traffic/docs/Transportation-Impact-Analysis-Guidelines-July-2020-v1.1.pdf | **16.8% below baseline** (per CARB 2017 Scoping Plan, not 15%) | TAZ-based |

> **Key cross-cutting observations:**
> 1. **15% is the dominant threshold.** Outliers: **Fresno 13%** (Central Valley GHG math), **LA County 16.8%** (CARB 2017 Scoping Plan compute). Renderer must expose threshold % as a configurable per-jurisdiction value.
> 2. **Baseline geography varies materially**: APC sub-area (LA City), Bay Area region (SF, Oakland), SANDAG region (San Diego), citywide existing (Sacramento, San Jose), LA County region (Long Beach), Orange County service-population (Anaheim).
> 3. **Screening trip counts split into camps**: 100 (SF, Oakland) / 110 (Anaheim, OPR default, Bakersfield) / 250 (LA, Sacramento) / 500 (Long Beach, Fresno).
> 4. **LOS is NOT dead** anywhere except inside CEQA in **San Francisco**. Every other jurisdiction retains LOS for non-CEQA operational review.
> 5. **San Jose's LTA** (Local Transportation Analysis, a separate non-CEQA track with its own threshold) and **San Diego's Mobility Choices Program** (programmatic VMT mitigation + Active Transportation In-Lieu Fee) are the two most architecturally distinctive frameworks and warrant city-specific renderer paths.

### 1.4 MPO Travel Demand Models

These are the regional models that produce the **baseline VMT** that local thresholds reference. Each MPO's model is the *legal* baseline source for projects in that region.

| MPO | Region | Current RTP/SCS | Current model | Public access | Project-level VMT tool |
|---|---|---|---|---|---|
| **MTC** | Bay Area (9 counties: Alameda, Contra Costa, Marin, Napa, SF, San Mateo, Santa Clara, Solano, Sonoma) | **Plan Bay Area 2050** (Oct 2021); **PBA 2050+** update slated early 2026 | **Travel Model One v1.6.1** (May 2025); TM2 under development (MAZ-level) | **Fully open-source on GitHub**: https://github.com/BayAreaMetro/travel-model-one ; TM2: https://github.com/BayAreaMetro/travel-model-two | **None published.** Project screening delegated to cities. Regional aggregate via Vital Signs: https://vitalsigns.mtc.ca.gov/indicators/daily-miles-traveled |
| **SCAG** | 6-county S. California (LA, OC, Riverside, San Bernardino, Imperial, Ventura) | **Connect SoCal 2024** (Apr 4, 2024) | **SCAG ABM** (TransCAD); legacy TBM retained as parallel | Files **not publicly downloadable**; documentation only | **HELPR 3.0** Regional Data Platform: https://rdp.scag.ca.gov/helpr/ — contains 2019 per-capita VMT at parcel suitability. LDX: https://scag.ca.gov/local-data-exchange |
| **SACOG** | 6 counties around Sacramento (Sacramento, Yolo, Placer, El Dorado, Sutter, Yuba) | **2025 Blueprint** (MTP/SCS) — adoption Fall 2025 | **SACSIM23** (activity-based, DaySim) | Scripts published (SACSIM19): https://github.com/SACOG/SACSIM19 ; SACSIM23 partial. Full run requires DaySim + regional data | **No SACOG-published project-level tool.** Member jurisdictions handle independently |
| **SANDAG** | San Diego County | **Final Amended 2021 Regional Plan** (CARB-approved Feb 2025); 2025 Regional Plan in development | **ABM3** (base year 2022) for 2025 plan; ABM2+ (2016 base) for 2021 plan | Documentation: https://sandag.github.io/ABM ; some source on GitHub (sandag org) | **YES — SANDAG SB 743 VMT Maps**, the most useful project-level tool in CA: https://geo.sandag.org/portal/apps/experiencebuilder/experience/?id=636ddd919dc6439cb7b8f26ba2c25388 · Methodology: https://www.sandag.org/-/media/SANDAG/Documents/PDF/data-and-research/geographic-information-systems/california-senate-bill-743-vehicle-miles-traveled-documentation-2022-02-11.pdf |
| **Fresno COG** | Fresno County (+ San Joaquin Valley COGs cluster) | n/a — see SJV COGs hub: https://sjvcogs.org/general-plans-findings-recommendations/vehicle-miles-traveled-vmt/ | Fresno COG ABM (DaySim + Replica IX/XI) | Documentation public | **YES — Fresno COG VMT Screening Tool**: http://gis1.lsa.net/FCOGVMT/ · User guide: http://gis1.lsa.net/FCOGVMT/Fresno%20COG%20Screening%20Tool%20User%20Guide%202025.pdf · SB 743 Regional Guidelines (June 2025): https://www.fresnocog.org/wp-content/uploads/2025/10/Fresno-COG-VMT-Thresholds-June-2025_10072025.pdf |
| **AMBAG** | Monterey, San Benito, Santa Cruz | **2045 MTP/SCS** (June 15, 2022) | **RTDM** (TransCAD, 2018 update, 2015 base); **ABM with 2022 base expected June 2026** | Documentation public; model files staff-coordinated | **None published** |

### 1.5 Jurisdiction-published VMT calculators (the *practical* engineering surface)

| Tool | Jurisdiction | URL | What it does |
|---|---|---|---|
| **LA VMT Calculator v1.3** (LADOT, May 2020) | City of LA | https://ladot.lacity.gov/docs/2-vmt-calculator-user-guide · Docs: https://ladot.lacity.gov/sites/default/files/documents/vmt_calculator_documentation-2020.05.18.pdf | Excel; address + land use + units → household VMT/capita + work VMT/employee + screening determination. Uses **ITE Trip Gen 9th Ed.** + SCAG ABM sociodemographic adjustments |
| **City of San Diego — Mobility Choices VMT (uses SANDAG portal directly)** | City of San Diego | https://www.sandiego.gov/sites/default/files/2025-04/dsd_appendix-c-vehicle-miles-traveled-analysis.pdf | Reads SANDAG SB 743 portal at CPA / Census Tract level; applies Mobility Choices in-lieu fee logic |
| **SANDAG SB 743 VMT Maps** | San Diego region | https://geo.sandag.org/portal/apps/experiencebuilder/experience/?id=636ddd919dc6439cb7b8f26ba2c25388 | ArcGIS Experience Builder app; VMT/resident + VMT/employee by City / CPA / Census Tract |
| **Fresno COG Screening Tool** | Fresno County (+ valley) | http://gis1.lsa.net/FCOGVMT/ | LSA-hosted ArcGIS app; parcel-level screening |
| **SCAG HELPR 3.0** | SCAG 6-county region | https://rdp.scag.ca.gov/helpr/ | Regional Data Platform; parcel suitability VMT layer (2019 baseline) |

### 1.6 CAPCOA — VMT-reduction Mitigation Handbook

| Doc | Edition | URL | Purpose |
|---|---|---|---|
| **CAPCOA Handbook for Analyzing GHG Emission Reductions, Assessing Climate Vulnerabilities, and Advancing Health and Equity** | **2024 Edition** — adopted by CAPCOA Board **2024-11-21**; supersedes Dec 2021 Handbook | https://www.caleemod.com/handbook/index.html · Update project page: https://www.airquality.org/residents/climate-change/ghg-handbook-caleemod | The canonical source of quantified VMT-reduction credits for **mitigation** (TDM, density, transit proximity, mixed-use, parking management). Chapter 3 = transportation measures. Stacked-measures multiplicative cap to prevent over-counting. |
| **CAPCOA 2010 Quantifying Greenhouse Gas Mitigation Measures** | 2010 (legacy; still cited in older local guidelines) | http://www.capcoa.org/wp-content/uploads/2010/11/CAPCOA-Quantification-Report-9-14-Final.pdf | Predecessor handbook; cite only if the host jurisdiction's guidelines lock to it (some still do). |
| **CARB January 2019, *2017 Scoping Plan-Identified VMT Reductions and Relationship to State Climate Goals*** | Jan 2019 | https://ww2.arb.ca.gov/resources/documents/carb-2017-scoping-plan-identified-vmt-reductions-and-relationship-state-climate | Source of the **16.8%** (light-duty per-capita) and **14.3%** (overall per-capita) figures. LA County uses 16.8%. |
| **CARB 2017 Climate Change Scoping Plan** | 2017 | https://www.arb.ca.gov/cc/scopingplan/scoping_plan_2017.pdf | Underlying GHG target framework. |

---

## 2. VMT Methodology Fundamentals

A CEQA-compliant California transportation impact analysis is **not** a renamed LOS report. It is a different analytical product. This section spells out the step-by-step.

### 2.1 Metric by land use (OPR Tech Advisory, Dec 2018)

| Land use | Metric | Why |
|---|---|---|
| **Residential** | **Home-based VMT per capita** (tour-based ideal; trip-based acceptable) | Efficiency metric, ties to GHG target |
| **Office / employment** | **Home-based work VMT per employee** | Workplace location drives commute distance |
| **Retail** | **Net change in total VMT** (absolute, not per-capita) | Retail is diversionary, not generative — measure rerouting |
| **Industrial / manufacturing / warehousing** | **VMT per employee** (by analogy to office; OPR sets no explicit number) | Insufficient OPR research base — local agency develops project-specific threshold |
| **Mixed-use** | **Analyze each component separately, taking internal-capture credit**. OPR explicitly discourages combining behind a single threshold (Advisory p. 6, 16). | Combining masks which use drives impact |
| **Hotels, hospitals, schools, special uses** | **No OPR-recommended metric.** Lead agency develops. LA County treats K-12, hotel/motel, college under the office (VMT/employee) approach. | Insufficient research base |

For office projects with a customer-facing component (e.g., government office serving public), OPR allows the customer component to be analyzed under the **retail** method (Advisory p. 5).

### 2.2 The 15%-below-baseline rule (verbatim from OPR Dec 2018)

OPR Technical Advisory, p. 10: *"OPR recommends that a per capita or per employee VMT that is fifteen percent below that of existing development may be a reasonable threshold."* For retail (p. 16): *"a net increase in total VMT may indicate a significant transportation impact."*

**What "baseline" means.** OPR allows the residential threshold to be measured against **regional VMT/capita OR city VMT/capita** (p. 15). For office, OPR says use the **region**, but if the region is much larger than the typical commute-shed, **the county may be used** (p. 16). "Region" = MPO planning region (SCAG, MTC, SANDAG, SACOG, AMBAG, Fresno COG, etc.). For unincorporated areas, lead agency may compare against (1) regional VMT/capita, or (2) population-weighted aggregate of all cities in the region.

**Threshold-percentage variants in practice:**
- **OPR default: 15%** — most cities follow this verbatim
- **LA County: 16.8%** (CARB 2017 Scoping Plan compute) — applied across LA County DPW guidelines
- **Fresno: 13%** — Central Valley GHG-aligned reduction target
- **Anaheim / Orange County: 15% of County VMT per service population** (a different denominator entirely)

The renderer must make threshold percentage **and** baseline geography configurable per jurisdiction — these are not safely hardcodeable.

### 2.3 Apples-to-apples constraint (OPR p. 4–5)

**The project VMT estimate and the threshold must use the same method.** If the baseline is tour-based (activity-based MPO model output), project VMT must be tour-based. If trip-based, both trip-based. Mixing breaks comparability.

### 2.4 Baseline VMT data sources — order of preference

1. **MPO travel demand model run by jurisdiction** (gold standard). LA County's guidelines (§ 3.1.4.2) require the **SCAG RTP/SCS Travel Demand Forecast Model** for residential, office, and land-use-plan VMT estimates. SANDAG, MTC, SACOG publish equivalent regional models for their regions.
2. **MPO- or jurisdiction-published screening maps / tables**: SCAG HELPR 3.0; SANDAG SB 743 portal; SACOG screening maps; Fresno COG tool. Lets consultants screen smaller projects without commissioning a model run.
3. **CARB SB 375 / Scoping Plan VMT targets** as state-level benchmark to *derive* the threshold percentage (the 16.8% figure), not as the project-comparison baseline.
4. **Local agency travel surveys / household data** for small jurisdictions without MPO model access.

### 2.5 Project VMT estimation methods

Three estimation paths in actual consultant practice:

| Method | When used | Effort |
|---|---|---|
| **MPO model "with project / plus project" run** | Gold standard — required for contested EIR-level projects; required by LA County for office/residential | Days–weeks; license fees; specialist labor |
| **Jurisdiction-published VMT calculator** | LA, San Diego, Fresno County have published calculators; SF/MTC use SFCTA's SF-CHAMP for SF projects | Hours per project; calculator parameterizes everything |
| **ITE Trip Generation × average trip length** (legacy) | Small projects under screening thresholds; used to compute the 110-trip / 250-trip / 500-trip screen | Minutes — but only valid for screening, not for impact determination |

### 2.6 Screening criteria — auto-exemption (OPR § E.1, p. 12–14)

A project may be screened out of full VMT analysis if **any** of the following apply:

1. **Small project: <110 daily trips.** OPR p. 12: *"projects that generate or attract fewer than 110 trips per day generally may be assumed to cause a less-than-significant transportation impact."* Tied to CEQA § 15301(e)(2) categorical exemption (10,000 sf addition). Some jurisdictions adopt higher screens (250 — LA, Sacramento; 500 — Long Beach, Fresno) — these are jurisdiction-specific stretches of OPR's floor.
2. **Transit Priority Area (TPA): within ½-mile of a major transit stop or high-quality transit corridor.** Major transit stop defined in PRC § 21064.3 (rail, ferry, OR intersection of two major bus routes ≤15-min peak headway). High-quality transit corridor defined in PRC § 21155 (fixed-route bus ≤15-min peak headway). **TPA presumption does NOT apply** if the project: (a) has FAR <0.75; (b) provides more parking than required; (c) is inconsistent with the SCS; or (d) replaces affordable units with fewer market-rate units (Advisory p. 14).
3. **Low-VMT area (map-based screen).** Residential/office projects sited in mapped TAZs already performing 15% below baseline are presumed less-than-significant, when project features (density, mix, transit access) are similar to the surrounding low-VMT zone.
4. **Locally-serving retail (size-limited).** Local-serving retail (LA County draws the line at <50,000 sf; OPR concurs) is presumed less-than-significant because it shortens trips.
5. **100% affordable residential infill.** OPR p. 14–15.
6. **Redevelopment with net VMT decrease.** Replacing a VMT-generating use with a lower-VMT use is presumed less-than-significant — except where the replacement displaces affordable housing near transit.

### 2.7 VMT-reduction mitigation (CAPCOA 2024 Handbook)

When a project exceeds the threshold, the report must propose VMT-reducing **mitigation measures** with quantified reduction credits drawn from the CAPCOA 2024 Handbook. Categories:

- **Land Use** — density, diversity, location efficiency
- **Neighborhood Design** — intersection density, pedestrian network
- **Transit** — proximity, frequency, network expansion
- **Parking Management** — supply reduction, pricing, unbundling
- **Trip Reduction / TDM** — employer commute programs, ride-share, telework
- **Pricing / Road Management**

Each measure has a percentage-reduction formula parameterized on project context (urban / suburban / rural; transit availability). Stacked measures apply a **multiplicative cap** so the total reduction can't double-count. The 2024 update split measures into (a) those with sufficient evidence for quantified reductions and (b) those requiring additional evidence — only (a) can be applied as primary mitigation; (b) is supplemental.

Caltrans' July 2022 Mitigation Playbook (citing CAPCOA Dec 2021, now superseded by 2024) specifically endorses **increased density** and **affordable housing inclusion** as the highest-leverage residential VMT mitigations.

### 2.8 Geographic scale

- **TAZ (Traffic Analysis Zone)**: standard unit for MPO model VMT estimation. Roughly census-tract-sized.
- **Census tract**: sometimes used for screening maps when MPO TAZ data isn't published openly.
- **City / county / MPO region**: the unit for the **baseline** comparison (denominator of the threshold).
- **Project boundary**: **never** sufficient. OPR p. 6 explicitly prohibits truncating analysis at jurisdictional or project boundaries.

### 2.9 Tour-based vs. trip-based models (current state, 2026)

- **SCAG**: SCAG ABM (activity-based, CT-RAMP family); legacy TBM retained in parallel.
- **MTC**: Travel Model One (trip-based, but with strong sub-models); TM2 (activity-based) under development.
- **SANDAG**: ABM3 (activity-based, CT-RAMP-derived).
- **SACOG**: SACSIM23 (activity-based, DaySim).
- **AMBAG**: TransCAD 4-step (trip-based; ABM update June 2026).
- **Fresno COG**: ABM with DaySim for II trips, Replica big-data for IX/XI.

Implication: most major CA MPOs are activity-based by 2026. The renderer's VMT engine should accept either tour-based or trip-based inputs, but flag which side of the apples-to-apples constraint the analysis is on.

---

## 3. Where LOS Still Applies in California

LOS did not disappear in California — it was moved **out of the CEQA process**. It remains the controlling metric in five distinct contexts. The existing LOS engine retains direct utility for all five.

| Context | LOS required? | Authority |
|---|---|---|
| **CEQA transportation impact significance** | **No** — *"shall not"* be the indicator | PRC § 21099(b)(2); 14 CCR § 15064.3(a) |
| **Local non-CEQA review** — general plan consistency, congestion management, traffic-engineering operations, site-access design, queueing | **Yes** — agencies remain free to use LOS for their own operational/design standards | OPR Tech Advisory p. 3 expressly preserves this discretion |
| **Caltrans state-highway design (HDM)** | **Yes** — HDM Ch. 100 Topic 102 and Ch. 400 still specify LOS for design capacity | HDM 7th Edition |
| **Caltrans Encroachment Permits** (non-CEQA permitting of work in state ROW) | **Yes** — LOS-based operational analysis still required for impact review of state highway facilities | Encroachment Permits Manual (EPM) |
| **Signal warrants** | LOS not used; **CA MUTCD Part 4C warrants** govern | CA MUTCD 2026 |

**Practical contexts where the existing LOS engine remains immediately useful in California:**

1. **Caltrans Encroachment Permit applications** — any new driveway, lane modification, or work in state ROW triggers an EPM application; LOS-based operational analysis is expected.
2. **Local site-access design review** — every California city does signal warrant + queue analysis + sight-distance review at driveway intersections regardless of CEQA outcome.
3. **San Jose's LTA (Local Transportation Analysis)** — formally codified non-CEQA LOS+ track required alongside the CEQA-VMT analysis whenever a project adds ≥10 peak-hour trips per lane to a signalized intersection within ½-mile already at LOS D or worse.
4. **San Diego's TSM Ch. 4 "operations" section** — explicitly retains LOS for site-access operations review.
5. **Anywhere outside SF that has retained LOS-based congestion management** — most of CA still has CMPs that monitor LOS, even if CEQA can't use it.

> The renderer should label the LOS section unambiguously as **"Non-CEQA Operational Analysis"** for California sites, with a footnote citing PRC § 21099(b)(2) so the reviewer knows the report author understands LOS does not satisfy CEQA. Failing to label correctly is the most common compliance error a non-CA consultant makes.

---

## 4. Recommended Renderer Architecture

Three options on the table. The honest assessment of each:

### Option A — Drop LOS, build VMT-only report (CEQA-compliant)
- **Pros:** Cleanest CEQA story; matches the statewide regulatory direction; matches SF practice.
- **Cons:** Throws away the existing LOS engine investment. Forces us to build a working VMT engine *before* California ships at all. Fails to serve **Caltrans Encroachment Permits** (where LOS is still the controlling metric), **non-CEQA local operational review** (where every city except SF still wants LOS at the driveway), and **HDM-driven site-access design**. Practically: an A-only product ships zero in California for 6–12 months.

### Option B — Keep LOS, label clearly as "non-CEQA operational analysis"
- **Pros:** Existing engine ships immediately. Covers Caltrans encroachment, site-access design, signal warrants, queueing. Honest labeling.
- **Cons:** **Does not produce a CEQA-compliant transportation impact analysis.** A consultant trying to use the deliverable for CEQA still needs to commission a separate VMT analysis elsewhere. We surface as a useful operational supplement, not as the primary CEQA deliverable. This is a real but limited market — Caltrans encroachment work alone is a healthy slice.

### Option C — Hybrid: LOS section + VMT section in one report ★ RECOMMENDED
- **Pros:** Matches what actual California consultants produce. The deliverable serves both the CEQA-VMT reviewer (lead agency planner / environmental coordinator) and the operational reviewer (Caltrans encroachment, local public works traffic engineer). Allows **phased build**: ship LOS-labeled-non-CEQA immediately, add Tier-1 VMT screening engine over weeks, add Tier-2 jurisdiction integrations over months.
- **Cons:** More UI surface; risk of bundling LOS into CEQA findings if labeling fails; more configuration per jurisdiction. None of these are blocking.

**Recommendation: Option C, phased.** Concrete sequencing:

**Phase 1 (immediate, days):** Ship existing LOS engine to California with the section labeled **"Non-CEQA Operational Analysis (Caltrans Encroachment Permit / Local Operational Review)"** and a prominent footer citing PRC § 21099(b)(2). Add a top-of-report banner: *"This report does not satisfy CEQA transportation impact requirements; a separate VMT analysis is required for CEQA."*

**Phase 2 (3–4 engineering-weeks):** Build a **Tier-1 VMT screening engine** that:
- Applies OPR screening criteria (110-trip floor or jurisdiction-specific override; TPA from a GIS transit-stop layer; low-VMT-area lookup; local-serving retail size cap; affordable infill flag; redevelopment net-VMT flag)
- Computes the 15%-below-baseline determination using **published per-jurisdiction baseline values** (LA City APC averages, SF Bay Area regional, San Diego SANDAG regional, Sacramento citywide, etc.)
- Outputs a **screening determination** — either "presumed less-than-significant" with the applicable criterion cited, or "VMT analysis recommended" with the recommended methodology (MPO model / jurisdiction calculator) called out.
- Cites OPR Dec 2018 + the host jurisdiction's adopted guidelines doc by URL.

**Phase 3 (6–9 months, opportunistic):** Wire **Tier-2 jurisdiction integrations** as paid add-ons:
- **City of LA** — reimplement the VMT Calculator v1.3 logic in code; pull SCAG TAZ baselines via HELPR 3.0
- **San Diego** — wire the SANDAG SB 743 portal (ArcGIS REST) for City / CPA / Census Tract VMT lookups
- **San Francisco** — wire SFCTA's TM1-derived TAZ baselines (TM1 is open source — feasible)
- **Fresno County** — wire the Fresno COG screening tool

Each Tier-2 wire takes 6–12 weeks and must validate against the published tool. Treat each as a separate commercial deliverable.

**Phase 4 (out of scope, indefinitely):** **Do not** attempt a Tier-3 MPO-equivalent VMT generator from scratch. SCAG ABM, MTC TM1, SANDAG ABM3, SACSIM23 each represent 10–20 engineer-years of investment by PhD transportation modelers. Even a single-MPO replica at production fidelity is 3–5 years with a team of 3–5 engineers + 1–2 transportation modelers, and would not be defensible in court as a substitute for the official MPO model. Direct contested projects to commission an MPO run from the regional agency or a consultant.

---

## 5. VMT Engine Requirements (Tier 1, the buildable scope)

A Tier-1 VMT screening engine needs the following components.

### 5.1 Per-jurisdiction baseline lookup table

For each supported jurisdiction, store: baseline residential VMT/capita, baseline VMT/employee, threshold percentage, baseline geography (APC / region / county / citywide / service-population), adopted-baseline-year, source URL.

Seed data:

| Jurisdiction | Res VMT/cap baseline | Empl VMT/empl baseline | Threshold % | Baseline geography | Source |
|---|---|---|---|---|---|
| LA City | per-APC (~12.7 to ~22.3) | per-APC (~18.4 to ~19.0) | 15% | APC sub-area | LA TAG (Jul 2020) |
| SF | (region avg, ~9.0 region-wide) | (region avg) | 15% | MTC region | SF TIA Guidelines (Oct 2019) |
| San Diego | (SANDAG region avg) | (SANDAG region avg) | 15% (i.e., ≤85% of regional) | SANDAG region | San Diego TSM (Sept 2022) |
| Sacramento | citywide | citywide | 15% | Citywide | Sacramento 2040 GP (2024) |
| San Jose | citywide | citywide | 15% | Citywide | San Jose TAH (Apr 2023) |
| Oakland | (Bay Area region) | (Bay Area region) | 15% | MTC region | Oakland TIR Guidelines (Apr 2017) |
| Long Beach | 11.8 (i.e., 15% below LA Co. 13.9) | 18.0 (15% below 21.2) | 15% | LA County (SCAG) region | Long Beach CM Memo (Jun 2020) |
| Anaheim | (OC region, VMT/service pop) | (OC region) | 15% | Orange County, VMT/svc-pop | Anaheim TIA Guidelines (Feb 2025) |
| Fresno (city) | (Fresno County baseline) | (Fresno County baseline) | **13%** | Fresno County | Fresno CEQA Guidelines (2020) + 2025 Program |
| Bakersfield | (defaults to OPR Dec 2018) | (defaults to OPR Dec 2018) | 15% | Per OPR | (OPR default; no adopted) |
| **LA County (DPW)** | 22.3 (North), 12.7 (South) | 19.0 (North), 18.4 (South) | **16.8%** | LA County sub-area | LA County DPW Guidelines (Jul 2020) |

Renderer must source the *current* baseline value from the MPO's latest published RTP/SCS or local guidelines on a per-project basis; the table above is a seed, not the truth.

### 5.2 Screening flag computation

For each project, compute six booleans:

1. `under_110_trips` (or under jurisdiction-specific override: 100/250/500)
2. `within_half_mile_major_transit_stop` (GIS query against a transit-stop layer derived from PRC § 21064.3 and § 21155 definitions; build from MPO GTFS-aggregated stops + headway data)
3. `in_low_vmt_taz` (lookup against jurisdiction-published low-VMT map)
4. `local_serving_retail_under_50ksf` (land use + size)
5. `affordable_housing_infill_100pct` (project flag)
6. `redevelopment_net_vmt_decrease` (comparison of existing vs. proposed land uses)

If **any** is true (with the TPA presumption qualifiers respected), the screen returns "presumed less-than-significant" with the criterion cited.

### 5.3 Project VMT estimation (when not screened)

For projects that don't screen out, the Tier-1 engine outputs **"VMT analysis recommended; recommend MPO model run via {region's MPO} or use of {jurisdiction's published calculator}"** with a deep link to the right tool. It does **not** attempt to produce a defensible project VMT number itself in Tier 1.

### 5.4 Mitigation menu (CAPCOA 2024)

For projects that don't screen out, render a menu of CAPCOA 2024 mitigation measures applicable to the project's land use + transit context. The renderer presents the measure list with citations; quantification of the reduction percentage requires Tier-2 integration (the formulas need land use, density, transit data wired together — not in Tier 1's scope).

### 5.5 Threshold determination

Tier 1 outputs three possible findings per land-use component:
- **Less-than-significant (screened)** — with cited screening criterion
- **VMT analysis recommended** — for non-screened projects; renderer hands off to Tier-2 or external consultant
- **Mitigation required** — only achievable after Tier-2 wires actual VMT numbers; not a Tier-1 finding

---

## 6. Required Deliverable Elements (VMT-style Report)

When the renderer produces a CEQA-VMT report (Option A or C path), the deliverable must include:

### 6.1 Required tables
- **Project description summary** (parcel/APN, land uses, units / sf by land use, phasing)
- **Screening determination matrix** (each OPR criterion × yes/no with citation)
- **Baseline VMT table** (per-capita / per-employee values, geography, source, year)
- **Project VMT estimate table** (by land use component; with tour- vs. trip-based labeled)
- **Significance threshold + comparison table** (baseline × (1 - threshold%) = threshold; project VMT vs. threshold)
- **Mitigation measure table** (CAPCOA reference, reduction %, post-mitigation VMT)
- **Cumulative VMT table** (project + cumulative scenarios)
- **RTP/SCS consistency table** (project alignment with regional SCS)

### 6.2 Required figures
- **Site vicinity map** with TPA overlay (½-mile buffers from major transit stops + high-quality transit corridors)
- **Site plan** with access points, parking count, bicycle/pedestrian connections
- **TAZ map** showing project location + baseline VMT category
- **Low-VMT-area screening map** (if applicable)
- **Transit accessibility map** (stops, routes, frequencies)

### 6.3 Required appendices
- **OPR Technical Advisory citations** (full PDF reference)
- **Local lead agency VMT guidelines citation** (URL + adoption date)
- **MPO baseline derivation** (model run date, RTP/SCS edition, MPO contact if model run was commissioned)
- **CAPCOA mitigation worksheets** (per-measure reduction calculation with stacked-measure cap math)
- **Calculator outputs** (LA Calculator workbook, SANDAG portal screenshot, etc.) where used
- **Transit stop / corridor data source** (GTFS feed, MPO transit network, date)

### 6.4 Non-CEQA Operational Section (when included in hybrid report)
The existing LOS engine output, labeled explicitly:
- Banner: **"Non-CEQA Operational Analysis"**
- Footnote: *"Per PRC § 21099(b)(2) and CEQA Guidelines § 15064.3(a), level-of-service analysis does not constitute a CEQA transportation impact determination. This section is provided for non-CEQA operational review including but not limited to Caltrans Encroachment Permit review under the Encroachment Permits Manual, signal warrant analysis under CA MUTCD Part 4C, queueing and site-access design under Highway Design Manual Chapters 100 and 400, and local agency operational standards."*

### 6.5 PE seal
California-licensed Civil or Traffic Engineer seal/signature/date on the cover and on each sealed sheet (CCR Title 16 Div. 5 Article 6 § 411 — Use of Stamp). Renderer must carry a CA P.E. seal block distinct from TX/GA seal blocks.

---

## 7. California-Specific Terminology Glossary

- **VMT** — Vehicle Miles Traveled. The CEQA transportation metric since 2020.
- **CEQA** — California Environmental Quality Act (PRC § 21000 et seq.). The state environmental review statute.
- **SB 743** — Steinberg, Stats. 2013, Ch. 386. The law that made the LOS-to-VMT shift.
- **OPR / LCI** — Governor's Office of Planning and Research, now the Governor's **Office of Land Use and Climate Innovation**. Publishes the Technical Advisory.
- **TPA** — Transit Priority Area. Within ½-mile of a major transit stop or high-quality transit corridor. Source of the "presumed less-than-significant" screening criterion.
- **Major transit stop** — defined in PRC § 21064.3: rail, ferry, **OR** intersection of two major bus routes with ≤15-min peak headway.
- **High-quality transit corridor** — defined in PRC § 21155: fixed-route bus service with ≤15-min peak headway.
- **SCS** — Sustainable Communities Strategy. The land-use + transportation chapter of each MPO's RTP, required by SB 375.
- **RTP/SCS** — Regional Transportation Plan / Sustainable Communities Strategy. Each MPO produces one.
- **TAF** — Caltrans Transportation Analysis Framework. Induced-travel analysis method for SHS projects.
- **TAC** — Caltrans Transportation Analysis under CEQA. CEQA significance determination for SHS projects.
- **HDM** — Caltrans Highway Design Manual. Where LOS still lives for state highway design.
- **EPM** — Caltrans Encroachment Permits Manual. Where LOS still lives for state ROW permitting.
- **SHS** — State Highway System. Caltrans-owned and -maintained routes.
- **APC** — Area Planning Commission. LA City sub-area used as VMT baseline geography under TAG.
- **CPA** — Community Planning Area. San Diego sub-area unit in SANDAG SB 743 portal.
- **TAZ** — Traffic Analysis Zone. Standard MPO-model spatial unit.
- **CAPCOA** — California Air Pollution Control Officers Association. Publisher of the VMT-reduction mitigation Handbook.
- **CalEEMod** — California Emissions Estimator Model. Where the CAPCOA Handbook is hosted (caleemod.com).
- **CARB** — California Air Resources Board. Publishes SCS evaluation, SB 375 targets, EMFAC.
- **EMFAC** — Emission Factors Model (current: EMFAC2025 v2.1.1, June 2026). Caltrans/CARB joint vehicle emissions + VMT model.
- **PeMS** — Caltrans Performance Measurement System. Sensor data for State Highway System.
- **CSTDM** — California Statewide Travel Demand Model.
- **MPO** — Metropolitan Planning Organization. The four big CA MPOs are SCAG (S. CA), MTC (Bay Area), SACOG (Sacramento), SANDAG (San Diego).
- **LTA** — Local Transportation Analysis (San Jose). The codified non-CEQA operational track distinct from the CEQA-VMT analysis.
- **TSM** — Transportation Study Manual (San Diego). The local guidelines doc.
- **TAG** — Transportation Assessment Guidelines (LA City). The local guidelines doc.
- **TAH** — Transportation Analysis Handbook (San Jose). The local guidelines doc.
- **Mobility Choices** — San Diego's programmatic VMT mitigation framework + Active Transportation In-Lieu Fee.
- **Service population** — population + employment (used in Orange County / Anaheim VMT denominator).
- **Caltrans District** — Caltrans's 12 administrative districts (D1–D12); the encroachment permit reviewer is the District with jurisdiction over the route.

> **What is NOT California-canonical terminology:**
> - **"TIS"** — California consultants generally say **"Transportation Study"** or **"TIA"**; "TIS" is more common in GA/TX/FL. The substance is the bigger issue: a "TIS" historically means LOS-based; the CA equivalent is VMT-based.
> - **"MTSO"** / **"Manual on Traffic Signal Operations"** — does not exist as a Caltrans document title. Cite the **Traffic Signal Operations Manual** (Jan 2020) + **CA MUTCD Part 4C** (signal warrants) instead.

---

## 8. Thresholds and Review Triggers

### 8.1 OPR-recommended significance thresholds (statewide floor)

| Land use | Threshold | Source |
|---|---|---|
| Residential | **15% below** regional OR city baseline VMT/capita | OPR TA p. 10 |
| Office | **15% below** regional baseline VMT/employee (county allowed if region is large) | OPR TA p. 16 |
| Retail | **Net increase in total VMT** | OPR TA p. 16 |
| Industrial | **Not specified by OPR.** Apply office method by analogy. Local agency develops project-specific. | — |

### 8.2 Caltrans (SHS, CEQA only)

- **TAC 2nd Ed. (Sept 2025)** governs CEQA significance on Caltrans SHS projects.
- **TAF 2nd Ed. (Sept 2025)** is invoked from TAC for capacity-increasing SHS projects to compute **induced travel**.
- **Non-capacity SHS projects** (maintenance, ops fixes) are **screened out** of induced-travel analysis (TAC § 5.1).
- Caltrans expresses VMT change in **absolute terms** for SHS projects.

### 8.3 Caltrans Encroachment Permits (non-CEQA)

- No state-level trip threshold for triggering an encroachment permit application; **any work in state ROW** requires a permit. LOS-based operational analysis expected for any new access onto an SHS route.

### 8.4 City-specific VMT screening triggers (where renderer must apply jurisdiction-specific value)

| Jurisdiction | Screening trip count (project below = presumed less-than-significant) |
|---|---|
| **San Francisco** | <100 daily trips |
| **Oakland** | <100 daily trips |
| **Anaheim** | <110 daily trips (per OPR) |
| **Bakersfield** | <110 daily trips (per OPR default) |
| **Los Angeles (city)** | <250 daily trips |
| **Sacramento** | <250 daily trips |
| **Long Beach** | <500 daily trips |
| **Fresno** | <500 daily trips |
| **San Diego** | **Mobility Zone-based** (1/2/3), not a single trip count — use the Mobility Evaluation Tool (MET) |
| **San Jose** | **Map-based** residential + office screens, not a single trip count |

> The renderer must dispatch the right screening threshold by jurisdiction. Hardcoding 110 to all California sites will under-screen LA / Sacramento and over-screen SF / Oakland.

---

## 9. California-Specific Data Sources

| Source | URL | What it provides | Wireable? |
|---|---|---|---|
| **CSTDM (Caltrans Statewide TDM)** | https://dot.ca.gov/programs/transportation-planning/division-of-transportation-planning/state-planning/statewide-modeling/california-statewide-travel-demand-model | Statewide trip/VMT/mode-share by TAZ | Files-only; not API |
| **CARB SB 375 Regional Targets** | https://ww2.arb.ca.gov/our-work/programs/sustainable-communities-program/sb-375-regional-targets | Per-capita GHG (proxy VMT) targets per MPO; SB 150 progress | PDF-only (cite) |
| **EMFAC** | https://emfac.arb.ca.gov/ (canonical) | On-road emission factors + VMT activity by county/air basin/MPO. **Current: EMFAC2025 v2.1.1** (June 2026, supersedes EMFAC2021) | Web tool + CSV download — semi-wireable |
| **Caltrans PeMS** | https://pems.dot.ca.gov/ | SHS detector flow/speed/occupancy (~40k loops). 5-min real-time; archive ≥10 yr | Free account (1–2 day approval); CSV bulk export per detector |
| **Caltrans Traffic Census / AADT** | https://dot.ca.gov/programs/traffic-operations/census · ArcGIS: https://gis.data.ca.gov/datasets/d8833219913c44358f2a9a71bda57f76 | Annual AADT, peak-hour, truck % on state highways | **YES — ArcGIS REST API, direct wire** |
| **California Road System (CRS) / HPMS All Public Roads Network** | https://gisdata-caltrans.opendata.arcgis.com/datasets/2d56e65de89c418780056651640291e8_0/about · Parent: https://dot.ca.gov/programs/research-innovation-system-information/highway-performance-monitoring-system | Functional class, lane count, surface, ownership, federal-aid status (RHiNo analog) | **YES — ArcGIS REST API** |
| **TIMS (UC Berkeley SafeTREC)** | https://tims.berkeley.edu/ | Geocoded SWITRS crashes; mapping + summary (10-yr rolling) | **YES — bulk CSV per query; the primary safety wire** |
| **CHP SWITRS** | https://www.chp.ca.gov/programs-services/services-information/switrs-internet-statewide-integrated-traffic-records-system | Crash records (collision, party, victim) | **Public SWITRS query interface retired 2025-01-08; replaced by CCRS (not yet a queryable public interface).** Use **TIMS** instead. |
| **STIP (CTC)** | https://catc.ca.gov/programs/state-transportation-improvement-program | Funded state-highway & regional projects, 5-yr horizon. **2026 STIP adopted Mar 19, 2026** | PDF/Excel — cite + parse |
| **CTP 2050 (Caltrans)** | https://dot.ca.gov/programs/transportation-planning/california-transportation-plan-2050 | Long-range policy framework | PDF-only (cite) |
| **Caltrans GIS Data Library** | https://gisdata-caltrans.opendata.arcgis.com/ | Hub for SHN lines, AADT, truck ADT, bottlenecks, rail, lane config, functional class | **YES — ArcGIS REST + WFS, primary wire** |
| **CA Dept of Finance Demographic Projections** | https://dof.ca.gov/forecasting/demographics/projections/ | Population + components of change by county, 2020–2070. **Current: 2026 vintage (Mar 13, 2026)** | **YES — XLSX/CSV per vintage** — denominator for VMT/capita math |
| **EPA Smart Location Database (SLD)** | https://www.epa.gov/smartgrowth/smart-location-mapping · REST: https://geodata.epa.gov/arcgis/rest/services/OA/SmartLocationDatabase/MapServer | Built-environment "D-variables" (density, diversity, design, transit, destination) per CBG; nationwide | **YES — ArcGIS REST API**; fallback VMT-per-capita layer where no MPO model |

### Wireability summary

**Tier 1 — direct API/bulk-CSV (build adapters now):**
Caltrans Traffic Census AADT, Caltrans GIS Library, CRS/HPMS, TIMS, EPA SLD, DOF Projections, **SANDAG SB 743 portal** (ArcGIS), **Fresno COG screening tool** (ArcGIS), **MTC TM1 outputs** (GitHub open-source — feasible but heavy).

**Tier 2 — registered / bulk export (scriptable but gated):**
PeMS (free account), EMFAC2025 (CSV output).

**Tier 3 — PDF-only (cite, don't ingest):**
CSTDM model files, CARB SB 375 targets (hardcode stable values per MPO), STIP, CTP 2050.

> **Version flags for the renderer:**
> - **EMFAC2025 v2.1.1** is current (June 2026). Do NOT cite EMFAC2021 — superseded.
> - **2026 STIP** is the adopted cycle (March 19, 2026); 2024 STIP is prior.
> - **CHP SWITRS public query retired 2025-01-08**; replacement is CCRS but it is not yet a public queryable interface. **TIMS is the only practical California crash wire today.**
> - **CA MUTCD 2026** effective **2026-01-18** (replaces 2014 Rev. 9). Renderer should cite 2026 edition.

---

## 10. Honest Scope Assessment

How big is the VMT engineering effort? Here are the three tiers laid out honestly, with hours/weeks/months.

### Tier 1 — Screening engine (lookup table + OPR criteria)
- **Effort: 3–10 engineering-days for working prototype; ~3–4 weeks for production-grade.**
- Scope: Per-jurisdiction baseline VMT/capita and VMT/employee values + threshold percentages + screening triggers, hardcoded with citations. OPR screening criteria implemented as a boolean cascade. GIS transit-stop layer (from MPO GTFS feeds + headway data) for the ½-mile TPA query. ITE rate × land use for the <110/250/500 trip screen.
- **What it satisfies:** OPR-screened projects only — projects that **clearly** qualify for one of the six screening presumptions. For these, the determination is defensible.
- **What it does NOT satisfy:** Any project that doesn't screen out. For contested projects, the lead agency will still require an MPO model run or a published-calculator VMT estimate. Tier 1 ends with **"VMT analysis recommended"** and a deep link to the right tool.
- **Verdict: WORTH DOING.** This is the buildable, ship-fast version.

### Tier 2 — Wire jurisdiction calculators (LA, SD, SF, Fresno)
- **Effort: 6–12 engineering-weeks per jurisdiction; ~6–9 months for top 3–4 jurisdictions.**
- Scope: Reimplement each city's published VMT calculator logic in code. LA's Calculator v1.3 is an Excel workbook with documented inputs (address, land use, units) and outputs (daily VMT, screening determination) using ITE Trip Gen 9th Ed. + SCAG ABM sociodemographic adjustments. SANDAG SB 743 portal is an ArcGIS app with TAZ-level lookups. SF uses SFCTA's TM1-derived baselines (TM1 is open source on GitHub — feasible). Fresno COG's tool is a published ArcGIS screening app.
- **What it satisfies:** Defensible project-level VMT estimates within the supported jurisdictions, matching the published tool's output within a few percent.
- **What it does NOT satisfy:** Contested EIR-level projects where the lead agency requires an MPO model run (not the calculator). Other jurisdictions until separately wired.
- **Verdict: WORTH DOING as paid add-ons, sequenced by market demand.** LA + San Diego first (largest TIS markets). SF and Fresno next.

### Tier 3 — Build MPO-equivalent VMT generator from scratch
- **Effort: 3–5 years with a team of 3–5 engineers + 1–2 transportation modelers, per MPO region. Each MPO's model represents 10–20 engineer-years of investment by PhD modeling teams.**
- Scope: Rebuild an activity-based travel demand model — TAZ socioeconomic data ingestion, network skim matrices, mode choice, tour generation/destination choice, time-of-day, assignment. Then calibrate against observed counts (PeMS, AADT) annually.
- **What it satisfies:** Nothing legally — would not be defensible in court as a substitute for the official MPO model regardless of fidelity.
- **Verdict: DO NOT ATTEMPT.** This is the whole company's mission, not a feature. For contested projects, direct users to commission an MPO run from the regional agency or a consultant (Fehr & Peers, Iteris, Kittelson, etc.).

### Net assessment

The honest answer to the user's question — *days, weeks, or months?* — is:

- **Weeks (3–4)** for a defensible Tier-1 screening engine that covers the OPR criteria and matches what 60–80% of California projects need.
- **Months (6–9)** to wire Tier-2 jurisdiction integrations for the top 3–4 markets.
- **Years (and not worth it)** for Tier-3 MPO replication.

Ship Tier 1 in the next sprint. Sell Tier 2 as paid integrations sequenced by market. Don't ship Tier 3.

---

## 11. Comparison to Georgia DRI / GDOT (Atlanta Sample)

The user provided a Georgia DRI sample showing US-typical LOS-based TIS structure. Documenting the fundamental incompatibility honestly:

| Dimension | Georgia / GDOT (DRI sample) | California (post-2020) |
|---|---|---|
| **Statutory basis** | GDOT TIS Guidelines + DRI rules under ARC / regional commission | CEQA (PRC § 21000+); SB 743 amended PRC § 21099; CEQA Guidelines 14 CCR § 15064.3 |
| **Primary metric for impact significance** | **LOS** (intersection delay, A–F) | **VMT** per capita / per employee / total. **LOS is statutorily excluded** from CEQA impact significance (PRC § 21099(b)(2)) |
| **Triggering review** | DRI tiered by trips + population (Tier 1/2/3) | OPR Dec 2018 Tech Advisory: <110 trips screen + TPA + low-VMT-area + local-serving retail + 100% affordable infill + redevelopment-net-decrease |
| **Regional review hook** | DRI via ARC and other Regional Commissions | None equivalent. MPO RTP/SCS consistency is reviewed by lead agency, not by the MPO itself for individual projects |
| **Trip generation** | ITE Trip Generation Manual (latest, 11th Ed.) | ITE rates still used for screening (110-trip cutoff), but **the impact metric is VMT, not trips** |
| **Build / horizon year** | Opening Year + 5 typical | Existing year + horizon year per RTP/SCS (typically 2050) for cumulative |
| **Mitigation framework** | GDOT pass-by + ITE-standard reductions + signal/intersection improvements | **CAPCOA 2024 Handbook**: density, TDM, transit, parking, mixed-use. Not intersection improvements — those don't reduce VMT |
| **PE seal** | GA-licensed P.E. | CA-licensed Civil or Traffic Engineer (CCR T. 16 Div. 5 Art. 6 § 411) |
| **Report substance** | LOS tables AM/PM, queueing, recommended geometric improvements | Project VMT vs. baseline, screening determination, TPA map, mitigation menu, RTP/SCS consistency narrative |
| **Where LOS still appears in CA** | Everywhere | Only **outside CEQA**: Caltrans HDM (design), Caltrans EPM (encroachment permits), local non-CEQA operational review, signal warrants per CA MUTCD Part 4C |
| **Fundamental incompatibility** | A GA-style DRI report is a non-compliant CEQA deliverable in California regardless of how thorough the LOS analysis is. Conversely, a CA VMT analysis without a Caltrans encroachment LOS section is **operationally incomplete** if the site fronts an SHS route. | |

**Implication for the engine.** The Georgia renderer and the California renderer are NOT variants of the same template with different citations swapped in. They are different analytical products. The California renderer must be a **separate dispatch path** in `pdf-export.ts`, not a "Georgia-with-CA-citations" overlay. The hybrid (Option C) renderer adds a **CA-specific Operational section** that reuses the existing LOS engine's tables and figures but **labels them unambiguously as non-CEQA** with the PRC § 21099(b)(2) footer.

---

## 12. Renderer Dispatch Notes

For [`pdf-export.ts`](../artifacts/tis-api-server/src/lib/pdf-export.ts), the California dispatch should:

1. **Resolve site coordinates → jurisdiction → MPO region → SHS frontage**:
   - Jurisdiction: city if inside city limits, else county
   - MPO region: SCAG / MTC / SACOG / SANDAG / Fresno COG / AMBAG by geometry
   - SHS frontage: any Caltrans route in frontage triggers the Caltrans-section + EPM track
2. **Pick the CEQA-VMT section pack** based on host jurisdiction:
   - **LA City** → LA TAG (Jul 2020), 15% APC baseline, 250-trip screen, LA Calculator v1.3 deep-link
   - **SF** → SF TIA Guidelines (Oct 2019), 15% MTC region baseline, 100-trip screen, **SF removes LOS from CEQA path entirely** (use VMT-only section, no operational section by default for SF unless user opts in)
   - **San Diego** → San Diego TSM (Sept 2022), 15% SANDAG region (i.e., ≤85% regional), Mobility Zones screen, **SANDAG SB 743 portal deep-link**
   - **Sacramento** → 2040 GP (2024), 15% citywide, 250-trip screen
   - **San Jose** → TAH (Apr 2023), 15% citywide, map-based screen, **separate LTA non-CEQA track**
   - **Oakland** → TIR Guidelines (Apr 2017), 15% MTC region, 100-trip screen
   - **Long Beach** → CM Memo (Jun 2020), 15% LA County region, 500-trip screen
   - **Anaheim / OC** → Anaheim TIA Guidelines (Feb 2025), 15% OC VMT/service-population, 110-trip screen
   - **Fresno (city)** → CEQA Guidelines (2020) + 2025 Program, **13%** Fresno County, 500-trip screen
   - **Bakersfield** → OPR Dec 2018 defaults, 15% baseline, 110-trip screen, flag "no local adoption"
   - **LA County (DPW, unincorporated)** → LA County DPW Guidelines (Jul 2020), **16.8%** sub-area baseline
   - **Other CA cities (unlisted)** → OPR Dec 2018 defaults with explicit "OPR-default" flag and "host-agency scoping required" callout
3. **Layer the Caltrans section** when any SHS route is in frontage:
   - **TAF/TAC (2nd Ed. Sept 2025)** citations for CEQA-significance framing
   - **HDM 7th Ed. Ch. 100 + Ch. 400** for design references
   - **EPM** + **CA MUTCD 2026 Part 4C** for non-CEQA encroachment/warrant references
   - District identification (D1–D12) per route geometry
4. **Layer the non-CEQA Operational section** (Option C) using the existing LOS engine, labeled **"Non-CEQA Operational Analysis"** with the PRC § 21099(b)(2) footnote.
5. **PE seal block**: CA Civil or Traffic Engineer per CCR T. 16 Div. 5 Art. 6 § 411. Distinct from TX P.E. and GA P.E. seal blocks.
6. **CA-specific footer** on every page: cite OPR Dec 2018 Tech Advisory + CEQA Guidelines § 15064.3 + host jurisdiction's guidelines doc by URL + adopted-year.
7. **Top-of-report banner** for hybrid reports: *"This report includes a non-CEQA operational analysis section. Per PRC § 21099(b)(2), level-of-service analysis does not satisfy CEQA transportation impact requirements. CEQA significance determination is provided in §[VMT-section-number] using the VMT methodology required by CEQA Guidelines § 15064.3."*

---

## 13. Open Items / Confidence Flags

Items that need verification before productionizing the renderer:

- **MPO baseline VMT values per jurisdiction** — for each city's adopted baseline, pull the current numeric value from the host MPO's published RTP/SCS or jurisdiction guidelines. The 22.3 / 12.7 / 19.0 / 18.4 figures I cited from LA County DPW Guidelines (Jul 2020) are the current published numbers but may have been updated in supplementary memos. Pull from the source quarterly.
- **SF baseline VMT/capita and VMT/employee** — confirm the current SF Planning-published numbers used in TPA-screening determinations. SF's published numbers post-2019 are not in this brief.
- **Long Beach baselines** — confirm 11.8 / 18.0 (computed from 2016 SCAG RTP/SCS 13.9 and 21.2 with 15% reduction). The 2024 Connect SoCal update may have shifted these.
- **Anaheim VMT per service population baseline** — Feb 2025 final draft; confirm Anaheim Council adopted the draft, and confirm the OC-wide service-population baseline value.
- **Bakersfield local adoption** — Kern COG RPAC has been workshopping regional VMT guidance (most recent agenda Nov 5, 2025). Confirm whether a Kern COG VMT guidelines doc has been formally adopted by the time of renderer ship.
- **San Diego TSM next revision** — TSM was last revised Sept 19, 2022; check for a 2025/2026 revision aligned with the SANDAG 2025 Regional Plan.
- **MTC Plan Bay Area 2050+ adoption date** — scheduled early 2026; confirm whether it has shipped.
- **SACOG 2025 Blueprint adoption** — slated for Fall 2025 (delayed from Spring 2024); confirm adoption status.
- **SANDAG 2025 Regional Plan** — politically contested (road-charge controversy from 2021 plan); confirm the 2025 plan status and whether ABM3 is the final modeling foundation.
- **AMBAG 2022-base ABM** — slated for June 2026; confirm release.
- **OPR Technical Advisory updates** — the December 2018 Advisory is current as of June 2026; check for any 2025–2026 supplemental memo before ship.
- **CAPCOA 2024 Handbook implementation in jurisdictions** — most local guidelines still cite the December 2021 edition. Confirm whether each host jurisdiction has explicitly adopted the 2024 edition or whether the 2021 edition remains the locked reference for VMT mitigation quantification.
- **CHP CCRS public access** — confirm whether CHP's CCRS replacement for SWITRS has launched a public query interface by ship date. If not, TIMS remains the only practical crash wire.
- **EMFAC2025 v2.1.1 stability** — confirm no further point releases before renderer ship.
- **2026 STIP final adoption** — adopted March 19, 2026 per CTC; confirm if any amendments before ship.
- **CA MUTCD 2026 effective date** — January 18, 2026 effective; confirm no implementation delays.

When the renderer cites a doc whose value was not directly verified above, it should append an inline **"[verify against current edition]"** tag rather than hard-code a number drawn from secondary sources.

---

## Appendix A — Source Index

### Statutes & regulations
- SB 743 (2013): https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=201320140SB743
- PRC § 21099: https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=PRC&sectionNum=21099.
- 14 CCR § 15064.3 (rulemaking text): https://resources.ca.gov/ceqa/docs/2018_ceqa_final_text_122818.pdf
- LCI SB 743 hub: https://lci.ca.gov/ceqa/sb-743/

### OPR / LCI
- Technical Advisory (Dec 2018): https://lci.ca.gov/ceqa/docs/20190122-743_Technical_Advisory.pdf
- LCI Technical Advisories landing: https://lci.ca.gov/ceqa/technical-advisories.html

### Caltrans
- SB 743 resource hub: https://dot.ca.gov/programs/sustainability/sb-743/resources
- TAF 2nd Ed. (Sept 2025): https://dot.ca.gov/-/media/dot-media/programs/sustainability/documents/vmt/202509-taf-2nd-edition-final-a11y.pdf
- TAC 2nd Ed. (Sept 2025): https://dot.ca.gov/-/media/dot-media/programs/sustainability/documents/vmt/202509-tac-2nd-edition-final-a11y.pdf
- HDM landing: https://dot.ca.gov/programs/design/manual-highway-design-manual-hdm
- HDM Ch. 100: https://dot.ca.gov/-/media/dot-media/programs/design/documents/chp0100-a11y.pdf
- HDM Ch. 400: https://dot.ca.gov/-/media/dot-media/programs/design/documents/chp0400-a11y.pdf
- CA MUTCD 2026: https://dot.ca.gov/programs/safety-programs/camutcd
- CA MUTCD 2026 PDF: https://dot.ca.gov/-/media/dot-media/programs/safety-programs/documents/ca-mutcd/2026/camutcd-2026-all.pdf
- Encroachment Permits Manual: https://dot.ca.gov/programs/traffic-operations/ep/ep-manual
- Traffic Signal Operations Manual: https://dot.ca.gov/-/media/dot-media/programs/traffic-operations/documents/mobility/traffic-signal-operatons-manual-1-31-2020-a11y.pdf
- Traffic Operations Manual hub: https://dot.ca.gov/programs/traffic-operations/traffic-ops-manual

### MPOs
- MTC: https://mtc.ca.gov/planning/long-range-planning/plan-bay-area-2050
- MTC TM1 GitHub: https://github.com/BayAreaMetro/travel-model-one
- MTC TM2 GitHub: https://github.com/BayAreaMetro/travel-model-two
- MTC Vital Signs VMT: https://vitalsigns.mtc.ca.gov/indicators/daily-miles-traveled
- SCAG Connect SoCal: https://scag.ca.gov/connect-socal
- SCAG HELPR: https://rdp.scag.ca.gov/helpr/
- SCAG LDX: https://scag.ca.gov/local-data-exchange
- SCAG model validation (RTP24): https://www.scag.ca.gov/sites/default/files/2024-12/scag_model_validation_report_final_rtp24.pdf
- SACOG Blueprint: https://www.sacog.org/planning/blueprint
- SACSIM19 GitHub: https://github.com/SACOG/SACSIM19
- SACOG SCS Methodology: https://ww2.arb.ca.gov/sites/default/files/2024-02/SACOG%202025%20SCS%20Technical%20Methodology.pdf
- SANDAG 2021 Regional Plan: https://www.sandag.org/regional-plan/2021-regional-plan/final-2021-regional-plan
- SANDAG modeling: https://www.sandag.org/data-and-research/transportation-modeling
- SANDAG ABM docs: https://sandag.github.io/ABM
- SANDAG SB 743 VMT Maps: https://geo.sandag.org/portal/apps/experiencebuilder/experience/?id=636ddd919dc6439cb7b8f26ba2c25388
- SANDAG SB 743 methodology: https://www.sandag.org/-/media/SANDAG/Documents/PDF/data-and-research/geographic-information-systems/california-senate-bill-743-vehicle-miles-traveled-documentation-2022-02-11.pdf
- Fresno COG VMT thresholds (Jun 2025): https://www.fresnocog.org/wp-content/uploads/2025/10/Fresno-COG-VMT-Thresholds-June-2025_10072025.pdf
- Fresno COG screening tool: http://gis1.lsa.net/FCOGVMT/
- SJV COGs: https://sjvcogs.org/general-plans-findings-recommendations/vehicle-miles-traveled-vmt/
- AMBAG 2045 MTP/SCS: https://www.ambag.org/plans/2045-metropolitan-transportation-plan-sustainable-communities-strategy

### Cities & counties
- LA City TAG (Jul 2020): https://ladot.lacity.gov/sites/default/files/documents/2020-transportation-assessment-guidelines_final_2020.07.27.pdf
- LA Calculator user guide: https://ladot.lacity.gov/docs/2-vmt-calculator-user-guide
- LA Calculator documentation v1.3: https://ladot.lacity.gov/sites/default/files/documents/vmt_calculator_documentation-2020.05.18.pdf
- SF TIA Guidelines: https://sfplanning.org/project/transportation-impact-analysis-guidelines-environmental-review-update
- SF VMT memo: https://default.sfplanning.org/publications_reports/TIA_Guidelines_VMT_Memo.pdf
- San Diego TSM: https://www.sandego.gov/sites/default/files/10-transportation-study-manual.pdf
- San Diego Mobility Choices: https://www.sandiego.gov/complete-communities/mobility-choices
- San Diego MET: https://www.sandiego.gov/sustainability-mobility/mobility/mobility-evaluation-tool
- San Diego VMT analysis appendix C: https://www.sandiego.gov/sites/default/files/2025-04/dsd_appendix-c-vehicle-miles-traveled-analysis.pdf
- Sacramento planning: https://www.cityofsacramento.gov/community-development/planning
- San Jose Transportation Analysis: https://www.sanjoseca.gov/your-government/departments-offices/public-works/development-services/transportation-analysis
- Oakland TIR Guidelines: https://www.oaklandca.gov/documents/transportation-impact-review-guidelines-for-land-use-development-projects
- Long Beach CEQA Transportation: https://www.longbeach.gov/lbcd/planning/environmental/ceqa-transportation-methodology/
- Anaheim TIA: https://www.anaheim.net/409/Traffic-Impact-Analysis-Guidelines
- Anaheim Feb 2025 Draft: https://www.anaheim.net/DocumentCenter/View/58979/Anaheim-Draft-TIA-Guidelines-022025-FINAL
- Fresno VMT program: https://www.fresno.gov/planning/plans-projects-under-review/vehicle-miles-traveled/
- Fresno VMT Reduction Program (Aug 2025): https://www.fresno.gov/wp-content/uploads/2025/08/VMT-Reduction-Program-8-8-25-10w916.pdf
- Bakersfield environmental: https://www.bakersfieldcity.us/279/Environmental-Documents
- LA County DPW Guidelines (Jul 2020): https://pw.lacounty.gov/traffic/docs/Transportation-Impact-Analysis-Guidelines-July-2020-v1.1.pdf
- LA County Implementation Report (Fehr & Peers, Jun 2020): https://pw.lacounty.gov/traffic/docs/Implementation-Report.pdf

### CAPCOA / CARB
- CAPCOA 2024 Handbook: https://www.caleemod.com/handbook/index.html
- CAPCOA handbook update project: https://www.airquality.org/residents/climate-change/ghg-handbook-caleemod
- CARB Jan 2019 VMT Reductions paper: https://ww2.arb.ca.gov/resources/documents/carb-2017-scoping-plan-identified-vmt-reductions-and-relationship-state-climate
- CARB 2017 Scoping Plan: https://www.arb.ca.gov/cc/scopingplan/scoping_plan_2017.pdf
- CARB SB 375 Regional Targets: https://ww2.arb.ca.gov/our-work/programs/sustainable-communities-program/sb-375-regional-targets

### Data sources
- CSTDM: https://dot.ca.gov/programs/transportation-planning/division-of-transportation-planning/state-planning/statewide-modeling/california-statewide-travel-demand-model
- EMFAC: https://emfac.arb.ca.gov/
- PeMS: https://pems.dot.ca.gov/
- Caltrans Traffic Census: https://dot.ca.gov/programs/traffic-operations/census
- Traffic Volumes AADT (geoportal): https://gis.data.ca.gov/datasets/d8833219913c44358f2a9a71bda57f76
- HPMS / CRS: https://dot.ca.gov/programs/research-innovation-system-information/highway-performance-monitoring-system
- All Public Roads Network: https://gisdata-caltrans.opendata.arcgis.com/datasets/2d56e65de89c418780056651640291e8_0/about
- TIMS: https://tims.berkeley.edu/
- SWITRS: https://www.chp.ca.gov/programs-services/services-information/switrs-internet-statewide-integrated-traffic-records-system
- STIP: https://catc.ca.gov/programs/state-transportation-improvement-program
- CTP 2050: https://dot.ca.gov/programs/transportation-planning/california-transportation-plan-2050
- Caltrans GIS Data Library: https://gisdata-caltrans.opendata.arcgis.com/
- DOF projections: https://dof.ca.gov/forecasting/demographics/projections/
- EPA SLD: https://www.epa.gov/smartgrowth/smart-location-mapping
