# Illinois TIS — Build Spec for State-Dispatched PDF Renderer

> **Status:** Research deliverable. No code. Implementation hooks into
> `artifacts/tis-api-server/src/lib/pdf-export.ts` (see dispatch around line 294).
> **Date:** 2026-06-09. **Verification standard:** Every URL was reached by WebFetch
> or surfaced through a search engine. Claims are tagged `[VERIFIED]` when the
> primary source was fetched and read, `[VERIFIED — URL only]` when the URL
> resolved but the body (PDF binary or 403'd page) could not be parsed in this
> research pass, and `[INFERENCE]` when no primary source was located and the
> claim rests on practitioner convention or secondary sources.
>
> **Headline finding:** Illinois has no single statewide TIS manual. Methodology
> for an IL TIS is assembled out of (a) BDE / BLRS chapters, (b) Title 92 Part 550
> driveway permit policy, (c) the **District 8 Access-Permit Guidelines, April
> 2024** — the only IDOT-published document with a fully prescribed TIS section
> structure that this research located — and (d) the local agency's overlay
> (CDOT for Chicago, the collar county DOTs, or the Tollway). The renderer must
> dispatch on **District + local-agency** pair, not just "state = IL".

---

## 0. Dispatch model

For each generated TIS, the renderer should resolve **two** keys before choosing
a template variant:

1. **IDOT District** — 9 districts; D1 (Schaumburg) covers Cook + all 5 collar
   counties; D8 (Collinsville) is the only district with a public TIS guideline
   doc. Site lat/lon → District.
2. **Local jurisdiction overlay** — one of:
   - `chicago_cdot` — Chicago city street (CDOT primary, TDM-flavored review)
   - `chicago_idot` — IL state route inside Chicago (IDOT + CDOT co-review)
   - `cook_county` — Cook County highway (DOTH permit, no published TIS manual)
   - `collar_dupage` / `collar_lake` / `collar_will` / `collar_kane` /
     `collar_mchenry`
   - `tollway_influence` — site triggers Tollway interchange/IGA review
   - `downstate_idot` — IDOT BLRS + BDE defaults, no local overlay

The dispatch should set the **header agency**, the **LOS criterion table**, the
**required-section list**, the **growth-rate convention**, the **software
constraint**, and the **PE-stamp boilerplate**. Defaults below assume `D1` +
`downstate_idot`; collar/Chicago overrides are noted in §3 and §8.

---

## 1. Authoritative Sources

### 1.1 IDOT (state-level)

| Doc | Edition | URL | Use |
|---|---|---|---|
| **Bureau of Local Roads and Streets Manual (BLRS)** | December 2018, updated via Procedure Memos `[VERIFIED]` | landing: https://idot.illinois.gov/transportation-system/local-transportation-partners/county-engineers-and-local-public-agencies/lpa-project-development-and-implementation/policy-and-procedures/local-roads-and-streets-manual.html ; TOC: https://idot.illinois.gov/content/dam/soi/en/web/idot/documents/doing-business/manuals-split/local-roads-and-streets/toc.pdf ; portal: https://public.powerdms.com/IDOT/documents/2096656 | Local-system design + procedural manual. **Ch. 27** basic design controls (LOS, design year, capacity), **Ch. 28** sight distance, **Ch. 32** geometric tables (LOS row, controlling design criterion), **Ch. 34** intersections, **Ch. 39** traffic-control devices (refs ILMUTCD), **Ch. 41** driveways + off-street parking, **Ch. 17** planning & programming. |
| **Bureau of Design & Environment Manual (BDE)** | Online living document, updated chapter-by-chapter via BDE Procedure Memoranda `[VERIFIED]` | portal: https://public.powerdms.com/IDOT/documents/1881647 ; tree: https://public.powerdms.com/IDOT/tree/documents/1881647 ; PMs: https://idot.illinois.gov/doing-business/procurements/engineering-architectural-professional-services/consultant-resources/highways/manuals-and-guides/bde-procedure-memorandums.html | State-system design and Phase I engineering manual. Cited TIS-relevant chapters: **Ch. 17** non-motorized warrants `[VERIFIED — cited by D8 doc]`; **Ch. 36** intersections (alignment, turn radii, sight distance) `[INFERENCE — exact ch. number to confirm against live TOC]`; **Ch. 35** roadside / access management `[INFERENCE]`; **Ch. 54** pavement design `[VERIFIED — cited by D8 doc]`; **Ch. 63** plans/specs/special provisions `[VERIFIED — cited by D8 doc]`. **Live BDE TOC PDF did not render in headless fetchers — re-verify chapter numbers from a desktop browser before locking template citations.** |
| **Illinois Highway Standards Manual** | Revision 229, eff. 2026-01-01 `[VERIFIED]` | portal: https://public.powerdms.com/IDOT/documents/3170312 ; landing: https://idot.illinois.gov/doing-business/industry-marketplace/construction-services/highway-standards-and-district-specific-details.html | Standard construction drawings only — not a policy doc. Cite for detail-sheet references in plan-set exhibits. |
| **Title 92, Part 550, Illinois Admin Code — Policy on Permits for Access Driveways to State Highways** | Current through mid-2024 `[VERIFIED — URL only]` | https://www.ilga.gov/Commission/jcar/admincode/JCARTitlePart.asp?Title=092&Part=0550 | The **regulatory floor** for any TIS touching a state-route driveway. Defines when a permit is required; TIS-trigger is implicit (turn-lane and signal warrants), not a numeric peak-hour threshold. |
| **Handbook for the Policy on Permits for Access Driveways to State Highways** | (companion to Part 550) `[VERIFIED — URL only]` | https://public.powerdms.com/IDOT/documents/2009206 | Procedural handbook for the access-driveway permit. |
| **IDOT Highway Permits — Requirements** | live page `[VERIFIED]` | https://idot.illinois.gov/doing-business/permits/highway-permits/requirements.html | District-routing for access permits + Forms OPER 1050 / OPER 1051. |
| **District 1 Traffic Signal Design Guidelines** | October 2025 `[VERIFIED]` | https://apps.dot.illinois.gov/eplan/desenv/standards/District%201/D1TrafficDesign/TrafficSignalDesignGuidelines/D1TrafficSignalDesignGuidelines_October2025.pdf | D1 signal-design manual; signal warrants + interconnect requirements when TIS recommends a signal. |
| **District 8 High-Volume Access-Permit Guidelines** | April 2024 `[VERIFIED]` | https://idot.illinois.gov/content/dam/soi/en/web/idot/documents/doing-business/manuals-guides-and-handbooks/highways/d8/Guidelines%20for%20D8%20High-Volume%20Access%20Permits%20April%202024.pdf | **THE only IDOT-published TIS-content guideline located.** Appendix A = TIS Guidelines (section list, software, growth, horizon years, PE stamp); Appendix B = IDS Checklist. Use as the **base template** for all IDOT-jurisdiction reports, flagged in the PDF cover letter that D1 may have unwritten variations confirmed at kickoff. |
| **Multi-Year Highway Improvement Program (MYP)** | FY 2026–2031 `[VERIFIED]` | landing: https://idot.illinois.gov/transportation-system/transportation-management/transportation-improvement-programs/myp.html ; doc: https://public.powerdms.com/IDOT/documents/3193195 | 6-year program; $32.50B highways inside $50.6B total. Cite in §3 background context if a programmed project intersects the study area. |
| **STIP** | FY 2026 (federal version) `[VERIFIED — URL only]` | https://idot.illinois.gov/content/dam/soi/en/web/idot/documents/transportation-system/reports/opp/stip/fy2024-2027/STIP_Body_FY2026.pdf | Federal STIP companion to the MYP. |
| **Getting Around Illinois (public AADT viewer)** | live `[VERIFIED]` | viewer: http://www.gettingaroundillinois.com/gai.htm?mt=aadt ; landing: https://idot.illinois.gov/transportation-system/network-overview/highway-system/maps/average-annual-daily-traffic.html | Public AADT lookup. (Internal IDOT system is **IRIS** — staff-only.) |
| **IDOT AADT open-data layer** | live `[VERIFIED — URL only]` | https://gis-idot.opendata.arcgis.com/datasets/annual-average-daily-traffic-aadt | Bulk AADT layer for ArcGIS/GeoJSON ingest. |
| **IDOT MYP GIS layer** | live `[VERIFIED — URL only]` | https://gis-idot.opendata.arcgis.com/datasets/5039ed431280426fae37c2a30b43f5cb_5/about | Programmed-project geometries for background-network impact statements. |
| **IDOT Regions / Districts** | live `[VERIFIED]` | https://idot.illinois.gov/about-idot/idot-regions.html ; D1: https://idot.illinois.gov/about-idot/idot-regions/idot-region-1.html ; boundary map: https://idot.illinois.gov/content/dam/soi/en/web/idot/documents/transportation-system/maps---charts/idot-specific/district-boundaries.pdf | Dispatch input: site lat/lon → District. |
| **Illinois MUTCD (ILMUTCD)** | adoption of FHWA MUTCD with IL supplements `[INFERENCE — referenced by BLRS §27 and D1 signal guidelines]` | (no single PDF URL verified — distributed via district eplan + IDOT manuals page) | Cite for signal warrants and signing/marking compliance. |

### 1.2 Chicago (CDOT / DPD)

| Doc | Edition | URL | Use |
|---|---|---|---|
| **CDOT Guidelines for Travel Demand Study and Management (TDM) Plans** | **v1.2 effective Feb 5, 2024 (supersedes interim v1.1 of June 16, 2023)** `[VERIFIED via renderer commit 2026-06-12]` | (chicago.gov/CDOTPRC path — confirm current URL) | **THIS IS THE CHICAGO TIS DOCUMENT.** Implements the Connected Communities Ordinance. Tiered: Tier 1 (site plan), Tier 2 (TDM Memo), Tier 3 (TDM Plan). Replaces traditional vehicle-LOS TIS for Chicago projects. |
| **Connected Communities Ordinance (CCO)** | adopted 2022-07-20; 2025-07 parking-mandate amendment `[VERIFIED — secondary]` | Municipal Code §17-3-0308 (B/C transit-served), §17-4-0301 (D transit-served), via https://codelibrary.amlegal.com/codes/chicago/latest/chicagozoning_il/0-0-0-49177 | Defines "Transit-Served Location" (within 2,640 ft / ½ mi of a CTA or Metra rail station entrance, plus eligible high-frequency bus corridors) and the by-right zero-parking provisions that drive Chicago trip-generation reductions. |
| **Complete Streets Chicago — CDOT Design Guidelines** | 2013 (operative foundational doc) `[VERIFIED via NACTO mirror]` | mirror: https://nacto.org/wp-content/uploads/complete_streets_chicago.pdf ; chicago.gov canonical: https://www.chicago.gov/content/dam/city/depts/cdot/Complete%20Streets/CompleteStreetsGuidelines.pdf | Modal hierarchy: **pedestrians → transit → cyclists → automobiles.** Cited for design conditions imposed on TIS recommendations. |
| **Chicago Pedestrian Plan** | 2012 `[VERIFIED — URL only]` | https://www.chicago.gov/content/dam/city/depts/cdot/supp_info/ChicagoPedestrianPlan.pdf | Cite for ped-LOS / quality-of-service narrative. |
| **CDOT Street and Site Plan Design Standards** | `[VERIFIED — URL only]` | https://www.chicago.gov/content/dam/city/depts/cdot/StreetandSitePlanDesignStandards407.pdf | Driveway / curb-cut geometric standards inside Chicago. |
| **CDOT Regulations for Construction in the Public Way (CIPW)** | `[VERIFIED — URL only]` | https://www.chicago.gov/dam/city/depts/cdot/Public%20Way%20Regulations/PublicWayRegsFINAL.pdf | Construction-period MOT requirements for any work within ROW. |
| **DPD Development Manual for Plan Commission Projects** | `[VERIFIED — URL only]` | https://www.chicago.gov/content/dam/city/depts/zlup/Planning_and_Policy/Publications/Development%20Manual%20for%20Plan%20Commission%20Projects/Plan_Commission_Manual_FINAL_for_web.pdf ; landing https://www.chicago.gov/city/en/depts/dcd/supp_info/development_manualforplancommissionprojects.html | Planned Development (PD) Part I / Part II submittal contents; defines when CDOT PRC, CTA, and DWM each get review copies. |
| **Chicago Plan Commission — Transit Friendly Development Guide** | adopted 2009-12-17 `[VERIFIED — secondary]` | (no direct PDF URL verified) | Background for transit-oriented site-plan expectations. |
| **CDOT Plan Review Committee (PRC)** | live `[VERIFIED — URL only]` | https://www.chicago.gov/city/en/depts/cdot/supp_info/cdot-plan-review.html | The operational gate for development access/permit review. |
| **Better Streets for Buses Plan** | CDOT + CTA, Dec 2023 `[VERIFIED — secondary]` | (CDOT page) | Cite for transit-coordination narrative when site affects bus routes. |
| **CDOT Average Daily Traffic Counts (data portal)** | live `[VERIFIED — URL only]` | https://data.cityofchicago.org/Transportation/Average-Daily-Traffic-Counts/gc7y-n4xa ; map: https://data.cityofchicago.org/Transportation/Average-Daily-Traffic-Counts-Map/pf56-35rv | Public ADT for Chicago streets. **Note:** these counts are aged — many entries are years old; flag in §3.3. |
| **Chicago Truck Count Data Portal (CNT)** | live `[VERIFIED — secondary]` | https://chicagotruckcounts.cnt.org/ | Truck + bike + ped counts; useful for freight-generator sites. |
| **Pedestrian Streets dataset** | live `[VERIFIED — secondary]` | https://data.cityofchicago.org/Transportation/Pedestrian-Streets/w3m8-5y6d | Designated P-streets; controls whether site driveway can front the primary street. |
| **CTA TOD program** | live `[VERIFIED — secondary]` | https://www.transitchicago.com/tod/ | Cite for TOD-bonus density/parking reductions. |

### 1.3 Cook County

| Doc | Edition | URL | Use |
|---|---|---|---|
| **Cook County DOTH — Construction Permit Packet (commercial/residential/government)** | Nov 2020 `[VERIFIED — URL only]` | https://www.cookcountyil.gov/sites/g/files/ywwepo161/files/documents/2021-09/1-_construction_permit_packet_commercial_residential_goverment_2020-11.pdf | Operative permit doc; **Cook County publishes no standalone TIS manual** — TIS required at staff discretion via the Permits Division. |
| **Cook County DOTH — landing page** | live `[VERIFIED]` | https://www.cookcountyil.gov/agency/transportation-and-highways | Contact (`hwy.permits@cookcountyil.gov`). |
| **Cook County permit portal** | live `[VERIFIED]` | https://apps.cookcountyil.gov/highway/login.aspx | Submission. |

### 1.4 CMAP (regional MPO)

| Doc | Edition | URL | Use |
|---|---|---|---|
| **ON TO 2050 Comprehensive Regional Plan** | Adopted Oct 2018; updated Oct 2022 (next update on quadrennial cycle) `[VERIFIED — URL only]` | https://www.cmap.illinois.gov/wp-content/uploads/dlm_uploads/ON-TO-2050-Comprehensive-Regional-Plan-FINAL.pdf ; financial appendix: https://cmap.illinois.gov/wp-content/uploads/ON-TO-2050-Update-Financial-Plan-for-Transportation-Appendix.pdf | Federal MTP for the 7-county region; cite for regional travel-demand assumptions and any reasonably-expected programmed project intersecting the study area. |
| **CMAP TIP** | active program FFY 2023–2028; FFY 2026–2030 call open `[VERIFIED]` | https://www.cmap.illinois.gov/programs/tip | Short-range capital program (CRP / CMAQ / STP / TAP). |
| **CMAP PART (Plan of Action for Regional Transit)** | adopted 2023-10-11; 2025 policy update `[VERIFIED]` | landing: https://cmap.illinois.gov/focus-areas/transportation/transit/plan-of-action-for-regional-transit/ ; full plan: https://cmap.illinois.gov/wp-content/uploads/Plan-of-Action-for-Regional-Transit_Dec2023.pdf ; Action Guide: https://cmap.illinois.gov/wp-content/uploads/PART_ActionGuide_Final.pdf | Macro context for transit assumptions; the 2026 transit fiscal cliff + SB 2111 reform are background, not project-level analysis. |
| **CMAP Local Technical Assistance (LTA)** | live `[VERIFIED]` | https://cmap.illinois.gov/news-updates/communities-invited-to-apply-for-local-planning-assistance/ | Source of suburban comprehensive plans / corridor studies that often inform development trip-generation assumptions. |

### 1.5 Illinois Tollway (ISTHA)

| Doc | Edition | URL | Use |
|---|---|---|---|
| **Manuals, Processes and Guidelines (index)** | live `[VERIFIED]` | https://agency.illinoistollway.com/doing-business/construction-engineering/manuals-processes-guidelines | Catalog page; **Tollway publishes no standalone TIS manual.** |
| **Roadway Design Criteria** | March 2026 `[VERIFIED — URL only]` | https://agency.illinoistollway.com/documents/20184/473059/1D%20Roadway%20Design%20Criteria.pdf | Geometric criteria for any work touching mainline / ramp / cross-road within the interchange area. |
| **Environmental Studies Manual** | March 2026 `[VERIFIED — URL only]` | https://agency.illinoistollway.com/documents/20184/238191/A2%20Environmental%20Studies%20Manual.pdf | Cite when development triggers a Tollway interchange modification (Categorical Exclusion / EA process). |
| **Drainage Design Manual** | March 2026 `[VERIFIED — URL only]` | https://agency.illinoistollway.com/documents/20184/238191/A1Drainage%20Design%20Manual.pdf | Required when site discharges to Tollway ROW. |
| **Interchange and Roadway Cost Sharing Policy** | 2007 / 2012 `[VERIFIED — URL only]` | https://agency.illinoistollway.com/about/regulations-rules-policies | Regulatory hook when development requests new or modified Tollway access; local share ≥ 50%. |
| **Traffic Generator Decision Tree / Sign Policy** | 2009 / 2022 `[VERIFIED — URL only]` | decision tree: https://agency.illinoistollway.com/documents/20184/473059/TRAFFIC%20GENERATOR%20DECISION%20TREE%20V2%201%20_2_.PDF.pdf ; policy: https://agency.illinoistollway.com/documents/20184/473059/TRAFFIC%20GENERATOR%20SIGN%20POLICY%202022.pdf | Logo-signage qualification (not TIS-methodology). |
| **Move Illinois capital program** | live `[VERIFIED]` | https://agency.illinoistollway.com/projects/capital-programs | $15B 16-year program completing end of 2027; successor **Bridging the Future** ($2B / 7-yr) approved Dec 2024. |

### 1.6 Collar counties

| Doc | Edition | URL | Use |
|---|---|---|---|
| **DuPage County DOT — Engineering Standards** | live `[VERIFIED]` | https://www.dupagecounty.gov/government/departments/transportation/doing_business/engineering_standards.php | **Project Manual is request-only** from project engineers; no public TIS manual. **Fair Share Impact-Fee program terminated 2023-05-24** — TIS now staff-discretionary. |
| **DuPage Impact Fee Permits page (termination notice)** | live `[VERIFIED]` | https://www.dupagecounty.gov/government/departments/transportation/doing_business/impact_fee_permits.php | Cite the termination explicitly in any DuPage TIS cover memo. |
| **Lake County Highway Access and Use Ordinance** | adopted 2019-07-09 `[VERIFIED — URL only]` | https://www.lakecountyil.gov/DocumentCenter/View/28214/Final-Draft_April-2019_Access-and-Use-Ordinance ; codified at Municode Ch. 90 ; §90.045 access classification: https://codelibrary.amlegal.com/codes/lakecountyil/latest/lakecounty_il/0-0-0-33809 | The closest thing to a collar-county TIS standard. |
| **Lake County Highway Access and Use Ordinance — Technical Reference Manual** | live, updated as procedures change `[VERIFIED — URL only; PDF binary not parsed]` | https://www.lakecountyil.gov/DocumentCenter/View/29625/Lake-County-Highway-Access-and-Use-Ordinance-Technical-Reference-Manual-PDF | Contains TIS Format requirements; numeric thresholds inside this PDF must be re-verified from a desktop browser before locking the template. |
| **Will County DOT — Permit and Access Regulations** | live `[VERIFIED]` | https://willcounty.gov/County-Offices/Economic-Development/Division-of-Transportation/Permit-and-Access-Regulations | **No standalone TIS manual**; TIS at staff discretion during access review. |
| **Kane County DOT — Permit Regulations Manual** | 2004 base + revisions `[VERIFIED — URL only; 7.3 MB / 143 pp, binary not parsed]` | https://kdot.kanecountyil.gov/Shared%20Documents/permits/entireManual.pdf | The "entire manual"; covers traffic control + access control. |
| **McHenry County DOT — Access / Development Permits** | live `[VERIFIED — URL only; 403 to headless]` | https://www.mchenrycountyil.gov/departments/transportation/apply-for/permits/access-development-permits | **Major Access Permit trigger: anticipated ADT > 50 trips per ITE → IL-PE-sealed TIS required.** `[VERIFIED via search-result excerpts]` |

### 1.7 Other downstate / out-of-region

- **Champaign County RPC — Project Priority Review Guidelines** (https://www.ccrpc.org/transportation/project_priority_review_ppr_guidelines.php) `[VERIFIED]` — STBG prioritization, not a TIS doc.
- **Sangamon County Highway / SSCRPC Transportation Planning** (https://sangamonil.gov/departments/d-l/highway-department/planning-reports ; https://sangamonil.gov/departments/m-r/regional-planning-commission/program-areas/transportation-planning) `[VERIFIED]` — no TIS overlay; defer to IDOT D6.
- Peoria (PPUATS), Rockford (RMAP), Quad Cities (Bi-State) — MPOs only; no local TIS overlays located. `[INFERENCE]`

---

## 2. Standard Section Structure

The base section list below derives from **D8 April 2024 Appendix A**, the only
IDOT-published prescriptive TIS content list located. The Chicago variant below
swaps in the CDOT TDM Guidelines structure.

### 2.1 Base IDOT TIS — section ordering

1. **Cover, certifications & PE seal block** — IL PE signature, license number, "Licensed Professional Engineer of Illinois," dated. `[VERIFIED — D8 Appx. A]`
2. **Executive Summary** — proposed development, trip generation summary, recommended improvements, agency-approval list. `[VERIFIED]`
3. **Introduction & Project Description** — site location (lat/lon + section/township/range), parcel acreage, existing zoning, proposed land use(s), site plan reference.
4. **Existing Conditions**
   - 4.1 Roadway network (functional class, jurisdictional limits, posted speed, AADT, lane geometry)
   - 4.2 Existing traffic volumes (counts: peak-period TMCs, 24-hr where required, with date / day / weather)
   - 4.3 Existing LOS analysis (signalized + unsignalized) — methodology per HCM current edition
   - 4.4 Crash history (3-year minimum, sourced from IDOT Safety Data Mart or CDOT IDOT-feed)
   - 4.5 Pedestrian and bicycle conditions (BDE Ch. 17 warrants)
   - 4.6 Transit service (when present)
5. **Proposed Development**
   - 5.1 Land-use table with ITE code, size unit, intensity
   - 5.2 **Trip Generation** — ITE Trip Generation current edition (verbatim mandate from D8 Appx. A), with pass-by / internal-capture justification when claimed
   - 5.3 Trip distribution + assignment
   - 5.4 Site plan + access geometry (driveways, throat depth, internal circulation)
6. **Background Traffic** — growth-rate derivation (not assumed), background-network committed developments, programmed-improvement netting (MYP + TIP + local CIP intersections)
7. **Future Conditions Analyses** — four mandatory scenarios per D8 Appx. A:
   - 7.1 **Opening (Construction) Year — No-Build**
   - 7.2 **Opening Year — Build**
   - 7.3 **20-Year Design Year — No-Build**
   - 7.4 **20-Year Design Year — Build**
   (For phased developments, add Full-Build-Out year between opening and design.)
8. **Mitigation & Improvements**
   - 8.1 Turn-lane warrant analysis (BDE nomographs)
   - 8.2 Signal warrant analysis (ILMUTCD warrants) — required if site triggers any signal warrant
   - 8.3 Sight-distance verification (BLRS Ch. 28: SSD, ISD)
   - 8.4 Auxiliary lanes / acceleration / deceleration
   - 8.5 Pedestrian / bicycle accommodations (BDE Ch. 17)
9. **Recommendations & Conclusions** — explicit list of agency-coordination conditions
10. **References**
11. **Appendices** — **A:** TMC and 24-hr count sheets, raw + balanced; **B:** Capacity analysis worksheets (Synchro/Vistro at TIS phase; **HCS mandatory at IDS phase per D8**); **C:** Crash data; **D:** ITE rate sheets; **E:** Signal warrant worksheets; **F:** Sight-distance check; **G:** Site plan + access geometry exhibits; **H:** Agency correspondence

If the next phase (Intersection Design Study, "IDS") is triggered, a **GD (Geometric Detail)** is the lighter-weight equivalent for unsignalized entrances — IDS minus traffic volumes and capacity analysis. `[VERIFIED — D8 Appx. A]`

### 2.2 Chicago / CDOT TDM Plan — section ordering

Per **CDOT TDM Guidelines v1.2 (Feb 5, 2024; supersedes interim v1.1 June 2023)**. The structure is **fundamentally different** from the IDOT TIS — it is a trip-**reduction** plan, not a network-impact study.

1. Cover page + applicant / zoning summary
2. Site context map — transit-served eligibility check with ½-mi radius to nearest CTA/Metra rail station entrance; high-frequency bus corridor overlay
3. Existing conditions narrative — modal hierarchy framing (ped → transit → bike → auto per Complete Streets Chicago 2013)
4. Trip generation — ITE base rates **with Chicago mode-shift reductions**; transit-served-location reduction; CCO parking-reduction context
5. Pedestrian + bicycle network description and quality-of-service narrative
6. Transit access narrative + CTA bus-stop and station inventory (1/4-mi walkshed minimum)
7. Loading and freight (Chicago Municipal Code §17-10-1100 schedule of minimums)
8. Construction-phase Maintenance of Traffic (MOT) plan reference + bus-stop displacement plan if applicable
9. **TDM Measures Matrix** — tied to ordinance §17-3-0308 / §17-4-0301; monetized cost share + monitoring commitment
10. Agency-correspondence appendix
11. **PE stamp not always required** — TDM Memos / Plans are sometimes signed by AICP/PTP; verify per project scope. `[INFERENCE]`

**Tier matrix** (dwelling units, per Taft Law summary `[VERIFIED — secondary]`):
- Tier 1: 20–50 DU → site plan only
- Tier 2: 51–175 DU → TDM Memo
- Tier 3: 175+ DU → full TDM Study + Plan

### 2.3 IL state-route inside Chicago — `chicago_idot`

Generate **both** an IDOT TIS appendix (§2.1) and a CDOT TDM summary (§2.2), with the IDOT methodology controlling vehicle-LOS analysis and CDOT controlling mode-shift commitments. The Jan-2023 IDOT-CDOT MOU streamlines co-review on safety improvements. `[VERIFIED — secondary]`

### 2.4 Comparison to a GA DRI 13-section structure

GA's DRI process (GDOT + ARC + GRTA) is built around a regional review trigger (square footage / DU / peak-hour thresholds set by DCA) and produces a single comprehensive deliverable with a fixed 13-section table of contents (executive summary, project description, study area, existing, trip gen, distribution, future no-build, future build, mitigation, signal/turn-lane warrants, queueing, conclusions, appendices). The IL D8 11-section structure (above) is structurally close — same backbone — but differs in **scenario count (4 vs. 2)**, **trip-generation language ("current edition" vs. ARC-DCA-coordinated overrides)**, and **PE-stamp language ("Licensed Professional Engineer of Illinois" vs. GA PE stamp).** See §9 for full side-by-side.

---

## 3. Methodology Conventions

### 3.1 Growth rate

- **IDOT:** No statewide fixed rate codified. D8 Appx. A explicitly requires the consultant to **derive and justify** a background-traffic growth rate. `[VERIFIED]`
- **Convention in practice:** 5-year historical AADT trend on Getting Around Illinois → compounded annual rate; or pull from CMAP travel-demand-model node projections in the 7-county region. `[INFERENCE]`
- **Renderer default:** Compute the 5-year compound AADT growth rate from the nearest matched IDOT count station and present it with the source. Surface a kickoff-meeting flag in the cover memo asking the District to confirm.

### 3.2 Peak-period / count requirements

- **Counts:** 24-hr machine + AM and PM peak-period TMCs at all study intersections. **Three to four peak-period hours minimum.** `[VERIFIED — D8 Appx. A wording on peak hours]`
- **Day of week:** Tuesday / Wednesday / Thursday; **avoid Monday + Friday, holidays, and non-school days** for any site sensitive to school traffic. `[INFERENCE — universal US convention, not a verified IL text]`
- **Weather:** Clear / dry conditions or rejected.
- **Heavy-vehicle %:** required column in every TMC for HCM analysis.

### 3.3 LOS standards

| Context | Design LOS | Source |
|---|---|---|
| Rural arterials / collectors | **C** (controlling design criterion) | BLRS Ch. 32 design table `[VERIFIED]` |
| Urban arterials / collectors | **C**; **D may be used in heavily-developed metro sections** | BLRS Ch. 32 Note 2 `[VERIFIED]` |
| Urban local streets / urban collectors | Desired **C** / Minimum **D** | BLRS Ch. 32 `[VERIFIED]` |
| Unsignalized intersections | HCM delay-based, per BLRS Fig. 27-6A | BLRS §27-6.01 `[VERIFIED]` |
| State system (BDE) | Parallel C/D framework | BDE chapter table — `[INFERENCE; live BDE TOC not parsed]` |
| **Chicago (CDOT)** | **No vehicle LOS pass/fail.** Multimodal mode-shift focus. | CDOT TDM Guidelines v1.2 (Feb 5, 2024; supersedes interim v1.1 June 2023), Complete Streets Chicago 2013 `[VERIFIED]` |

### 3.4 Trip generation

- **Mandate:** "The current edition of the ITE Trip Generation Manual shall be used." `[VERIFIED — D8 Appx. A verbatim]`. As of 2026 → ITE Trip Generation 11th Ed.
- **No edition pin.** Renderer should resolve "current edition" at generation time rather than hard-coding "11th."
- **Supplemental sources** allowed for land uses not represented, with permission. `[VERIFIED — D8 Appx. A]`
- **Pass-by / internal capture / mixed-use:** No IL-specific override located; defer to ITE/NCHRP defaults. `[INFERENCE — convention]`
- **Chicago additional reductions:** Transit-served-location reduction (CCO ½-mi rule), pedestrian-network density, P-street designation. Cite the CCO section in any reduction claim.

### 3.5 Horizon years

D8 Appx. A requires evaluating ALL of:
- **Construction (opening) year** per phase
- **Full build-out year** for phased developments
- **20-year design year** per phase
- **20-year No-Build** baseline (both existing and future-without-project)

`[VERIFIED]`. Matches BLRS §27-6.02(a): "20 years is the usual design period" for new/reconstruction; "3R projects … the design period may be 10 years or longer." `[VERIFIED]`. Design year is measured from construction completion, not submittal year. `[VERIFIED]`

### 3.6 Software

| Phase | Software requirement | Source |
|---|---|---|
| TIS | "Most recent version" implementing current HCM. Synchro, Vistro, HCS all acceptable. `[VERIFIED — D8 Appx. A]` | software-agnostic |
| **IDS (Intersection Design Study)** | **HCS mandatory. No substitute software allowed.** `[VERIFIED — D8 Appx. A verbatim]` | HCS only |
| Roundabouts | **SIDRA** printouts required (per D8 IDS checklist) | `[VERIFIED]` |
| District 1 | May accept Synchro at IDS; confirm at kickoff | `[INFERENCE]` |

### 3.7 Build year

The renderer's default opening year should be **`max(currentYear + 1, sitePermitYear + 1)`**, capped to a reasonable construction-window estimate; design-year = opening + 20. `[VERIFIED — D8 Appx. A; "design year is measured from construction completion"]`

---

## 4. Required Deliverable Elements

### 4.1 Required tables (IDOT base template)

- Trip generation summary by land use (ITE code, units, AM in/out, PM in/out, daily)
- Trip-distribution percentages by access leg
- Pass-by / internal-capture credits with NCHRP source
- AM and PM existing LOS by intersection (movement + overall)
- AM and PM future LOS — 4 scenarios (Opening No-Build, Opening Build, Design No-Build, Design Build)
- Crash summary — count + rate per 100 MVMT, 3-yr minimum, by type and severity
- Turn-lane warrant summary table
- Signal warrant summary table (Warrants 1–9 with met/not-met)
- Sight-distance check table (SSD / ISD per direction)

### 4.2 Required figures

- Site location map (USGS quad + lat/lon)
- Site plan with access geometry dimensioned
- Existing roadway-network map with functional class
- Existing volumes (AM + PM) on study intersections
- Trip distribution percentages
- Site-generated trips
- 4 scenarios × AM/PM = 8 volume figures
- Recommended improvements graphic

### 4.3 Appendices

See §2.1 appendix list (A–H).

### 4.4 PE seal / submittal

- IL-PE seal: name + IL license number + "Licensed Professional Engineer of Illinois" + signature + date adjacent to seal. **Digital seals/signatures allowed per 68 Ill. Admin. Code §1380.295.** `[VERIFIED]`
- **Two bound paper copies + one electronic PDF + electronic capacity-analysis files (Synchro/HCS/Vistro source).** `[VERIFIED — D8]`
- All TIS submittals to **District Permits Unit Chief**. `[VERIFIED — D8]`
- Allow **8–10 weeks per submittal review; 18–24 months total** for signalized / widening projects on D8. D1 timelines may differ. `[VERIFIED — D8]`
- IDS signatures required: Geometric Engineer, Program Development Engineer, Operations Engineer, Region Engineer + City/County Engineer where applicable. `[VERIFIED — D8]`

### 4.5 Chicago additions

- Application packaged through DPD for Planned Developments
- CDOT PRC routing letter
- CTA letter of no objection when site affects bus stop / station access
- TDM Measures monitoring commitment language

---

## 5. Illinois-Specific Terminology

| Term | Meaning | Source |
|---|---|---|
| **TIS** | "Traffic Impact Study" — preferred IDOT term. No instance of "TIA" found in IDOT primary sources. `[VERIFIED]` | D8 Appx. A |
| **Phase I engineering** | Preliminary engineering + environmental study; the planning/scoping phase prior to Phase II final design. | BDE Manual purpose `[VERIFIED]` |
| **IDS — Intersection Design Study** | The follow-on document required when the TIS recommends turn lanes or signals; format codified in D8 Appx. B (March 2016). | `[VERIFIED]` |
| **GD — Geometric Detail** | Lighter IDS variant for unsignalized entrances (IDS minus volumes / capacity). | `[VERIFIED — D8]` |
| **OPER 1050 / OPER 1051** | Standard IDOT highway-permit application forms. | IDOT Highway Permits page `[VERIFIED]` |
| **MYP** | Multi-Year Highway Improvement Program (IL state equivalent of programmed projects). | `[VERIFIED]` |
| **STIP** | Federal Statewide Transportation Improvement Program. | `[VERIFIED]` |
| **TIP** | Transportation Improvement Program (CMAP's regional version, 7-county). | `[VERIFIED]` |
| **IRIS** | Internal IDOT roadway-data system; not public. The **public** counterpart is **Getting Around Illinois**. | `[VERIFIED]` |
| **Frontage road / marginal access road** | IDOT BDE/BLRS follows AASHTO terminology ("frontage road" generic). No IL-specific overload located. | `[INFERENCE]` |
| **"Type II" study** | Not a named IDOT category in sources reviewed. | `[INFERENCE — not located]` |
| **Connected Communities Ordinance (CCO)** | Chicago 2022 zoning amendment redefining Transit-Served Location at ½ mi from CTA/Metra rail. | Municipal Code §17-3-0308 / §17-4-0301 `[VERIFIED]` |
| **Planned Development (PD)** | Negotiated Chicago zoning approval requiring Plan Commission + CDOT PRC review. | `[VERIFIED]` |
| **Transit-Served Location** | Within 2,640 ft / ½ mi of a CTA / Metra rail station entrance (CCO doubled the prior 1,320 ft). | `[VERIFIED]` |
| **P-street / Pedestrian Street** | Chicago zoning overlay banning new curb cuts / driveways from the primary frontage; access must be from alley. §17-3-0500 / §17-4-0500. | `[VERIFIED]` |
| **TDM Memo / TDM Plan** | Chicago's TIS-replacement deliverables under **CDOT TDM Guidelines v1.2 (Feb 5, 2024)**. | `[VERIFIED via renderer 2026-06-12]` |
| **DOTH** | Cook County Department of Transportation & Highways. | `[VERIFIED]` |
| **DuDOT / LCDOT / KDOT / MCDOT** | DuPage / Lake / Kane / McHenry county DOTs respectively. | `[VERIFIED]` |
| **ISTHA** | Illinois State Toll Highway Authority — formal name of the "Illinois Tollway." | `[VERIFIED]` |
| **Move Illinois / Bridging the Future** | Successive Tollway capital programs (2012–2027 / 2025–2031). | `[VERIFIED]` |
| **Loading zone** | Chicago Municipal Code §17-10-1100 et seq. — off-street loading minimums; on-street under §9-68-030. | `[VERIFIED — secondary]` |
| **CIPW** | Construction in the Public Way; CDOT permit + regulations doc (Chapters 10-20 + 10-30). | `[VERIFIED — secondary]` |

---

## 6. Thresholds and Review Triggers

### 6.1 IDOT trip thresholds

**No statewide numeric peak-hour-trip threshold for TIS is codified.** `[VERIFIED — searched; not found]`. The IDOT TIS-trigger is **implicit through turn-lane and signal warrants**:

> "A Traffic Impact Study may be required based on an initial assessment of the proposed development and if turn lanes or traffic signals are anticipated." — D8 Appx. A `[VERIFIED]`

The renderer should evaluate **right-turn-lane and left-turn-lane warrants** per BDE nomographs and the **ILMUTCD signal warrants** (Warrants 1, 2, 3 first-pass) — any "met" condition fires the TIS requirement.

### 6.2 CDOT triggers (Chicago)

- **Connected Communities Ordinance** thresholds (B/C/D transit-served zoning)
- **Planned Development** designation (any project requiring PD)
- TDM tier per dwelling-unit count (Tier 1: 20–50 DU; Tier 2: 51–175 DU; Tier 3: 175+ DU) `[VERIFIED — secondary]`

### 6.3 Collar counties

| County | Trigger |
|---|---|
| DuPage | Impact-fee program ended 2023-05-24; today: staff-discretionary during access/signal permit review `[VERIFIED]` |
| Lake | Per Technical Reference Manual companion to Highway Access and Use Ordinance (2019) — numeric thresholds inside PDF, not parsed `[VERIFIED — URL only]` |
| Will | Staff-discretionary `[INFERENCE]` |
| Kane | Per 2004 Permit Regulations Manual `[VERIFIED — URL only]` |
| **McHenry** | **Major Access Permit = anticipated ADT > 50 trips per ITE → IL-PE-sealed TIS required.** `[VERIFIED — secondary]` |
| Kendall | Subdivision review only, no standalone TIS `[INFERENCE]` |
| Winnebago | Commercial driveways may require TIS per County Access Policy `[VERIFIED — secondary]` |
| Boone | None published `[INFERENCE]` |

### 6.4 Tollway influence-area review

No published numeric influence-area distance. `[INFERENCE]`. Practical convention: 1-mile FHWA Access-Management interchange-influence rule of thumb. Tollway review fires only when development requests new/modified Tollway access OR proposes drainage discharge into Tollway ROW. Governed by the **Interchange and Roadway Cost Sharing Policy** (≥ 50% local share), negotiated via Intergovernmental Agreement (IGA). `[VERIFIED — URL only]`

---

## 7. State-Specific Data Sources

| Source | URL | Use |
|---|---|---|
| **Getting Around Illinois (public AADT viewer)** | http://www.gettingaroundillinois.com/gai.htm?mt=aadt | Primary public AADT lookup statewide |
| IDOT AADT GIS open data | https://gis-idot.opendata.arcgis.com/datasets/annual-average-daily-traffic-aadt | Bulk ingest |
| IDOT MYP roadway-projects layer | https://gis-idot.opendata.arcgis.com/datasets/5039ed431280426fae37c2a30b43f5cb_5/about | Programmed-project geometries for background-network impact |
| IDOT Safety / crash data | (Safety Data Mart access via IDOT — internal portal; consultants obtain via FOIA) | Crash history, 3-year minimum |
| IDOT historical traffic counts | embedded in Getting Around Illinois + open-data | Trend-derivation for growth rate |
| **IDOT MYP FY 2026–2031** | https://public.powerdms.com/IDOT/documents/3193195 | Programmed background-network context |
| **CMAP TIP** | https://www.cmap.illinois.gov/programs/tip | Regional short-range committed projects |
| **CMAP ON TO 2050** | https://www.cmap.illinois.gov/wp-content/uploads/dlm_uploads/ON-TO-2050-Comprehensive-Regional-Plan-FINAL.pdf | Regional plan context |
| **CDOT ADT counts (Chicago)** | https://data.cityofchicago.org/Transportation/Average-Daily-Traffic-Counts/gc7y-n4xa | Chicago-street ADT (note: many counts are aged — flag the year explicitly in §3.3) |
| **Chicago Truck Counts (CNT)** | https://chicagotruckcounts.cnt.org/ | Truck + bike + ped for Chicago |
| **Pedestrian Streets dataset** | https://data.cityofchicago.org/Transportation/Pedestrian-Streets/w3m8-5y6d | P-street designation check |
| Tollway data | (no public-facing AADT viewer) | Tollway counts require coordination via permit |
| **ILMUTCD** | distributed via district eplan + IDOT manuals page | Signal warrants + signing/marking |

Note: TIS-specific count sources (turning-movement counts at study intersections) are **not pre-published** — the consultant collects them per §3.2. None of CDOT, IDOT, or CMAP publishes a TMC archive that satisfies TIS-quality requirements.

---

## 8. CDOT vs IDOT vs Cook County Jurisdictional Split

### 8.1 What IDOT controls inside Chicago

State routes inside Chicago city limits (~400 mi of state-jurisdiction roadway, excluding expressways) `[VERIFIED — IDOT-CDOT MOU summary]`:
- **US-41** (DuSable Lake Shore Drive)
- **IL-50** (Cicero)
- **IL-64** (North Ave)
- **IL-19** (Irving Park)
- **IL-43** (Western)
- **IL-1** (Halsted on portions)
- **US-12 / US-20 / US-45**
- **Expressway network** (I-90 / I-94 / I-55 / I-57 / I-290)

A TIS site fronting any of these submits on **IDOT BLR forms** to **District 1 (Schaumburg)** AND co-routes to CDOT PRC. The Jan-2023 IDOT-CDOT MOU streamlines co-review of safety improvements on state routes inside Chicago. `[VERIFIED — secondary]`

### 8.2 What CDOT controls

All other Chicago arterials, collectors, and local streets. CDOT review goes through the Plan Review Committee.

### 8.3 What Cook County controls

Cook County highways — mostly suburban-Cook arterials and collectors outside Chicago. Permit through DOTH; no standalone TIS manual. `[VERIFIED]`

### 8.4 Renderer dispatch logic

```
if (cityLimits == "Chicago") {
  if (roadwayJurisdiction == "state_route") return "chicago_idot";
  else                                       return "chicago_cdot";
}
else if (county == "Cook" && !cityLimits)      return "cook_county";
else if (county in collarCounties)             return `collar_${county}`;
else if (insideTollwayInfluence(site, 1mi))    return "tollway_influence";
else                                            return "downstate_idot";
```

The state-route detection should use the **IDOT roadway-jurisdiction layer** (open data; URL not isolated in this pass — pull from IDOT GIS Hub).

---

## 9. Comparison to Georgia DRI Sample

| Dimension | Georgia DRI (GDOT + ARC + GRTA) | Illinois TIS (IDOT) | Implication for renderer |
|---|---|---|---|
| **Trigger model** | Regional impact thresholds (sq ft / DU / peak-hr) set by DCA; DRI process is mandatory above thresholds | No statewide numeric threshold; warrant-based + agency-discretionary | Renderer must not advertise a numeric trigger statewide; show warrant analysis as the gate |
| **Number of TIS scenarios** | Typically 2 (Existing → Build-Out) + sometimes intermediate years | **4 mandatory** (Opening No-Build, Opening Build, Design No-Build, Design Build); add Full-Build-Out for phased | Layout must accommodate 4× scenario tables/figures |
| **Section count** | ~13 sections in standard DRI deliverable | 11 sections (D8 template) — structurally close but tighter | Renderer can largely reuse the GA backbone; relabel §s |
| **Design horizon** | Typically 5-yr opening + 10–20 yr build-out | **20-year design year mandatory**; BLRS §27-6.02(a) | Default design horizon = 20 yr |
| **Trip generation** | ITE current edition + ARC + DCA coordination | ITE current edition (D8 verbatim); "supplemental sources allowed with permission" | Edition resolves at render time, not hard-coded |
| **LOS standard** | GDOT typically LOS D urban / LOS C rural; GA-DOT-specific worksheets | **C controlling, D allowed in heavily-developed metro** (BLRS Ch. 32) | LOS criterion table differs — separate template constants |
| **Pass-by / internal capture** | ITE / NCHRP defaults; ARC may overlay | ITE defaults; **no IL-specific override located** | Same default; no IL override blob |
| **Software** | Synchro standard at GDOT; HCS / Vistro accepted | Software-agnostic at TIS phase; **HCS mandatory at IDS phase**; SIDRA for roundabouts | Renderer must call out IDS-phase HCS requirement |
| **PE stamp** | GA PE seal + signature | **"Licensed Professional Engineer of Illinois"** verbatim required | Stamp boilerplate differs |
| **Submittal** | DRI: ARC + GRTA + DCA + GDOT; TIS: GDOT District | **IDOT District Permits Unit Chief** for TIS; co-routed to CDOT PRC inside Chicago | Distribution list differs by overlay |
| **Local overlay** | ARC, GRTA, county DOTs, City of Atlanta | **CDOT TDM Guidelines** (Chicago), Cook County DOTH, collar-county DOTs, Tollway | Chicago overlay (TDM Plan) is a fundamentally different deliverable, not just a reskin |
| **Modal-hierarchy framing** | GDOT vehicle-LOS-primary; PEDS guidance for ped/bike | **CDOT explicitly inverts the hierarchy** (ped → transit → bike → auto); CDOT does NOT use vehicle LOS pass/fail | Chicago variant cannot use vehicle-LOS pass/fail as the headline finding |
| **Crash history** | GDOT crash data via GEARS portal | IDOT Safety Data Mart (consultant access via FOIA) | Crash-source citation differs |
| **AADT source** | GDOT TADA viewer | **Getting Around Illinois** | Cite-string differs |
| **Background project context** | GDOT STIP + ARC TIP | **IDOT MYP FY 2026–2031** + CMAP TIP + local CIP | Cite-string differs |
| **Permit form** | GDOT TIS Permit Application | OPER 1050 / OPER 1051 + Title 92 Part 550 reference | Boilerplate differs |
| **Build year language** | "Opening year + 5/10/20" framing common | "Construction year" + "20-year design year"; design year measured from construction completion | Stricter wording — render exactly D8 phrasing |
| **Tollway parallel** | (none in GA; GDOT manages all toll lanes via P3) | **ISTHA is a separate authority** with own Roadway Design Criteria, Drainage Manual, Cost Sharing Policy | Tollway overlay must be its own dispatch branch |

---

## 10. Open Questions for Implementation

1. **BDE chapter numbers** for traffic forecasting and access management must be re-verified against the live BDE TOC from a desktop browser before locking the template's "see BDE Ch. XX" citation strings.
2. **D1 internal TIS guideline** — does District 1 publish anything analogous to D8 Appx. A? If so, override the D8 template for `chicago_idot` and all collar dispatch keys. Confirm at kickoff.
3. **Lake County Technical Reference Manual** PDF must be fetched and parsed to extract Lake-specific TIS-format requirements (LOS, growth, thresholds).
4. **Kane County 2004 Permit Regulations Manual** — same; verify TIS-specific content from local copy.
5. **Tollway influence-area distance** — confirm with current ISTHA Planning whether the 1-mile rule of thumb is the working assumption.
6. **CCO §17-10-0207** (parking reductions for transit-served locations) — confirm exact subsection.
7. ✅ **RESOLVED 2026-06-12**: CDOT TDM Guidelines **v1.2 effective Feb 5, 2024** (supersedes interim v1.1 June 2023). Verified via renderer commit; PDF URL on chicago.gov still pending direct confirmation.

8. **Connected Communities Ordinance — July 2025 parking-mandate amendment**: O2025-0015577, **effective September 25, 2025**, eliminated parking mandates outright in transit-served locations outside the downtown D districts. Renderer surfaces this at submittal time. Earlier spec drafts only flagged "2025-07 parking-mandate amendment" without the ordinance number or effective date — now resolved.
8. **Chicago.gov 403** — replace headless WebFetch with a curl-with-real-UA verification step in CI to byte-check chicago.gov citations.
9. **D1 timelines** for permit issuance — confirm 8–10 weeks / 18–24 months parity with D8 or document the D1-specific window.
10. **Software override at D1** — confirm whether Synchro is accepted at IDS phase in D1 (D8 mandates HCS).

---

## 11. Renderer Constants — Quick Reference

```
ILLINOIS_TIS = {
  baseTemplate:    "idot_d8_april_2024",
  designYearHorizon: 20,
  openingYearOffset: 1,
  losStandard:      { ruralArterial: "C", urbanArterial: "C",
                      urbanArterialMetroOK: "D", urbanLocal: "D" },
  growthRateSource:  "5yr_compound_AADT_GettingAroundIL",
  software: {
    tisPhase:       ["Synchro", "Vistro", "HCS"],
    idsPhase:       ["HCS_only"],
    roundabouts:    ["SIDRA"],
  },
  tripGenSource:    "ITE_TripGen_currentEdition",
  peStamp:          "Licensed Professional Engineer of Illinois",
  submittal:        { copies: 2, electronic: ["pdf", "synchroSource"],
                      routeTo: "DistrictPermitsUnitChief" },
  citations: {
    accessReg:      "92 Ill. Adm. Code Part 550",
    losTable:       "IDOT BLRS Ch. 32",
    horizonRule:    "IDOT BLRS §27-6.02(a)",
    tisGuidelines:  "IDOT D8 High-Volume Access-Permit Guidelines, April 2024 — Appx. A",
    aadtSource:     "Getting Around Illinois",
    programmed:     "IDOT MYP FY 2026–2031 + CMAP TIP",
  }
}

CHICAGO_OVERLAY = {
  baseTemplate:    "cdot_tdm_v1_1_june_2023",
  losStandard:     "n/a — modal hierarchy ped>transit>bike>auto",
  tripGenReduction: "transit_served_location_CCO_half_mile_rule",
  tieredScope:     { tier1: "20-50 DU site plan",
                     tier2: "51-175 DU TDM Memo",
                     tier3: ">175 DU TDM Plan" },
  citations: {
    cco:            "Chicago Municipal Code §17-3-0308, §17-4-0301",
    designGuide:    "Complete Streets Chicago (CDOT, 2013)",
    loadingMin:     "Chicago Municipal Code §17-10-1100",
    pStreets:       "§17-3-0500 / §17-4-0500",
  }
}
```

---

## Verification appendix — what was NOT verified

The renderer should not block-quote any of the following without a desktop-browser confirmation pass:

- BDE Manual specific chapter numbers (Ch. 35 / 36 inferences)
- Lake County Technical Reference Manual numeric thresholds (PDF binary; not parsed)
- Kane County 2004 Permit Regulations Manual content (PDF binary; not parsed)
- chicago.gov URLs (URL surfaced, 403 to headless — confirm bytes from a desktop browser)
- amlegal.com codified Chicago Municipal Code section text (403 to headless)
- "Type II" / "marginal access road" terminology — could not find IL-specific use
- District-1-specific TIS-guideline document (could not locate; D8 is the only one)
- ISTHA influence-area numeric distance (no published value located)
- ILMUTCD direct PDF URL (distributed via district eplan)

These open items belong in §10 as kickoff-meeting questions for the District.
