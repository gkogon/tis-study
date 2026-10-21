/**
 * The one place the site renders a Leaflet TileLayer. Every map puts
 * <BasemapLayers kind="light" | "dark" | "satellite" | "street" /> inside its
 * MapContainer, and this draws that basemap's layers from src/lib/basemap.ts,
 * base first and labels on top. `pnpm run check:basemap-tiles` holds every
 * map under src/ to it.
 */
import type { LeafletEvent, TileLayer as LeafletTileLayer } from "leaflet";
import { TileLayer } from "react-leaflet";
import { BASEMAPS, type BasemapKind } from "@/lib/basemap";

// After a zoom, Leaflet keeps the previous level's tiles under the new ones
// until the new ones have faded in (200 ms), then drops them from its fade
// loop. That loop skips the drop when every new tile turns opaque in the same
// frame, which happens whenever frames are slow (the /cities/:slug signal map
// redraws a canvas every frame), and the old level then stays until the next
// pan. Under an opaque base that is invisible, but a labels layer is
// transparent, so the old level's labels stay on screen, scaled up, behind the
// new ones. Once a layer has loaded and its fade is over, two opacity passes
// make Leaflet drop them: the first marks the faded tiles active, the second
// finds them active and prunes the stale level.
function dropStaleZoomLevels(e: LeafletEvent) {
  const layer = e.target as LeafletTileLayer;
  window.setTimeout(() => {
    const opacity = layer.options.opacity ?? 1;
    layer.setOpacity(opacity);
    layer.setOpacity(opacity);
  }, 250);
}
const TILE_EVENTS = { load: dropStaleZoomLevels };

export function BasemapLayers({ kind }: { kind: BasemapKind }) {
  return (
    <>
      {BASEMAPS[kind].map((layer) => (
        <TileLayer key={layer.url} url={layer.url} attribution={layer.attribution} maxNativeZoom={layer.maxNativeZoom} maxZoom={layer.maxZoom} eventHandlers={TILE_EVENTS} />
      ))}
    </>
  );
}
