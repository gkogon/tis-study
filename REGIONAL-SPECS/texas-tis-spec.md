# Texas TIA Build Spec — State-Dispatched Renderer

**Scope.** This spec defines what a Texas-flavored Traffic Impact Analysis (TIA) PDF must contain when produced for a site located in Texas. It is consumed by the state-dispatch renderer in [`artifacts/tis-api-server/src/lib/pdf-export.ts`](../artifacts/tis-api-server/src/lib/pdf-export.ts).

**Terminology.** Texas uses **TIA** (Traffic Impact Analysis), not **TIS**. TxDOT's own statewide procedure is titled "Traffic Impact Analysis" in Chapter 16 of the Traffic and Safety Analysis Procedures Manual; Houston, Austin, Dallas, Fort Worth, San Antonio, Harris County, and Travis County all use **TIA**. The renderer should label outputs **TIA** for Texas sites regardless of internal product wording.

**Authority pattern.** Texas is unusual: there is no single statewide manual that fully governs a development TIA. **TxDOT controls access onto state-system roadways** (the IH/US/SH/FM/RM/BU/BS/SL/SS designations), but the development itself is reviewed by the **city** (inside city limits or ETJ) — and the big cities have published their own TIA standards that differ materially from one another. The renderer therefore must produce a **TxDOT-section** when state ROW is touched **and** a **city-section** with the host city's conventions, with both running in parallel.

---

## 1. Authoritative Sources

### 1.1 TxDOT — Statewide

| Doc | Edition | URL | TIA-relevant content |
|---|---|---|---|
| **Traffic and Safety Analysis Procedures Manual (TSP)**, Ch. 16 — Traffic Impact Analysis | Current (HTML controlling) | https://www.txdot.gov/manuals/des/tsp/chapter-16-traffic-impact-analysis-.html | **The statewide TIA procedure.** Sections 16.1 Introduction, 16.2 Process, 16.2.1 Categories, 16.2.4 Report, 16.3 Scope of Analysis, 16.4 Methodology, 16.4.3 Mitigation. |
| **TSP Ch. 16 Appendix Q** — TIA Report Outline + worked examples | Current | https://www.txdot.gov/manuals/des/tsp/chapter-16---appendix-q---traffic-impact-analysis.html (also https://ftp.txdot.gov/pub/txdot/crossroads/des/documents/tssas/traffic-and-safety-analysis-procedures-manual-appendix.pdf) | Required outline + example problems. **Cite as Appendix Q** in renderer footer. |
| **Access Management Manual (ACM)** | July 2011 PDF; HTML on txdot.gov is controlling | https://www.txdot.gov/manuals/des/acm/ (PDF: https://onlinemanuals.txdot.gov/TxDOTOnlineManuals/TxDOTManuals/acm/acm.pdf) | **When a TIA is required** on state ROW. Ch. 2 §3 (connection spacing, Table 2-2), Ch. 2 §4 (driveway permits/design), **Ch. 3 §3 — Engineering Analysis (TIA vs. engineering study).** Pairs with TSP Ch. 16 — ACM says *when*, TSP says *how*. |
| **Roadway Design Manual (RDW)** | Nov 2022 (verify Manual Notice page) | https://onlinemanuals.txdot.gov/TxDOTOnlineManuals/TxDOTManuals/rdw/index.htm | **Ch. 16 Driveways** (16.1–16.5); plus design speed, intersection sight distance, turn-lane geometry chapters. |
| **Texas MUTCD (TMUTCD)** | 2025 edition, effective **Jan 18, 2026** (conforms to MUTCD 11th Ed.) | https://www.txdot.gov/business/resources/traffic-design-standards/tmutcd.html | Signs, signals, markings; signal warrants cited in TIAs. |
| **Traffic Signals Manual (TFF)** | Current | https://onlinemanuals.txdot.gov/TxDOTOnlineManuals/txdotmanuals/tff/tff.pdf | Signal warrant analysis, design, operations. |
| **Project Development Process Manual (PDP)** | Rev Nov 2024 | https://www.txdot.gov/manuals/des/pdp/index.html (PDF: https://www.txdot.gov/content/dam/txdotoms/des/pdp/pdp.pdf) | **§3.4.4 Traffic and Safety Analysis** — where TIA plugs into project development. |
| **Plans, Specifications & Estimates Manual (PSE)** — Sealing Procedures | Current | https://www.txdot.gov/manuals/des/pse/chapter-3--plan-set-development/section-4--engineer-s-seal-and-signature-requireme.html | PE seal/signature requirements. |

> **"Subdivision Manual" does not exist as a standalone TxDOT publication.** Subdivision/plat TIA triggers on the state system live in ACM Ch. 3. The renderer must not cite a non-existent "Subdivision Manual" — drop from the canonical citation list.

### 1.2 City of Houston

**Correction 2026-06-12**: Earlier draft cited "2023 IDM (effective Nov 27, 2023)" — **wrong**. The IDM Ch. 15 PDF at the URL below carries footer revision date **07-01-2022**. No 2023 edition exists at that URL as of this verification. The TIA Content Guide is **Dec 22, 2020**.

| Doc | Edition | URL |
|---|---|---|
| **Infrastructure Design Manual (IDM) Ch. 15** — Traffic and Signal Design Requirements | **Revision 07-01-2022** (verified by PDF footer) | https://www.houstonpermittingcenter.org/media/6471/download |
| **TIA Content Guide and OCE Format Requirements** | **Dec 22, 2020** (verified verbatim) | https://www.houstonpermittingcenter.org/media/6016/download |
| **OCE Traffic landing page** | live | https://www.houstonpermittingcenter.org/office-city-engineer/traffic |
| **Houston Access Management Data Summary Form** (mandatory companion — embedded in IDM at pp. 15-5 to 15-8) | live | https://www.houstonpermittingcenter.org/media/3866/download |
| **CPC 101 Form** (additional required item for TIA approval per TIA Content Guide p. 3) | live | [verify URL — referenced in TIA Content Guide] |
| **Major Thoroughfare and Freeway Plan (MTFP)** | live, Planning & Development | https://www.houstontx.gov/planning/transportation/MTFP.html |

