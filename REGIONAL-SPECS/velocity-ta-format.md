# Velocity TA Format — Renderer Target Spec

**Status:** Derived from the client's actual filed report. This is the canonical format the London renderer (`renderTisLondon` in `pdf-export.ts`) must match. Supersedes the Holloway-modelled structure for London output. Companion to the research spec `london-ta-spec.md` (statutory/policy background).

**Why:** Velocity Transport Planning is our only London client. Their format = the London default.

---

## 1. Source / provenance

Canonical exemplar (the "Church Street" report from the brief — actually **Grace­church** Street):

- **Report:** "60 Gracechurch Street — Transport Assessment", **Velocity Transport Planning Ltd**, Project **23/186**, Doc **D002**, v1.0, **July 2024**. Client: Obayashi Properties UK Ltd.
- **Application:** City of London Corporation ref **24/00743/FULEIA** — Allianz House, 60 Gracechurch Street, EC3V 0HR. 36-storey Class E office tower (Sellar/Obayashi, 3XN). Approved 15.05.2025.
- **Structure on file:** TA **Part A** (54pp — front matter + Ch 1–4) + **Part B** (52pp — Ch 5–8 + appendices) + a 3pp **Transport Addendum**. ~106pp total; Part A ≈ the "70-page report" in the brief.
- **Local copies (uncommitted, private):** `~/tis-study/private/velocity-refs/60gcs-ta-partA.pdf`, `…partB.pdf`, `…addendum.pdf`, plus `*-full.txt` layout extracts. Secondary Velocity exemplar (residential): `hamclose-velocity-ta.pdf` (Ham Close, Apr 2022).
- **Portal retrieval gotcha:** the City of London Idox search applies a hidden recency filter — searching the reference returns only recent child apps (NMA/MDC), never the 2024 original. Reach the original via the **property record**: a child app's `relatedCases` tab → `propertyDetails.do` keyVal → its `relatedCases` lists *all* apps at the address with their real `applicationDetails` keyVals (no date filter). Original app keyVal: `SGGVKXFHL6A00`; property keyVal `L93MC6FH0M100`.

---

## 2. Document furniture (renderer auto-generates)

- **Cover page:** `[SITE]` / `TRANSPORT ASSESSMENT` / `PROJECT NO. [NN/NNN]` / `DOC NO. [DNNN]` / `DATE: [MONTH YEAR]` / `VERSION: [n.n]` / `CLIENT: [CLIENT]` / `Velocity Transport Planning Ltd` / `www.velocity-tp.com`.
- **Document Control Sheet (page i):** Document Reference · Project Title · Document Title · Project Number · Document Number · Revision No. · Document Date; **Document Review** table — Prepared By / Reviewed By / Authorised By (initials) + Date completed; Notes; `© Velocity Transport Planning Ltd — Extracts may be reproduced provided that the source is acknowledged`.
- **Per-page footer (every page):** `Velocity Transport Planning Limited | Transport Assessment | Project No [NN/NNN] Doc No [DNNN] | [Site] | Page [n] | [Month Year]`.
- **Front matter:** Table of Contents, List of Figures, List of Tables.

---

## 3. Chapter structure (mirror exactly)

> Titles below are read verbatim from the source TA (`60gcs-ta-partA-full.txt` Ch 1–4, `…partB-full.txt` Ch 5–8), not inferred. Source heading lines: Part A 228 "1 INTRODUCTION", 363 "2 TRANSPORT PLANNING FOR PEOPLE", 415 "3 SITE AND SURROUNDINGS", 945 "4 PEDESTRIAN COMFORT LEVEL ANALYSIS"; Part B 1 "5 ACTIVE TRAVEL ZONE ASSESSMENT", 754 "6 LONDON WIDE NETWORK", 1425 "7 PLANNING POLICY DELIVERY", 1887 "8 SUMMARY AND CONCLUSIONS". The renderer hyphenates Ch 6 as "London-Wide Network" for consistency with the non-London branch.

