# Data sources — 85-metro coverage inventory (all 50 states)

**Last updated:** 2026-05-27 (post Tier-6 expansion: 50-state coverage complete)
**Status:** 85 active metros across all 50 states + DC · 345,423 signals indexed · 34 metros at Tier-A AADT coverage (up from 13 — Tier-4 + Tier-5 AADT overlays now wired). Tier-6 (small-metro states) AADT pending the in-flight probe results.

This is the authoritative reference for every data source feeding the TIS
engine, where it comes from, where it lives on disk, and how to refresh it.
Each metro's depth varies — that variance is honest, not a bug. Tier-B
metros ship with calibrated road-class baselines instead of measured AADT
because the local state DOT doesn't publish counts in a usable form yet.

---

## Quick reference

| Layer | Universal? | Source | Owner | Refresh cadence |
|-------|-----------|--------|-------|-----------------|
| Signal inventory | ✅ all 64 | Geofabrik state PBFs + osmium | OpenStreetMap | Quarterly |
| Road network | ✅ all 64 | Geofabrik state PBFs + osmium | OpenStreetMap | Quarterly |
| City signal overlay | ⚠️ 5 of 64 | ArcGIS REST per city | City DOTs | Annual |
| AADT | ⚠️ 16 of 64 | FDOT / NCDOT / TDOT / VDOT / SCDOT / MDC | State DOTs | Annual |
| Live incidents | ⚠️ 7 of 64 | GDOT 511 / NCDOT TIMS / FDOT DIVAS / KYTC | State DOTs | Every 60s |
| Neighborhood polygons | ⚠️ 7 of 64 | City open-data hubs | Cities | One-shot |

---

## State-DOT integrations (cover multiple metros)

### GDOT — Atlanta + (planned: Savannah/Augusta/Macon)
- **Live**: `atlanta-live.ts` (legacy Atlanta-only code path) → GDOT 511 NaviGAtor v2
- **AADT**: built into `atlanta-data.ts` (calibrated counts, years of accumulation)
- **Status**: Atlanta only via legacy path; Savannah/Augusta/Macon use OSM + synthetic baseline pending regional pull

### NCDOT — Charlotte + Raleigh-Durham + Asheville + Wilmington + Triad + Fayetteville + Greenville-NC
- **Live incidents**: [`ncdot-live.ts`](artifacts/api-server/src/lib/ncdot-live.ts) → `eapps.ncdot.gov/services/traffic-prod/v1/`
- **AADT**: `NCDOT__2024_AADT_Stations_published_September_2025` (48,687 statewide stations)
- **URL**: `https://services.arcgis.com/NuWFvHYDMVmmxMeM/arcgis/rest/services/NCDOT__2024_AADT_Stations_published_September_2025/FeatureServer/0`
- **Snap radius**: 1000m (stations are sparse)
- **Coverage**: 70-95% per metro

### TDOT — Nashville + Memphis + Knoxville + Chattanooga
- **Live incidents**: ❌ no public API (SmartWay is OAuth-gated)
- **AADT**: `Traffic_Points` (597,245 statewide points — huge dataset, county-filtered at fetch)
- **URL**: `https://services2.arcgis.com/nf3p7v7Zy4fTOh6M/arcgis/rest/services/Traffic_Points/FeatureServer/0`
- **Snap radius**: 200m
- **Coverage**: 31-40% per metro (state routes only — most local-road signals miss)

### FDOT — Tampa + Orlando + Miami-Dade + Jacksonville + Pensacola
- **Live incidents**: [`fdot-live.ts`](artifacts/api-server/src/lib/fdot-live.ts) → `DIVAS_GetEvent` (~130 active statewide events)
- **AADT**: `Annual_Average_Daily_Traffic_TDA` (21,608 statewide polylines)
- **URL**: `https://services1.arcgis.com/O1JpcwDW8sjYuddV/arcgis/rest/services/Annual_Average_Daily_Traffic_TDA/FeatureServer/0`
- **Snap radius**: 200m (segments are dense — p50 snap distance is **2m**)
- **K-factor**: per-segment from `KFCTR` field (real, not assumed)
- **Coverage**: 67-88% per metro
- **Plus Miami-Dade County supplement**: `MDCTrafficCountStation_gdb` (424 local-road stations, 2019 vintage). Adds ~5% to Miami-Dade coverage.