### 1.3 City of Austin

| Doc | Edition | URL |
|---|---|---|
| **Land Development Code Title 25 Ch. 25-6 — Transportation** (TIA trigger at §25-6-117) | live | https://library.municode.com/tx/austin/codes/land_development_code?nodeId=TIT25LADE_CH25-6TR |
| **Transportation Criteria Manual (TCM) §10 — Traffic Impact Analysis** | aligned with Guidelines as of June 20, 2022 | https://library.municode.com/tx/austin/codes/transportation_criteria_manual?nodeId=TRCRMA_S10TRIMAN |
| **City of Austin TIA Guidelines** | June 2022 | https://www.austintexas.gov/sites/default/files/files/Transportation/Transportation_Development_Services/Austin_TIA_Guidelines_06-2022.pdf |
| **TIA Determination Worksheet** | live | https://www.austintexas.gov/sites/default/files/files/Transportation/Transportation_Development_Services/TIA_Determination_Worksheet.pdf |
| **TIA Scope Template** | July 2022 v2 | https://www.austintexas.gov/sites/default/files/files/Transportation/Transportation_Development_Services/TIA_Scope_Template_07-2022v2.pdf |
| **Street Impact Fee Guidelines** | Jan 31, 2023 | https://www.austintexas.gov/sites/default/files/files/Transportation/Street_Impact_Fee/SIF_Guidelines_2023-01-31.pdf |
| **Austin Strategic Mobility Plan (ASMP)** | adopted Apr 11, 2019 | https://www.austintexas.gov/sites/default/files/files/Transportation/ASMP/ASMP_Chapters/FINAL_ASMP_LowFormatVersion.pdf |

### 1.4 City of Dallas

Dallas has **no single dated TIA manual** — the renderer must reference a *composite* of the documents below. This is the largest jurisdiction gap in Texas; flag in the report intro that Dallas review is partly discretionary.

| Doc | Edition | URL |
|---|---|---|
| **Dallas Development Code Ch. 51A §51A-4.803** — Site Plan Review (TIA trigger) | live (Ord. 19455 + amendments) | https://codelibrary.amlegal.com/codes/dallas/latest/dallas_tx/0-0-0-84542 |
| **Paving/Drainage Traffic Impact Study Waiver** form | live, Sustainable Development | https://dallascityhall.com/departments/sustainabledevelopment/DCH%20documents/pdf/PavingDrainage_TrafficImpactStudyWaiver.pdf |
| **Connect Dallas Strategic Mobility Plan** (LOS → VMT transition) | adopted Apr 28, 2021 | https://dallascityhall.com/departments/transportation/Pages/Strategic-Mobility-Plan.aspx |
| **CBD Streets and Vehicular Circulation Plan** | 1971, updated 1988 (dated; flag) | https://dallascityhall.com/departments/transportation/DCH%20Documents/Transportation_Planning/pdf/DALLAS_CBD_PLAN.pdf |
| **TxDOT Dallas CityMAP** | live | https://www.dallascitymap.com/ |
| **ProjectDox Engineering Application** | live | https://dallas.gov/departments/sustainabledevelopment/land-management/DCH%20Documents/EPRS/ProjectDox_Engineering_Engineering%20Application.pdf |

### 1.5 City of Fort Worth

| Doc | Edition | URL |
|---|---|---|
| **City of Fort Worth Transportation Engineering Manual (TPW)** | June 2019 | https://www.fortworthtexas.gov/files/assets/public/v/2/tpw/documents/cfw-transportation-engineering-manual.pdf |
| **TIA Worksheet** | live | https://www.fortworthtexas.gov/files/assets/public/v/2/development-services/documents/resources-applications-forms-videos/p/tia-worksheet.pdf |
| **Subdivision Ordinance Ch. 31** (§31-101 access, §31-106 street design) | live | https://codelibrary.amlegal.com/codes/ftworth/latest/ftworth_tx/0-0-0-29534 |
| **Master Thoroughfare Plan** | live | (TPW site) |
| **NCTCOG Regional Thoroughfare Plan** | live | https://resources.nctcog.org/trans/thoroughfare/rtp/index.asp |

### 1.6 City of San Antonio

| Doc | Edition | URL |
|---|---|---|
| **Unified Development Code (UDC) Ch. 35 §35-502** — TIA & Roughly Proportionate Determination | live | http://sanantonio-tx.elaws.us/code/udc_artv_div2_sec35-502 |
| **UDC Appendix B §35-B122** — TIA Submittal Contents | live | http://sanantonio-tx.elaws.us/code/udc_apxb_sec35-b122 |
| **TIA Threshold Worksheet** | live | https://docsonline.sanantonio.gov/FileUploads/dsd/2010-02-12-TIA-Threshold-Worksheet.pdf |
| **Rough Proportionality Ordinance** | live | https://www.sa.gov/files/assets/main/v/1/dsd/roughproportionality.pdf |
| **Information Bulletin 567** (TIA process) | live | https://docsonline.sanantonio.gov/FileUploads/DSD/IB567.pdf |
| **Major Thoroughfare Plan** | live | https://www.sa.gov/Directory/Departments/Transportation/Initiatives/Major-Thoroughfare-Map |
| **UDC §35-208 TOD** (LOS-E carve-out) | live | http://sanantonio-tx.elaws.us/code/udc_artii_sec35-208 |

### 1.7 Secondary Cities

