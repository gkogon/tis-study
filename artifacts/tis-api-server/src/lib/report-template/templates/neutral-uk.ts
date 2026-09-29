/**
 * Template #3 — a neutral UK Transport Assessment format.
 *
 * The default for every UK study not rendered for Velocity's own account (see
 * TEMPLATE_OWNERS in ../registry.ts). It uses the Velocity template's provider
 * bindings (except its standards providers, below) and a similar chapter
 * order, but carries no firm identity
 * of its own: name, URL, footer and © line bind to the requesting firm, the
 * Client row shows the study's client (or is left out), figures are drawn in
 * this palette rather than the colours sampled from Velocity's TA, and the
 * prose and headings are its own (check:uk-template-ownership refuses any
 * sentence, or any 7-word run, shared with Velocity's wording). It prints for
 * every UK nation, so London-only guidance (TfL, the London Plan) and
 * England-only policy (NPPF, PPG, Section 106 / 278) are always qualified in
 * the text and never named in a heading, and its standards table lists only
 * the entries that apply in the site's home nation (the *ByNation providers;
 * uk-nations.ts) — the shared registry the Velocity TA prints is left as it is.
 */
import type { ReportTemplate } from "../engine";

export const neutralUkTemplate: ReportTemplate = {
  id: "uk-ta",
  name: "UK Transport Assessment",
  documentType: "Transport Assessment",
  brand: {
    firmName: "{{firm.name}}",
    url: "{{firm.website}}",
    palette: {
      primary: "#34495E",
      onPrimary: "#ffffff",
      accent: "#5D7285",
      text: "#2B2B2B",
      muted: "#6B7280",
      tableHeader: "#ECEFF3",
      rule: "#D5DAE1",
    },
    cover: { style: "band" },
    footer: "{{firm.name}}  ·  Transport Assessment  ·  {{project.projectName}}  ·  Page {{page}}",
    docControl: true,
    // The requesting firm prepares the report; it is not also the client.
    client: "{{project.clientName}}",
    copyright: "© {{firm.name}}. All rights reserved.",
    charts: "palette",
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
            { kind: "prose", text: "This Transport Assessment reviews how the development proposed at {{project.address}} would change travel to and from the site and on the roads around it. It is a screening set against UK Transport Assessment practice: in England, the NPPF (December 2024) and the Planning Practice Guidance; elsewhere in the UK, the equivalent national planning policy; and, for sites in Greater London, also the London Plan 2021 and TfL's Healthy Streets Transport Assessment guidance. This screening is not a substitute for a Transport Assessment built on TRICS data and prepared by a chartered engineer." },
            { kind: "metrics", provider: "headline" },
            {
              kind: "if",
              flag: "noLosImpact",
              then: [{ kind: "prose", text: "On this screening, no junction in the study network drops one or more LOS grades in the With-Development scenario, so highway capacity does not constrain the scheme. Walking, cycling and public-transport provision and pedestrian comfort (and, in London, Healthy Streets performance) are evidenced at submittal from surveys and the design drawings." }],
              else: [{ kind: "prose", text: "On this screening, one or more junctions show a residual capacity impact. Mitigation, and how it is delivered, is agreed between the applicant, the highway or roads authority and, in London, TfL before a recommendation on planning permission is made." }],
            },
          ],
        },
        {
          number: "",
          title: "Confidence Grades and Standards",
          blocks: [
            { kind: "prose", text: "The table below grades the main inputs to this screening for confidence and gives the basis for each grade. The report is written for review and sign-off by a chartered engineer; where the For submittal column names further evidence, that evidence is needed before the assessment is submitted." },
            { kind: "metrics", provider: "accuracyOverallByNation" },
            { kind: "table", provider: "accuracy" },
            {
              // The table lists only the register's entries that apply in the
              // site's home nation for this study type (uk-nations.ts; none for a
              // Scottish pedestrian study), never every document the text names:
              // the lead-in prints only above a table, and never calls it complete.
              kind: "if",
              flag: "hasRegulationsByNation",
              then: [
                { kind: "prose", text: "The table below gives the edition of the policy, guidance and data sources recorded for the site's location and this type of study. It is not a complete list of the documents this report names." },
                { kind: "table", provider: "regulationsByNation" },
                { kind: "keyvalue", provider: "regulationStatus" },
              ],
              else: [{ kind: "note", text: "No edition table is given for the site's location and this type of study; the policy, guidance and data sources that apply, and their editions, are confirmed at submittal." }],
            },
          ],
        },
      ],
    },
    {
      number: "1.0",
      title: "Introduction",
      intro: "The scheme, the study network and the policy framework the assessment is set against.",
      sections: [
        {
          number: "1.1",
          title: "Purpose and Scheme",
          blocks: [
            { kind: "prose", text: "The key facts of the development proposed at {{project.address}} are set out below. The study network takes in the {{report.intersectionsStudied|num}} junctions within {{report.studyRadiusMi|num2}} miles of the site." },
            { kind: "keyvalue", provider: "schemeSummary" },
          ],
        },
        {
          number: "1.2",
          title: "Proposed Land Use",
          blocks: [
            { kind: "prose", text: "The proposed land use is summarised in the table below." },
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
              then: [{ kind: "prose", text: "With the development's trips added, no junction in the study network drops one or more LOS grades, so highway capacity does not constrain the scheme." }],
              else: [{ kind: "prose", text: "With the development's trips added, one or more junctions deteriorate; any mitigation they need would be secured through a Section 106 / Section 278 agreement, or the local equivalent (see Chapter 6)." }],
            },
          ],
        },
        {
          number: "1.4",
          title: "Policy Context",
          blocks: [
            { kind: "prose", text: "In England, national planning policy is set out in the NPPF (December 2024), whose paragraphs 115 and 118 call for a vision-led approach to transport, with the Planning Practice Guidance on travel plans, transport assessments and statements; elsewhere in the UK, the equivalent national planning policy and guidance apply. For sites in Greater London, the London Plan 2021 transport policies (T1 to T9), the Mayor's Transport Strategy and TfL's Healthy Streets Approach apply as well. In every case the local development plan applies, with any local transport plan or strategy. The vision for the place, and the part transport plays in achieving it, is written at submittal by the design team and the reviewing chartered engineer, ahead of any capacity results." },
          ],
        },
      ],
    },
    {
      number: "2.0",
      title: "Transport Planning for People",
      intro: "The people the development will serve, and the pattern of their travel through the day.",
      sections: [
        {
          number: "2.1",
          title: "Travel Through the Day",
          blocks: [
            {
              kind: "if",
              flag: "drawDiurnal",
              then: [
                { kind: "prose", text: "The gross trip generation is distributed across the day in the figure below, using the within-day profile cited beneath it." },
                { kind: "chart", provider: "diurnalColumn" },
              ],
              else: [{ kind: "note", text: "This screening has no within-day profile for this land use; one is taken at submittal from the matching TRICS or travel-survey data." }],
            },
          ],
        },
        {
          number: "2.2",
          title: "Travel Behaviour Segments",
          blocks: [{ kind: "note", text: "In Greater London, travel-behaviour segments come from TfL's Transport Classification of Londoners; elsewhere, from local travel-survey evidence where it exists. They are added at submittal from that source; this screening does not produce them." }],
        },
      ],
    },
    {
      number: "3.0",
      title: "Site and Surroundings",
      intro: "How people of all abilities reach, enter and move around the site.",
      sections: [
        { number: "3.1", title: "Existing Access and Movement", blocks: [{ kind: "note", text: "Site access (existing and proposed), walking and cycling catchments, local cycle routes and the main road network are described at submittal from the site plans and access drawings, using TfL's WebCAT tool for sites in London." }] },
        { number: "3.2", title: "Cycle Parking and Servicing", blocks: [{ kind: "note", text: "Cycle parking, long-stay and short-stay, is checked against the local parking standard (in London, London Plan Policy T5), and servicing demand against any servicing guidance the local authority publishes, once the scheme drawings are available." }] },
      ],
    },
    {
      number: "4.0",
      title: "Pedestrian Movement and Comfort",
      intro: "Whether there is enough footway and crossing space for the pedestrian numbers the scheme will bring.",
      sections: [{ number: "4.1", title: "Pedestrian Comfort", blocks: [{ kind: "note", text: "Footways and crossings are assessed for the base, future-base and with-development scenarios agreed with the highway or roads authority, using observed peak pedestrian flows: in London, with TfL's Pedestrian Comfort Level (PCL) method; elsewhere, with a method that authority accepts. The method is confirmed with that authority, and the survey inputs supplied, at submittal." }] }],
    },
    {
      number: "5.0",
      title: "Active Travel Assessment",
      intro: "How people will make the key walking and cycling journeys from the site.",
      sections: [{ number: "5.1", title: "Walking and Cycling Routes", blocks: [{ kind: "note", text: "The key walking and cycling routes are reviewed from survey and mapping at submittal: in London, as an Active Travel Zone assessment under TfL's ATZ guidance with a Healthy Streets Indicator review of each key route; elsewhere, with the equivalent local route audit. A review of recorded road collisions on those routes is added in every case." }] }],
    },
    {
      number: "6.0",
      title: "Trip Generation and Network Impact",
      intro: "The trips the development is expected to generate, how they spread across the study network, and the impact that remains.",
      sections: [
        {
          number: "6.1",
          title: "Trip Generation",
          blocks: [
            { kind: "prose", text: "Gross trips are estimated from US public-data screening rates (NHTS 2017, SANDAG 2002 and NCHRP 716) for {{tripGeneration.landUseName}}, land-use code {{tripGeneration.landUseCode}}, at a size of {{tripGeneration.size}} {{tripGeneration.unit}}. For submission these are replaced by TRICS multi-modal rates and, where appropriate, a mode split from Census travel-to-work data." },
            { kind: "table", provider: "tripGenSummary" },
            { kind: "if", flag: "hasPeriods", then: [{ kind: "table", provider: "periodTripGen" }], else: [] },
          ],
        },
        {
          number: "6.2",
          // The figure plots vehicles on site for a vehicular study and
          // pedestrians for a pedestrian one (its title, axis label and caption
          // say which), so the heading names neither and the note names the one
          // the study counts.
          title: "Accumulation on Site Through the Day",
          blocks: [
            {
              kind: "if",
              flag: "drawDiurnal",
              then: [{ kind: "chart", provider: "diurnalLine" }],
              else: [
                {
                  kind: "if",
                  flag: "isPedestrian",
                  then: [{ kind: "note", text: "The number of pedestrians on site through the day is estimated at submittal from the within-day profile described in Section 2.1." }],
                  else: [{ kind: "note", text: "The number of vehicles on site through the day is estimated at submittal from the within-day profile described in Section 2.1." }],
                },
              ],
            },
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
                { kind: "prose", text: "Each junction is screened by its degree of saturation (DoS), with 90% taken as the practical capacity threshold. For submission, the affected junctions are modelled in LinSig or Junctions on the agreed TRICS-based demand." },
                { kind: "if", flag: "hasIntersections", then: [{ kind: "table", provider: "ukCapacity" }], else: [{ kind: "note", text: "The study radius contains no junctions, so the screening finds no off-site capacity impact." }] },
              ],
              else: [{ kind: "note", text: "For a study of this type, junction capacity does not decide the outcome. Pedestrian movement and comfort do, and they are assessed at submittal using the method described in Chapter 4 (in London, TfL's PCL; elsewhere, a method the highway or roads authority accepts)." }],
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
      intro: "How the scheme meets national, regional and local transport policy.",
      sections: [{ number: "7.1", title: "Policy Compliance and Management Plans", blocks: [{ kind: "note", text: "The project team adds a policy-compliance table at submittal, together with the outline management plans the local authority asks for (for example a Travel Plan, a Delivery and Servicing Plan or a Construction Logistics Plan)." }] }],
    },
    {
      number: "8.0",
      title: "Summary and Conclusions",
      intro: "What the screening found, and what remains to be done for submission.",
      sections: [
        {
          number: "8.1",
          title: "Conclusion",
          blocks: [
            {
              kind: "if",
              flag: "noLosImpact",
              then: [{ kind: "prose", text: "Highway capacity does not limit the scheme on this screening. Before submission, the survey evidence described above completes the assessment of walking, cycling and public-transport provision and of pedestrian comfort (and, in London, of Healthy Streets performance)." }],
              else: [{ kind: "prose", text: "The screening leaves a residual impact at one or more junctions. The applicant agrees the mitigation, and the agreement that secures it (a Section 106 / Section 278 agreement, or the local equivalent), with the highway or roads authority and, in London, TfL before a planning recommendation is made." }],
            },
            { kind: "note", text: "The report is for sign-off by a chartered engineer (for example, CEng MCIHT). As a screening, it does not stand in for a full Transport Assessment built on TRICS data and signed by a registered professional." },
          ],
        },
      ],
    },
  ],
};
