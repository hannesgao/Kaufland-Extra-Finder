/**
 * Leaflet map. Loaded lazily on the first search, so no tile request reaches OpenStreetMap
 * before the user searches.
 */

import type { CircleMarker, LayerGroup, Map as LeafletMap } from "leaflet";
import type { LatLng } from "../data";
import { h } from "../dom";

/** A store on the map; `kind` picks the marker colour. */
export interface MapMarker {
  id: string;
  name: string;
  lat: number;
  lng: number;
  kind: "default" | "closed" | "foreign";
}

export interface MapView {
  show(origin: LatLng, radiusKm: number, markers: readonly MapMarker[]): void;
  select(id: string | null): void;
}

const MARKER_COLOUR: Record<MapMarker["kind"], string> = {
  default: "--map-marker",
  closed: "--map-marker-closed",
  foreign: "--map-marker-foreign",
};

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
// Static markup (Leaflet renders attribution strings as HTML); no data goes in here.
const ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">' +
  "OpenStreetMap</a>-Mitwirkende";

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export async function createMap(
  container: HTMLElement,
  onSelect: (id: string) => void,
): Promise<MapView> {
  const [L] = await Promise.all([import("leaflet"), import("leaflet/dist/leaflet.css")]);

  const map: LeafletMap = L.map(container, { scrollWheelZoom: false });
  // Leaflet's default prefix links to leafletjs.com; keep only the required OSM credit.
  map.attributionControl.setPrefix(false);
  L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);

  const layers: LayerGroup = L.layerGroup().addTo(map);
  const markers = new Map<string, CircleMarker>();
  let selected: string | null = null;

  const style = (isSelected: boolean, marker: MapMarker) => ({
    radius: isSelected ? 11 : 8,
    weight: isSelected ? 3 : 2,
    color: cssVar("--map-marker-stroke"),
    fillColor: cssVar(MARKER_COLOUR[marker.kind]),
    fillOpacity: 0.9,
  });

  return {
    show([lat, lng], radiusKm, points) {
      const origin: [number, number] = [lat, lng];
      layers.clearLayers();
      markers.clear();
      L.circle(origin, {
        radius: radiusKm * 1000,
        color: cssVar("--map-radius"),
        weight: 1,
        fillOpacity: 0.05,
        interactive: false,
      }).addTo(layers);
      L.circleMarker(origin, {
        radius: 6,
        weight: 2,
        color: cssVar("--map-marker-stroke"),
        fillColor: cssVar("--map-origin"),
        fillOpacity: 1,
        interactive: false,
      }).addTo(layers);

      // Computed from coordinates: Circle#getBounds() needs a map that already has a view.
      const bounds = L.latLng(origin).toBounds(radiusKm * 2000);
      for (const point of points) {
        const marker = L.circleMarker([point.lat, point.lng], style(point.id === selected, point))
          // Leaflet renders string content with innerHTML; pass an element so names stay text.
          .bindTooltip(h("span", null, point.name))
          .on("click", () => {
            onSelect(point.id);
          })
          .addTo(layers);
        markers.set(point.id, marker);
        bounds.extend(marker.getLatLng());
      }
      map.invalidateSize();
      map.fitBounds(bounds, { padding: [16, 16] });
    },

    select(id) {
      for (const [storeId, marker] of markers) {
        const isSelected = storeId === id;
        marker.setRadius(isSelected ? 11 : 8).setStyle({ weight: isSelected ? 3 : 2 });
        if (isSelected) {
          marker.bringToFront();
          map.panTo(marker.getLatLng());
        }
      }
      selected = id;
    },
  };
}
