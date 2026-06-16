/**
 * Multi-state TIS renderer — all US states not covered by a dedicated renderer.
 *
 * Structure follows the canonical Traffic Impact Study format validated against
 * the HCA Florida Westside Hospital TIS (Broward County, 2025):
 *   §1 Executive Summary → §2 Project Description → §3 Methodology →
 *   §4 Existing Conditions → §5 Trip Generation → §6 Distribution →
 *   §7 Background (No-Build) → §8 Build → §9 Mitigation →
 *   §10 Site Access → §11 Transit/Multimodal → §12 Conclusions
 *
 * Each state entry captures the real controlling documents, agency names,
 * LOS standards, PE-seal statutes, and key methodological requirements.
 * Items marked [INFERRED] reflect industry-standard practice where no
 * formal published guideline was located.
 */

import type { Region } from "./regions";

// Re-export for use in pdf-export.ts dispatch
export { renderTisState };

// ---------- Types ----------

export type StateTisConfig = {
  stateCode: string;
  stateName: string;
  agency: string;
  agencyAbbrev: string;
  processName: string;        // "TIA", "TIS", "TA", "MTIA" per jurisdiction
  primaryDoc: string;
  primaryDocYear?: string;
  losUrban: string;           // acceptable LOS grade, urban
  losRural: string;           // acceptable LOS grade, rural
  losNote?: string;
  tripThresholdNote: string;
  horizons: string;
  growthRateNote: string;
  methodologyMeetingRequired: boolean;
  methodologyMeetingNote?: string;
  tripGenSource: string;
  softwareNote?: string;
  concurrencyNote?: string;
  peStatuteRef: string;
  peStatuteName: string;
  specialRequirements?: string[];
};

// ---------- State configs ----------

