/** Renders search hits as list items. All data goes through h(), i.e. into text nodes. */

import { formatDay } from "../dates";
import { h } from "../dom";
import { formatKm } from "../geo";
import type { Hit, LeafletView } from "../search";

const MAX_SIBLINGS = 5;

function external(href: string, label: string, description: string) {
  return h(
    "a",
    {
      href,
      target: "_blank",
      rel: "noopener noreferrer",
      "aria-label": `${label}: ${description}`,
    },
    label,
  );
}

function renderLeaflet(view: LeafletView, storeName: string): HTMLLIElement {
  const { leaflet, closedDays, specialHours, siblings } = view;
  const more = siblings.length - MAX_SIBLINGS;
  return h(
    "li",
    { class: "leaflet" },
    h(
      "p",
      { class: "leaflet__head" },
      h("span", { class: view.label === "Diese Woche" ? "badge badge--now" : "badge" }, view.label),
      " ",
      h("span", { class: "leaflet__range" }, view.range),
    ),
    h(
      "p",
      { class: "leaflet__links" },
      external(leaflet.viewer, "Prospekt ansehen", `Extra-Angebote ${storeName}, ${view.range}`),
      external(leaflet.pdf, "PDF", `Extra-Angebote ${storeName}, ${view.range}`),
    ),
    view.unusable
      ? h("p", { class: "notice notice--warn" }, "Filiale in diesem Zeitraum geschlossen.")
      : closedDays.length > 0 &&
          h(
            "p",
            { class: "notice notice--warn" },
            `Geschlossen am ${closedDays.map(formatDay).join(", ")}`,
          ),
    specialHours.length > 0 &&
      h(
        "p",
        { class: "notice" },
        "Sonderöffnungszeiten: ",
        specialHours.map((d) => `${formatDay(d.date)} ${d.open}–${d.close} Uhr`).join(", "),
      ),
    siblings.length > 0 &&
      h(
        "p",
        { class: "siblings" },
        "Gleicher Prospekt auch in: ",
        siblings
          .slice(0, MAX_SIBLINGS)
          .map((s) => `${s.name} (${s.plz})`)
          .join(", "),
        more > 0 && ` und ${more} weiteren`,
      ),
  );
}

export function renderHit(hit: Hit, onSelect: (id: string) => void, note?: string): HTMLLIElement {
  const { store } = hit;
  const headingId = `store-${store.id}`;
  return h(
    "li",
    { class: hit.closed ? "store store--closed" : "store", "data-id": store.id },
    h(
      "article",
      { "aria-labelledby": headingId },
      note && h("p", { class: "store__note" }, note),
      h(
        "h3",
        { class: "store__title", id: headingId },
        h(
          "button",
          {
            type: "button",
            class: "store__select",
            "aria-label": `${store.name} auf der Karte zeigen`,
            on: {
              click: () => {
                onSelect(store.id);
              },
            },
          },
          store.name,
        ),
        h("span", { class: "store__distance" }, formatKm(hit.distanceKm)),
      ),
      h("p", { class: "store__address" }, `${store.street}, ${store.plz} ${store.city}`),
      hit.closed && h("p", { class: "badge badge--closed" }, "Vorübergehend geschlossen"),
      h("ul", { class: "leaflets" }, ...hit.leaflets.map((l) => renderLeaflet(l, store.name))),
    ),
  );
}
