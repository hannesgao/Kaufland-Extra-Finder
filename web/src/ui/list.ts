/**
 * Store cards (radius search) and rows (all stores). Both share the leaflet panel, so dates,
 * warnings and buttons look the same in both tabs. All data goes through h() into text nodes.
 */

import { formatDay } from "../dates";
import { h } from "../dom";
import { formatKm } from "../geo";
import { icon } from "../icons";
import type { Store } from "../data";
import type { DayLabel, Hit, LeafletView, StoreView } from "../search";

const MAX_SIBLINGS = 5;

function externalButton(
  href: string,
  label: string,
  description: string,
  variant: string,
  iconName: Parameters<typeof icon>[0],
) {
  return h(
    "a",
    {
      class: `btn btn--sm ${variant}`,
      href,
      target: "_blank",
      rel: "noopener noreferrer",
      "aria-label": `${label}: ${description} (neues Fenster)`,
    },
    icon(iconName),
    label,
  );
}

/** "Neuester Extra-Prospekt ab | Donnerstag | (08.10.2026)" — cells line up across both chips. */
function validityChip(prefix: string, day: DayLabel): HTMLSpanElement {
  return h(
    "span",
    { class: "chip validity__chip", "aria-hidden": "true" },
    h("span", { class: "validity__prefix" }, prefix),
    h("span", null, day.weekday),
    h("span", { class: "validity__date" }, `(${day.date})`),
  );
}

function validity(view: LeafletView): HTMLDivElement {
  const { heading, from, to } = view;
  return h(
    "div",
    {
      class: `validity ${view.running ? "validity--now" : "validity--upcoming"}`,
      role: "group",
      "aria-label": `${heading} ${from.weekday}, ${from.date}, bis ${to.weekday}, ${to.date}`,
    },
    validityChip(heading, from),
    validityChip("bis", to),
  );
}

/** Prominent notice when the PDF itself names a different store. */
function pdfWarning(view: LeafletView): HTMLDivElement | false {
  const { pdfStore, pdfStoreMatch } = view.leaflet;
  if (pdfStoreMatch !== false || !pdfStore) return false;
  return h(
    "div",
    { class: "pdf-warning", role: "note" },
    icon("warning", "icon pdf-warning__icon"),
    h(
      "div",
      null,
      h(
        "p",
        { class: "pdf-warning__title" },
        "Achtung: Laut PDF gilt dieser Extra-Prospekt nicht für diese Filiale.",
      ),
      h("p", { class: "pdf-warning__text" }, `Im PDF steht: „NUR IN ${pdfStore}“`),
    ),
  );
}

function siblingsCard(view: LeafletView): HTMLElement | false {
  const { siblings } = view;
  if (siblings.length === 0) return false;
  const more = siblings.length - MAX_SIBLINGS;
  return h(
    "section",
    { class: "siblings", "aria-label": "Gleicher Extra-Prospekt auch in" },
    h("h4", { class: "siblings__title" }, icon("info"), "Gleicher Extra-Prospekt auch in"),
    h(
      "ul",
      { class: "siblings__list" },
      ...siblings
        .slice(0, MAX_SIBLINGS)
        .map((s) =>
          h(
            "li",
            { class: "siblings__item" },
            icon("storefront"),
            h(
              "span",
              null,
              h("span", { class: "siblings__name" }, s.name),
              h("span", { class: "siblings__place" }, `${s.plz} ${s.city}`),
            ),
          ),
        ),
      more > 0 &&
        h(
          "li",
          { class: "siblings__more" },
          `und ${String(more)} ${more === 1 ? "weitere Filiale" : "weitere Filialen"}`,
        ),
    ),
  );
}

