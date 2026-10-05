/**
 * Leaflet map. Loaded lazily on the first search, so no tile request reaches OpenStreetMap
 * before the user searches.
 */

import type { CircleMarker, LayerGroup, Map as LeafletMap } from "leaflet";
import type { LatLng } from "../data";
import { h } from "../dom";
import type { Hit } from "../search";

export interface MapView {
  show(origin: LatLng, radiusKm: number, hits: readonly Hit[]): void;
  select(id: string | null): void;
}

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende';

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

  const style = (isSelected: boolean, closed: boolean) => ({
    radius: isSelected ? 11 : 8,
    weight: isSelected ? 3 : 2,
    color: cssVar("--map-marker-stroke"),
    fillColor: cssVar(closed ? "--map-marker-closed" : "--map-marker"),
    fillOpacity: 0.9,
  });

  return {
    show([lat, lng], radiusKm, hits) {
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
      for (const hit of hits) {
        const { store } = hit;
        const marker = L.circleMarker(
          [store.lat, store.lng],
          style(store.id === selected, hit.closed),
        )
          // Leaflet renders string content with innerHTML; pass an element so names stay text.
          .bindTooltip(h("span", null, store.name))
          .on("click", () => {
            onSelect(store.id);
          })
          .addTo(layers);
        markers.set(store.id, marker);
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