| City | Standard | URL | Threshold |
|---|---|---|---|
| **El Paso** | Municipal Code Title 19 Ch. 19.18 — TIA + Street Design Manual | http://www.elpaso-tx.elaws.us/code/coor_title19_art2_ch19.18 | Not confirmed; chapter exists |
| **Plano** | Engineering Design Standards §12 — TIA | https://www.plano.gov/545/Traffic-Impact-Analysis (manual §12: https://www.planocompplan.org/DocumentCenter/View/4532/Section-12_Traffic-Impact-Analysis) | **≥ 8,000 site-generated ADT** |
| **Frisco** | P117 — Preliminary TIA and Circulation (2023-02-01) + Subdivision Ord. §8 | https://www.friscotexas.gov/DocumentCenter/View/28954/20230201---P117-Frisco---Preliminary-TIA-and-Circulation | Director discretion |
| **McKinney** | Engineering Design Manual Rev. 6 (2024-11-19) | https://www.mckinneytexas.org/DocumentCenter/View/16490/McKinney-Engineering-Design-Manual---Rev-6-20241119 | Not confirmed |
| **Round Rock** | Transportation Criteria Manual §2 TIA (Feb 2021) | https://www.roundrocktexas.gov/wp-content/uploads/2021/02/Sec-2-Traffic-Impact-Analysis-TIA.pdf | Numeric not confirmed |
| **Arlington** | No standalone TIA standard; Design Criteria Manual + ROW Manual | https://www.arlingtontx.gov/City-Services/Transportation-Streets-Traffic/Streets-and-Traffic/Engineers-Builders-Contractors/Design-Criteria-Manual | Staff-scoped at pre-app |
| **Irving** | No standalone TIA standard; references inside UDC | https://library.municode.com/tx/irving/codes/code_of_ordinances | Staff-scoped |
| **Corpus Christi** | No standalone TIA standard; Traffic Engineering reviews case-by-case | https://www.corpuschristitx.gov/department-directory/public-works/services/traffic-engineering/ | Staff-scoped |

### 1.8 Counties (TIA-relevant)

| County | Doc | URL | Threshold |
|---|---|---|---|
| **Harris** | Harris County TIA Guidelines (May 8, 2025) | https://www.eng.hctx.net/Portals/33/Publications/professional-services/standard-traffic/Harris-County-TIA-Guidelines-2025.pdf | **50 new peak-hour trips** triggers TIA; **300 peak-hour trips** triggers corridor capacity analysis |
| **Travis** | TNR Subdivision Preliminary Plan process | https://www.traviscountytx.gov/tnr/development-services/apply-for-a-permit/subdivision-preliminary-plan | **1,000 net new daily trips** |
| **Bexar** | Coordinates through City of San Antonio UDC | — | **75 PHT** (SA UDC) |
| **Dallas / Tarrant** | No county-level TIA program confirmed; review through cities + TxDOT | — | — |

### 1.9 Tollway Authorities

| Authority | Facilities | Access Policy | Notes |
|---|---|---|---|
| **HCTRA** | Sam Houston Tollway, Hardy Toll Rd, Westpark Tollway, Ship Channel Br | No public TIA doc | Closed access; review via TxDOT/Harris Co./Houston frontage roads |
| **NTTA** | PGBT, DNT, SRT, LLTB | No public TIA doc | Closed access; review via TxDOT + host city |
| **CTRMA** | 183A, MoPac Express, 290 Toll | Board Resolution 07-58 | https://www.mobilityauthority.com/wp-content/uploads/2024/01/RESOLUTION_07-58.pdf — DAP for frontage access |
| **TxDOT Toll Ops Div.** (former Turnpike Authority) | Central TX Turnpike Sys, SH 99 Grand Pkwy, SH 249, SH 288 ML | TxDOT ACM | https://www.txdot.gov/discover/toll-roads-managed-lanes/txdot-toll-roads.html |

### 1.10 Special Districts

- **Harris County Flood Control District (HCFCD)** — drainage only; **no TIA review authority**.
- **Houston-area Management Districts (MDs) and MUDs** — funding entities; **no plan-review/TIA-approval authority** (city/county retain it).
- **Austin MUDs** — same pattern; ETJ MUDs default to county + TxDOT until annexed.

---

## 2. Standard Section Structure

### 2.1 TxDOT canonical outline (TSP Ch. 16 / Appendix Q)

The renderer's TxDOT section ordering:

1. **Cover** — title, project name, site location, date, **PE seal block** (Texas-licensed P.E., civil or traffic, with seal + signature + date per 22 TAC §137.33).
2. **Executive Summary** — findings, mitigation, level of effort (Category 1/2/3).
3. **Introduction** — purpose, study sponsor, TIA category determination.
4. **Project Description** — land use, build year, phasing, site plan.
5. **Study Area** — intersections analyzed, peak hours, scoping notes (per TSP §16.3).
6. **Existing Conditions** — geometry, signal timing, posted speed, AADT (TxDOT STARS II / TCDS source), turning-movement counts, crash history (CRIS).
7. **Trip Generation** — ITE 11th Ed., land-use codes, rates vs. equations per ITE Handbook 3rd Ed.
8. **Internal capture, pass-by, diverted-linked** — adjustments with citations.
9. **Trip Distribution & Assignment** — figures.
10. **Background Growth** — historical AADT trend + committed-development trips.
11. **Build / No-Build Analysis** — HCS or Synchro; **Opening Year + 5** future horizon (TSP §16.3).
12. **Mitigation** — per TSP §16.4.3.
13. **Conclusions & Recommendations**.
14. **Appendices** — counts, ITE worksheets, HCS/Synchro output, signal warrants, sight-distance worksheets, scoping memo.

### 2.2 City-specific divergence from the TxDOT outline