### VDOT — Hampton Roads + Richmond
- **Live incidents**: ❌ not in public ArcGIS (511virginia.org needs scraping)
- **AADT**: `VDOT_Traffic_Volume_2024` (123,766 statewide polylines, all road classes)
- **URL**: `https://services.arcgis.com/p5v98VHDX9Atv3l7/arcgis/rest/services/VDOT_Traffic_Volume_2024/FeatureServer/0`
- **Snap radius**: 200m — bbox-filtered per region (no county column in the data)
- **Coverage**: **94-97%** per metro — best in the platform; p50 snap distance is **1m**

### SCDOT — Charleston + Columbia
- **Live incidents**: ❌ no public API
- **AADT**: `Traffic_Counts_2017` (11,363 statewide multipoints — dated but real)
- **URL**: `https://services1.arcgis.com/VaY7cY9pvUYUP1Lf/arcgis/rest/services/Traffic_Counts_2017/FeatureServer/0`
- **Snap radius**: 600m (multipoints sparser than NCDOT stations)
- **Coverage**: 69-81% per metro

### KYTC — Louisville + Lexington
- **Live closures**: [`kytc-live.ts`](artifacts/api-server/src/lib/kytc-live.ts) → `KYTC_Road_Closures` (typically 0-5 active)
- **URL**: `https://services2.arcgis.com/CcI36Pduqd0OR4W9/arcgis/rest/services/KYTC_Road_Closures/FeatureServer/0`
- **AADT**: ❌ no statewide layer found in ArcGIS
- **Synthetic baseline** in use for both KY metros

### ALDOT — Birmingham + Mobile + Huntsville
- **Live incidents**: ❌ AlgoTraffic API is OAuth-gated (requires registration)
- **AADT**: ❌ only Gulf Coast subset found (~1,300 records — not enough for AL metros)
- **All 3 AL metros**: ship with OSM + synthetic baseline

### LADOTD — New Orleans
- **Live incidents**: ❌ 511la.org needs scraping
- **AADT**: ❌ no public ArcGIS host
- **Synthetic baseline** in use

---

## City-authoritative signal overlays

Where the city DOT publishes its own signal inventory, we overlay it on the
OSM baseline (replacing OSM coords + adding city-canonical intersection
names). See [`fetch-city-signals.ts`](scripts/src/fetch-city-signals.ts).

| Metro | Source | Records overlaid | Records added |
|-------|--------|------------------|---------------|
| Charlotte | CDOT Accela layer 11 (`gis.charlottenc.gov`) | 928 OSM signals upgraded | 364 net-new (CDOT-only) |
| Miami-Dade | County `TrafficSignals_gdb` (~6K signals) | 3,475 upgraded | 2,558 net-new |
| Orlando | `City_of_Orlando_ITS_Devices/3` (524 devices) | 459 upgraded | 65 net-new |
| Raleigh-Durham | `Raleigh_Traffic_Signals_Public_for_PowerBI` (673) | 640 upgraded | 33 net-new |
| Tampa | `Traffic_Signal_Locations_TDA` (FDOT statewide, FL-portion) | 950 upgraded | 102 net-new |

Other metros: OSM only — either the city doesn't publish, or its dataset
is mostly school flashers / pedestrian signals (Orlando had this issue and
we accepted it after probing).

---

## Neighborhood polygons (zone labels)

Where loaded, replaces the compass-quadrant fallback ("NW Charlotte") with
real neighborhood names ("Park Central", "Florida Center").