/** One leaflet: warning, dates, closures, (siblings), buttons. Same panel in cards and rows. */
function leafletPanel(view: LeafletView, storeName: string, withSiblings: boolean): HTMLLIElement {
  const { leaflet, closedDays, specialHours } = view;
  const description = `Extra-Angebote ${storeName}, ${view.range}`;
  return h(
    "li",
    { class: "leaflet" },
    pdfWarning(view),
    validity(view),
    view.unusable
      ? h(
          "p",
          { class: "notice notice--error" },
          icon("event_busy"),
          "Filiale in diesem Zeitraum geschlossen.",
        )
      : closedDays.length > 0 &&
          h(
            "p",
            { class: "notice notice--error" },
            icon("event_busy"),
            `Geschlossen am ${closedDays.map(formatDay).join(", ")}`,
          ),
    specialHours.length > 0 &&
      h(
        "p",
        { class: "notice" },
        icon("schedule"),
        "Sonderöffnungszeiten: ",
        specialHours.map((d) => `${formatDay(d.date)} ${d.open}–${d.close} Uhr`).join(", "),
      ),
    withSiblings && siblingsCard(view),
    h(
      "div",
      { class: "actions" },
      externalButton(
        leaflet.viewer,
        "Extra-Prospekt ansehen",
        description,
        "btn--tonal",
        "open_in_new",
      ),
      externalButton(leaflet.pdf, "PDF", description, "btn--outlined", "download"),
    ),
  );
}

/** Store-level chips shared by cards and rows. */
function storeChips(view: StoreView) {
  return [
    view.closed &&
      h("p", { class: "chip chip--closed" }, icon("event_busy"), "Vorübergehend geschlossen"),
    view.foreignOnly &&
      h(
        "p",
        { class: "chip chip--foreign" },
        icon("warning"),
        "Extra-Prospekt einer anderen Filiale",
      ),
  ];
}

/** Store-level buttons, styled and aligned like the leaflet buttons above them. */
function storeActions(store: Store, onShowOnMap?: () => void): HTMLDivElement {
  return h(
    "div",
    { class: "actions store__actions" },
    store.url &&
      externalButton(store.url, "Filialseite", store.name, "btn--outlined", "storefront"),
    onShowOnMap &&
      h(
        "button",
        { type: "button", class: "btn btn--sm btn--outlined", on: { click: onShowOnMap } },
        icon("map"),
        "Auf Karte zeigen",
      ),
  );
}

function classes(...names: (string | false)[]): string {
  return names.filter(Boolean).join(" ");
}

export function renderHit(hit: Hit, onSelect: (id: string) => void, note?: string): HTMLLIElement {
  const { store } = hit;
  const headingId = `store-${store.id}`;
  const select = () => {
    onSelect(store.id);
  };
  return h(
    "li",
    {
      class: classes("store", hit.closed && "store--closed", hit.foreignOnly && "store--foreign"),
      "data-id": store.id,
    },
    h(
      "article",
      { class: "store__body", "aria-labelledby": headingId },
      note && h("p", { class: "store__note" }, icon("near_me"), note),
      h(
        "div",
        { class: "store__header" },
        icon("storefront", "icon store__avatar"),
        h(
          "div",
          { class: "store__heading" },
          h(
            "h3",
            { class: "store__title", id: headingId },
            h(
              "button",
              {
                type: "button",
                class: "store__select",
                title: "Auf der Karte zeigen",
                on: { click: select },
              },
              store.name,
            ),
          ),
          h("p", { class: "store__address" }, `${store.street}, ${store.plz} ${store.city}`),
        ),
        h(
          "span",
          { class: "chip chip--distance", "aria-label": `Entfernung ${formatKm(hit.distanceKm)}` },
          icon("location_on"),
          formatKm(hit.distanceKm),
        ),
      ),
      ...storeChips(hit),
      h("ul", { class: "leaflets" }, ...hit.leaflets.map((l) => leafletPanel(l, store.name, true))),
      storeActions(store, select),
    ),
  );
}

/** Row for the "Alle Extra-Filialen" list: same panels and buttons as the cards, no map. */
export function renderRow(view: StoreView): HTMLLIElement {
  const { store } = view;
  const headingId = `row-${store.id}`;
  return h(
    "li",
    {
      class: classes("row", view.closed && "row--closed", view.foreignOnly && "row--foreign"),
      "data-id": store.id,
    },
    h("span", { class: "row__plz", "aria-hidden": "true" }, store.plz),
    h(
      "article",
      { class: "row__main", "aria-labelledby": headingId },
      h("h3", { class: "row__title", id: headingId }, store.name),
      h("p", { class: "row__address" }, `${store.street}, ${store.plz} ${store.city}`),
      ...storeChips(view),
      h(
        "ul",
        { class: "leaflets" },
        ...view.leaflets.map((l) => leafletPanel(l, store.name, false)),
      ),
      storeActions(store),
    ),
  );
}