| City | Where it diverges |
|---|---|
| **Houston** | **Correction**: "VLOS" / "Vehicle Level of Service" is **NOT a term used in IDM Ch. 15** — the IDM uses plain "LOS" with **LOS D as the published threshold of significance** for transportation facilities on the area street system (IDM §15.04.B.6.a, p. 15-14). Earlier draft's "LOS demoted in 2023 IDM" framing was wrong. Houston still requires the TIA Content Guide outline + Access Management Data Summary Form + CPC 101 Form; tech-memo tier sits between worksheet and full TIA. |
| **Austin** | **Three-tier** process (NTA / Transportation Assessment / Full TIA); requires a separate **Sustainable Modes Analysis** within a **TDM Plan**; **scoping pre-approval** is a hard gate before TIA submittal |
| **Dallas** | No fixed outline; submittal organized around the **§51A-4.803 site-plan review** + waiver form; mid-flight LOS→VMT transition per Connect Dallas |
| **Fort Worth** | Tiered: TIA Worksheet → Abbreviated TIA → Full TIA; **5+ lot subdivisions** must include a phased traffic management plan |
| **San Antonio** | Adds **Rough Proportionality cost calculation** (mitigation $ ≤ max proportional impact); pre-submittal **scoping meeting with TCI + Public Works + Planning** is mandatory |
| **Plano** | Section 12 outline; **1-mile study radius < 10k trips/day**, larger for bigger sites |
| **Round Rock** | TCM §2 outline; PE-sealed compliance statement |
| **Harris County (ETJ)** | Two-tier: TIA at 50 PHT; corridor capacity analysis at 300 PHT |

---

## 3. Methodology Conventions

### 3.1 Trip generation

- **All Texas jurisdictions: ITE Trip Generation Manual 11th Edition.** Austin mandated 11th Ed. effective Jan 1, 2022; Houston Ch. 15 references "latest ITE"; Plano §12 references current ITE; TxDOT TSP §16 references ITE without an edition lock.
- **Rate vs. equation** selection per ITE Trip Generation Handbook 3rd Ed., Fig. 4.2.
- **No Texas city publishes its own trip-generation rate set** comparable to NYC TPI or San Diego SANDAG.

### 3.2 Growth rate

- **TxDOT TSP §16.3.3 does not prescribe a fixed percentage.** Growth is derived from **historical TxDOT AADT trend** (STARS II / TCDS) combined with **current field counts** and known committed development. The common "1–2% compounded" is a district practical default, not manual-mandated. **The renderer must expose growth rate as a configurable input**, default 1.5%, but emit a footnote that the value should be calibrated to the segment's historical AADT trend.
- **Cities defer to TxDOT or NCTCOG/H-GAC/CAMPO/AAMPO regional model factors** for background growth. NCTCOG factors are commonly cited in DFW TIAs.

### 3.3 Build / horizon year

- **TxDOT TSP §16.3:** **Opening Year + 5** is the canonical future horizon. Phased developments add interim horizon years per phase.
- **Cities** generally follow the same convention; Austin uses Opening Year + 5 in TIA Guidelines (June 2022); Houston Ch. 15 follows same. Plano uses Opening Year + 5 for studies ≤10k trips, +10 for larger.

### 3.4 LOS standards

| Jurisdiction | Standard | Notes |
|---|---|---|
| **TxDOT** | No statewide LOS mandate; district-discretion | TSP §16 leaves target to district + project |
| **Houston** | **LOS D** (IDM §15.04.B.6.a, p. 15-14: "threshold of significance for transportation facilities on the area street system is LOS D") | **Verified verbatim** in IDM revision 07-01-2022; earlier "VLOS" / "LOS demoted" framing was wrong |
| **Austin** | **LOS A–F still in use.** Mitigation when a movement drops from D (No-Build) to E (Build) | No VMT switch as of June 2022 |
| **Dallas** | **Transitional LOS → VMT.** Legacy LOS D suburban / E in CBD per practice | Per Connect Dallas (Apr 2021) |
| **Fort Worth** | **LOS D arterials/collectors outside CBD; LOS E in CBD and Urban Villages** | June 2019 manual |
| **San Antonio** | **LOS D general; LOS E in TOD overlays** (UDC §35-208) | |
| **Plano** | **LOS D peak-hour target** | §12 |
| **Harris County** | LOS D peak-hour target | TIA Guidelines 2025 |

### 3.5 Mixed-use / TDM reductions

- **Austin** is the most aggressive: **internal capture, transit proximity, reduced parking supply, TDM measures, affordable housing** all allowed and codified as Street Impact Fee credits per the SIF Guidelines (Jan 31, 2023). A formal **Sustainable Modes Analysis** is required.
- **Houston, Dallas, Fort Worth, San Antonio** allow ITE-standard internal capture + pass-by; no codified TDM credit system equivalent to Austin's.
- **TxDOT TSP §16** allows ITE pass-by / internal capture without prescribing a city-style TDM framework.

### 3.6 Data collection — counts

- **TxDOT**: 13-hour ATR counts or 2-hour peak TMCs at study intersections; sample within last 12 months; avoid school/holiday windows; document day-of-week + weather.
- **Houston (verified verbatim, IDM §15.06.01)**: counts current within **12 months in high-growth areas** or **24 months elsewhere** (§15.06.01.A); restricted to Tue–Thu, school in session, no holidays, no summer counts without City Traffic Engineer authorization (§15.06.01.B–C). Earlier draft's flat "24 months" was incomplete.
- **Austin**: pre-COVID counts no longer accepted by default; counts within 24 months, scope memo must justify older data.
- **Dallas / Fort Worth / San Antonio**: 12–24 month window; school-in-session.
- **All jurisdictions**: count source, date, weather, and observer must appear in the appendix.

---

## 4. Required Deliverable Elements

### 4.1 TxDOT (per TSP Ch. 16 Appendix Q)

**Required tables:** Site Trip Generation; Internal Capture/Pass-By; Trip Distribution; Background Growth derivation; Existing LOS by intersection; No-Build LOS; Build LOS; Mitigation summary.

**Required figures:** Site vicinity map; site plan with access; study area with intersections labeled; existing geometry/lane configuration; existing AM/PM TMC; trip distribution arrows; AM/PM site trips; AM/PM build volumes; recommended mitigation geometry.