| Metro | Source | Polygon count |
|-------|--------|---------------|
| Atlanta | hand-curated in `atlanta-data.ts` | 9 polygons |
| Charlotte | `HNS/NPA_HLT` (NPA Housing Locational Tool) | 911 NPAs |
| Nashville | Temple University academic mirror | 288 polygons |
| Orlando | `OpenData_Orlando OrlandoPoliticalNeighborhoods` | 125 polygons |
| Miami-Dade | `Municipal_Boundary_30` (cities within county) | 28 municipalities |
| Raleigh-Durham | `Raleigh_Neighborhood_Registry` (HOAs) | 411 polygons |
| Tampa | `HillsboroughCounty/Cities` | 3 cities only |

Other metros fall back to compass quadrants (Central / NW / NE / SW / SE
\<Metro\>). Acceptable; per-metro curation can replace.

---

## Per-metro coverage table

| Metro | Signals | Named% | AADT% | AADT source | Live | Neighborhoods |
|-------|--------:|-------:|------:|-------------|------|---------------|
| Atlanta | 7,393 | 82.6% | flagship | GDOT calibrated counts | ✅ GDOT | ✅ |
| Charlotte | 4,562 | 98.9% | **86.3%** | NCDOT 2024 | ✅ NCDOT | ✅ |
| Raleigh-Durham | 4,904 | 97.8% | **95.4%** | NCDOT 2024 | ✅ NCDOT | ✅ HOAs |
| Triad (Greensboro-WS) | 2,940 | 98.5% | **88.6%** | NCDOT 2024 | ✅ NCDOT | — |
| Asheville | 699 | 95.7% | **84.4%** | NCDOT 2024 | ✅ NCDOT | — |
| Wilmington | 621 | 98.7% | **94.4%** | NCDOT 2024 | ✅ NCDOT | — |
| Fayetteville | 1,096 | 97.4% | 70.0% | NCDOT 2024 | ✅ NCDOT | — |
| Greenville-NC | 299 | 98.0% | 70.9% | NCDOT 2024 | ✅ NCDOT | — |
| Nashville | 2,685 | 96.9% | 31.2% | TDOT (state routes) | ❌ | ✅ |
| Memphis | 1,280 | 98.3% | 33.5% | TDOT (state routes) | ❌ | — |
| Knoxville | 1,553 | 96.6% | 37.4% | TDOT (state routes) | ❌ | — |
| Chattanooga | 523 | 95.8% | 40.3% | TDOT (state routes) | ❌ | — |
| Tampa | 5,208 | 97.4% | **80.5%** | FDOT TDA | ✅ FDOT | ✅ |
| Orlando | 6,850 | 96.5% | 67.8% | FDOT TDA | ✅ FDOT | ✅ neighborhoods |
| Miami-Dade | 10,302 | 98.9% | **85.1%** | FDOT TDA + MDC | ✅ FDOT | ✅ municipalities |
| Jacksonville | 2,512 | 97.6% | **84.6%** | FDOT TDA | ✅ FDOT | — |
| Pensacola | 658 | 98.8% | **88.4%** | FDOT TDA | ✅ FDOT | — |
| Hampton Roads | 4,676 | 99.6% | **94.2%** | VDOT 2024 | ❌ | — |
| Richmond | 3,522 | 100.0% | **97.0%** | VDOT 2024 | ❌ | — |
| Charleston-SC | 806 | 97.1% | 69.4% | SCDOT 2017 | ❌ | — |
| Columbia-SC | 976 | 99.4% | **80.9%** | SCDOT 2017 | ❌ | — |
| Birmingham | 1,854 | 95.0% | — | (synth) | ❌ | — |
| Huntsville | 968 | 98.2% | — | (synth) | ❌ | — |
| Mobile | 900 | 95.9% | — | (synth) | ❌ | — |
| Louisville | 1,461 | 98.6% | — | (synth) | ✅ KYTC closures | — |
| Lexington | 978 | 99.9% | — | (synth) | ❌ | — |
| New Orleans | 1,979 | 98.3% | — | (synth) | ❌ | — |
| Savannah | 722 | 98.9% | — | (synth) | ❌ | — |
| Augusta | 519 | 99.4% | — | (synth) | ❌ | — |
| Macon-Bibb | 815 | 94.7% | — | (synth) | ❌ | — |
| Washington DC | 10,752 | 99.6% | — | (synth, DDOT probe pending) | ❌ | — |
| Baltimore | 4,770 | 99.7% | — | (synth, MDOT-SHA probe pending) | ❌ | — |
| Philadelphia | 8,924 | 96.7% | — | (synth, PennDOT probe pending) | ❌ | — |
| Pittsburgh | 2,973 | 99.2% | — | (synth, PennDOT probe pending) | ❌ | — |
| New York | 30,601 | 91.9% | — | (synth, NYSDOT TDV pending) | ❌ | — |
| Boston | 7,815 | 99.8% | — | (synth, MassDOT probe pending) | ❌ | — |
| Chicago | 13,305 | 99.0% | — | (synth, IDOT pending) | ❌ | — |
| Detroit | 7,041 | 98.7% | — | (synth, MDOT pending) | ❌ | — |
| Twin Cities | 6,504 | 98.3% | — | (synth, MnDOT pending) | ❌ | — |
| Cleveland | 3,475 | 98.9% | — | (synth, ODOT probe pending) | ❌ | — |
| Columbus-OH | 2,551 | 99.0% | — | (synth, ODOT probe pending) | ❌ | — |
| Cincinnati | 2,632 | 98.4% | — | (synth, ODOT probe pending) | ❌ | — |
| Indianapolis | 3,745 | 99.1% | — | (synth, INDOT probe pending) | ❌ | — |
| St. Louis | 3,581 | 97.6% | — | (synth, MoDOT probe pending) | ❌ | — |
| Kansas City | 2,086 | 94.4% | — | (synth, MoDOT probe pending) | ❌ | — |
| Milwaukee | 4,621 | 99.9% | — | (synth, WisDOT pending) | ❌ | — |
| Houston | 14,498 | 99.4% | — | (synth, TxDOT probe pending) | ❌ | — |
| Dallas-Fort Worth | 15,796 | 99.9% | — | (synth, TxDOT probe pending) | ❌ | — |
| Austin | 2,932 | 98.8% | — | (synth, TxDOT probe pending) | ❌ | — |
| San Antonio | 3,374 | 99.7% | — | (synth, TxDOT probe pending) | ❌ | — |
| Los Angeles | 30,933 | 99.9% | — | (synth, Caltrans pending) | ❌ | — |
| SF Bay | 15,751 | 99.3% | — | (synth, Caltrans pending) | ❌ | — |
| San Diego | 10,246 | 99.9% | — | (synth, Caltrans pending) | ❌ | — |
| Sacramento | 4,428 | 99.5% | — | (synth, Caltrans pending) | ❌ | — |
| Inland Empire | 12,141 | 99.9% | — | (synth, Caltrans pending) | ❌ | — |
| Fresno | 1,887 | 100.0% | — | (synth, Caltrans pending) | ❌ | — |
| Portland | 3,333 | 99.1% | — | (synth, ODOT-OR pending) | ❌ | — |
| Seattle | 4,770 | 98.8% | — | (synth, WSDOT pending) | ❌ | — |
| Las Vegas | 5,698 | 99.8% | — | (synth, NDOT pending) | ❌ | — |
| Phoenix | 7,977 | 99.8% | — | (synth, ADOT pending) | ❌ | — |
| Tucson | 1,950 | 100.0% | — | (synth, ADOT pending) | ❌ | — |
| Denver | 7,700 | 99.3% | — | (synth, CDOT-CO pending) | ❌ | — |
| Salt Lake City | 2,887 | 99.4% | — | (synth, UDOT pending) | ❌ | — |
| Albuquerque | 1,939 | 99.7% | — | (synth, NMDOT pending) | ❌ | — |