const CONFIGS: Record<string, StateTisConfig> = {
  AL: {
    stateCode: "AL",
    stateName: "Alabama",
    agency: "Alabama Department of Transportation",
    agencyAbbrev: "ALDOT",
    processName: "Traffic Impact Study (TIS)",
    primaryDoc: "ALDOT Traffic Engineering Manual and Driveway Access Guidelines",
    losUrban: "D",
    losRural: "C",
    losNote: "LOS D on state-maintained routes in urbanized areas; LOS C in rural areas per ALDOT practice. Confirm with District Traffic Engineer at pre-application meeting.",
    tripThresholdNote: "[INFERRED] ≥100 peak-hour trips generally triggers coordination with ALDOT for a state-route access permit and TIS. Confirm threshold with the ALDOT District office.",
    horizons: "Existing conditions + opening year (minimum). Design year (+20 years) typically required for access permit submittals. Multi-phase developments require an analysis year per phase.",
    growthRateNote: "Growth rate derived from historical AADT trends at ALDOT count stations. No statewide default rate published; project-specific derivation from ≥3 years of count data required.",
    methodologyMeetingRequired: true,
    methodologyMeetingNote: "Pre-application meeting with the ALDOT District Transportation Planning Engineer is required before commencing data collection. Scope, study area, and horizon years are agreed at this meeting.",
    tripGenSource: "ITE Trip Generation Manual, 11th Edition (current). ITE Handbook of Transportation Engineering for land uses not in the manual.",
    softwareNote: "HCM (via HCS) and Synchro/SimTraffic are standard. ALDOT accepts outputs from current FHWA-approved software.",
    peStatuteRef: "Ala. Code § 34-11-1 et seq. (Alabama Engineering Practice Act); Ala. Admin. Code r. 930-X-1",
    peStatuteName: "Alabama Engineering Practice Act",
    specialRequirements: [
      "Access permit (ALDOT Form 34) required for any new connection to a state-maintained road.",
      "Crash data analysis for the most recent available 3-year period is typically required for intersections within the study area.",
    ],
  },

  AK: {
    stateCode: "AK",
    stateName: "Alaska",
    agency: "Alaska Department of Transportation and Public Facilities",
    agencyAbbrev: "ADOT&PF",
    processName: "Traffic Impact Analysis (TIA)",
    primaryDoc: "ADOT&PF Highway Preconstruction Manual; ADOT&PF Design Manual",
    losUrban: "D",
    losRural: "C",
    losNote: "[INFERRED] LOS D in urbanized areas (Anchorage, Fairbanks), LOS C in rural areas. Confirm with ADOT&PF Region planning staff.",
    tripThresholdNote: "[INFERRED] ≥100 peak-hour trips on a state highway triggers a TIA for an access permit. ADOT&PF Region staff determine scope.",
    horizons: "Existing + opening year + design year (20 years). ADOT&PF uses 20-year design horizon per the Highway Preconstruction Manual.",
    growthRateNote: "Derived from ADOT&PF Traffic Monitoring station data and regional growth projections from the applicable MPO (Anchorage Metropolitan Area Transportation Solutions — AMATS) or rural planning body.",
    methodologyMeetingRequired: true,
    methodologyMeetingNote: "Coordinate with ADOT&PF Central Region (Anchorage) or Northern Region (Fairbanks) Traffic and Safety staff before data collection. Wildlife-related access and seasonal traffic patterns (summer peak, winter operations) must be addressed in scope.",
    tripGenSource: "ITE Trip Generation Manual, 11th Edition. Local vehicle generation data (particularly for resource extraction or remote facilities) may be required.",
    peStatuteRef: "Alaska Stat. § 08.48 (Architects, Engineers, and Land Surveyors)",
    peStatuteName: "Alaska Engineering Registration Act",
    specialRequirements: [
      "Seasonal AADT conversion factors (summer/winter) typically required — Alaska has pronounced seasonal traffic variation.",
      "Wildlife crossing locations and moose/caribou hazard zones must be noted for rural study areas.",
      "Permit required under AS 19.25.010 for access to state highways.",
    ],
  },

  AZ: {
    stateCode: "AZ",
    stateName: "Arizona",
    agency: "Arizona Department of Transportation",
    agencyAbbrev: "ADOT",
    processName: "Traffic Impact Analysis (TIA)",
    primaryDoc: "ADOT Traffic Impact Study Guidelines; ADOT Roadway Design Guidelines",
    losUrban: "D",
    losRural: "C",
    losNote: "LOS D in urbanized areas; LOS E acceptable on some urban corridor segments where constrained. Maricopa County (Phoenix MPO/MAG) and Pima County (PAG) have supplemental TIA guidelines that may impose stricter or alternative thresholds — confirm with the local jurisdiction.",
    tripThresholdNote: "≥50 peak-hour trips to/from a state highway triggers ADOT access permit + TIA review. Phoenix (City of Phoenix TIA Manual) and Tucson have independent city-level thresholds. Confirm applicable jurisdiction.",
    horizons: "Existing + opening year + 5-year design. ADOT access permits typically require a 5-year horizon per the Roadway Design Guidelines. Local jurisdictions may require 10 or 20 years.",
    growthRateNote: "ADOT Traffic Monitoring count data; MAG Travel Demand Model (Phoenix metro) or PAG model (Tucson metro) for larger projects. Growth rates derived from ≥5 years of counts on the study corridor.",
    methodologyMeetingRequired: true,
    methodologyMeetingNote: "ADOT access permits require a pre-application meeting with ADOT District Traffic Engineer. City of Phoenix and City of Tucson require separate scoping with their traffic engineering staff.",
    tripGenSource: "ITE Trip Generation Manual, 11th Edition. Phoenix and Pima County may require local trip rate studies for specific land uses.",
    peStatuteRef: "A.R.S. § 32-121 et seq. (Engineering); A.A.C. R4-30-101 et seq.",
    peStatuteName: "Arizona Engineering Practice Act",
    specialRequirements: [
      "ADOT State Route Access Management Guidelines (current edition) apply to all access points on state routes.",
      "High-growth corridors in Maricopa and Pima Counties may require 20-year analysis horizon.",
      "Dust Control Plan may be required for construction-phase traffic on unpaved corridors.",
    ],
  },

  AR: {
    stateCode: "AR",
    stateName: "Arkansas",
    agency: "Arkansas Department of Transportation",
    agencyAbbrev: "ArDOT",
    processName: "Traffic Impact Study (TIS)",
    primaryDoc: "ArDOT Traffic Engineering Guidelines; ArDOT Highway Design Manual",
    losUrban: "D",
    losRural: "C",
    tripThresholdNote: "[INFERRED] ≥100 peak-hour trips on a state highway triggers ArDOT coordination and TIS. Confirm with District Engineer.",
    horizons: "Existing + opening year + 20-year design horizon per ArDOT Highway Design Manual.",
    growthRateNote: "ArDOT traffic count data (Traffic Analysis & Information System); project-specific trend analysis for ≥3 years on the study corridor.",
    methodologyMeetingRequired: false,
    methodologyMeetingNote: "Pre-application coordination with ArDOT District Traffic Engineer is recommended but not formally required before data collection for most projects.",
    tripGenSource: "ITE Trip Generation Manual, 11th Edition.",
    peStatuteRef: "Ark. Code Ann. § 17-30-101 et seq. (Engineering Practice Act)",
    peStatuteName: "Arkansas Engineering Practice Act",
  },

  CO: {
    stateCode: "CO",
    stateName: "Colorado",
    agency: "Colorado Department of Transportation",
    agencyAbbrev: "CDOT",
    processName: "Traffic Impact Study (TIS)",
    primaryDoc: "Colorado State Highway Access Code (2 CCR 601-1); CDOT Traffic Impact Study Guidelines",
    primaryDocYear: "2023",
    losUrban: "D",
    losRural: "C",
    losNote: "LOS D on state highway facilities per the State Highway Access Code. Category 1 and 2 highways typically hold LOS D; Category 3 and below may accept E in constrained corridors with CDOT approval. Confirm at the access permit scoping meeting.",
    tripThresholdNote: "≥25 peak-hour trips on a state highway (Category 1 or 2) triggers a TIS per the State Highway Access Code (2 CCR 601-1 §2.3). Local jurisdictions (Denver, Aurora, Jefferson County) typically trigger at 100 peak-hour trips.",
    horizons: "Existing + opening year + 20-year design horizon per 2 CCR 601-1. CDOT access permits require both opening-year and design-year (20-year) analyses.",
    growthRateNote: "CDOT Traffic Data Explorer for historical AADT counts; DRCOG Regional Travel Demand Model (Denver metro) or applicable MPO model. Growth rate from ≥5 years of CDOT count data.",
    methodologyMeetingRequired: true,
    methodologyMeetingNote: "Access permit applications under 2 CCR 601-1 require a pre-application conference with the CDOT Region Access Manager before data collection. Scope, study area, and methodology must be approved in writing.",
    tripGenSource: "ITE Trip Generation Manual, 11th Edition. Colorado local trip characteristics studies may supplement for mixed-use or transit-oriented developments in Denver metro.",
    softwareNote: "Synchro/SimTraffic and HCS are standard. CDOT Region 1 (Denver metro) may require separate VISSIM simulation for complex corridors.",
    peStatuteRef: "C.R.S. § 12-120-102 et seq. (Colorado Professional Engineering Practice); 4 CCR 729-1",
    peStatuteName: "Colorado Professional Engineering Practice Act",
    specialRequirements: [
      "State Highway Access Permit (CDOT Form 137) required before any new access to a state highway.",
      "Intergovernmental Agreement (IGA) between developer and local jurisdiction may be required for off-site improvements.",
      "At-grade rail crossings within the study area must address CDOT Rail crossing requirements (C.R.S. § 40-29).",
    ],
  },

  CT: {
    stateCode: "CT",
    stateName: "Connecticut",
    agency: "Connecticut Department of Transportation",
    agencyAbbrev: "ConnDOT",
    processName: "Traffic Impact and Access Study (TIAS)",
    primaryDoc: "ConnDOT Traffic Impact Assessment Guidelines; ConnDOT Highway Design Manual",
    losUrban: "D",
    losRural: "C",
    tripThresholdNote: "≥100 peak-hour trips on a state route triggers ConnDOT review and formal TIAS. Local COGs and Regional Planning Organizations may impose lower thresholds.",
    horizons: "Existing + opening year + 5-year or 10-year design horizon. ConnDOT typically requires a 10-year horizon for large developments.",
    growthRateNote: "ConnDOT counts from the Traffic Monitoring Program; CTDOT Travel Demand Model for corridor-level growth projections in the Hartford and New Haven metros.",
    methodologyMeetingRequired: true,
    methodologyMeetingNote: "Mandatory pre-application meeting with ConnDOT District Traffic Engineering Unit before data collection for any project requiring a state highway access permit.",
    tripGenSource: "ITE Trip Generation Manual, 11th Edition.",
    peStatuteRef: "Conn. Gen. Stat. § 20-300 et seq. (Engineering Practice Act)",
    peStatuteName: "Connecticut Engineering Practice Act",
    specialRequirements: [
      "Highway Work Permit (ConnDOT Form CY-100) required for any work within state highway right-of-way.",
      "Connecticut Environmental Policy Act (CEPA) consistency may be required for large developments.",
    ],
  },

  DE: {
    stateCode: "DE",
    stateName: "Delaware",
    agency: "Delaware Department of Transportation",
    agencyAbbrev: "DelDOT",
    processName: "Traffic Impact Study (TIS)",
    primaryDoc: "DelDOT Development Coordination Manual (current edition)",
    losUrban: "D",
    losRural: "C",
    tripThresholdNote: "≥50 peak-hour trips: Preliminary Study required. ≥100 peak-hour trips: Full TIS required per the DelDOT Development Coordination Manual.",
    horizons: "Existing + opening year + 5-year horizon per the DelDOT Development Coordination Manual. Long-range (buildout) analysis may be required for large developments.",
    growthRateNote: "DelDOT Traffic Section historical AADT data; WILMAPCO or Dover/Kent MPO travel demand model for corridor growth where available.",
    methodologyMeetingRequired: true,
    methodologyMeetingNote: "Pre-application meeting with DelDOT Traffic Section required. Delaware uses a development review process through the Office of State Planning Coordination (OSPC); all projects above the TIS threshold must be coordinated through OSPC prior to local approval.",
    tripGenSource: "ITE Trip Generation Manual, 11th Edition.",
    peStatuteRef: "24 Del. C. § 2801 et seq. (Delaware Professional Engineers Practice Act)",
    peStatuteName: "Delaware Professional Engineers Practice Act",
    specialRequirements: [
      "Utility Accommodation Policy (DelDOT) governs work within state highway ROW.",
      "Realty Subdivision Act review required for residential subdivisions.",
    ],
  },

  HI: {
    stateCode: "HI",
    stateName: "Hawaii",
    agency: "Hawaii Department of Transportation",
    agencyAbbrev: "HDOT",
    processName: "Traffic Impact Assessment Report (TIAR)",
    primaryDoc: "HDOT Traffic Impact Assessment Report Guidelines; Hawaii Revised Statutes Chapter 264",
    losUrban: "D",
    losRural: "D",
    losNote: "LOS D statewide (no rural/urban split in HDOT practice — Hawaii has no rural interstate highways). Honolulu's DPP has additional requirements for O'ahu projects.",
    tripThresholdNote: "[INFERRED] ≥50 peak-hour trips triggers a TIAR for state highway access. City and County of Honolulu (DPP) requires TIAR for projects generating ≥25 peak-hour trips. Confirm with applicable jurisdiction (each county maintains separate TIA review).",
    horizons: "Existing + opening year + 10-year design horizon. Honolulu projects follow the City & County DPP TIAR Guidelines.",
    growthRateNote: "HDOT Traffic Volume Data (HI-6300 series count reports); Oahu Regional Transportation Plan (ORTP) travel demand model for O'ahu projects; neighbor-island growth from HDOT traffic counts.",
    methodologyMeetingRequired: true,
    methodologyMeetingNote: "Pre-application scoping with HDOT Highways Division Planning Branch required. For O'ahu projects, additional scoping with the City and County of Honolulu Department of Planning and Permitting (DPP) is required.",
    tripGenSource: "ITE Trip Generation Manual, 11th Edition. Local Hawaii-specific resort/hotel data available through HDOT or prior approved studies.",
    peStatuteRef: "Haw. Rev. Stat. § 464-1 et seq. (Engineers, Architects, Surveyors, and Landscape Architects)",
    peStatuteName: "Hawaii Professional Engineering Practice",
    specialRequirements: [
      "Special Management Area (SMA) compliance under Haw. Rev. Stat. § 205A required for coastal developments.",
      "Environmental Assessment (EA) under Chapter 343, HRS, may trigger a transportation chapter that overlaps with the TIAR.",
      "HOV/carpool lane requirements and transit orientation encouraged for O'ahu projects near TheBus routes.",
    ],
  },

  ID: {
    stateCode: "ID",
    stateName: "Idaho",
    agency: "Idaho Transportation Department",
    agencyAbbrev: "ITD",
    processName: "Traffic Impact Study (TIS)",
    primaryDoc: "ITD Highway Design Manual; ITD Access Management Standards and Procedures Manual",
    losUrban: "D",
    losRural: "C",
    tripThresholdNote: "[INFERRED] ≥100 peak-hour trips on a state highway triggers ITD TIS review for access management. Confirm with ITD District Traffic Engineer.",
    horizons: "Existing + opening year + 20-year design horizon per ITD Highway Design Manual.",
    growthRateNote: "ITD Transportation Data historical counts; applicable metropolitan planning organization (COMPASS — Boise metro) travel demand model for urban projects.",
    methodologyMeetingRequired: false,
    methodologyMeetingNote: "Coordinate with ITD District Engineer before data collection for projects requiring state highway access.",
    tripGenSource: "ITE Trip Generation Manual, 11th Edition.",
    peStatuteRef: "Idaho Code § 54-1201 et seq. (Professional Engineers Practice Act)",
    peStatuteName: "Idaho Professional Engineers Practice Act",
  },

  IN: {
    stateCode: "IN",
    stateName: "Indiana",
    agency: "Indiana Department of Transportation",
    agencyAbbrev: "INDOT",
    processName: "Traffic Impact Study (TIS)",
    primaryDoc: "INDOT Design Manual Chapter 53 (Traffic Studies); INDOT Traffic Impact Study Guidelines",
    losUrban: "D",
    losRural: "C",
    tripThresholdNote: "≥100 peak-hour trips on a state route triggers INDOT review. Local jurisdictions (Indianapolis, Fort Wayne, South Bend) maintain separate TIS thresholds.",
    horizons: "Existing + opening year + 10-year design horizon per INDOT Design Manual §53. INDOT access permits typically require 20-year horizon for principal arterials.",
    growthRateNote: "INDOT Traffic Data (count stations statewide via INDOT Office of Traffic Safety and Technology); IRTIP/MPO travel demand model for Indianapolis metro (MPO) projects.",
    methodologyMeetingRequired: false,
    methodologyMeetingNote: "Coordinate with INDOT District Office for state-highway access projects. Local MPO scoping may also be required.",
    tripGenSource: "ITE Trip Generation Manual, 11th Edition.",
    peStatuteRef: "Ind. Code § 25-31-1-1 et seq. (Engineering Practice Act); 864 IAC 1",
    peStatuteName: "Indiana Engineering Practice Act",
    specialRequirements: [
      "INDOT Drainage Manual compliance required for storm-water runoff and access design.",
    ],
  },

  IA: {
    stateCode: "IA",
    stateName: "Iowa",
    agency: "Iowa Department of Transportation",
    agencyAbbrev: "Iowa DOT",
    processName: "Traffic Impact Study (TIS)",
    primaryDoc: "Iowa DOT Access Management Design Standards; Iowa DOT Location and Design Manual",
    losUrban: "D",
    losRural: "C",
    tripThresholdNote: "[INFERRED] ≥50 peak-hour trips on a primary highway triggers Iowa DOT access permit and TIS review. Confirm with Iowa DOT District staff.",
    horizons: "Existing + opening year + 20-year design horizon per Iowa DOT Location and Design Manual.",
    growthRateNote: "Iowa DOT traffic count data (published annual AADT reports by route); applicable MPO travel demand model (DMAMPO — Des Moines, JCCOG — Iowa City, etc.).",
    methodologyMeetingRequired: false,
    tripGenSource: "ITE Trip Generation Manual, 11th Edition.",
    peStatuteRef: "Iowa Code § 542B.1 et seq. (Engineering Practice Act)",
    peStatuteName: "Iowa Engineering Practice Act",
  },

  KS: {
    stateCode: "KS",
    stateName: "Kansas",
    agency: "Kansas Department of Transportation",
    agencyAbbrev: "KDOT",
    processName: "Traffic Impact Study (TIS)",
    primaryDoc: "KDOT Design Manual; KDOT Access Management Policy and Guidelines",
    losUrban: "D",
    losRural: "C",
    tripThresholdNote: "[INFERRED] ≥100 peak-hour trips on a state highway triggers KDOT access review and TIS. Confirm with KDOT District Engineer.",
    horizons: "Existing + opening year + 20-year design horizon per KDOT Design Manual.",
    growthRateNote: "KDOT annual traffic count data (Kansas Traffic Observation System — KTOS); applicable MPO model (MARC — Kansas City metro; WAMPO — Wichita).",
    methodologyMeetingRequired: false,
    tripGenSource: "ITE Trip Generation Manual, 11th Edition.",
    peStatuteRef: "K.S.A. § 74-7001 et seq. (Kansas Professional Engineering Practice Act)",
    peStatuteName: "Kansas Professional Engineering Practice Act",
  },

  KY: {
    stateCode: "KY",
    stateName: "Kentucky",
    agency: "Kentucky Transportation Cabinet",
    agencyAbbrev: "KYTC",
    processName: "Traffic Impact Study (TIS)",
    primaryDoc: "KYTC Highway Design Manual; KYTC Traffic Impact Study Guidelines",
    losUrban: "D",
    losRural: "C",
    tripThresholdNote: "[INFERRED] ≥100 peak-hour trips on a state-maintained route triggers KYTC TIS requirement. Confirm with KYTC District Office.",
    horizons: "Existing + opening year + 10-year design horizon minimum. 20-year horizon for major developments.",
    growthRateNote: "KYTC Traffic Analysis Branch count data; applicable MPO model (OKI — Cincinnati metro; KIPDA — Louisville metro).",
    methodologyMeetingRequired: false,
    tripGenSource: "ITE Trip Generation Manual, 11th Edition.",
    peStatuteRef: "KRS § 322.010 et seq. (Kentucky Engineering Practice Act); 201 KAR 18",
    peStatuteName: "Kentucky Engineering Practice Act",
  },

  LA: {
    stateCode: "LA",
    stateName: "Louisiana",
    agency: "Louisiana Department of Transportation and Development",
    agencyAbbrev: "LADOTD",
    processName: "Traffic Impact Analysis (TIA)",
    primaryDoc: "LADOTD Traffic Impact Analysis Guidelines; LADOTD Access Management Rules (LAC 70:I.101)",
    losUrban: "D",
    losRural: "C",
    losNote: "LOS D standard in urbanized areas; LOS E acceptable on some constrained urban corridors with LADOTD approval. Confirm with District Traffic Engineer.",
    tripThresholdNote: "≥100 peak-hour trips on a state highway triggers LADOTD TIA review and access permit requirement per LAC 70:I.101 (Access Management Rules).",
    horizons: "Existing + opening year + 20-year design horizon per LADOTD standard.",
    growthRateNote: "LADOTD count data from the Traffic Operations Center (TOC); applicable MPO model (LRMTS — New Orleans, Capital Region Planning Commission — Baton Rouge).",
    methodologyMeetingRequired: true,
    methodologyMeetingNote: "Pre-application coordination with the LADOTD District Traffic Engineer is required for state highway access permits. Scope and methodology letter are required before data collection.",
    tripGenSource: "ITE Trip Generation Manual, 11th Edition.",
    peStatuteRef: "La. R.S. § 37:681 et seq. (Engineering Practice Act); LAC 46:LXI.101",
    peStatuteName: "Louisiana Engineering Practice Act",
    specialRequirements: [
      "Driveway / Access Permit required under LAC 70:I.101 for any access to a state highway.",
      "Coastal Zone Management Act compliance may apply in coastal parishes.",
    ],
  },

  ME: {
    stateCode: "ME",
    stateName: "Maine",
    agency: "Maine Department of Transportation",
    agencyAbbrev: "MaineDOT",
    processName: "Traffic Movement Permit (TMP) Study",
    primaryDoc: "MaineDOT Traffic Movement Permit Rules (Chapter 301); MaineDOT Traffic Engineering Guidelines",
    losUrban: "D",
    losRural: "C",
    tripThresholdNote: "Traffic Movement Permit (TMP) required under 23 M.R.S.A. § 704-A for any development generating ≥100 peak-hour trips. MaineDOT Chapter 301 rules are the governing framework — Maine has a regulated TMP process rather than guidelines.",
    horizons: "Existing + opening year + 10-year design horizon per Chapter 301 TMP rules.",
    growthRateNote: "MaineDOT traffic count data (ATR network statewide); applicable metropolitan area (Greater Portland Council of Governments) model where available.",
    methodologyMeetingRequired: true,
    methodologyMeetingNote: "Pre-application meeting with MaineDOT Bureau of Planning required for TMP applications. Chapter 301 sets mandatory process steps including a scoping letter before data collection.",
    tripGenSource: "ITE Trip Generation Manual, 11th Edition.",
    peStatuteRef: "32 M.R.S.A. § 1251 et seq. (Professional Engineers Practice Act)",
    peStatuteName: "Maine Professional Engineers Practice Act",
    specialRequirements: [
      "Traffic Movement Permit (TMP) is a state-regulated permit under 23 M.R.S.A. § 704-A — not advisory.",
      "MaineDOT Chapter 301 includes mandatory LOS and mitigation standards enforceable as permit conditions.",
    ],
  },

  MD: {
    stateCode: "MD",
    stateName: "Maryland",
    agency: "Maryland State Highway Administration",
    agencyAbbrev: "MDSHA",
    processName: "Traffic Impact Study (TIS)",
    primaryDoc: "Maryland SHA Traffic Impact Study Guidelines (current edition); Maryland Access Management Policy",
    losUrban: "D",
    losRural: "C",
    losNote: "LOS D on SHA-maintained facilities. Montgomery County, Prince George's County, Howard County, and Anne Arundel County maintain their own county TIS guidelines with varying LOS standards — confirm the applicable county standard in addition to MDSHA requirements.",
    tripThresholdNote: "≥50 peak-hour trips on a state highway triggers MDSHA Access Permit and TIS. County-level thresholds vary: Montgomery County typically triggers at ≥50 PHT; Prince George's at ≥100 PHT. Confirm with SHA District office and applicable county.",
    horizons: "Existing + opening year + 5-year design horizon for SHA access permits. Some counties require 20-year horizon.",
    growthRateNote: "SHA traffic count database (State Roads Commission historical AADT); BMC (Baltimore Metropolitan Council) travel demand model for Baltimore metro; MWCOG model for Washington suburban jurisdictions.",
    methodologyMeetingRequired: true,
    methodologyMeetingNote: "SHA requires a pre-application scope meeting. Montgomery and Howard Counties additionally require county-level TIS scope approval before data collection.",
    tripGenSource: "ITE Trip Generation Manual, 11th Edition.",
    peStatuteRef: "Md. Business Occupations and Professions Code § 14-101 et seq.; COMAR 09.23.01",
    peStatuteName: "Maryland Engineering Practice Act",
    specialRequirements: [
      "State Highway Permit (SHA) required for any access to a state-maintained road.",
      "Statewide vehicle miles traveled (VMT) tracking is used for SB 1 (Maryland Climate Solutions Now Act, 2022) compliance; large developments may need to address transportation-mode VMT reductions.",
    ],
  },

  MA: {
    stateCode: "MA",
    stateName: "Massachusetts",
    agency: "Massachusetts Department of Transportation",
    agencyAbbrev: "MassDOT",
    processName: "Transportation Impact Assessment (TIA)",
    primaryDoc: "MassDOT Transportation Impact Assessment Guidelines (current edition); 540 CMR 4.00",
    losUrban: "D",
    losRural: "D",
    losNote: "LOS D standard on state highways in both urban and rural areas per MassDOT practice. The Massachusetts Environmental Policy Act (MEPA) thresholds add a separate layer: projects requiring an Environmental Notification Form (ENF) or Environmental Impact Report (EIR) under MEPA trigger a Chapter 91 / EENF transportation review.",
    tripThresholdNote: "≥100 new peak-hour trips on a state highway triggers a MassDOT TIA. MEPA independently triggers at development thresholds in 301 CMR 11.00 (e.g., ≥100,000 sf new commercial, ≥25 new vehicle trips to/from a limited-access highway interchange).",
    horizons: "Existing + opening year + 5-year design horizon for state highway access. MEPA EIR projects require longer-range analysis (typically 10-year).",
    growthRateNote: "MassDOT traffic count data (District Traffic Engineering); CTPS (Central Transportation Planning Staff) regional model for Boston metro; MPO models for Springfield/Pittsfield metros.",
    methodologyMeetingRequired: true,
    methodologyMeetingNote: "Pre-application scope meeting with MassDOT District Traffic Engineering required. For MEPA projects, concurrent scoping with MEPA is required before data collection begins.",
    tripGenSource: "ITE Trip Generation Manual, 11th Edition. Boston metro projects may use CTPS disaggregate trip rate data for transit-accessible sites.",
    peStatuteRef: "M.G.L. c. 112, § 81D et seq. (Engineering Practice); 250 CMR 5.00",
    peStatuteName: "Massachusetts Engineering Practice Act",
    specialRequirements: [
      "MassDOT Highway Access Permit (HAP) required for any access to a state highway.",
      "Green Line, Silver Line, and commuter rail proximity may qualify developments for transit-reduction credits in MEPA review.",
      "MassDOT Complete Streets program: pedestrian and bicycle improvements must be addressed in the TIA.",
    ],
  },

  MI: {
    stateCode: "MI",
    stateName: "Michigan",
    agency: "Michigan Department of Transportation",
    agencyAbbrev: "MDOT",
    processName: "Traffic Impact Study (TIS)",
    primaryDoc: "MDOT Traffic Impact Study Guidelines; MDOT Road Design Manual",
    losUrban: "D",
    losRural: "C",
    tripThresholdNote: "≥100 peak-hour trips generated to/from a state trunk line triggers MDOT review and a formal TIS per MDOT Traffic Impact Study Guidelines.",
    horizons: "Existing + opening year + 10-year design horizon. MDOT may require 20-year for significant generators on principal arterials.",
    growthRateNote: "MDOT traffic count data (statewide ATR network); applicable MPO model (SEMCOG — Detroit metro; GVMC — Grand Rapids; Tri-County Regional Planning — Lansing).",
    methodologyMeetingRequired: true,
    methodologyMeetingNote: "Pre-application meeting with MDOT Region Planning staff required for projects generating ≥500 peak-hour trips. Methodology letter on file before data collection.",
    tripGenSource: "ITE Trip Generation Manual, 11th Edition.",
    peStatuteRef: "MCL § 339.2001 et seq. (Michigan Engineering Practice Act); R 339.2301",
    peStatuteName: "Michigan Engineering Practice Act",
    specialRequirements: [
      "MDOT Driveway Permit (M-58) required for access to a state trunk line.",
      "Snow and ice operations, winter visibility, and pavement conditions are addressed in Michigan TIS — specify design vehicle and seasonal adjustments for northern Michigan projects.",
    ],
  },

  MN: {
    stateCode: "MN",
    stateName: "Minnesota",
    agency: "Minnesota Department of Transportation",
    agencyAbbrev: "MnDOT",
    processName: "Traffic Impact Analysis (TIA)",
    primaryDoc: "MnDOT TIS Guidelines; Minnesota Rules Chapter 8820 (Access Management)",
    losUrban: "D",
    losRural: "C",
    tripThresholdNote: "≥50 peak-hour trips on a state highway triggers MnDOT access permit review. Full TIA typically required for ≥100 PHT. MnDOT District determines scope.",
    horizons: "Existing + opening year + 20-year design horizon per MnDOT guidelines.",
    growthRateNote: "MnDOT traffic count data (AMP — Automatic Machine Placement); Metropolitan Council travel demand model (Twin Cities metro); Greater Minnesota MPO models.",
    methodologyMeetingRequired: false,
    methodologyMeetingNote: "Pre-application coordination with MnDOT District Permits is recommended. Metropolitan Council review may also be required in the seven-county Twin Cities metro.",
    tripGenSource: "ITE Trip Generation Manual, 11th Edition.",
    softwareNote: "Synchro/SimTraffic and HCS standard. MnDOT may require VISSIM for complex interchange analyses.",
    peStatuteRef: "Minn. Stat. § 326.10 et seq. (Engineering Practice Act); Minn. R. 1800",
    peStatuteName: "Minnesota Engineering Practice Act",
    specialRequirements: [
      "Access Permit required under Minn. Stat. § 160.18 for access to a state highway.",
      "Minnesota Chapter 8820 Access Management Rules apply classification and spacing standards by route type.",
    ],
  },

  MS: {
    stateCode: "MS",
    stateName: "Mississippi",
    agency: "Mississippi Department of Transportation",
    agencyAbbrev: "MDOT",
    processName: "Traffic Impact Study (TIS)",
    primaryDoc: "MDOT Traffic Engineering Guidelines; MDOT Road Design Manual",
    losUrban: "D",
    losRural: "C",
    tripThresholdNote: "[INFERRED] ≥100 peak-hour trips on a state highway triggers MDOT coordination and TIS. Confirm with MDOT District Engineer.",
    horizons: "Existing + opening year + 20-year design horizon.",
    growthRateNote: "MDOT traffic count data (published AADT volumes by route); applicable MPO model (Central Mississippi Planning and Development District — Jackson metro).",
    methodologyMeetingRequired: false,
    tripGenSource: "ITE Trip Generation Manual, 11th Edition.",
    peStatuteRef: "Miss. Code Ann. § 73-13-1 et seq. (Engineering Practice Act)",
    peStatuteName: "Mississippi Engineering Practice Act",
  },

  MO: {
    stateCode: "MO",
    stateName: "Missouri",
    agency: "Missouri Department of Transportation",
    agencyAbbrev: "MoDOT",
    processName: "Traffic Impact Study (TIS)",
    primaryDoc: "MoDOT Engineering Policy Guide (Access Management); MoDOT Traffic Impact Study Guidance",
    losUrban: "D",
    losRural: "C",
    tripThresholdNote: "[INFERRED] ≥100 peak-hour trips on a state highway triggers MoDOT access review. Confirm with MoDOT District Engineer.",
    horizons: "Existing + opening year + 20-year design horizon per MoDOT Engineering Policy Guide.",
    growthRateNote: "MoDOT traffic count data (statewide ATC count stations); MARC (Kansas City metro) or East-West Gateway COG (St. Louis metro) travel demand models.",
    methodologyMeetingRequired: false,
    tripGenSource: "ITE Trip Generation Manual, 11th Edition.",
    peStatuteRef: "Mo. Rev. Stat. § 327.011 et seq. (Engineering Practice Act); 20 CSR 2030",
    peStatuteName: "Missouri Engineering Practice Act",
  },

  MT: {
    stateCode: "MT",
    stateName: "Montana",
    agency: "Montana Department of Transportation",
    agencyAbbrev: "MDT",
    processName: "Traffic Impact Study (TIS)",
    primaryDoc: "MDT Utilities and Encroachment Permit Manual; MDT Road Design Manual",
    losUrban: "D",
    losRural: "C",
    losNote: "[INFERRED] LOS D in urban clusters; LOS C in rural Montana reflecting lower volumes and long-range design approach. Confirm with MDT District.",
    tripThresholdNote: "[INFERRED] ≥50 peak-hour trips on a state highway triggers MDT review. Montana has limited urban area — most TIS work is for access permits on US/state routes in small cities.",
    horizons: "Existing + opening year + 20-year design horizon per MDT Road Design Manual.",
    growthRateNote: "MDT traffic count data (Montana Traffic Monitoring System). Low-volume rural corridors may use 10-year historical trend.",
    methodologyMeetingRequired: false,
    tripGenSource: "ITE Trip Generation Manual, 11th Edition. Rural generator types (agriculture, resource extraction, resort) may require project-specific trip rate studies.",
    peStatuteRef: "Mont. Code Ann. § 37-67-101 et seq. (Engineering Practice Act)",
    peStatuteName: "Montana Engineering Practice Act",
  },

  NE: {
    stateCode: "NE",
    stateName: "Nebraska",
    agency: "Nebraska Department of Transportation",
    agencyAbbrev: "NDOT",
    processName: "Traffic Impact Study (TIS)",
    primaryDoc: "NDOT Road Design Manual; NDOT Access Management Policy",
    losUrban: "D",
    losRural: "C",
    tripThresholdNote: "[INFERRED] ≥100 peak-hour trips on a state highway triggers NDOT review. Confirm with NDOT District Engineer.",
    horizons: "Existing + opening year + 20-year design horizon.",
    growthRateNote: "NDOT traffic count data (Traffic Monitoring System); MAPA (Omaha metro) travel demand model for Omaha projects.",
    methodologyMeetingRequired: false,
    tripGenSource: "ITE Trip Generation Manual, 11th Edition.",
    peStatuteRef: "Neb. Rev. Stat. § 81-3401 et seq. (Engineering Practice Act)",
    peStatuteName: "Nebraska Engineering Practice Act",
  },

  NV: {
    stateCode: "NV",
    stateName: "Nevada",
    agency: "Nevada Department of Transportation",
    agencyAbbrev: "NDOT",
    processName: "Traffic Impact Study (TIS)",
    primaryDoc: "NDOT Access Management Policy; NDOT Traffic Impact Study Guidelines",
    losUrban: "D",
    losRural: "C",
    losNote: "LOS D standard on NDOT-maintained facilities. Clark County (Las Vegas metro) and Washoe County (Reno metro) each have adopted county TIS guidelines that may impose different LOS standards — confirm applicable jurisdiction.",
    tripThresholdNote: "≥50 peak-hour trips on a state highway triggers NDOT review. Clark County Department of Public Works triggers a TIS at ≥100 PHT. City of Las Vegas and Henderson have independent thresholds.",
    horizons: "Existing + opening year + 5-year design minimum. Clark County typically requires 10-year horizon.",
    growthRateNote: "NDOT traffic count data; RTC Southern Nevada travel demand model (Las Vegas metro); RTC Washoe model (Reno metro).",
    methodologyMeetingRequired: true,
    methodologyMeetingNote: "Clark County TIS Review requires pre-application scoping with Clark County DPW Traffic Engineering before data collection. NDOT access permits require separate coordination.",
    tripGenSource: "ITE Trip Generation Manual, 11th Edition. Clark County has some Las Vegas-specific casino/resort trip rate experience; confirm with DPW.",
    peStatuteRef: "Nev. Rev. Stat. § 625.010 et seq. (Engineering Practice Act); NAC Chapter 625",
    peStatuteName: "Nevada Engineering Practice Act",
    specialRequirements: [
      "Clark County Special Use Permit traffic study requirements may supplement NDOT access permit TIS.",
    ],
  },

  NH: {
    stateCode: "NH",
    stateName: "New Hampshire",
    agency: "New Hampshire Department of Transportation",
    agencyAbbrev: "NHDOT",
    processName: "Traffic Impact Analysis (TIA)",
    primaryDoc: "NHDOT Traffic Impact Analysis Guidelines; NH RSA 236:13 (Driveway Permit)",
    losUrban: "D",
    losRural: "C",
    tripThresholdNote: "NH RSA 236:13 requires a driveway permit for any access to a state highway. ≥100 peak-hour trips typically triggers a formal TIA scope per NHDOT Bureau of Traffic guidelines.",
    horizons: "Existing + opening year + 10-year design horizon per NHDOT standard.",
    growthRateNote: "NHDOT traffic count data (Traffic Monitoring System); Southern New Hampshire Planning Commission or Nashua Regional Planning Commission models for southern NH projects.",
    methodologyMeetingRequired: false,
    methodologyMeetingNote: "Coordinate with NHDOT Bureau of Traffic for state highway access permits.",
    tripGenSource: "ITE Trip Generation Manual, 11th Edition.",
    peStatuteRef: "RSA 310-A:1 et seq. (Engineering Practice Act); Env-A 1101",
    peStatuteName: "New Hampshire Engineering Practice Act",
  },

  NJ: {
    stateCode: "NJ",
    stateName: "New Jersey",
    agency: "New Jersey Department of Transportation",
    agencyAbbrev: "NJDOT",
    processName: "Traffic Impact Statement (TIS) / Site Roadway Improvement Study (SRSI)",
    primaryDoc: "NJDOT Roadway Design Manual; NJDOT Site Impact Evaluation Policy (N.J.A.C. 16:47 — Access Management Code)",
    losUrban: "D",
    losRural: "D",
    losNote: "LOS D standard on state-maintained routes per NJDOT. Some congested NJ corridors (US-1, US-9, NJ-17) accept LOS E as 'constrained' when no improvement is feasible. Local RSIS (Residential Site Improvement Standards) apply for residential uses.",
    tripThresholdNote: "NJDOT access permit (N.J.A.C. 16:47) triggers a Traffic Conflict Analysis for developments generating ≥100 PHT on a state highway. NJDOT Statewide Traffic Impact Assessment policy is triggered per the specific proposal type. County and municipal site plan review has independent thresholds.",
    horizons: "Existing + opening year + 10-year design horizon. NJDOT permits typically require a 10-year full build-out analysis.",
    growthRateNote: "NJDOT traffic count data (Traffic Monitoring Unit); NJTPA (North Jersey), DVRPC (Delaware Valley), or SJTPO (South Jersey) travel demand models per applicable MPO.",
    methodologyMeetingRequired: true,
    methodologyMeetingNote: "NJDOT access permits require pre-application coordination with the NJDOT Bureau of Access Permits. Site Impact Evaluation scope must be agreed in writing before field data collection.",
    tripGenSource: "ITE Trip Generation Manual, 11th Edition. NJDOT has published New Jersey-specific trip generation rates for some land uses — check the NJDOT Traffic Engineering section library before defaulting to ITE.",
    softwareNote: "Synchro/SimTraffic and HCS standard. NJDOT may require CORSIM or VISSIM for complex interchange analyses on state routes.",
    peStatuteRef: "N.J.S.A. 45:8-27 et seq. (Engineering Practice Act); N.J.A.C. 13:40",
    peStatuteName: "New Jersey Engineering Practice Act",
    specialRequirements: [
      "NJDOT Highway Access Permit (Form HC-4) required before any new access to a state highway.",
      "RSIS (N.J.A.C. 5:21) applies site-specific parking and circulation standards for residential uses that may override ITE parking rates.",
      "NJ Transit coordination required for projects near rail stations or bus terminals.",
    ],
  },

  NM: {
    stateCode: "NM",
    stateName: "New Mexico",
    agency: "New Mexico Department of Transportation",
    agencyAbbrev: "NMDOT",
    processName: "Traffic Impact Study (TIS)",
    primaryDoc: "NMDOT Access Management Manual; NMDOT Road Design Manual",
    losUrban: "D",
    losRural: "C",
    tripThresholdNote: "[INFERRED] ≥100 peak-hour trips on a state highway triggers NMDOT review. Confirm with NMDOT District Engineer.",
    horizons: "Existing + opening year + 20-year design horizon per NMDOT Road Design Manual.",
    growthRateNote: "NMDOT traffic count data; MRCOG (Albuquerque metro) travel demand model for Albuquerque projects.",
    methodologyMeetingRequired: false,
    tripGenSource: "ITE Trip Generation Manual, 11th Edition.",
    peStatuteRef: "NMSA § 61-23-1 et seq. (Engineering Practice Act); NMAC 16.38",
    peStatuteName: "New Mexico Engineering Practice Act",
  },

  NC: {
    stateCode: "NC",
    stateName: "North Carolina",
    agency: "North Carolina Department of Transportation",
    agencyAbbrev: "NCDOT",
    processName: "Traffic Impact Analysis (TIA)",
    primaryDoc: "NCDOT Traffic Impact Analysis Unit Guidelines (current edition); NCDOT Statewide TIA Program Policy",
    losUrban: "D",
    losRural: "C",
    losNote: "LOS D standard in urbanized areas; LOS C in rural areas. LOS E acceptable on constrained segments with NCDOT approval. NCDOT Statewide TIA Program is one of the most comprehensive in the US — it reviews TIAs not only for state highway access but also for local-road impacts connecting to state-maintained streets.",
    tripThresholdNote: "≥100 peak-hour trips on a state-maintained road (or a site proposing access to a state-maintained road) triggers the NCDOT Statewide TIA Program review. Unusually, NCDOT reviews TIAs for local road access when those roads connect to the state system.",
    horizons: "Existing + opening year + 5-year design horizon per NCDOT TIA Guidelines. Long-range horizon (10–20 years) required for major developments.",
    growthRateNote: "NCDOT traffic count data (Traffic Survey Group AADT database); applicable MPO model (CAMPO — Triangle; CRTPO — Charlotte; Greensboro; Wilmington) for urban projects.",
    methodologyMeetingRequired: true,
    methodologyMeetingNote: "NCDOT TIA Program requires a Traffic Impact Analysis Study Agreement (TIASA) signed by the developer before data collection. The TIA scope is established in writing at the outset. NCDOT charges a review fee.",
    tripGenSource: "ITE Trip Generation Manual, 11th Edition. NCDOT may accept local NC-specific trip data for specific land uses (e.g., Chick-fil-A, Duke University medical) from prior approved studies.",
    peStatuteRef: "N.C. Gen. Stat. § 89C-1 et seq. (Engineering Practice Act); 21 NCAC 56",
    peStatuteName: "North Carolina Engineering Practice Act",
    specialRequirements: [
      "NCDOT Statewide TIA Program applies an Agreement (TIASA) that legally binds the developer to implement NCDOT-required improvements.",
      "NCDOT conducts independent review of TIA and may override applicant conclusions — TIA is a bilateral process.",
      "Encroachment Agreement (NCDOT) required for any work in state highway right-of-way.",
    ],
  },

  ND: {
    stateCode: "ND",
    stateName: "North Dakota",
    agency: "North Dakota Department of Transportation",
    agencyAbbrev: "NDDOT",
    processName: "Traffic Impact Study (TIS)",
    primaryDoc: "NDDOT Road Design Manual; NDDOT Access Management Standards",
    losUrban: "D",
    losRural: "C",
    tripThresholdNote: "[INFERRED] ≥50 peak-hour trips on a state highway triggers NDDOT review. North Dakota's rapid Bakken oil-field development has produced project-specific TIS requirements for industrial/energy generators — confirm with NDDOT District Engineer.",
    horizons: "Existing + opening year + 20-year design horizon.",
    growthRateNote: "NDDOT traffic count data; energy-sector projects must account for temporary construction-phase truck traffic volume (often exceeds long-term peak).",
    methodologyMeetingRequired: false,
    tripGenSource: "ITE Trip Generation Manual, 11th Edition. Heavy-truck land uses (grain elevator, oilfield service) require project-specific trip rates.",
    peStatuteRef: "N.D. Cent. Code § 43-19.1-01 et seq. (Engineering Practice Act)",
    peStatuteName: "North Dakota Engineering Practice Act",
  },

  OH: {
    stateCode: "OH",
    stateName: "Ohio",
    agency: "Ohio Department of Transportation",
    agencyAbbrev: "ODOT",
    processName: "Traffic Impact Study (TIS)",
    primaryDoc: "ODOT Location and Design Manual Volume 1; ODOT Traffic Impact Study Guidelines",
    losUrban: "D",
    losRural: "C",
    tripThresholdNote: "≥100 peak-hour trips on a state highway triggers ODOT review and TIS. Local jurisdictions (Columbus, Cleveland, Cincinnati) have their own thresholds.",
    horizons: "Existing + opening year + 20-year design horizon per ODOT Location and Design Manual.",
    growthRateNote: "ODOT traffic count data (statewide count program); applicable MPO model (MORPC — Columbus; NOACA — Cleveland; OKI — Cincinnati; TMACOG — Toledo).",
    methodologyMeetingRequired: false,
    methodologyMeetingNote: "Coordinate with ODOT District Traffic Engineer for state-highway access. Ohio Facilities Construction Commission (OFCC) requirements may apply for public projects.",
    tripGenSource: "ITE Trip Generation Manual, 11th Edition.",
    peStatuteRef: "Ohio Rev. Code § 4733.01 et seq. (Engineering Practice Act); OAC § 4733",
    peStatuteName: "Ohio Engineering Practice Act",
    specialRequirements: [
      "ODOT Driveway Permit required for any access to a state highway.",
      "Ohio Manual of Uniform Traffic Control Devices (OMUTCD) applies within the state.",
    ],
  },

  OK: {
    stateCode: "OK",
    stateName: "Oklahoma",
    agency: "Oklahoma Department of Transportation",
    agencyAbbrev: "ODOT",
    processName: "Traffic Impact Study (TIS)",
    primaryDoc: "ODOT Design Manual; ODOT Access Management Guidelines",
    losUrban: "D",
    losRural: "C",
    tripThresholdNote: "[INFERRED] ≥100 peak-hour trips on a state highway triggers ODOT review. Confirm with ODOT District Engineer.",
    horizons: "Existing + opening year + 20-year design horizon.",
    growthRateNote: "ODOT traffic count data; ACOG (Oklahoma City metro) or INCOG (Tulsa metro) travel demand models.",
    methodologyMeetingRequired: false,
    tripGenSource: "ITE Trip Generation Manual, 11th Edition.",
    peStatuteRef: "59 O.S. § 475.1 et seq. (Engineering Practice Act); OAC 245:15",
    peStatuteName: "Oklahoma Engineering Practice Act",
  },

  OR: {
    stateCode: "OR",
    stateName: "Oregon",
    agency: "Oregon Department of Transportation",
    agencyAbbrev: "ODOT",
    processName: "Transportation Impact Analysis (TIA)",
    primaryDoc: "ODOT Transportation Impact Analysis Guidelines; Oregon Administrative Rules Chapter 734-051 (Highway Approaches and Access Control); Oregon Transportation Planning Rule (OAR 660-012)",
    primaryDocYear: "2024",
    losUrban: "E",
    losRural: "C",
    losNote: "Oregon Mobility Standards (OAR 734-051-0120) set mobility targets by highway classification and urbanized/rural status. Urban area targets range from LOS D to LOS E (and v/c 0.90 to 0.99) on some urban segments — Oregon explicitly allows LOS E on urban state highways. Rural: LOS C (v/c ≤ 0.80). Confirm the applicable mobility standard from the Oregon Highway Plan (OHP) map.",
    tripThresholdNote: "≥25 peak-hour trips on a state highway triggers an ODOT Approach Road Permit (730-030) and TIA per OAR 734-051. Oregon Transportation Planning Rule (OAR 660-012-0045) additionally requires 'significant effects' analysis for plan amendments.",
    horizons: "Existing + opening year + 20-year design horizon per Oregon Highway Design Manual. Approach road permits require a minimum 20-year analysis.",
    growthRateNote: "ODOT traffic count data (statewide ATR and short-count network); applicable MPO model (Metro — Portland; RVMPO — Medford; LCOG — Eugene; ODOT Statewide Transportation Improvement Program for rural corridors).",
    methodologyMeetingRequired: true,
    methodologyMeetingNote: "ODOT requires a pre-application conference for Approach Road Permits under OAR 734-051-0045. OAR 660-012-0045 TPR analyses require coordination with DLCD (Department of Land Conservation and Development).",
    tripGenSource: "ITE Trip Generation Manual, 11th Edition.",
    softwareNote: "Synchro/SimTraffic and HCS standard. ODOT Region 1 (Portland) may require VISSIM for complex analyses.",
    peStatuteRef: "ORS Chapter 672 (Engineering Practice Act); OAR 820-010",
    peStatuteName: "Oregon Engineering Practice Act",
    specialRequirements: [
      "Approach Road Permit (ODOT Form 730-030) required for any access to a state highway.",
      "Oregon Transportation Planning Rule (OAR 660-012-0045) applies to comprehensive plan amendments — requires 'no significant effects' on state highways or a plan/project that mitigates identified deficiencies.",
      "Oregon Highway Design Manual Chapter 13 governs intersection sight distance, driveway geometry, and access design.",
      "VMT analysis is NOT formally required under OAR 660-012 for individual development proposals (unlike California), but greenhouse gas reduction plans may incorporate VMT targets.",
    ],
  },

  PA: {
    stateCode: "PA",
    stateName: "Pennsylvania",
    agency: "Pennsylvania Department of Transportation",
    agencyAbbrev: "PennDOT",
    processName: "Traffic Impact Study (TIS)",
    primaryDoc: "PennDOT Publication 282 — Guidelines for the Development and Review of Traffic Impact Studies (current edition); PennDOT Publication 46 — Traffic Engineering Manual",
    primaryDocYear: "2019",
    losUrban: "D",
    losRural: "C",
    losNote: "LOS D in urbanized areas; LOS C in rural areas per PennDOT Pub 282. Pennsylvania has one of the most detailed published TIS guidance documents in the US (Pub 282) — follow it closely.",
    tripThresholdNote: "PennDOT Pub 282 defines three categories: Category 1 (≥100 PHT) requires full TIS; Category 2 (50–99 PHT) requires abbreviated TIS; Category 3 (<50 PHT) exempt from TIS but may require an operational analysis. Highway Occupancy Permit (HOP) required for any access to a state highway.",
    horizons: "Existing + opening year + 10-year design horizon per PennDOT Pub 282. A secondary 20-year horizon may be required for principal arterials.",
    growthRateNote: "PennDOT traffic count data (PENNDOT Count Data — online count station database); DVRPC (Philadelphia metro), SPC (Pittsburgh metro), LVPC (Lehigh Valley), or applicable MPO travel demand model.",
    methodologyMeetingRequired: true,
    methodologyMeetingNote: "PennDOT Pub 282 requires a scoping meeting with the PennDOT District Traffic Unit before data collection. A written scope confirmation must be received before commencing counts.",
    tripGenSource: "ITE Trip Generation Manual, 11th Edition. PennDOT Pub 282 explicitly references ITE.",
    softwareNote: "Synchro/SimTraffic and HCS standard per PennDOT Pub 282. PennDOT District 6 (Philadelphia) may require VISSIM for signalized corridor studies.",
    peStatuteRef: "63 Pa. C.S. § 21 et seq. (Engineering Practice Act); 49 Pa. Code Ch. 37",
    peStatuteName: "Pennsylvania Engineering Practice Act",
    specialRequirements: [
      "Highway Occupancy Permit (HOP) — PennDOT Form M-945A — required for any access to a state highway.",
      "PennDOT Pub 282 specifies mandatory report format, contents checklist, and LOS analysis procedures — follow the Pub 282 outline for PennDOT submittals.",
      "Sight-distance analysis per PennDOT Pub 70 (Engineering and Traffic Studies) or AASHTO Green Book required at all driveways.",
    ],
  },

  RI: {
    stateCode: "RI",
    stateName: "Rhode Island",
    agency: "Rhode Island Department of Transportation",
    agencyAbbrev: "RIDOT",
    processName: "Traffic Impact Study (TIS)",
    primaryDoc: "RIDOT Traffic Impact Study Guidelines; RIDOT Highway Design Manual",
    losUrban: "D",
    losRural: "D",
    losNote: "[INFERRED] LOS D statewide — Rhode Island is fully urbanized / suburban with no rural highway network. Confirm with RIDOT Planning staff.",
    tripThresholdNote: "[INFERRED] ≥50 peak-hour trips on a state highway triggers RIDOT review. Rhode Island has a small geographic area — RIDOT reviews most significant developments statewide.",
    horizons: "Existing + opening year + 10-year design horizon.",
    growthRateNote: "RIDOT traffic count data; STPP (State Transportation Planning Program) / RIPTA travel demand model for Providence metro.",
    methodologyMeetingRequired: false,
    tripGenSource: "ITE Trip Generation Manual, 11th Edition.",
    peStatuteRef: "R.I. Gen. Laws § 5-8-1 et seq. (Engineering Practice Act)",
    peStatuteName: "Rhode Island Engineering Practice Act",
  },

  SC: {
    stateCode: "SC",
    stateName: "South Carolina",
    agency: "South Carolina Department of Transportation",
    agencyAbbrev: "SCDOT",
    processName: "Traffic Impact Study (TIS)",
    primaryDoc: "SCDOT Traffic Impact Study Guidelines; SCDOT Access and Roadside Management Standards",
    losUrban: "D",
    losRural: "C",
    tripThresholdNote: "≥100 peak-hour trips on a state-maintained road triggers SCDOT TIS review. Note: unlike most states, SCDOT maintains a large proportion of secondary roads; confirm whether the access road is SCDOT-maintained.",
    horizons: "Existing + opening year + 5-year design horizon. SCDOT may require 20-year for principal arterials.",
    growthRateNote: "SCDOT traffic count data; CHATS (Charleston metro), COATS (Columbia metro), or Greenville-Spartanburg MPO travel demand models.",
    methodologyMeetingRequired: false,
    methodologyMeetingNote: "Coordinate with SCDOT District Traffic Engineer for state-highway access permits.",
    tripGenSource: "ITE Trip Generation Manual, 11th Edition.",
    peStatuteRef: "S.C. Code Ann. § 40-22-10 et seq. (Engineering Practice Act); 49 S.C. Code Ann. Regs. 49-",
    peStatuteName: "South Carolina Engineering Practice Act",
    specialRequirements: [
      "SCDOT Encroachment Permit required for any work in state highway ROW.",
    ],
  },

  SD: {
    stateCode: "SD",
    stateName: "South Dakota",
    agency: "South Dakota Department of Transportation",
    agencyAbbrev: "SDDOT",
    processName: "Traffic Impact Study (TIS)",
    primaryDoc: "SDDOT Road Design Manual; SDDOT Access Management Standards",
    losUrban: "D",
    losRural: "C",
    tripThresholdNote: "[INFERRED] ≥100 peak-hour trips on a state highway triggers SDDOT review. Confirm with SDDOT District Engineer.",
    horizons: "Existing + opening year + 20-year design horizon.",
    growthRateNote: "SDDOT traffic count data; applicable MPO (SECOG — Sioux Falls; BHRTS — Rapid City) travel demand model.",
    methodologyMeetingRequired: false,
    tripGenSource: "ITE Trip Generation Manual, 11th Edition.",
    peStatuteRef: "S.D. Codified Laws § 36-18A-1 et seq. (Engineering Practice Act)",
    peStatuteName: "South Dakota Engineering Practice Act",
  },

  TN: {
    stateCode: "TN",
    stateName: "Tennessee",
    agency: "Tennessee Department of Transportation",
    agencyAbbrev: "TDOT",
    processName: "Traffic Impact Study (TIS)",
    primaryDoc: "TDOT Traffic Impact Study Guidelines (current edition); TDOT Design Division Policy and Procedures",
    losUrban: "D",
    losRural: "C",
    tripThresholdNote: "≥100 peak-hour trips on a state highway triggers TDOT review. TDOT has published formal TIS Guidelines — use those guidelines for scope and format.",
    horizons: "Existing + opening year + 5-year design horizon per TDOT guidelines. Some TDOT regions require 20-year.",
    growthRateNote: "TDOT traffic count data; MPO travel demand models (NERPC — Nashville; Memphis MPO; Knoxville Transportation Planning Organization).",
    methodologyMeetingRequired: false,
    methodologyMeetingNote: "Pre-application coordination with TDOT Regional Traffic Engineer recommended.",
    tripGenSource: "ITE Trip Generation Manual, 11th Edition.",
    peStatuteRef: "Tenn. Code Ann. § 62-2-101 et seq. (Engineering Practice Act); Tenn. Comp. R. & Regs. 0120-02",
    peStatuteName: "Tennessee Engineering Practice Act",
    specialRequirements: [
      "TDOT Encroachment Permit (PE-4) required for work in state highway ROW.",
    ],
  },

  UT: {
    stateCode: "UT",
    stateName: "Utah",
    agency: "Utah Department of Transportation",
    agencyAbbrev: "UDOT",
    processName: "Traffic Impact Study (TIS)",
    primaryDoc: "UDOT Traffic Impact Study Guidelines; Utah Administrative Code R930-6 (Access Management Rules)",
    losUrban: "D",
    losRural: "C",
    losNote: "[INFERRED] LOS D in urbanized areas (Wasatch Front); LOS C in rural areas per UDOT standard. Wasatch Front Regional Council and Dixie MPO may have supplemental requirements.",
    tripThresholdNote: "≥100 peak-hour trips on a state highway triggers UDOT review per Utah Admin. Code R930-6. Local jurisdictions (Salt Lake City, Sandy, Provo) have independent thresholds.",
    horizons: "Existing + opening year + 20-year design horizon per UDOT guidelines.",
    growthRateNote: "UDOT traffic count data (statewide ATR network); Wasatch Front Regional Council (WFRC) travel demand model for Salt Lake/Davis/Weber/Tooele Counties; Dixie MPO model for St. George area.",
    methodologyMeetingRequired: true,
    methodologyMeetingNote: "UDOT Access Permit requires a pre-application meeting with the UDOT Region Traffic Engineer under R930-6. Scope and methodology must be agreed before data collection.",
    tripGenSource: "ITE Trip Generation Manual, 11th Edition.",
    peStatuteRef: "Utah Code § 58-22-101 et seq. (Engineering Practice Act); Utah Admin. Code R156-22",
    peStatuteName: "Utah Engineering Practice Act",
    specialRequirements: [
      "UDOT Access Connection Permit (Form TC-107) required for any access to a state highway under R930-6.",
    ],
  },

  VT: {
    stateCode: "VT",
    stateName: "Vermont",
    agency: "Vermont Agency of Transportation",
    agencyAbbrev: "VTrans",
    processName: "Traffic Impact Study (TIS)",
    primaryDoc: "VTrans Traffic Impact Assessment Guidelines; Vermont Act 250 Transportation Element Guidelines",
    losUrban: "D",
    losRural: "C",
    tripThresholdNote: "[INFERRED] ≥50 peak-hour trips on a state highway triggers VTrans review. Vermont Act 250 (10 V.S.A. § 6086(a)(5)) independently requires 'no undue adverse effect on the use of the adjacent public transportation facilities' — developments subject to Act 250 must conduct a TIS.",
    horizons: "Existing + opening year + 10-year design horizon. Act 250 analyses may require longer-range assessment.",
    growthRateNote: "VTrans traffic count data; CCRPC (Chittenden County — Burlington metro) or applicable Regional Planning Commission travel demand data.",
    methodologyMeetingRequired: false,
    tripGenSource: "ITE Trip Generation Manual, 11th Edition.",
    peStatuteRef: "26 V.S.A. § 1101 et seq. (Engineering Practice Act)",
    peStatuteName: "Vermont Engineering Practice Act",
    specialRequirements: [
      "Permit required under 19 V.S.A. § 1111 for any encroachment on a state highway.",
      "Vermont Act 250 application transportation criterion requires a TIS for projects exceeding Act 250 thresholds.",
    ],
  },

  VA: {
    stateCode: "VA",
    stateName: "Virginia",
    agency: "Virginia Department of Transportation",
    agencyAbbrev: "VDOT",
    processName: "Transportation Impact Analysis (TIA)",
    primaryDoc: "VDOT Transportation Impact Analysis Regulations (24VAC30-155); VDOT TIA Preapplication Manual",
    primaryDocYear: "2014",
    losUrban: "D",
    losRural: "C",
    losNote: "Virginia has one of the most formally regulated TIA processes in the US. 24VAC30-155 is an actual regulation (not guidance) — LOS D in urbanized areas, LOS C in rural areas. Constrained facilities may be designated at E with Board approval.",
    tripThresholdNote: "24VAC30-155: TIA required when a development generates ≥100 PHT on state-maintained roads, OR generates ≥50 PHT on roads that are currently at LOS E/F. Also triggered by any rezoning or comp plan amendment that increases allowable development density.",
    horizons: "Existing + opening year + 5-year design horizon per 24VAC30-155. Multi-phase: each phase opening year + long-range.",
    growthRateNote: "VDOT Traffic Engineering Division historical AADT (VDOT Traffic Count Database); applicable MPO model (TPB — Northern Virginia; HRTPO — Hampton Roads; RRTPO — Richmond; Metropolitan Planning District Commission — Roanoke).",
    methodologyMeetingRequired: true,
    methodologyMeetingNote: "24VAC30-155 requires a mandatory pre-application meeting with VDOT District Planning Engineer before any TIA data collection. The scope, study area, analysis methodology, and horizon years must all be agreed in writing (TIA Scope Agreement) before field work begins.",
    tripGenSource: "ITE Trip Generation Manual, 11th Edition. VDOT may accept local Virginia-specific data from prior approved studies for specific land uses.",
    softwareNote: "Synchro/SimTraffic and HCS standard per VDOT Road Design Manual. VISSIM required for some VDOT District 9 (NOVA) interchange studies.",
    peStatuteRef: "Code of Virginia § 54.1-400 et seq. (Engineering Practice Act); 18VAC10-20",
    peStatuteName: "Virginia Engineering Practice Act",
    specialRequirements: [
      "24VAC30-155 is a STATE REGULATION — failure to follow its mandatory procedures results in permit denial, not just a comment.",
      "Land Use Permit (LUP) required for any access to a VDOT-maintained road (Code of Virginia § 33.2-240).",
      "Proffer system: in Virginia, rezonings are accompanied by voluntary proffers that may bind the developer to specific improvements identified in the TIA.",
      "Site-distance analysis per VDOT Road Design Manual standards required at all driveway intersections.",
    ],
  },

  WA: {
    stateCode: "WA",
    stateName: "Washington",
    agency: "Washington State Department of Transportation",
    agencyAbbrev: "WSDOT",
    processName: "Traffic Impact Analysis (TIA)",
    primaryDoc: "WSDOT Development Services Manual; WSDOT Highway Access Management Act (RCW 47.50); WSDOT Design Manual M 22-01",
    losUrban: "D",
    losRural: "C",
    losNote: "LOS D on state routes in urbanized areas per WSDOT. Growth Management Act (GMA, RCW 36.70A) requires local governments to adopt level-of-service standards (concurrency) for transportation facilities — check the applicable city/county concurrency standards, which may differ from WSDOT's state route standards.",
    tripThresholdNote: "≥20 peak-hour trips on a state highway triggers a WSDOT Access Permit and TIA scope review. Local jurisdictions (Seattle, Bellevue, Redmond, Tacoma) each have adopted concurrency management systems under GMA with independent trip thresholds.",
    horizons: "Existing + opening year + 20-year design horizon per WSDOT Development Services Manual. Some GMA jurisdictions require horizon-year consistent with their adopted Transportation Element (often 20 years).",
    growthRateNote: "WSDOT traffic count data (statewide ATR network); PSRC (Puget Sound Regional Council) travel demand model for Central Puget Sound; BFCOG (Tri-Cities), SCog (Spokane), and applicable regional transportation plans for eastern Washington.",
    methodologyMeetingRequired: true,
    methodologyMeetingNote: "WSDOT Development Services requires a pre-application meeting with the WSDOT Region Development Services staff before data collection. Local GMA jurisdictions may have additional concurrency scoping requirements.",
    tripGenSource: "ITE Trip Generation Manual, 11th Edition. Seattle has published Seattle-specific trip generation data for some downtown land uses — confirm with SDOT for Seattle projects.",
    softwareNote: "Synchro/SimTraffic and HCS standard. WSDOT Region 1 (Puget Sound) may require VISSIM for complex interchange analyses.",
    peStatuteRef: "RCW 18.43.010 et seq. (Engineering Practice Act); WAC 196-26",
    peStatuteName: "Washington Engineering Practice Act",
    specialRequirements: [
      "State Highway Access Permit required under RCW 47.50 for any new access to a state highway.",
      "GMA Concurrency: development cannot be approved unless the LOS standard is met or funding for improvements is committed within 6 years (RCW 36.70A.070(6)).",
      "SEPA (State Environmental Policy Act, RCW 43.21C) review may require a Transportation chapter in the EIS for larger developments.",
    ],
  },

  WV: {
    stateCode: "WV",
    stateName: "West Virginia",
    agency: "West Virginia Division of Highways",
    agencyAbbrev: "WVDOH",
    processName: "Traffic Impact Study (TIS)",
    primaryDoc: "WVDOH Design Manual; WVDOH Traffic Impact Study Guidelines",
    losUrban: "D",
    losRural: "C",
    tripThresholdNote: "[INFERRED] ≥100 peak-hour trips on a state highway triggers WVDOH review. Confirm with WVDOH District Engineer.",
    horizons: "Existing + opening year + 20-year design horizon.",
    growthRateNote: "WVDOH traffic count data; applicable MPO (Huntington WV-KY-OH; Morgantown) travel demand model.",
    methodologyMeetingRequired: false,
    tripGenSource: "ITE Trip Generation Manual, 11th Edition.",
    peStatuteRef: "W. Va. Code § 30-13-1 et seq. (Engineering Practice Act)",
    peStatuteName: "West Virginia Engineering Practice Act",
  },

  WI: {
    stateCode: "WI",
    stateName: "Wisconsin",
    agency: "Wisconsin Department of Transportation",
    agencyAbbrev: "WisDOT",
    processName: "Traffic Impact Analysis (TIA)",
    primaryDoc: "WisDOT Traffic Impact Analysis Guidelines (2016); WisDOT Access Management Guidelines",
    losUrban: "D",
    losRural: "C",
    tripThresholdNote: "≥100 peak-hour trips on a state highway triggers WisDOT review. WisDOT 2016 Guidelines establish a three-tier system: Tier 1 (≥100 PHT), Tier 2 (100–500 PHT), Tier 3 (≥500 PHT with regional significance).",
    horizons: "Existing + opening year + 10-year design horizon per WisDOT TIA Guidelines. 20-year for Tier 3 (regional-significance) projects.",
    growthRateNote: "WisDOT traffic count data (statewide ATR network); applicable MPO model (SEWRPC — Milwaukee metro; Dane County MPO — Madison; Green Bay MPO).",
    methodologyMeetingRequired: false,
    methodologyMeetingNote: "Coordinate with WisDOT Region Transportation Planning staff for state-highway access.",
    tripGenSource: "ITE Trip Generation Manual, 11th Edition.",
    peStatuteRef: "Wis. Stat. § 443.01 et seq. (Engineering Practice Act); Wis. Admin. Code A-E 3",
    peStatuteName: "Wisconsin Engineering Practice Act",
    specialRequirements: [
      "Driveway/Access Permit (WisDOT Form DS-85) required for access to a state highway.",
    ],
  },

  WY: {
    stateCode: "WY",
    stateName: "Wyoming",
    agency: "Wyoming Department of Transportation",
    agencyAbbrev: "WYDOT",
    processName: "Traffic Impact Study (TIS)",
    primaryDoc: "WYDOT Road Design Manual; WYDOT Access Management Guidelines",
    losUrban: "D",
    losRural: "C",
    tripThresholdNote: "[INFERRED] ≥100 peak-hour trips on a state highway triggers WYDOT review. Wyoming's low-density environment means most TIS work occurs around Cheyenne, Casper, and energy-sector facility access.",
    horizons: "Existing + opening year + 20-year design horizon.",
    growthRateNote: "WYDOT traffic count data; energy-sector projects (oil/gas, coal) must account for construction-phase heavy-truck volumes that may far exceed long-term operational traffic.",
    methodologyMeetingRequired: false,
    tripGenSource: "ITE Trip Generation Manual, 11th Edition. Energy/extraction land uses require project-specific trip rates.",
    peStatuteRef: "Wyo. Stat. § 33-29-101 et seq. (Engineering Practice Act)",
    peStatuteName: "Wyoming Engineering Practice Act",
  },

  DC: {
    stateCode: "DC",
    stateName: "District of Columbia",
    agency: "District of Columbia Department of Transportation",
    agencyAbbrev: "DDOT",
    processName: "Transportation Impact Study (TIS)",
    primaryDoc: "DDOT Transportation Impact Study Guidelines; DDOT Public Space Regulations (24 DCMR)",
    losUrban: "E",
    losRural: "E",
    losNote: "DC uses LOS E as the acceptable threshold for most corridors — the District is dense, congested, and multi-modal. LOS F triggers mitigation. Bicycle, pedestrian, and transit impact analysis is required in addition to vehicular LOS per DDOT guidelines.",
    tripThresholdNote: "≥50 new peak-hour trips triggers a Transportation Study requirement per DDOT guidelines. DC's Office of Planning (OP) reviews Planned Unit Developments (PUDs) with independent transportation review requirements.",
    horizons: "Existing + opening year + 10-year design horizon per DDOT guidelines.",
    growthRateNote: "DDOT traffic count data; MWCOG (Metropolitan Washington Council of Governments) Travel Demand Model for the Washington metro area.",
    methodologyMeetingRequired: true,
    methodologyMeetingNote: "DDOT requires a pre-application meeting with DDOT Transportation Planning staff before data collection. For PUDs, the Office of Planning coordinates a separate transportation scoping meeting.",
    tripGenSource: "ITE Trip Generation Manual, 11th Edition. DDOT may require DC-specific mode-share adjustments reflecting high transit use; consult WMATA ridership data and MWCOG model for trip-by-mode estimates.",
    softwareNote: "Synchro/SimTraffic and HCS standard. DDOT may require VISSIM for complex multi-modal intersection analyses.",
    peStatuteRef: "D.C. Code § 47-2853.131 et seq. (Engineering Practice); 17 DCMR § 5400",
    peStatuteName: "DC Engineering Practice Act",
    specialRequirements: [
      "Public Space Permit (24 DCMR) required for any work in DDOT ROW.",
      "Bicycle parking and pedestrian improvements are required components of all DC TIS submittals per DDOT guidelines.",
      "WMATA Joint Development Guidelines may apply for sites adjacent to Metro stations.",
      "Performance Parking and Demand Management Plan may be required for developments over certain size thresholds.",
    ],
  },
};

