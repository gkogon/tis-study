/**
 * Template #2 — a generic US DOT-style Traffic Impact Study format.
 *
 * Deliberately different from Velocity in cover style, branding, chapter
 * structure, ordering and prose — but it renders the SAME study data through
 * the SAME providers. This is the proof that format is data, not code: nothing
 * here is Velocity-specific, and no renderer was written for it.
 */
import type { ReportTemplate } from "../engine";

export const genericUsTemplate: ReportTemplate = {
  id: "generic-us-tis",
  name: "Generic US DOT — Traffic Impact Study",
  documentType: "Traffic Impact Study",
  brand: {
    firmName: "{{firm.name}}",
    palette: {
      primary: "#1F4E79",
      onPrimary: "#ffffff",
      accent: "#2E75B6",
      text: "#1a1a1a",
      muted: "#6b7280",
      tableHeader: "#E8EEF6",
      rule: "#D8DEE6",
    },
    cover: { style: "band", tagline: "Prepared in accordance with ITE / HCM methodology" },
    footer: "{{firm.name}}  ·  Traffic Impact Study  ·  {{project.projectName}}  ·  Page {{page}}",
    docControl: false,
  },
  chapters: [
    {
      number: "1",
      title: "Introduction",
      sections: [
        {
          number: "1.1",
          title: "Project Description",
          blocks: [
            { kind: "prose", text: "This Traffic Impact Study evaluates the transportation effects of the proposed development at {{project.address}}. The analysis covers {{report.intersectionsStudied|num}} study intersections within a {{report.studyRadiusMi|num2}}-mile radius and follows the ITE Trip Generation Manual (11th Edition) and the Highway Capacity Manual." },
            { kind: "keyvalue", provider: "schemeSummary" },
          ],
        },
        { number: "1.2", title: "Summary of Impacts", blocks: [{ kind: "metrics", provider: "headline" }] },
        {
          number: "1.3",
          title: "Accuracy and Applicable Standards",
          blocks: [
            { kind: "prose", text: "Each component of this study is graded for confidence below. The report is generated to current methodology and prepared for review and seal by a licensed Professional Engineer, who substitutes field-collected counts and a calibrated capacity model where a component is marked Medium or Low." },
            { kind: "metrics", provider: "accuracyOverall" },
            { kind: "table", provider: "accuracy" },
            { kind: "table", provider: "regulations" },
            { kind: "keyvalue", provider: "regulationStatus" },
          ],
        },
      ],
    },
    {
      number: "2",
      title: "Trip Generation",
      sections: [
        {
          number: "2.1",
          title: "Trip Generation Estimate",
          blocks: [
            { kind: "prose", text: "Trip generation for ITE land use {{tripGeneration.landUseCode}} ({{tripGeneration.landUseName}}) at {{tripGeneration.size}} {{tripGeneration.unit}} is summarized below, with pass-by and internal-capture credits applied per the ITE Trip Generation Handbook." },
            { kind: "table", provider: "tripGenSummary" },
            { kind: "if", flag: "hasPeriods", then: [{ kind: "table", provider: "periodTripGen" }], else: [] },
            { kind: "keyvalue", provider: "demandAssumptions" },
          ],
        },
        {
          number: "2.2",
          title: "Time-of-Day Distribution",
          blocks: [
            { kind: "if", flag: "drawDiurnal", then: [{ kind: "chart", provider: "diurnalColumn" }, { kind: "chart", provider: "diurnalLine" }], else: [{ kind: "note", text: "A time-of-day distribution is produced for office / commercial land uses." }] },
          ],
        },
      ],
    },
    {
      number: "3",
      title: "Trip Distribution and Assignment",
      sections: [
        {
          number: "3.1",
          title: "Site Trip Distribution",
          blocks: [
            { kind: "prose", text: "Site-generated trips are assigned to the study network by inverse-distance weighting from the site to each intersection." },
            { kind: "if", flag: "hasIntersections", then: [{ kind: "table", provider: "tripDistribution" }], else: [{ kind: "note", text: "No study intersections fall within the analysis radius." }] },
          ],
        },
      ],
    },
    {
      number: "4",
      title: "Findings and Recommendations",
      sections: [
        {
          number: "4.1",
          title: "Conclusion",
          blocks: [
            {
              kind: "if",
              flag: "noLosImpact",
              then: [{ kind: "prose", text: "No study intersection is projected to degrade by one or more levels of service under the Build condition. No capacity mitigation is indicated by this screening." }],
              else: [{ kind: "prose", text: "One or more study intersections are projected to degrade under the Build condition; geometric or operational mitigation should be designed to the controlling agency's standards." }],
            },
            { kind: "note", text: "This screening analysis is not a substitute for an agency-approved TIS with field-collected turning-movement counts and signal timings sealed by a licensed Professional Engineer." },
          ],
        },
      ],
    },
  ],
};