**Bold AADT** = Tier-A coverage (≥75%, featured on website).

---

## AADT endpoints (Tier-4/5 re-probed 2026-05-27) — ready to wire

After deeper probing, public ArcGIS endpoints found for all 8 previously-struggling Tier-4 states **plus** confirmed federal/state hosts for the Tier-5 expansion. Below is the list ready for `fetch-aadt-by-signal.ts` wiring.

### Tier-4 re-probe targets (8 states, 8 hits)

| State | Endpoint | Format | Year | Records | AADT field | Live API |
|-------|----------|--------|------|--------:|------------|----------|
| TX (TxDOT) | `services.arcgis.com/KTcxiTD9dsQw4r7Z/.../TxDOT_AADT/FeatureServer/0` | polyline | current | 717,119 | `AADT_CUR` | `.../TxDOT_Roadway_Status/FeatureServer/0` (DriveTexas, public) |
| OH (ODOT) | `tims.dot.state.oh.us/ags/rest/services/Roadway_Information/Traffic_Count_Segments/MapServer/0` | polyline | 2024 | 149,040 | `AADT_TOTAL` | OHGO public API (key required, free) |
| PA (PennDOT) | `gis.penndot.gov/arcgis/rest/services/opendata/roadwaytraffic/MapServer/0` | polyline | 2020-25 | 45,444 | `CUR_AADT` | RCRS_Event_Data (gated, free w/ form) |
| MA (MassDOT) | `gis.massdot.state.ma.us/arcgis/rest/services/Roads/TrafficInventoryYearEnd/FeatureServer/1` | polyline | up to 2024 | 438,121 | `AADT` | GoTime API (free, registration required) |
| IN (INDOT) | `gis.indot.in.gov/ro/rest/services/DOT/RO_RandH_Organization_Default/FeatureServer/110` | polyline | 2021 | 37,375 | `AADT` | ❌ no public API (511IN is SPA-only) |
| MO (MoDOT) | `mapping.modot.mo.gov/arcgis/rest/services/BusinessInt/TrafficInfoSegAADT/MapServer/1-4` (per direction) | polyline | 2003-25 | ~370k | `AADT` | WZDx public feed + ArcGIS Traveler Info |
| MD (MDOT SHA) | `services.arcgis.com/njFNhDsUCentVYJW/.../MDOT_SHA_Annual_Average_Daily_Traffic/FeatureServer/0,1` | point + polyline | 2023 | 8,149 + 10k+ | `AADT` | CHART `chart.maryland.gov/DataFeeds/GetIncidentJson` (public) |
| DC (DDOT) | `maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Transportation_TrafficVolume_WebMercator/MapServer/4` (2023) | polyline | 2023 | 8,373 | `AADT` | ❌ no public incidents feed |

