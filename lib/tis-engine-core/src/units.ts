// Unit conversions shared by the engine and the browser.
//
// Every road file stores OSM maxspeed in km/h (the extractors convert "N mph"
// tags on write), while the routers' free-flow times and class-default speeds
// are in mph. Both routers — tis-api-server network-assignment.ts buildGraph and
// atlanta-tis study-map-sim.ts buildRoadGraph — divide by this one constant, so
// the engine's paths and the live map's paths cannot drift apart on units.

/** km/h in one mph (exact: the international mile is 1.609344 km). */
export const KMH_PER_MPH = 1.609344;