**Required appendices:** scoping memo; TMC count sheets; ITE worksheets; HCS/Synchro outputs; signal warrant analyses (TMUTCD-cited); sight-distance worksheets (RDW Ch. 2 + Ch. 16); access permit application materials (Form 1058 series).

**PE stamp.** Texas-licensed P.E. seal/signature/date per 22 TAC §137.33 (Texas Engineering Practice Act, Tex. Occ. Code Ch. 1001). Seal must appear on the **cover** and on every sealed sheet of the report.

**Submission.** Through the TxDOT **District** with jurisdiction over the route. TIA accompanies a **Driveway Access Permit (DAP)** application.

### 4.2 Houston

**Tables/figures:** Per TIA Content Guide — trip generation (with ITE codes, rates/equations, pass-by/internal capture); distribution + assignment figures; existing/background/build VLOS tables; queue analysis; signal warrants where applicable; site access evaluation.

**Required companion:** **Houston Access Form** for all commercial sites.

**Submission:** Office of the City Engineer, Traffic Group, via Houston Permitting Center (electronic PDF default). **Must be approved before plan submittal for permitting** if no plat is required.

**PE seal:** Texas P.E. (civil) on the report.

### 4.3 Austin

**Process gates:** (1) TIA Determination Worksheet → TDS portal; (2) Scope of Work submittal + fees; (3) Transportation Assessment or Full TIA submittal.

**Required deliverables:** project description; study area/intersections; existing conditions; trip generation with **reductions table**; distribution/assignment; background growth; build conditions; LOS analysis (AM/PM, Sat as applicable); queueing; **Sustainable Modes Analysis + TDM Plan**; mitigation; conclusions.

**Submission:** TransportationReview@austintexas.gov — Transportation Development Services (TDS) Division, Austin Transportation and Public Works.

### 4.4 Dallas

**No fixed required-elements list.** Submittal carries the same engineering tables/figures as TxDOT plus alignment with **Connect Dallas** (cite VMT + multimodal context) and any applicable PD overlay traffic conditions. **TIS Waiver form** required when threshold not triggered.

**Submission:** Plan Commission via Sustainable Development & Construction; substantive review by **Dallas DOT Traffic Engineering**; engineering plans via **ProjectDox**.

### 4.5 Fort Worth

**Tiered deliverables:** TIA Worksheet (<100 PHT); Abbreviated TIA (100–299 PHT); Full TIA (≥300 PHT or ≥5,000 ADT). Full TIA carries the standard TxDOT-equivalent outline plus **mitigation plan with cost/phasing** and reference to the **MTP** and **NCTCOG Regional Thoroughfare Plan** for affected segments.

**Submission:** TPW Traffic Engineering via Development Services. Pre-scoping meeting expected for full TIAs.

### 4.6 San Antonio

**Required elements (UDC App. B §35-B122):** Exec Summary; site description; existing conditions; ITE trip generation; distribution; build/no-build LOS; signal warrant + turn-lane analysis; queueing; **Rough Proportionality cost calculation**; conclusions.

**Submission:** TIA Threshold Worksheet → DSD → if triggered, mandatory scoping meeting with **TCI + Public Works + Planning** → consultant proceeds.

**PE seal:** TX P.E. with traffic-engineering expertise specifically called out.

### 4.7 Secondary cities (renderer hints)

- **Plano**: §12 outline; 1-mile study radius scaling rule.
- **Frisco**: P117 checklist.
- **McKinney**: EDM Rev. 6 chapter on TIA.
- **Round Rock**: TCM §2 outline + PE-sealed compliance statement.
- **El Paso**: Code Ch. 19.18 + Street Design Manual references.
- **Arlington / Irving / Corpus Christi**: defer to staff scoping; renderer should generate a TxDOT-equivalent outline + flag "host-city scoping required, no published threshold."

---

## 5. Texas-Specific Terminology Glossary

- **TIA** — Traffic Impact Analysis. Canonical term in Texas. Not TIS.
- **DAP** — Driveway Access Permit. TxDOT's permit for site access onto state-system ROW; the gate under which a TIA is required by TxDOT.
- **ETJ** — Extraterritorial Jurisdiction. Outside city limits but within city's extraterritorial reach for plat approval (LGC Ch. 212).
- **MTP / MTFP** — Major Thoroughfare Plan (FW, SA) / Major Thoroughfare and Freeway Plan (Houston). Long-range ROW preservation map; classification + ROW width.
- **MUD / PID / MD** — Municipal Utility District / Public Improvement District / Management District. Funding entities. **No TIA review authority.**
- **HCTRA / NTTA / CTRMA** — Houston / North Texas / Central Texas tollway authorities.
- **TCDS / STARS II** — TxDOT's Traffic Count Database System / Statewide Traffic Analysis and Reporting System (II). Source of historical AADT.
- **RHiNo** — TxDOT Roadway Inventory.
- **CRIS** — Crash Records Information System (TxDOT).
- **UTP** — Unified Transportation Program. TxDOT's 10-year program; Texas equivalent of STIP/TIP for state-funded work.
- **STIP** — federally-required 4-year slice of UTP.
- **VLOS** — Vehicle Level of Service (Houston 2023 IDM term).
- **Rough Proportionality** — San Antonio doctrine requiring mitigation cost ≤ max proportional impact (UDC §35-502).
- **Sustainable Modes Analysis** — Austin TIA requirement (multimodal/TDM section).
- **TMUTCD** — Texas Manual on Uniform Traffic Control Devices.

**TxDOT route designations (cite in renderer glossary box):**