**Net:** All 8 metros that were "synth-only pending probe" now have a path to Tier-A AADT. Wiring effort = extend `fetch-aadt-by-signal.ts` with 6 new state branches (TX/OH/PA/MA/IN/MO; MD/DC were partial misses before).

### Tier-5 (8 states, 8 hits — deep-probed 2026-05-27 second round)

| State | Endpoint | Format | Year | Records | AADT field | Live API |
|-------|----------|--------|------|--------:|------------|----------|
| CA (Caltrans) | `caltrans-gis.dot.ca.gov/.../CHhighway/Traffic_AADT/FeatureServer/0` | point (postmile) | 2023 | 13,919 | `BACK_AADT` + `AHEAD_AADT` | CHP KML (no JSON; CWWP2 for SLA'd) |
| OR (ODOT) | `gis.odot.state.or.us/arcgis1006/.../transgis/catalog/MapServer/159` (Traffic Flow polyline) | polyline | 2024 | 6,544 | `AADT` | `ODOT_Traffic_Incidents/FeatureServer/0` (public, ArcGIS, 5min refresh) |
| WA (WSDOT) | `data.wsdot.wa.gov/.../Shared/TrafficData/FeatureServer/1` (Sections) | polyline | 2024 | 4,810 | `AADT` | `HighwayAlertsREST` (free key) |
| NV (NDOT) | `gis.dot.nv.gov/.../Applications/TRINA/FeatureServer/1` (Stations) | point | 2024 | 3,500 | `AADT_2024` (wide year cols) | NV511 dev API (free key) |
| AZ (ADOT) | `services6.arcgis.com/clPWQMwZfdWn4MQZ/.../ADOT_2024_Average_Annual_Daily_Traffic_(AADT)/FeatureServer/0` | polyline | 2024 | 26,508 | `AADT` | `ADOT_Traffic_Events/FeatureServer/0` (public, no key) |
| CO (CDOT-CO) | `dtdapps.coloradodot.info/.../OTIS/TrafficExplorer/MapServer/0` (TrafficStations) | point | 2024 | 3,260 | `AADT` | ❌ no public incidents feed |
| UT (UDOT) | `services.arcgis.com/pA2nEVnB6tquxgOW/.../AADT2024_Unrounded/FeatureServer/3` | polyline | 2024 | 4,574 | `AADT2024` (wide year cols) | Utah 511 (free key) |
| NM (NMDOT) | `services.arcgis.com/hOpd7wfnKm16p9D9/.../Traffic_Section_HPMS_2025_Submittal_of_2024_Data/FeatureServer/0` | polyline | 2024 | 78,283 | `AADT` | `Roadway_Incidents_Public_view/FeatureServer/0` (public) |

### Tier-4 final batch (IL/MI/MN/WI/NY — probed 2026-05-27 second round)

| State | Endpoint | Format | Year | Records | AADT field | Live API |
|-------|----------|--------|------|--------:|------------|----------|
| IL (IDOT) | `gis1.dot.illinois.gov/.../AdministrativeData/AADT_Historical/FeatureServer/2025` | polyline | 2015-25 mixed | 280,443 | `AADT` (with `AADT_YR` per-segment) | (separate probe — Lake Cook tollway) |
| MI (MDOT) | `mdotgis.state.mi.us/.../DataAccess/MdotAadtCaadt2023/FeatureServer/0` | polyline | 2023 | 24,500 | `Aadt` | MI Drive API (free key) |
| MN (MnDOT) | `webgis.dot.state.mn.us/65agsf1/.../AADT_SEGMENT_CURRENT/FeatureServer/0` | polyline | current (per `CURRENT_YEAR`) | 40,159 | `CURRENT_VOLUME` | 511MN (gated) |
| WI (WisDOT) | `dotmaps.wi.gov/.../agohub/TRAFFIC_COUNTS/MapServer/0` | point | 2024-mixed | 27,090 | `RDWY_AADT` | 511WI (free key) |
| NY (NYSDOT) | `gisportalny.dot.ny.gov/hostingny/.../Roadways/Traffic_Monitoring/FeatureServer/1` | polyline | per-segment latest | 174,842 statewide | `AADTLastAct` (+ `YearLastAct`) | 511NY (gated) |

**Net (Tier-4 + Tier-5):** All 21 previously-unwired states now have field-level-confirmed AADT endpoints. Wired into `fetch-aadt-by-signal.ts` via generic `polyline_bbox` + `point_bbox` config-driven handlers — adding a new state now = one ~15-line config block.

---

## Data file inventory

All persisted in `artifacts/api-server/src/data/`:

```
<slug>-signals.json     compact tuple [osmId, lat, lon, name|null, roadClass]
<slug>-roads.json       { classes: [...], ways: [[code, name, [[lat,lon]...]]...] }
<slug>-aadt.json        { "<signalId>": { aadt, year, kFactor, distM, source } }
<slug>-neighborhoods.geojson    GeoJSON FeatureCollection of named polygons

_osm-archive/<slug>-signals.json    pre-merge OSM baseline (audit trail)
```

Atlanta has additional enrichment files (`atlanta-accidents.json`,
`atlanta-parking.json`, `atlanta-calibration.json`,
`atlanta-prediction-history.json`) from years of in-house data work that
new metros don't yet have.

---

## Refresh procedure

### Quarterly: OSM signals + roads (Geofabrik)

```bash
# 1. Download fresh state PBFs into /tmp/geofabrik_pbf/
mkdir -p /tmp/geofabrik_pbf
for state in florida georgia tennessee north-carolina south-carolina \
             alabama virginia kentucky louisiana \
             district-of-columbia maryland pennsylvania new-york massachusetts \
             illinois michigan minnesota ohio indiana missouri wisconsin texas \
             california oregon washington nevada arizona colorado utah new-mexico; do
  curl -L -o "/tmp/geofabrik_pbf/${state}.osm.pbf" \
    "https://download.geofabrik.de/north-america/us/${state}-latest.osm.pbf"
done

# 2. Re-extract signals + roads per metro (uses osmium)
pnpm --filter @workspace/scripts exec tsx \
  scripts/src/fetch-from-geofabrik-pbf.ts

# 2b. ⚠ fetch-from-geofabrik-pbf.ts writes each metro from ONE state's PBF
# (last state wins), so multi-state metros lose their out-of-state side.
# new_york_metro (NJ side), washington_dc_metro (NoVA + suburban MD), and
# philadelphia_metro (South Jersey) are extended by an APPEND pass that
# preserves existing tuple ids (the AADT join key). Re-run it after any
# full re-extraction of those three metros, then the AADT supplements:
pnpm --filter @workspace/scripts exec tsx scripts/src/extend-region-coverage.ts
pnpm --filter @workspace/scripts exec tsx scripts/src/fetch-aadt-by-signal.ts \
  --supplement-only new-york philadelphia washington-dc

# 3. Refresh per-metro counts in atlanta-tis/src/data/metro-coverage.ts
pnpm --filter @workspace/scripts exec tsx \
  scripts/src/compute-metro-stats.ts > /tmp/metro-stats.json
```

The original Overpass-based `fetch-osm-signals.ts` and `fetch-osm-roads.ts`
scripts are kept for ad-hoc single-region pulls but Overpass is unreliable
under load. Geofabrik PBF path is the production refresh.

### Annual: AADT per state

```bash
pnpm --filter @workspace/scripts exec tsx \
  scripts/src/fetch-aadt-by-signal.ts --all
```

Pulls from FDOT/NCDOT/TDOT/VDOT/SCDOT for the regions configured in the
script. Per-region snap stats logged for verification.

### Annual: city-authoritative signal overlays

```bash
pnpm --filter @workspace/scripts exec tsx \
  scripts/src/fetch-city-signals.ts --all
```

### One-shot: neighborhood polygons

```bash
pnpm --filter @workspace/scripts exec tsx \
  scripts/src/fetch-neighborhoods.ts --all
```

### Live data (no refresh — pulled on-demand by api-server)

`ncdot-live.ts`, `fdot-live.ts`, `kytc-live.ts` cache for 60s in-process.
No refresh script — they fetch on first request after cache expiry.

---

## Known gaps

| Gap | Affected metros | Severity | Path to close |
|-----|-----------------|----------|---------------|
| AADT (Tier-5) | 14 metros (CA/OR/WA/NV/AZ/CO/UT/NM) | High for analyzer accuracy | Tier-5 endpoints starter list in "AADT endpoints" section; all 8 states publish open data, need wiring |
| AADT (Tier-4) | 20 metros (DC/MD/PA/NY/MA/IL/MI/MN/OH/IN/MO/WI/TX) | High for analyzer accuracy | **All 13 states now confirmed-public** — see "AADT endpoints (Tier-4/5 re-probed)" section. Wiring effort = extend `fetch-aadt-by-signal.ts` with per-state branches |
| AADT (legacy) | 10 metros (AL + KY + LA + GA-except-Atlanta) | High for analyzer accuracy | Scrape state PDF reports OR commercial data (StreetLight/INRIX) |
| Live incidents | 42 metros (everything except Atlanta + 7 wired DOTs) | Medium (analyzer still works) | OAuth registration where possible (AlgoTraffic, SunGuide), scraping otherwise |
| TMC (turning movements) | All except Atlanta | High for full TIS quality | Commercial (StreetLight, Replica) OR engineering-firm partnerships |
| Signal timings (cycle/split/offset) | All except Atlanta | Medium for full TIS quality | City DOT relationships per metro |
| Per-signal accident history | All except Atlanta | Low (TIS engine takes user input) | FARS snap + local crash DB per metro (deferred) |

---

## Module map

```
artifacts/api-server/src/lib/
├── atlanta-*.ts             (Atlanta-only — legacy rich path)
├── regional-intersections.ts (consumes signals + AADT + neighborhoods + roads naming → IntersectionSummary[])
├── regional-signal-naming.ts (point-in-polygon road naming, per-region cache)
├── regional-zones.ts         (point-in-polygon neighborhood lookup)
├── ncdot-live.ts             (NCDOT TIMS — Charlotte + Raleigh-Durham + 5 more NC metros)
├── fdot-live.ts              (FDOT DIVAS — Tampa + Orlando + Miami + Jax + Pensacola)
└── kytc-live.ts              (KYTC Road Closures — Louisville)

artifacts/tis-api-server/src/lib/
├── regions.ts                (64-region registry, jurisdiction copy, getActiveRegion + regionForCoordinate)
└── tis.ts                    (engine; derives region from coords, plumbs Region into findings/mitigation language)

scripts/src/
├── fetch-from-geofabrik-pbf.ts   (production OSM refresh)
├── fetch-osm-signals.ts          (ad-hoc Overpass — unreliable under load)
├── fetch-osm-roads.ts            (same caveat)
├── fetch-city-signals.ts         (CDOT, Miami-Dade County, Orlando ITS, Raleigh, FDOT statewide)
├── fetch-aadt-by-signal.ts       (FDOT/NCDOT/TDOT/VDOT/SCDOT all five wired)
├── fetch-neighborhoods.ts        (6 metros with polygon data)
├── fetch-charlotte-cdot-signals.ts  (older one-off; superseded by fetch-city-signals)
├── fetch-miami-dade-county-signals.ts (older one-off; same)
├── compute-metro-stats.ts        (refreshes signals/namedPct for metro-coverage.ts)
└── smoke-test-multi-region.ts    (validates region resolution across all 64 metros)
```

---

## Smoke testing

```bash
pnpm --filter @workspace/scripts exec tsx \
  scripts/src/smoke-test-multi-region.ts
```

Validates:
1. `regionForCoordinate(lat, lon)` resolves the correct region for a known
   landmark in each of the 50 metros.
2. Each region carries a distinct, correct `dotName`, `planningOfficeName`,
   `parkingCodeCitation`.
3. `getActiveRegion(code)` round-trips + safely falls back to Atlanta on
   unknown / inactive codes.

Currently passes **67/67 assertions**. Run after any edit to `regions.ts`
— catches the common mistakes (coordinates outside bounds, jurisdiction
copy-paste, code typos).

---

## What the website surfaces

- `/` — home page has §04 Coverage section listing 13 Tier-A metros + a "Also indexed" strip for the rest.
- `/cities` — full coverage appendix (all 64) grouped by state.
- `/cities/<slug>` — 50 per-metro detail pages, each with provenance + sibling metros for nav.
- `/sitemap.xml` — lists all 65 city-related URLs at appropriate priorities (Tier-A at 0.85, Tier-B at 0.6).

Frontend data lives in
[`artifacts/atlanta-tis/src/data/metro-coverage.ts`](artifacts/atlanta-tis/src/data/metro-coverage.ts)
and must be kept in sync with this doc + the api-server's `regions.ts`
registry **by hand**. (A build-time generator could automate this —
deferred work.)
