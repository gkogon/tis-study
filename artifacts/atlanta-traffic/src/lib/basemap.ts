/**
 * Every basemap tile layer the analyzer draws, in one place.
 * <BasemapLayers kind="…" /> (src/components/basemap-layers.tsx) renders
 * them, and `pnpm run check:basemap-tiles` fails if a TileLayer or a tile
 * URL turns up anywhere else under src/. It mirrors the TIS website's
 * artifacts/atlanta-tis/src/lib/basemap.ts (light and dark only).
 *
 * light and dark are Esri's ArcGIS Online Canvas basemaps (World Light Gray
 * and World Dark Gray): a muted base, with the matching Reference layer of
 * place and road labels on top. They need no API key. They replaced CARTO
 * (light_all, dark_all) and OpenStreetMap's own tile server: since
 * 2026-10-13 CARTO answers every keyless request with an "API KEY REQUIRED"
 * watermark tile, and OpenStreetMap's own tile server answers us 418 "Access
 * blocked" (its usage policy excludes production apps).
 *
 * Esri tile URLs run {z}/{y}/{x}, row before column: the reverse of the
 * {z}/{x}/{y} order CARTO and OSM use. The Canvas services have real tiles
 * only to zoom 16 and answer deeper zooms with a "Map data not yet
 * available" tile, so their layers stop at maxNativeZoom 16 and Leaflet
 * upscales z16 from there to maxZoom 20.
 */

export type BasemapKind = "light" | "dark";

export type BasemapLayer = {
  /** Leaflet URL template. Esri's order is {z}/{y}/{x}. */
  url: string;
  /** HTML for the map's attribution control (Leaflet shows identical credits once). */
  attribution: string;
  /** The deepest zoom the service has real tiles for; Leaflet upscales past it. */
  maxNativeZoom: number;
  maxZoom: number;
};

/**
 * "Powered by Esri" with Esri linked to esri.com, then the Canvas services'
 * own copyrightText (identical for all four services), per Esri's attribution
 * terms for its basemaps.
 */
export const ESRI_CANVAS_ATTRIBUTION =
  'Powered by <a href="https://www.esri.com/">Esri</a> | Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, and the GIS user community';

const CANVAS_NATIVE_MAX_ZOOM = 16;
const MAX_ZOOM = 20;

const canvas = (url: string): BasemapLayer => ({
  url,
  attribution: ESRI_CANVAS_ATTRIBUTION,
  maxNativeZoom: CANVAS_NATIVE_MAX_ZOOM,
  maxZoom: MAX_ZOOM,
});

/** Each basemap's layers, bottom to top. */
export const BASEMAPS: Record<BasemapKind, readonly BasemapLayer[]> = {
  light: [
    canvas("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"),
    canvas("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}"),
  ],
  dark: [
    canvas("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"),
    canvas("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"),
  ],
};