| Code | Name | Notes |
|---|---|---|
| **IH** | Interstate | E.g., IH-10, IH-35 |
| **US** | US Highway | E.g., US 290 |
| **SH** | State Highway | E.g., SH 71 |
| **FM** | Farm-to-Market | Rural statewide |
| **RM** | Ranch-to-Market | Rural, Hill Country/west |
| **BU** | Business US | Business route |
| **BS** | Business State Highway | |
| **SL / Loop** | State Loop | Bypass around a city |
| **SS / Spur** | State Spur | Short connector |
| **PA / Park Rd** | Park Road | State parks |

All of the above are on-system / TxDOT-maintained unless explicitly transferred. The renderer should treat any of these codes in the site's frontage roadway list as a trigger for the TxDOT-section + DAP track.

---

## 6. Thresholds and Review Triggers

### 6.1 TxDOT

- **No hard statewide trip-count trigger.** Determination at the District during DAP review per ACM Ch. 3 §3.
- **TSP §16.2.1 TIA Categories (driving level of effort):**
  - **Category 1** — 100–499 peak-hour trips
  - **Category 2** — 500–1,000 peak-hour trips
  - **Category 3** — > 1,000 peak-hour trips
- Below 100 PHT, expect ACM driveway compliance check instead of full TIA.

### 6.2 Cities

| City | Threshold |
|---|---|
| **Houston** | **Verified verbatim (IDM 2022-07-01)**: ≥100 PHT triggers scoping meeting that determines full TIA (IDM §15.04.A.4.a). Tech-memo tier is **80–120 vph** during AM or PM peak (IDM §15.04.A.5). Table 15.04.01 categories: I (PHT < 100), II (100–499), III (500–999), IV (≥1,000). Note: 80–120 band overlaps the ≥100 PHT scoping trigger. |
| **Austin** | **Verified verbatim (TIA Guidelines June 2022)**: TIA required when site generates **>2,000 vehicular trips**; **Full TIA required >5,000 trips/day**. Transportation Assessment band is 2,000–5,000 trips/day. NTA for >300 vpd residential-only access. |
| **Dallas** | **Verified verbatim (Paving/Drainage TIS Waiver form)**: **<1,000 trips/day → no TIS or waiver required**; **>1,000 trips/day → TIS or TIS Waiver**. Waivers granted per-case by Director of Development Services. Renderer should default to **1,000 trips/day**; the "100 PHT / 2,000 ADT" figure from prior consultant practice is **NOT in the Waiver form** and is secondary-source only. |
| **Fort Worth** | **Verified (TIA Worksheet PDF title)**: Worksheet < 100 PHT; Abbreviated 100–299 PHT; Full TIA **≥ 300 PHT or ≥ 5,000 ADT**. |
| **San Antonio** | **≥ 76 PHT** triggers full TIA (UDC §35-502). Below: Peak Hour Trip Generation Form only. The "100 PHT" figure cited elsewhere is the driveway-geometry threshold, not the TIA trigger. |
| **Plano** | **Verified verbatim (Plano §12)**: TIA required when **site-generated ADT ≥ 8,000**. |
| **Harris County** | **50 PHT** triggers TIA; **300 PHT** triggers corridor capacity analysis |
| **Travis County** | **1,000 net new daily trips** |

### 6.3 Tollway / Special facility triggers

- **HCTRA / NTTA**: development TIA flows through TxDOT + host city; tollway authority reviews only direct facility impacts (ramp/managed-lane geometry).
- **CTRMA**: any new/modified access onto CTRMA frontage triggers DAP under Board Resolution 07-58.
- **HCFCD, MUDs, MDs, PIDs**: no TIA review authority.

---

## 7. State-Specific Data Sources (renderer should cite)

| Source | URL | Use in renderer |
|---|---|---|
| **TxDOT Statewide Planning Map** | https://www.txdot.gov/data-maps/statewide-planning-map.html | Interactive AADT + roadway inventory layers (UI handoff) |
| **TxDOT Open Data Portal (ArcGIS Hub)** | https://gis-txdot.opendata.arcgis.com/ | **Canonical AADT + RHiNo downloads.** Annual refresh. *(Confirm wired data pulls from here.)* |
| **TxDOT Roadway Inventory (RHiNo)** | https://www.txdot.gov/data-maps/roadway-inventory.html | Functional class, lane count, speed limit, surface |
| **TxDOT Traffic Data Collection** | https://www.txdot.gov/business/resources/traffic-data-collection.html | Counting methodology, STARS II reference |
| **TxDOT UTP 2026** ($101.6B, adopted Aug 2025) | https://www.txdot.gov/projects/planning/utp.html (draft: https://ftp.txdot.gov/pub/txdot/get-involved/tpp/utp/062725-draft-2026utp.pdf) | Programmed-projects citations |
| **TxDOT STIP** | https://www.txdot.gov/business/governments/stip.html | Federal 4-year slice |
| **TxDOT CRIS Public Query** | https://cris.dot.state.tx.us/public/Query/ | Crash history for existing-conditions section |
| **TxDOT highway designations glossary** | https://www.txdot.gov/projects/planning/highway-designations/glossary.html | Render the route-designation gloss box |
| **H-GAC TIP 2025–2028** | https://www.h-gac.com/transportation-improvement-program/2025-2028 | Houston region |
| **NCTCOG TIP** | https://www.nctcog.org/trans/funds/tip | DFW |
| **NCTCOG Regional Thoroughfare Plan** | https://resources.nctcog.org/trans/thoroughfare/rtp/index.asp | DFW regional thoroughfares |
| **CAMPO TIP** | https://www.campotexas.org/ | Austin region (verify edition URL) |
| **AAMPO TIP** | https://www.aampo.org/tip.php | San Antonio region |
| **Houston CIP** | https://www.houstontx.gov/cip/ | 5-yr rolling capital program |
| **Austin CIP** | https://www.austintexas.gov/page/capital-improvement-program | |
| **NCTCOG Mobility 2045 (2022 Update)** | https://www.nctcog.org/trans/plan/mtp/mobility-2045-2022-update | DFW MTP reference |
| **TxDOT Dallas CityMAP** | https://www.dallascitymap.com/ | Dallas urban-interstate scenarios |
| **TxDOT Houston District DAP checklist** | https://ftp.txdot.gov/pub/txdot/hou/resources/permits/driveway-access-permit.pdf | Houston-district DAP procedure |

