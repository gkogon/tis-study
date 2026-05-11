/**
 * Central registry of authoritative references cited throughout the TIS
 * report. Each citation has a stable short tag (used as the footnote marker
 * in the report body) and a long-form bibliography entry rendered in the
 * methodology appendix and on the cover page.
 *
 * Structured this way so a PE reviewing the report can trace any number on
 * any page back to a specific manual / table / equation. This is what
 * differentiates a "defensible, PE-stampable" deliverable from a calculator
 * screenshot.
 */

export interface Citation {
  tag: string;          // short marker, e.g. "HCM-19-2"
  shortLabel: string;   // e.g. "HCM 6th Ed., Ch. 19, Eq. 19-8"
  fullCitation: string; // bibliography-form
}

export const CITATIONS: Record<string, Citation> = {
  HCM_19: {
    tag: "HCM-19",
    shortLabel: "HCM 6th Ed., Ch. 19",
    fullCitation:
      "Transportation Research Board. Highway Capacity Manual, 6th Edition, Chapter 19: Signalized Intersections. National Academies of Sciences, Engineering, and Medicine, 2016.",
  },
  HCM_19_8: {
    tag: "HCM-19-8",
    shortLabel: "HCM 6th Ed., Eq. 19-8 (uniform delay)",
    fullCitation:
      "Transportation Research Board. Highway Capacity Manual, 6th Edition, Equation 19-8: Uniform Control Delay (d₁). National Academies of Sciences, Engineering, and Medicine, 2016.",
  },
  HCM_19_LOS: {
    tag: "HCM-19-LOS",
    shortLabel: "HCM 6th Ed., Exhibit 19-8 (LOS thresholds)",
    fullCitation:
      "Transportation Research Board. Highway Capacity Manual, 6th Edition, Exhibit 19-8: LOS Criteria for Signalized Intersections. National Academies of Sciences, Engineering, and Medicine, 2016.",
  },
  ITE_TG_11: {
    tag: "ITE-TG-11",
    shortLabel: "ITE Trip Generation Manual, 11th Ed.",
    fullCitation:
      "Institute of Transportation Engineers. Trip Generation Manual, 11th Edition. ITE, Washington, D.C., 2021.",
  },
  ITE_TG_11_LU: {
    tag: "ITE-TG-LU",
    shortLabel: "ITE Trip Generation 11th Ed., Land Use Code",
    fullCitation:
      "Institute of Transportation Engineers. Trip Generation Manual, 11th Edition, Land Use Codes. ITE, Washington, D.C., 2021.",
  },
  MUTCD_2009: {
    tag: "MUTCD-2009",
    shortLabel: "MUTCD 2009 (Rev. 3, 2012)",
    fullCitation:
      "Federal Highway Administration. Manual on Uniform Traffic Control Devices for Streets and Highways, 2009 Edition with Revisions 1, 2, and 3. U.S. Department of Transportation, Washington, D.C., 2012.",
  },
  MUTCD_4C: {
    tag: "MUTCD-4C",
    shortLabel: "MUTCD §4C (signal warrants)",
    fullCitation:
      "Federal Highway Administration. Manual on Uniform Traffic Control Devices, 2009 Edition, Chapter 4C: Traffic Control Signal Needs Studies. U.S. DOT, 2012.",
  },
  AASHTO_GREEN: {
    tag: "AASHTO-GB-7",
    shortLabel: "AASHTO Green Book, 7th Ed.",
    fullCitation:
      "American Association of State Highway and Transportation Officials. A Policy on Geometric Design of Highways and Streets, 7th Edition. AASHTO, Washington, D.C., 2018.",
  },
  GDOT_RPM: {
    tag: "GDOT-RPM",
    shortLabel: "GDOT Regulations for Driveway and Encroachment Control",
    fullCitation:
      "Georgia Department of Transportation. Regulations for Driveway and Encroachment Control, current edition. GDOT, Atlanta, GA.",
  },
  NCHRP_765: {
    tag: "NCHRP-765",
    shortLabel: "NCHRP Report 765 (trip distribution)",
    fullCitation:
      "Transportation Research Board. NCHRP Report 765: Analytical Travel Forecasting Approaches for Project-Level Planning and Design. National Academies of Sciences, Engineering, and Medicine, 2014.",
  },
};

/**
 * In-document footnote marker.
 *
 * Used as a superscript next to a number in the report body. The tag matches
 * up with the numbered list rendered by the methodology appendix.
 */
export function ref(...tags: Array<keyof typeof CITATIONS>): string {
  return tags.map((t) => CITATIONS[t].tag).join(",");
}