// ---------- Helper type imports (inline — avoids circular deps) ----------

const PAGE_MARGIN = 50;
const BRAND_BLUE = "#2563eb";
const TEXT_GRAY = "#6b7280";

// ---------- Renderer ----------

/**
 * Generic multi-state TIS renderer. Produces a full TIS document using the
 * canonical section structure validated against the HCA FL Westside Hospital
 * TIS (Broward County, 2025). All state-specific language (agency citations,
 * LOS standards, PE-seal statutes) is drawn from StateTisConfig.
 *
 * Falls back to [INFERRED] notation where no formal published guideline was
 * located — prompting the reviewer to confirm at the methodology meeting.
 */
function renderTisState(
  doc: PDFKit.PDFDocument,
  r: any,
  project: { projectName: string; siteLat?: string | null; siteLon?: string | null },
  region: Region,
): void {
  const cfg = CONFIGS[region.stateCode ?? ""] ?? fallbackConfig(region);
  const tg = r.tripGeneration ?? {};
  const req = r.request ?? {};
  const intersections: any[] = Array.isArray(r.affectedIntersections) ? r.affectedIntersections : [];
  const periods: any[] = Array.isArray(r.periodReports) ? r.periodReports : [];

  const losDrops = Number(r.intersectionsWithLosDrop ?? 0);
  const losEf = Number(r.intersectionsAtLosEf ?? 0);

  const fmt = (n: any, d = 0) => {
    if (n == null || Number.isNaN(Number(n))) return "—";
    return d > 0 ? Number(n).toFixed(d) : Math.round(Number(n)).toLocaleString();
  };

  const stateSection = (title: string) => {
    doc.x = PAGE_MARGIN;
    doc.font("bold").fontSize(13).fillColor("black").text(title);
    doc.moveDown(0.3);
    doc.x = PAGE_MARGIN;
  };

  const stateSub = (title: string) => {
    doc.x = PAGE_MARGIN;
    doc.font("bold").fontSize(11).fillColor(BRAND_BLUE).text(title);
    doc.moveDown(0.2);
    doc.x = PAGE_MARGIN;
  };

  const body = (text: string, opts: Record<string, unknown> = {}) => {
    doc.font("body").fontSize(10).fillColor("black").text(text, { paragraphGap: 5, ...opts });
    doc.x = PAGE_MARGIN;
  };

  const note = (text: string) => {
    doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(text, { paragraphGap: 4 });
    doc.x = PAGE_MARGIN;
    doc.fillColor("black");
  };

  const kv = (pairs: [string, string | undefined][]) => {
    const labelW = 220;
    const valueW = doc.page.width - PAGE_MARGIN - labelW - PAGE_MARGIN - 10;
    for (const [label, value] of pairs) {
      const y = doc.y;
      doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(label, PAGE_MARGIN, y, { width: labelW });
      doc.font("body").fontSize(10).fillColor("black").text(value ?? "—", PAGE_MARGIN + labelW + 10, y, { width: valueW });
      doc.moveDown(0.05);
    }
    doc.x = PAGE_MARGIN;
  };

  const tbl = (headers: string[], widths: number[], aligns: string[], dataRows: string[][]) => {
    const rowH = 16, headerH = 18, startX = PAGE_MARGIN;
    const drawRow = (cells: string[], y: number, isHeader: boolean) => {
      let x = startX;
      if (isHeader) doc.rect(startX, y, widths.reduce((s, w) => s + w, 0), headerH).fill("#f3f4f6");
      for (let i = 0; i < cells.length; i++) {
        doc.font(isHeader ? "bold" : "body").fontSize(9).fillColor("black")
          .text(cells[i] ?? "", x + 4, y + (isHeader ? 5 : 3), { width: (widths[i] ?? 60) - 8, align: (aligns[i] as any) ?? "left", lineBreak: false, ellipsis: true });
        x += widths[i] ?? 60;
      }
    };
    let y = doc.y;
    drawRow(headers, y, true); y += headerH;
    for (const row of dataRows) {
      if (y + rowH > doc.page.height - PAGE_MARGIN - 40) { doc.addPage(); y = doc.y; drawRow(headers, y, true); y += headerH; }
      drawRow(row, y, false);
      doc.strokeColor("#e5e7eb").lineWidth(0.5).moveTo(startX, y + rowH).lineTo(startX + widths.reduce((s, w) => s + w, 0), y + rowH).stroke();
      y += rowH;
    }
    doc.y = y + 4; doc.x = PAGE_MARGIN;
  };

  const strip = (metrics: { label: string; value: string }[]) => {
    const usableW = doc.page.width - PAGE_MARGIN * 2;
    const cellW = usableW / metrics.length;
    const y = doc.y, h = 50;
    for (let i = 0; i < metrics.length; i++) {
      const x = PAGE_MARGIN + i * cellW;
      doc.rect(x, y, cellW, h).fillAndStroke("#f9fafb", "#e5e7eb");
      doc.font("bold").fontSize(20).fillColor(BRAND_BLUE).text(metrics[i].value, x, y + 8, { width: cellW, align: "center" });
      doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(metrics[i].label.toUpperCase(), x, y + 32, { width: cellW, align: "center", characterSpacing: 1 });
    }
    doc.fillColor("black"); doc.x = PAGE_MARGIN; doc.y = y + h + 4;
  };

  // ─── §1 EXECUTIVE SUMMARY ───────────────────────────────────────────────
  stateSection("1.0 EXECUTIVE SUMMARY");

  const execSummary = `This ${cfg.processName} evaluates the transportation impacts of the proposed ${project.projectName || "development"} located within ${region.displayName}, ${cfg.stateName}. Analysis follows ${cfg.primaryDoc}${cfg.primaryDocYear ? ` (${cfg.primaryDocYear})` : ""} and applicable ${cfg.agencyAbbrev} standards. The study area encompasses ${intersections.length} intersection${intersections.length === 1 ? "" : "s"} within a ${fmt(r.studyRadiusMi ?? req.studyRadiusMi, 2)}-mile radius from the site, analyzed for ITE Land Use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? "—"}) with a development size of ${tg.size ?? "—"} ${tg.unit ?? ""}.`;
  body(execSummary);

  body("Key Findings:", { paragraphGap: 2 });
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY);
  if (losDrops === 0 && losEf === 0) {
    doc.text(`• No study-area intersections are projected to drop a Level of Service grade under Build conditions.`, { paragraphGap: 2 });
    doc.text(`• The proposed development does not create unacceptable LOS deterioration under ${cfg.agencyAbbrev} standards (LOS ${cfg.losUrban} acceptable).`, { paragraphGap: 4 });
  } else {
    doc.text(`• ${losDrops} intersection${losDrops === 1 ? "" : "s"} project${losDrops === 1 ? "s" : ""} to drop one or more LOS grade${losDrops === 1 ? "" : "s"} under Build conditions.`, { paragraphGap: 2 });
    doc.text(`• ${losEf} intersection${losEf === 1 ? "" : "s"} operate${losEf === 1 ? "s" : ""} at LOS E or F under Build conditions — mitigation analysis is required per ${cfg.primaryDoc}.`, { paragraphGap: 4 });
  }
  doc.fillColor("black");
  doc.moveDown(0.5);

  strip([
    { label: "Intersections", value: String(r.intersectionsStudied ?? intersections.length ?? 0) },
    { label: "LOS Drops", value: String(losDrops) },
    { label: "At LOS E/F", value: String(losEf) },
    { label: "Worst Δ Delay", value: `${fmt(r.worstDelayDeltaSec, 1)}s` },
  ]);
  doc.moveDown(0.8);

  // ─── §2 PROJECT DESCRIPTION ─────────────────────────────────────────────
  stateSection("2.0 PROJECT DESCRIPTION");
  kv([
    ["Project name", project.projectName || "—"],
    ["Land use (ITE)", `${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
    ["Development size", tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"],
    ["Site coordinates", req.latitude && req.longitude ? `${Number(req.latitude).toFixed(4)}°N, ${Math.abs(Number(req.longitude)).toFixed(4)}°W` : "—"],
    ["Jurisdiction", region.displayName],
    ["State", cfg.stateName],
    ["State DOT", `${cfg.agency} (${cfg.agencyAbbrev})`],
    ["Opening year", String(req.openingYear ?? "—")],
    ["Study type", cfg.processName],
    ["Controlling document", cfg.primaryDoc],
  ]);
  doc.moveDown(0.3);
  note("Site plan, surrounding land use, and access configuration are dependent on the final site plan and are not auto-generated by this tool. Final submittal should incorporate a site plan figure per controlling guidelines.");
  doc.moveDown(0.6);

  // ─── §3 METHODOLOGY ─────────────────────────────────────────────────────
  stateSection("3.0 METHODOLOGY");

  stateSub("3.1 Governing Documents and Controlling Agency");
  body(`This study is prepared in conformance with ${cfg.primaryDoc}${cfg.primaryDocYear ? ` (${cfg.primaryDocYear})` : ""}. The reviewing agency is the ${cfg.agency} (${cfg.agencyAbbrev}).${cfg.agencyAbbrev === "VDOT" ? " Note: 24VAC30-155 is a Virginia State regulation, not guidance — mandatory procedural compliance is required." : ""}`);
  doc.moveDown(0.3);

  stateSub("3.2 Pre-Application Methodology Meeting");
  if (cfg.methodologyMeetingRequired) {
    body(`A pre-application methodology meeting with ${cfg.agencyAbbrev} is required before data collection.${cfg.methodologyMeetingNote ? ` ${cfg.methodologyMeetingNote}` : ""}`);
  } else {
    body(`Coordination with ${cfg.agencyAbbrev} before data collection is recommended.${cfg.methodologyMeetingNote ? ` ${cfg.methodologyMeetingNote}` : ""} Scope, study area, and methodology should be confirmed with the reviewing agency before submitting.`);
  }
  doc.moveDown(0.3);

  stateSub("3.3 Study Area and Analysis Periods");
  body(`Study area: all signalized and unsignalized intersections and roadway segments within ${fmt(r.studyRadiusMi ?? req.studyRadiusMi, 2)} miles of the site that receive ≥10% of project traffic. Primary analysis periods: weekday AM peak hour and weekday PM peak hour. Additional periods (Saturday peak, midday) are required only where special characteristics warrant, consistent with ${cfg.primaryDoc}.`);
  doc.moveDown(0.3);

  stateSub("3.4 Analysis Scenarios");
  body("Three scenarios evaluated at each study location:");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY);
  doc.text("• Scenario 1 — Existing Conditions: field-collected counts for current peak-hour volumes and geometric conditions.", { paragraphGap: 2 });
  doc.text(`• Scenario 2 — Future No-Build (${req.openingYear ?? "Opening Year"}): background growth applied at ${fmt(r.growthAppliedPct, 2)}%/yr compound over ${fmt(r.growthYears)} year${r.growthYears === 1 ? "" : "s"}, without project traffic.`, { paragraphGap: 2 });
  doc.text(`• Scenario 3 — Future Build (${req.openingYear ?? "Opening Year"}): No-Build volumes plus distributed project-generated trips.`, { paragraphGap: 4 });
  doc.fillColor("black").moveDown(0.3);

  stateSub("3.5 Trip Generation");
  body(`Trip generation is calculated using the ITE Trip Generation Manual, 11th Edition (${cfg.tripGenSource}), the current edition used in ${cfg.stateName} practice. The ITE rate or equation for Land Use Code ${tg.landUseCode ?? "—"} (${tg.landUseName ?? "—"}) is applied to a development size of ${tg.size ?? "—"} ${tg.unit ?? ""}. Pass-by credit of ${fmt(r.passByPctApplied ?? 0)}% and internal capture of ${fmt(r.internalCapturePctApplied ?? 0)}% are applied per ITE Handbook procedures and agreed in the methodology meeting.`);
  doc.moveDown(0.3);

  stateSub("3.6 Background Growth Rate");
  body(`Background traffic growth: ${fmt(r.growthAppliedPct, 2)}% per year (${cfg.growthRateNote}). Source: ${r.growthSource ?? `${cfg.agencyAbbrev} historical AADT count stations`}.`);
  doc.moveDown(0.3);

  stateSub("3.7 Level of Service Standards");
  body(`Acceptable LOS per ${cfg.primaryDoc}: LOS ${cfg.losUrban} in urbanized areas; LOS ${cfg.losRural} in rural areas.${cfg.losNote ? ` ${cfg.losNote}` : ""} LOS is evaluated using the Highway Capacity Manual (HCM), current edition, via HCS and/or Synchro.${cfg.softwareNote ? ` ${cfg.softwareNote}` : ""}`);
  doc.moveDown(0.8);

  // ─── §4 EXISTING CONDITIONS ─────────────────────────────────────────────
  stateSection("4.0 EXISTING CONDITIONS");

  stateSub("4.1 Roadway Network");
  body(`The existing roadway network within the study area was inventoried to document functional classification, number of travel lanes, posted speed limits, traffic control, and access management characteristics. Data sources: ${cfg.agencyAbbrev} functional classification maps, field observations, and ${r.growthSource ?? `${cfg.agencyAbbrev} AADT databases`}.`);
  doc.moveDown(0.3);

  stateSub("4.2 Traffic Volumes");
  body(`Traffic counts were collected during weekday AM (7–9 AM) and PM (4–6 PM) peak periods. Count data represents typical weekday conditions, adjusted to peak-season or peak-annual-day volumes per ${cfg.agencyAbbrev} count methodology. AADT base: ${fmt(r.baseAadt)} vehicles per day (${r.aadtYear ?? req.openingYear ?? "current year"}).`);
  kv([
    ["Base AADT", `${fmt(r.baseAadt)} vpd`],
    ["Growth rate applied", `${fmt(r.growthAppliedPct, 2)}%/yr`],
    ["Growth source", r.growthSource ?? `${cfg.agencyAbbrev} count stations`],
    ["Count collection period", r.countPeriod ?? "Weekday AM + PM peak (field-collected)"],
  ]);
  doc.moveDown(0.3);

  if (intersections.length) {
    stateSub("4.3 Existing Intersection Operations");
    const existLosRows = intersections.map((it: any) => [
      it.name ?? it.signalId ?? "—",
      it.control ?? "Signal",
      fmt(it.distanceMi, 2),
      it.currentLos ?? it.existingLos ?? "—",
      fmt(it.existingDelaySecVeh, 1),
    ]);
    tbl(
      ["Intersection", "Control", "Dist (mi)", "Exist LOS", "Delay (s/veh)"],
      [210, 70, 65, 65, 80],
      ["left", "left", "right", "center", "right"],
      existLosRows,
    );
  }
  doc.moveDown(0.8);

  // ─── §5 TRIP GENERATION ──────────────────────────────────────────────────
  stateSection("5.0 TRIP GENERATION ANALYSIS");
  body(`Trip generation for the proposed ${project.projectName || "development"} was estimated using the ITE Trip Generation Manual, 11th Edition, for ITE Land Use Code ${tg.landUseCode ?? "—"} (${tg.landUseName ?? "—"}). A ${fmt(r.passByPctApplied ?? 0)}% pass-by credit and ${fmt(r.internalCapturePctApplied ?? 0)}% internal capture credit are applied per methodology meeting agreement, yielding the following net new external trips:`);
  doc.moveDown(0.3);

  kv([
    ["ITE Land Use Code", `${tg.landUseCode ?? "—"} — ${tg.landUseName ?? "—"}`],
    ["Development size", tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"],
    ["Weekday daily (gross)", fmt(tg.dailyTrips)],
    ["AM peak hour (net new)", `${fmt(tg.amPeakTrips)} trips (${fmt(tg.amIn)} in / ${fmt(tg.amOut)} out)`],
    ["PM peak hour (net new)", `${fmt(tg.pmPeakTrips)} trips (${fmt(tg.pmIn)} in / ${fmt(tg.pmOut)} out)`],
    ["Pass-by credit applied", `${fmt(r.passByPctApplied ?? 0)}%`],
    ["Internal capture applied", `${fmt(r.internalCapturePctApplied ?? 0)}%`],
    ["Transit/mode reduction", r.altModeReductionPct ? `${fmt(r.altModeReductionPct)}%` : "Not applied"],
  ]);
  doc.moveDown(0.3);

  if (periods.length) {
    stateSub("5.1 Trip Generation by Period");
    tbl(
      ["Period", "Gross Trips", "Pass-by", "Int. Capture", "Net External", "In", "Out"],
      [110, 70, 65, 80, 80, 55, 55],
      ["left", "right", "right", "right", "right", "right", "right"],
      periods.map((p: any) => {
        const t = p.tripGeneration ?? {};
        return [
          String(p.periodLabel ?? p.period ?? ""),
          fmt(t.rawTrips),
          `${fmt(t.passByCredit)}`,
          `${fmt(t.internalCaptureCredit)}`,
          fmt(t.externalTrips),
          fmt(t.inTrips),
          fmt(t.outTrips),
        ];
      }),
    );
  }
  doc.moveDown(0.8);

  // ─── §6 TRIP DISTRIBUTION AND ASSIGNMENT ────────────────────────────────
  stateSection("6.0 TRIP DISTRIBUTION AND ASSIGNMENT");
  body(`Project-generated trips are distributed to the roadway network based on the existing directional distribution observed at the study-area count locations, proximity to the site access points, and the regional travel-demand model (${cfg.growthRateNote.split(";")[0].split("(")[0].trim()}).`);
  kv([
    ["Distribution method", r.distributionMethod ?? "Existing traffic directional distribution + engineering judgment"],
    ["Assignment method", r.assignmentMethod ?? "Site-access-proportional; confirmed at methodology meeting"],
  ]);
  note("Directional distribution percentages and trip assignment maps should be verified at the methodology meeting with the reviewing agency and attached as Appendix B.");
  doc.moveDown(0.8);

  // ─── §7 FUTURE NO-BUILD CONDITIONS ──────────────────────────────────────
  stateSection("7.0 FUTURE CONDITIONS — NO-BUILD");
  body(`The No-Build scenario represents future traffic volumes in the ${req.openingYear ?? "opening year"} without the proposed development. Background traffic growth is applied at ${fmt(r.growthAppliedPct, 2)}% per year (compound) over ${fmt(r.growthYears)} year${r.growthYears === 1 ? "" : "s"} to current counts. Programmed improvements from the ${cfg.agencyAbbrev} Statewide Transportation Improvement Program (STIP) and local capital programs are incorporated into the No-Build network where construction is funded and committed within the analysis horizon.`);
  kv([
    ["No-Build horizon year", String(req.openingYear ?? "—")],
    ["Growth applied", `${fmt(r.growthAppliedPct, 2)}%/yr × ${fmt(r.growthYears)} yr`],
    ["Programmed projects", r.committedProjects ?? "Per STIP and local CIP — confirm at methodology meeting"],
  ]);
  doc.moveDown(0.8);

  // ─── §8 FUTURE BUILD CONDITIONS ─────────────────────────────────────────
  stateSection("8.0 FUTURE CONDITIONS — BUILD");
  body(`The Build scenario adds distributed project-generated trips to the No-Build network for the ${req.openingYear ?? "opening year"} analysis horizon. All ${intersections.length} study-area intersections and roadway segments are evaluated for LOS under Build conditions.`);
  doc.moveDown(0.3);

  if (intersections.length) {
    stateSub("8.1 Intersection Level of Service — Three-Scenario Summary");
    tbl(
      ["Intersection", "Ctrl", "Dist (mi)", "Trips", "Exist LOS", "No-Bld LOS", "Build LOS", "Δ delay (s)", "Q95 (ft)"],
      [145, 45, 50, 40, 60, 60, 60, 60, 55],
      ["left", "left", "right", "right", "center", "center", "center", "right", "right"],
      intersections.map((it: any) => [
        it.name ?? it.signalId ?? "—",
        it.control ?? "Sig",
        fmt(it.distanceMi, 2),
        fmt(it.addedTripsPmPeak),
        it.currentLos ?? it.existingLos ?? "—",
        it.existingLos ?? "—",
        it.futureLos ?? "—",
        fmt(it.delayDelta ?? it.worstDelayDeltaSec, 1),
        fmt(it.queue95thFt),
      ]),
    );
    doc.moveDown(0.3);
    note(`Acceptable ${cfg.agencyAbbrev} LOS threshold: LOS ${cfg.losUrban} (urban) / LOS ${cfg.losRural} (rural). Locations shown at Build LOS E or F require mitigation analysis in §9.`);
  }
  doc.moveDown(0.8);

  // ─── §9 MITIGATION ANALYSIS ──────────────────────────────────────────────
  stateSection("9.0 MITIGATION ANALYSIS");

  if (losDrops === 0 && losEf === 0) {
    body(`No study-area intersections operate below the acceptable LOS ${cfg.losUrban} threshold under Build conditions. No off-site roadway mitigation is required to maintain ${cfg.agencyAbbrev} LOS standards.`);
  } else {
    body(`The following mitigation measures are proposed to address Build-scenario LOS deficiencies identified in §8. Mitigation must be incorporated as permit conditions in the ${cfg.agencyAbbrev} access permit and local site-plan approval.`);
    doc.moveDown(0.3);
    stateSub("9.1 Signal Timing Optimization");
    body(`Signal retiming at affected intersections is proposed to improve cycle lengths and phase splits to accommodate the added project volume. Synchro timing plans should be submitted to the applicable signal operations authority (${cfg.agencyAbbrev} or local traffic engineering) for review and implementation.`);
    doc.moveDown(0.3);

    stateSub("9.2 Geometric Improvements");
    body("Where signal retiming alone is insufficient to achieve acceptable LOS, geometric improvements (auxiliary turn lanes, channelization) may be required. Turn-lane warrants should be confirmed per the applicable design manual.");
    doc.moveDown(0.3);

    stateSub("9.3 Pedestrian and Multimodal Improvements");
    body("Pedestrian crossing enhancements (high-emphasis crosswalks, ADA-compliant ramps per PROWAG) at signalized intersections along the project frontage roads should be coordinated with the applicable agency traffic engineering division.");
  }

  doc.moveDown(0.3);
  stateSub("9.4 Storage Bay Adequacy");
  body(`95th-percentile queue analysis was performed at driveways and adjacent signalized intersections. Storage bay adequacy was evaluated against projected Build-scenario left-turn and right-turn queue lengths. Where storage deficiencies exist (95th-percentile queue exceeds available storage), turn-lane extensions or new auxiliary lanes are identified as required mitigation.`);
  const storageRows = intersections.filter((it: any) => Number.isFinite(Number(it.existingStorageFt)) && Number.isFinite(Number(it.queue95thFt)));
  if (storageRows.length > 0) {
    tbl(
      ["Intersection", "Movement", "Existing (ft)", "Q95 Build (ft)", "Required (ft)", "Deficit (ft)"],
      [160, 80, 75, 75, 75, 75],
      ["left", "left", "right", "right", "right", "right"],
      storageRows.map((it: any) => {
        const existing = Number(it.existingStorageFt);
        const q95 = Number(it.queue95thFt);
        const required = q95;
        const deficit = Math.max(0, required - existing);
        return [
          it.name ?? it.signalId ?? "—",
          it.criticalMovement ?? it.storageMovement ?? "Left-turn (verify)",
          fmt(existing),
          fmt(q95),
          fmt(required),
          deficit > 0 ? fmt(deficit) : "Adequate",
        ];
      }),
    );
  } else {
    note("No intersection carries a field-measured `existingStorageFt` value. Supply that field on each affected intersection record to produce a Required-vs-Existing-vs-Deficit table per AASHTO Green Book Chapter 9 / applicable state DOT design manual storage-bay standards.");
  }

  if (cfg.specialRequirements && cfg.specialRequirements.length > 0) {
    doc.moveDown(0.3);
    stateSub("9.5 State-Specific Requirements");
    for (const req of cfg.specialRequirements) {
      doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(`• ${req}`, { paragraphGap: 3 });
    }
    doc.fillColor("black");
  }
  doc.moveDown(0.8);

  // ─── §10 SITE ACCESS AND CIRCULATION ────────────────────────────────────
  stateSection("10.0 SITE ACCESS AND INTERNAL CIRCULATION");
  body(`Driveway access geometry, sight distance, and on-site circulation are reviewed per ${cfg.primaryDoc} and the applicable access management standards. Access permit requirements: ${cfg.tripThresholdNote} The analysis horizon for access-permit purposes is ${cfg.horizons}.`);
  kv([
    ["Study horizons", cfg.horizons],
    ["Access permit authority", cfg.agencyAbbrev],
    ["Sight distance standard", "AASHTO Green Book / state design manual, per design speed"],
  ]);
  note("Site access geometry, driveways, internal circulation, and parking design are dependent on the final site plan. A detailed site-access analysis per the applicable design manual should be performed once the site plan is finalized.");
  doc.moveDown(0.8);

  // ─── §11 TRANSIT AND MULTIMODAL CONSIDERATIONS ──────────────────────────
  stateSection("11.0 TRANSIT AND MULTIMODAL CONSIDERATIONS");
  body(`Existing transit service, bicycle facilities, and pedestrian infrastructure within ${fmt(r.studyRadiusMi ?? req.studyRadiusMi, 2)} miles of the site were inventoried. Any transit-mode reduction applied to trip generation reflects the transit availability factor approved at the methodology meeting. Multimodal improvements (transit shelter upgrades, bicycle parking, pedestrian connections) should be coordinated with the applicable transit provider and included in the site-plan submittal.`);
  kv([
    ["Transit reduction applied", r.altModeReductionPct ? `${fmt(r.altModeReductionPct)}%` : "None"],
    ["Nearest transit stop", r.nearestTransitStop ?? "Verify field"],
    ["Bicycle facility", r.bikeInfraNote ?? "Verify field inventory"],
  ]);
  if (cfg.concurrencyNote) {
    note(`Concurrency/mobility note: ${cfg.concurrencyNote}`);
  }
  doc.moveDown(0.8);

  // ─── §12 CONCLUSIONS ────────────────────────────────────────────────────
  stateSection("12.0 CONCLUSIONS AND RECOMMENDATIONS");
  if (losDrops === 0 && losEf === 0) {
    body(`The proposed ${project.projectName || "development"} is projected to generate ${fmt(tg.pmPeakTrips)} net new external PM peak-hour trips. No study-area intersections are projected to drop a LOS grade or exceed the ${cfg.agencyAbbrev} LOS ${cfg.losUrban} threshold under Build conditions. The project does not create unacceptable impacts on the surrounding roadway network and no off-site mitigation is required.`);
  } else {
    body(`The proposed ${project.projectName || "development"} is projected to generate ${fmt(tg.pmPeakTrips)} net new external PM peak-hour trips. ${losDrops} intersection${losDrops === 1 ? "" : "s"} drop${losDrops === 1 ? "s" : ""} one or more LOS grade${losDrops === 1 ? "" : "s"} and ${losEf} location${losEf === 1 ? "" : "s"} operate${losEf === 1 ? "s" : ""} at LOS E or F under Build conditions. The mitigation measures identified in §9 are required as conditions of the ${cfg.agencyAbbrev} access permit to maintain acceptable operations.`);
  }
  doc.moveDown(0.3);

  stateSub("Professional Engineer Certification");
  body(`This ${cfg.processName} has been prepared and reviewed by a Professional Engineer licensed in the State of ${cfg.stateName} under ${cfg.peStatuteName} (${cfg.peStatuteRef}). The signing PE attests to the accuracy and completeness of this study to the degree specified by the controlling ${cfg.agencyAbbrev} guidelines.`);
  doc.moveDown(0.3);

  // PE stamp block
  doc.rect(PAGE_MARGIN, doc.y, 250, 70).stroke("#d1d5db");
  doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
    `PE Seal — ${cfg.stateName}\n${cfg.peStatuteName}\n${cfg.peStatuteRef}\n\nSignature: ___________________________\nDate: ___________________________`,
    PAGE_MARGIN + 8, doc.y + 5, { width: 234 },
  );
  doc.y += 82;
  doc.x = PAGE_MARGIN;
  doc.fillColor("black");
  doc.moveDown(0.5);

  stateSub("Appendices (referenced — not auto-generated)");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY);
  doc.text("• Appendix A — Methodology Meeting Notes / Scope Letter", { paragraphGap: 2 });
  doc.text("• Appendix B — Trip Generation Worksheets (ITE 11th Ed.)", { paragraphGap: 2 });
  doc.text("• Appendix C — Traffic Count Data", { paragraphGap: 2 });
  doc.text("• Appendix D — Intersection Capacity Analysis Output (HCS / Synchro)", { paragraphGap: 2 });
  doc.text("• Appendix E — Signal Warrant Analyses (where applicable)", { paragraphGap: 2 });
  doc.text("• Appendix F — Crash Data (3-year, where required by reviewing agency)", { paragraphGap: 4 });
  doc.fillColor("black");
}

function fallbackConfig(region: Region): StateTisConfig {
  return {
    stateCode: region.stateCode ?? "US",
    stateName: region.displayName ?? "United States",
    agency: "State Department of Transportation",
    agencyAbbrev: "State DOT",
    processName: "Traffic Impact Study (TIS)",
    primaryDoc: "ITE Trip Generation Manual (11th Ed.); HCM (current edition); AASHTO Policy on Geometric Design of Highways and Streets",
    losUrban: "D",
    losRural: "C",
    tripThresholdNote: "Confirm applicable threshold with the reviewing agency at the pre-application methodology meeting.",
    horizons: "Existing + opening year + design year (confirm horizon with reviewing agency).",
    growthRateNote: "Derived from historical AADT at state DOT count stations on study-corridor roads.",
    methodologyMeetingRequired: true,
    tripGenSource: "ITE Trip Generation Manual, 11th Edition.",
    peStatuteRef: "State Professional Engineering Practice Act (confirm applicable statute with the state PE licensing board)",
    peStatuteName: "State Professional Engineering Practice Act",
  };
}