1. **INTRODUCTION** — purpose; site boundary (Fig 1-1); proposed land-use / area schedule (GIA, **§1.4 Proposed Development**, Table 1-1); report structure; policy context (NPPF Dec-2024 paras 115/118, London Plan T1–T9, MTS, Healthy Streets, **City of London Local Plan + Transport Strategy**).
2. **TRANSPORT PLANNING FOR PEOPLE** — who the development is for and **when / why** they travel (TfL **LTDS 2019**); a light people-first framework. NOT the floor-area schedule (that is Ch 1 §1.4). Employee inbound/outbound trip profile by start time is presented with the trip generation in Ch 6.
3. **SITE AND SURROUNDINGS** — existing & proposed access; walking catchment isochrone (Fig 3-3); local cycle routes; strategic highway network; vehicle access; permissive paths / highway oversailing; cycle hire docks; **cycle parking** (long-stay basement, end-of-trip, short-stay) vs London Plan T5 Table 10.2 (Table 3-1); London Plan policy + employee occupation context; on-street parking restrictions; blue-badge bays; servicing arrangements; waste strategy.
4. **PEDESTRIAN COMFORT LEVEL ANALYSIS** — TfL **Pedestrian Comfort Level (PCL)** method; footway + crossing assessments across **Base 2024 / Sensitivity 2024 / Future Base 2040 / 2040 + Development**; forecast additional pedestrian trips by mode (Table 4-6); pedestrian movement distribution + assignment; observed crossing flows/queues (AM / lunch / PM 15-min peaks); PCL summary tables (4-10, 4-15).
5. **ACTIVE TRAVEL ZONE ASSESSMENT** — TfL **ATZ** (Map One/Two/Three + Neighbourhood Photo Survey); key-destination prioritisation (Table 5-1); ~5 agreed key routes × Healthy Streets Indicator analysis (Tables 5-2…5-6); **Vision Zero** analysis; DfT personal-injury collision data (3-yr KSI) + collision map.
6. **LONDON-WIDE NETWORK** — PTAL band + map (site = 6b); bus / underground / Elizabeth line / rail service frequencies (Tables 6-1…6-3); **TRIP GENERATION** (see §4); net change travel demand; daily person accumulation (Fig 6-2); **servicing demand** (see §5); Underground/DLR impact (Bank/Monument, Liverpool St) + Rail impact. (Public transport + trip generation + network impact all live in this chapter in the source report.)
7. **PLANNING POLICY DELIVERY** — strategic-policy-delivery table (how the scheme meets NPPF / London Plan / MTS / CoL policies); outline **Delivery & Servicing Plan**, **Operational Waste Management Plan**, **Cycle Promotion Plan**, **Construction Logistics Plan**.
8. **SUMMARY AND CONCLUSIONS** — sustainable-transport credentials, residual impacts, mitigation; §8.5 Conclusion.

Appendices (Part B / consultant-uploaded): TRICS outputs, PCL survey data, swept-path & access drawings, etc.

---

## 4. Trip-generation method — THE engine core (matches §6.4 verbatim in approach)

This is exactly the "2011 census, not 2021" instinct from the brief — Velocity's own method:

1. **TRICS** comparable office sites → "all journey purpose" mode shares for arrivals/departures (Table 6-5 *Original TRICS Mode Split*). Rates are **per 100 sqm GIA**.
2. **2011 Census "Method of Travel to Work"** (City of London as destination, **MSOA**-level) is extracted to **adjust the public-transport mode share** (disaggregate rail / underground / bus). Table 6-6 *Census Mode Share for Travel to Work (City of London as destination)*. **2011, not 2021** — pre-COVID, the planner's convention.
3. **Bus, cyclist and pedestrian** trips stay at the **TRICS** mode share (not Census-adjusted).
4. → Adjusted existing mode split (6-7) → existing office trips by mode at existing GIA (6-8) → proposed mode share (6-10) → proposed forecast trips by mode (6-11) → **net change** (proposed − existing).

Engine action (task #3): replace the hard-coded `london_metro: 0.38` in `mode-share.ts` with this two-step TRICS→2011-Census-MTW adjustment, keyed on **City-of-London-destination MSOA** Census data, PT-only adjustment.

---

## 5. Servicing demand

- **City of London "Loading Bay Ready Reckoner"** estimates daily servicing vehicles from GIA/use (≈119/day for this scheme; ~20% in peak hours).
- Off-site **freight consolidation** reduces servicing trips by ≥75%; renderer states the consolidation assumption + net peak-hour servicing vehicles.

---

## 6. ADT % / highway impact (task #4) — placement + honest caveat

- Metric: for each road/junction in the radius, **development AADT as a % of existing baseline AADT (DfT 2019)**, flagged vs the material-impact threshold. Lives in **Ch 6 (net change)**.
- **Caveat:** for a PTAL 6b car-free City site, car mode share ≈ 0, so the highway ADT impact is ~0% — and showing that *is* the correct finding. The ADT% table earns its keep for **outer-London / higher-car** sites. Keep it emitted everywhere; never suppress.

---

## 7. Deltas from the current Holloway-modelled renderer

- Holloway = **residential** Healthy Streets TA (985 DU, per-dwelling). Gracechurch = **commercial Class E office** (per-100sqm GIA, near-car-free). Renderer must support **office/Class E GIA trip generation** with the TRICS→2011-Census method, not just residential.
- Add Velocity **cover + Document Control Sheet + per-page footer**.
- Add **PCL pedestrian-comfort** chapter (Ch 4) and full **ATZ / Healthy Streets** chapter (Ch 5) — data-heavy; renderer emits the framework + tables, survey inputs uploaded.
- Add **CoL Loading Bay Ready Reckoner** servicing (Ch 6).
- 2011 Census MTW City-of-London mode share is the trip-gen basis (§4).