---

## 8. Jurisdictional Handoff Decision Table

Given a site at lat/lon, the dispatcher answers four questions in order: **(a) inside city limits or ETJ?** **(b) frontage on a TxDOT route?** **(c) inside a tollway authority's facility?** **(d) inside an unincorporated county?**

| Scenario | TxDOT? | City? | County? | Tollway? | TIA tracks |
|---|---|---|---|---|---|
| **A.** City limits, frontage on city street only | No | **Yes** | No | No | City TIA only |
| **B.** City limits, frontage on TxDOT route (IH/US/SH/FM/RM/BU/BS/SL/SS) | **Yes** (DAP + TIA) | **Yes** | No | No | **Parallel** TxDOT-section + city TIA |
| **C.** City ETJ, frontage on city or county road | No | **Yes** (plat) | County (if county road impacted) | No | City TIA per ETJ rules + county if a county road is impacted |
| **D.** City ETJ, frontage on TxDOT route | **Yes** | **Yes** | County (if applicable) | No | **Triple**: TxDOT + city + county |
| **E.** Unincorporated, no city ETJ, county road | No | No | **Yes** (Harris/Travis/Bexar have programs) | No | County TIA (Harris: 50 PHT; Travis: 1,000 ADT) |
| **F.** Unincorporated, TxDOT route frontage | **Yes** | No | County (where applicable) | No | TxDOT + county |
| **G.** Frontage on HCTRA, NTTA, CTRMA frontage | **Yes** (frontage ROW often TxDOT) | **Yes** (host city) | County (if ETJ) | Tollway (geom only) | TxDOT + host city + tollway (limited) |
| **H.** TOD overlay (SA Green Line), MUD, PID, MD | per A/B above | per A/B above (LOS-E allowed) | — | — | Same as A/B; LOS standard relaxed |

**Shot-clock note.** Texas HB 3167 (2019; LGC §212) imposes a **30-day plat approval window** with written disapproval reasons. **There is no TIA-specific shot-clock**, but because TIAs are usually plat conditions the 30-day window cascades through TIA review. HB 3492 (2023) further limits municipal exactions; renderer should not present mitigation that exceeds rough-proportionality bounds without flagging.

**SB 2038 (2023) ETJ-release wrinkle.** Landowners can petition out of an ETJ; renderer should not assume ETJ status is stable across study horizons — flag if site has been petitioned out.

---

## 9. Comparison to Georgia DRI / GDOT Conventions

The Atlanta/Georgia track of the product uses **DRI (Development of Regional Impact)** as the regional review hook plus GDOT's standalone TIS Guidelines. Texas does not have a DRI-equivalent — there is no statewide regional-review threshold automatically tied to a regional commission (ARC equivalent). The closest analog is the **city/county threshold + MPO travel-demand model context** that NCTCOG, H-GAC, CAMPO, and AAMPO provide, but those MPOs **do not review project-level TIAs** the way ARC's DRI process reviews Atlanta-region projects.

| Dimension | Georgia / GDOT | Texas — closest equivalent |
|---|---|---|
| **Statewide TIA manual** | GDOT TIS Guidelines | **No single doc.** TxDOT TSP Ch. 16 (procedure) + ACM Ch. 3 (when required). Looser. |
| **State threshold** | DRI tiered (Tier 1 / Tier 2 / Tier 3 by trips + population) | **TSP Categories 1/2/3 by peak-hour trips (100 / 500 / 1,000)** — closer to GDOT than to a California-style VMT regime |
| **Regional review** | DRI via ARC and other regional commissions | **None.** MPOs (H-GAC, NCTCOG, CAMPO, AAMPO) do not review individual TIAs |
| **City-specific TIA standards** | Atlanta has a TIS process; Sandy Springs, Roswell, etc. have varying levels | **Far more divergent**: Houston, Austin, Dallas, Fort Worth, San Antonio each publish their own standard with material differences |
| **LOS default** | LOS D suburban, E in CBD; GDOT moving toward multimodal context | **Most similar: Fort Worth, San Antonio, Plano** (D suburban / E CBD/TOD); Houston and Dallas mid-transition to VLOS / VMT |
| **PE seal** | GA-licensed P.E. | TX-licensed P.E. per 22 TAC §137.33 |
| **Trip generation** | ITE latest | ITE 11th Ed. (same) |
| **Build/horizon year** | Opening Year + 5 typical | Opening Year + 5 (TSP §16.3) — same |
| **Mixed-use reductions** | ITE-standard + GDOT pass-by | ITE-standard everywhere; **Austin adds codified TDM/SIF credits** — the one Texas outlier |

**Closest Texas analog to Georgia DRI's tiered statewide trigger:** **TxDOT TSP Ch. 16 Categories 1/2/3** (driven by peak-hour trips). Use this as the structural parallel when reusing the Georgia renderer's tiered-effort logic.

**Closest Texas city to a Georgia-style standalone TIS process:** **Fort Worth** (June 2019 manual is the most GDOT-like in form — tiered, threshold-driven, MTP-aware, NCTCOG-cited). **San Antonio** is next-closest. **Austin** is the furthest (three-tier + TDM Plan + Sustainable Modes Analysis + Street Impact Fee credits).

---

## 10. Renderer Dispatch Notes

For [`pdf-export.ts`](../artifacts/tis-api-server/src/lib/pdf-export.ts), the Texas dispatch should:

1. Resolve site coordinates → city / ETJ / county / TxDOT route frontage / tollway proximity.
2. Pick the **state section pack** (TxDOT TSP Ch. 16 outline + Appendix Q citations) when any state-system route is in frontage; **always render** if rural/unincorporated TxDOT-fronted.
3. Layer the **city section pack** when inside city limits or ETJ; renderer must carry per-city outlines (Houston / Austin / Dallas / Fort Worth / San Antonio / Plano / Frisco / McKinney / Round Rock / El Paso first; remaining cities fall back to a generic Texas-city outline with a "host-city scoping required" callout).
4. Layer the **county section** when in unincorporated Harris / Travis / Bexar.
5. Emit a **shot-clock note** + **rough-proportionality cap** callout in any TIA where mitigation cost approaches that bound.
6. **PE seal block** carries Texas P.E. signature, seal image, date — required on cover and on every sealed sheet (22 TAC §137.33). Distinct from GA renderer's GA-P.E. seal block.
7. **Glossary box** on page 2 should render the FM/RM/BU/BS/Loop/Spur designation table for any Texas report.

---

## 11. Open Items / Confidence Flags

### Resolved (2026-06-12 — gap-coverage pass)

- ✅ **Houston IDM Ch. 15** verified verbatim. Current revision **07-01-2022 (not "2023 IDM")**. **Full-TIA scoping trigger is ≥100 PHT** (§15.04.A.4.a); tech-memo tier is **80–120 vph** (§15.04.A.5); Category table I/II/III/IV. **LOS D is the published threshold of significance** (§15.04.B.6.a) — "VLOS" / "LOS demoted" framing was **wrong**. Count window: **12 months high-growth / 24 months elsewhere** (§15.06.01.A). PE seal: **TX-licensed civil PE** (not traffic specialty). Required additional forms: Access Management Data Summary Form (embedded in IDM pp. 15-5 to 15-8) + CPC 101 Form (per TIA Content Guide p. 3).
- ✅ **Austin TIA Guidelines (June 2022)** verified verbatim: TIA required >2,000 vehicular trips; Full TIA >5,000 trips/day; Transportation Assessment band 2,000–5,000.
- ✅ **Dallas Paving/Drainage TIS Waiver form** verified verbatim: <1,000 trips/day → no TIS or waiver; >1,000 → TIS or waiver. The 100 PHT / 2,000 ADT figures are NOT in the canonical form; renderer should default to 1,000 trips/day.
- ✅ **Fort Worth TIA Worksheet** confirms tiered thresholds (Worksheet <100 PHT; Abbreviated 100–299; Full ≥300 PHT or ≥5,000 ADT).
- ✅ **Plano §12** verified verbatim: ≥8,000 site-generated ADT.

### Still outstanding

- **Fort Worth Transportation Engineering Manual** — full LOS standard verbatim by context (arterial outside CBD vs. CBD vs. Urban Village). PDF still 403s; the threshold-tier numbers are confirmed but the LOS-D-vs-LOS-E split is from a separate page that wasn't retrieved. Confirm via desktop browser before locking renderer text.
- **Austin ASMP LTS** requirements inside TIA Guidelines — confirm whether folded in.
- **Dallas CBD Streets and Vehicular Circulation Plan** — 1988 last update; confirm whether a current revision exists before citing.
- **San Antonio IB 567** scoping-meeting procedure — confirm verbatim.
- **El Paso, McKinney, Round Rock, Frisco** — exact numeric thresholds. Round Rock TCM §2.3.2A references a trip-generation criterion but the numeric was not retrieved in WebSearch. McKinney Rev. 6 (Nov 2024) and Frisco P117 (Feb 2023) require PDF download.
- **Dallas County / Tarrant County** — confirm no county-level TIA program (current evidence: none).
- **CAMPO TIP** — confirm current edition URL.
- **STIP** — confirm `txdot.gov/business/governments/stip.html` is canonical (not migrated).

When the renderer cites a doc whose threshold was not directly verified above, it should append an inline "[verify against current edition]" tag rather than hard-code a number drawn from secondary sources.

### Bugs in current `renderTisTexas` (pdf-export.ts ~line 2369–) caught by this pass

| Line (approx) | Bug | Fix |
|---|---|---|
| 2426 | `"Technical Memorandum tier 80–120 vph during the AM or PM peak hour; Full TIA above 120 vph (2023 IDM Ch. 15, effective Nov 27, 2023; OCE TIA Content Guide)"` | Wrong on three counts: (a) IDM is **07-01-2022 revision** not "2023 IDM effective Nov 27, 2023"; (b) Full-TIA threshold is **≥100 PHT** scoping trigger per §15.04.A.4.a, not "above 120 vph"; (c) the 80–120 vph band overlaps the 100 trigger — renderer should emit both. |
| 2434 | `"Vehicle LOS (VLOS) per the 2023 IDM; LOS D was the historical target but the 2023 IDM demotes letter-grade LOS in favor of multimodal metrics"` | Wrong. "VLOS" is **not a term in the IDM**. The IDM (§15.04.B.6.a) still publishes **LOS D as the threshold of significance** for area street system facilities. Replace with the verbatim text. |
| 2427 | `"≥ 2,000 vpd unadjusted triggers analysis ... 2,000–5,000 vpd → Transportation Assessment + TDM Plan; > 5,000 vpd → Full TIA + TDM Plan (TCM §10 / TIA Guidelines June 2022)"` | Numbers verified verbatim. Citation should be **TIA Guidelines June 2022** (LDC §25-6-117 is the trigger statute, but the 2,000/5,000 bands are in the Guidelines, not the LDC). |
| 2428 | `"< 1,000 trips per day exempts a non-school site per the Paving/Drainage TIS Waiver form. Above that, consultant practice triggers a TIS at ~100 PHT or ~2,000 ADT — the Development Code (§51A-4.803) does not publish a single canonical numeric"` | Half-right. The 1,000-trips/day figure IS canonical (verbatim from Waiver form). The "100 PHT / 2,000 ADT" secondary-source figures should be **dropped** — they're not in the form and create false ambiguity. |
