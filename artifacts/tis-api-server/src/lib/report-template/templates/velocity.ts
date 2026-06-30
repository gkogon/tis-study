/**
 * Template #1 — Velocity Transport Planning's Transport Assessment format.
 *
 * This is the 60 Gracechurch Street TA structure expressed as DATA: the cover,
 * brand palette, 8-chapter spine, prose and the provider bindings that decide
 * which computed block lands where. No bespoke renderer function — the generic
 * engine renders it. Swap this value for another firm's `ReportTemplate` and the
 * same study renders in their format (see ./generic-us.ts).
 */
import type { ReportTemplate } from "../engine";

export const velocityTemplate: ReportTemplate = {
  id: "velocity-ta",
  name: "Velocity Transport Planning — Transport Assessment",
  documentType: "Transport Assessment",
  brand: {
    firmName: "Velocity Transport Planning Ltd",
    url: "www.velocity-tp.com",
    palette: {
      primary: "#3F9C5A",
      onPrimary: "#ffffff",
      accent: "#8EC57C",
      text: "#3F3F3F",
      muted: "#7A7A7A",
      tableHeader: "#ECF5E9",
      rule: "#D6E8CF",
    },
    cover: { style: "gradient", colors: ["#07B160", "#269D89", "#5BA7CF"], wordmark: "VELOCITY", tagline: "Transport Planning" },
    footer: "Velocity Transport Planning Limited  |  Transport Assessment  |  {{project.projectName}}  |  Page {{page}}",
    docControl: true,
  },
  chapters: [
    {
      number: "",
      title: "Executive Summary",
      sections: [
        {
          number: "",
          title: "",
          blocks: [
            { kind: "prose", text: "This Transport Assessment reports the anticipated transport effects of the proposed development at {{project.address}}. It is prepared as a cross-reference to UK Transport Assessment methodology under the NPPF (December 2024), the Planning Practice Guidance, the London Plan 2021 and the TfL Healthy Streets Transport Assessment format. It does not replace a TRICS-based TA prepared by a chartered engineer." },
            { kind: "metrics", provider: "headline" },
            {
              kind: "if",
              flag: "noLosImpact",
              then: [{ kind: "prose", text: "On the basis of this screening, no junction within the study network is projected to deteriorate by one or more LOS categories under the With-Development scenario; highway capacity is not the limiting factor for the scheme. The sustainable-transport credentials, pedestrian comfort and Healthy Streets compliance are completed with the survey evidence and design drawings at submittal." }],
              else: [{ kind: "prose", text: "The screening indicates a residual capacity impact at one or more junctions; mitigation and its delivery mechanism are to be agreed between the applicant, the borough and TfL before planning permission is recommended." }],
            },
          ],
        },
        {
          number: "",
          title: "Accuracy and Applicable Standards",
          blocks: [
            { kind: "prose", text: "This report is generated to current methodology and is complete for the inputs available. Rather than a blanket disclaimer, each component is graded for confidence below; the report is prepared for review and seal by a chartered engineer, who substitutes field-collected data and a calibrated model where a component is marked Medium or Low." },
            { kind: "metrics", provider: "accuracyOverall" },
            { kind: "table", provider: "accuracy" },
            { kind: "prose", text: "The assessment is prepared against the following standards (current editions):" },
            { kind: "table", provider: "regulations" },
            { kind: "keyvalue", provider: "regulationStatus" },
          ],
        },
      ],
    },
    {
      number: "1.0",
      title: "Introduction",
      intro: "i.e. What is being built, why and when — and how the scheme supports Healthy Streets, Vision Zero and the Mayor's Transport Strategy.",
      sections: [
        {
          number: "1.1",
          title: "Purpose and Scheme",
          blocks: [
            { kind: "prose", text: "This Transport Assessment reports the anticipated transport effects of the proposed development at {{project.address}}. {{report.intersectionsStudied|num}} junctions fall within a {{report.studyRadiusMi|num2}} mile study radius. The assessment is prepared to UK Transport Assessment methodology under the NPPF (December 2024), the London Plan 2021 and the TfL Healthy Streets TA format." },
            { kind: "keyvalue", provider: "schemeSummary" },
          ],
        },
        {
          number: "1.2",
          title: "Proposed Land Use",
          blocks: [
            { kind: "prose", text: "The proposed land-use schedule is summarised below (Table 1-1)." },
            { kind: "table", provider: "landUseSchedule" },
          ],
        },
        {
          number: "1.3",
          title: "Headline Findings",
          blocks: [
            { kind: "metrics", provider: "headline" },
            {
              kind: "if",
              flag: "noLosImpact",
              then: [{ kind: "prose", text: "No junction within the study network is projected to deteriorate by one or more LOS categories under the With-Development scenario; highway capacity is not the limiting factor for this scheme." }],
              else: [{ kind: "prose", text: "One or more junctions are projected to deteriorate under the With-Development scenario and may warrant mitigation under S106 / S278 — see Chapter 6." }],
            },
          ],
        },
        {
          number: "1.4",
          title: "Policy Context",
          blocks: [
            { kind: "prose", text: "The assessment is framed by the NPPF (December 2024) vision-led approach (paragraphs 115 and 118), the London Plan 2021 (Policies T1–T9), the Mayor's Transport Strategy, TfL Healthy Streets, and the City of London Local Plan and Transport Strategy. The place outcome the scheme seeks, and how transport supports that vision before capacity numbers are reported, is a vision-led narrative completed by the chartered engineer with the design team." },
          ],
        },
      ],
    },
    {
      number: "2.0",
      title: "Transport Planning for People",
      intro: "i.e. Who is the development for, and when and why will they travel?",
      sections: [
        {
          number: "2.1",
          title: "When Will People Travel?",
          blocks: [
            { kind: "prose", text: "A daily profile of journeys to and from the development is shown in Figure 2-1, distributing the gross trip generation across the within-day distribution. The highest inbound flow is in the AM peak and the highest outbound flow is in the PM peak, with a midday exchange." },
            {
              kind: "if",
              flag: "drawDiurnal",
              then: [{ kind: "chart", provider: "diurnalColumn" }],
              else: [{ kind: "note", text: "A within-day arrival/departure profile is produced for office / commercial schemes; for this use class it should be derived from the matching TRICS / LTDS profile at submittal." }],
            },
          ],
        },
        {
          number: "2.2",
          title: "Transport Classification of Londoners",
          blocks: [{ kind: "note", text: "TfL's Transport Classification of Londoners segments residents into travel-attitude groups; drawn from TfL Insight at submittal, it is not produced by this screening engine." }],
        },
      ],
    },
    {
      number: "3.0",
      title: "Site and Surroundings",
      intro: "i.e. How can people of all abilities move around the site and its immediate surroundings?",
      sections: [
        { number: "3.1", title: "Existing Access and Movement", blocks: [{ kind: "note", text: "Existing and proposed access arrangements, walking isochrones, the local cycle network and the strategic highway network (TLRN) are drawn from the architectural and access drawings and TfL WebCAT at submittal." }] },
        { number: "3.2", title: "Cycle Parking and Servicing", blocks: [{ kind: "note", text: "Long-stay, end-of-trip and short-stay cycle parking are assessed against London Plan Policy T5 (Table 10.2); servicing demand is estimated from the City of London Loading Bay Ready Reckoner with off-site consolidation. These are completed against the submitted drawings." }] },
      ],
    },
    {
      number: "4.0",
      title: "Pedestrian Comfort Level Analysis",
      intro: "i.e. Are footways and crossings comfortable for the forecast pedestrian flows?",
      sections: [{ number: "4.1", title: "PCL Method", blocks: [{ kind: "note", text: "TfL Pedestrian Comfort Level (PCL) assessment of footways and crossings across Base 2024 / Sensitivity 2024 / Future Base 2040 / 2040+Development, with observed 15-minute peak flows and queues. Survey-driven; the framework is emitted here and the survey inputs are uploaded." }] }],
    },
    {
      number: "5.0",
      title: "Active Travel Zone Assessment",
      intro: "i.e. How will people make the key journeys in the 20-minute Active Travel Zone?",
      sections: [{ number: "5.1", title: "ATZ and Healthy Streets", blocks: [{ kind: "note", text: "TfL Active Travel Zone maps (Map One/Two/Three), key-route Healthy Streets Indicator analysis and Vision Zero / DfT collision review. Survey- and map-driven; uploaded at submittal." }] }],
    },
    {
      number: "6.0",
      title: "Public Transport, Trip Generation and Network Impact",
      intro: "i.e. How will people travel onto London's public-transport and highway networks, and what is the residual impact?",
      sections: [
        {
          number: "6.1",
          title: "Trip Generation",
          blocks: [
            { kind: "prose", text: "Gross trip generation follows public-data US screening rates (NHTS 2017 / SANDAG 2002 / NCHRP 716) for land use {{tripGeneration.landUseCode}} ({{tripGeneration.landUseName}}) at {{tripGeneration.size}} {{tripGeneration.unit}}. A submitted TA substitutes TRICS multi-modal rates with the 2011 Census Method-of-Travel-to-Work public-transport adjustment." },
            { kind: "table", provider: "tripGenSummary" },
            { kind: "if", flag: "hasPeriods", then: [{ kind: "table", provider: "periodTripGen" }], else: [] },
          ],
        },
        {
          number: "6.2",
          title: "Daily Person Accumulation",
          blocks: [
            { kind: "if", flag: "drawDiurnal", then: [{ kind: "chart", provider: "diurnalLine" }], else: [{ kind: "note", text: "Daily person accumulation is produced for office / commercial schemes." }] },
          ],
        },
        {
          number: "6.3",
          title: "Demand Assumptions",
          blocks: [{ kind: "keyvalue", provider: "demandAssumptions" }],
        },
        {
          number: "6.4",
          title: "Network Capacity Impact",
          blocks: [
            {
              kind: "if",
              flag: "showCapacity",
              then: [
                { kind: "prose", text: "Junction capacity is screened on a UK degree-of-saturation basis (DoS, practical limit 90%). A submitted TA re-runs affected junctions in LinSig 3 / Junctions 11 with the agreed TRICS demand." },
                { kind: "if", flag: "hasIntersections", then: [{ kind: "table", provider: "ukCapacity" }], else: [{ kind: "note", text: "No junctions fall within the study radius — no off-site capacity impact is anticipated." }] },
              ],
              else: [{ kind: "note", text: "Junction capacity is not the controlling consideration for this study type; pedestrian movement and comfort are assessed in Chapter 4." }],
            },
          ],
        },
        {
          number: "6.5",
          title: "Trip Distribution",
          blocks: [{ kind: "if", flag: "hasIntersections", then: [{ kind: "table", provider: "tripDistribution" }], else: [] }],
        },
      ],
    },
    {
      number: "7.0",
      title: "Planning Policy Delivery",
      intro: "i.e. How does the scheme meet NPPF, London Plan, MTS and City of London policy?",
      sections: [{ number: "7.1", title: "Policy Delivery and Management Plans", blocks: [{ kind: "note", text: "Strategic-policy-delivery table plus the outline Delivery & Servicing Plan, Operational Waste Management Plan, Cycle Promotion Plan and Construction Logistics Plan, prepared by the project team at submittal." }] }],
    },
    {
      number: "8.0",
      title: "Summary and Conclusions",
      intro: "i.e. The headline transport impacts and the solutions that respond to them.",
      sections: [
        {
          number: "8.1",
          title: "Conclusion",
          blocks: [
            {
              kind: "if",
              flag: "noLosImpact",
              then: [{ kind: "prose", text: "On the basis of this screening the scheme is not constrained by highway capacity. Sustainable-transport credentials, PCL comfort and Healthy Streets compliance are completed by the chartered engineer with the survey evidence above." }],
              else: [{ kind: "prose", text: "The screening indicates residual impacts at one or more junctions; mitigation and its delivery mechanism (S106 / S278) are to be agreed between the applicant, the borough and TfL before permission is recommended." }],
            },
            { kind: "note", text: "Sign-off should be by a Chartered Engineer (CEng) and Member of CIHT (MCIHT). This screening cross-reference does not replace a TRICS-based TA prepared under professional registration." },
          ],
        },
      ],
    },
  ],
};
