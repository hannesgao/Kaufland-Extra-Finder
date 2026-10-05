/** Renders search hits as Material-style cards. All data goes through h(), i.e. into text nodes. */

import { formatDay } from "../dates";
import { h } from "../dom";
import { formatKm } from "../geo";
import { icon } from "../icons";
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

/** "Ab | Donnerstag | (08.10.2026)" — three cells that line up across both chips. */
function validityChip(prefix: string, day: DayLabel): HTMLSpanElement {
  return h(
    "span",
    { class: "chip validity__chip", "aria-hidden": "true" },
    h("span", { class: "validity__prefix" }, prefix),
    h("span", null, day.weekday),
    h("span", { class: "validity__date" }, `(${day.date})`),
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

function renderLeaflet(view: LeafletView, storeName: string): HTMLLIElement {
  const { leaflet, closedDays, specialHours, siblings } = view;
  const more = siblings.length - MAX_SIBLINGS;
  const description = `Extra-Angebote ${storeName}, ${view.range}`;
  return h(
    "li",
    { class: "leaflet" },
    pdfWarning(view),
    h(
      "div",
      {
        class: `validity ${view.running ? "validity--now" : "validity--upcoming"}`,
        role: "group",
        "aria-label": `Gültig ${view.running ? "seit" : "ab"} ${view.from.weekday}, ${view.from.date}, bis ${view.to.weekday}, ${view.to.date}`,
      },
      validityChip(view.running ? "Seit" : "Ab", view.from),
      validityChip("Bis", view.to),
    ),
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
    siblings.length > 0 &&
      h(
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
      ),
    h(
      "div",
      { class: "leaflet__actions" },
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

export function renderHit(hit: Hit, onSelect: (id: string) => void, note?: string): HTMLLIElement {
  const { store } = hit;
  const headingId = `store-${store.id}`;
  const select = () => {
    onSelect(store.id);
  };
  return h(
    "li",
    {
      class: ["store", hit.closed && "store--closed", hit.foreignOnly && "store--foreign"]
        .filter(Boolean)
        .join(" "),
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
      hit.closed &&
        h("p", { class: "chip chip--closed" }, icon("event_busy"), "Vorübergehend geschlossen"),
      hit.foreignOnly &&
        h(
          "p",
          { class: "chip chip--foreign" },
          icon("warning"),
          "Extra-Prospekt einer anderen Filiale",
        ),
      h("ul", { class: "leaflets" }, ...hit.leaflets.map((l) => renderLeaflet(l, store.name))),
      h(
        "div",
        { class: "store__actions" },
        store.url &&
          externalButton(store.url, "Filialseite", store.name, "btn--text", "storefront"),
        h(
          "button",
          { type: "button", class: "btn btn--text", on: { click: select } },
          icon("map"),
          "Auf Karte zeigen",
        ),
      ),
    ),
  );
}

/** Compact row for the "Alle Extra-Filialen" list. */
export function renderRow(view: StoreView): HTMLLIElement {
  const { store } = view;
  const headingId = `row-${store.id}`;
  return h(
    "li",
    {
      class: ["row", view.closed && "row--closed", view.foreignOnly && "row--foreign"]
        .filter(Boolean)
        .join(" "),
      "data-id": store.id,
    },
    h("span", { class: "row__plz", "aria-hidden": "true" }, store.plz),
    h(
      "article",
      { class: "row__main", "aria-labelledby": headingId },
      h(
        "div",
        { class: "row__head" },
        h(
          "div",
          null,
          h("h3", { class: "row__title", id: headingId }, store.name),
          h("p", { class: "row__address" }, `${store.street}, ${store.plz} ${store.city}`),
        ),
        store.url &&
          externalButton(store.url, "Filialseite", store.name, "btn--text btn--xs", "storefront"),
      ),
      view.closed &&
        h("p", { class: "chip chip--closed" }, icon("event_busy"), "Vorübergehend geschlossen"),
      h(
        "ul",
        { class: "row__leaflets" },
        ...view.leaflets.map((l) => {
          const description = `Extra-Angebote ${store.name}, ${l.range}`;
          return h(
            "li",
            { class: "row__leaflet" },
            h(
              "span",
              { class: l.label === "Diese Woche" ? "chip chip--now" : "chip chip--upcoming" },
              l.label,
            ),
            h("span", { class: "leaflet__range" }, l.range),
            l.leaflet.pdfStoreMatch === false &&
              l.leaflet.pdfStore &&
              h(
                "span",
                { class: "row__foreign" },
                icon("warning"),
                `Laut PDF nur in ${l.leaflet.pdfStore}`,
              ),
            l.closedDays.length > 0 &&
              h(
                "span",
                { class: "row__warn" },
                icon("event_busy"),
                `geschlossen ${l.closedDays.map(formatDay).join(", ")}`,
              ),
            h(
              "span",
              { class: "row__links" },
              externalButton(
                l.leaflet.viewer,
                "Prospekt",
                description,
                "btn--tonal btn--xs",
                "open_in_new",
              ),
              externalButton(
                l.leaflet.pdf,
                "PDF",
                description,
                "btn--outlined btn--xs",
                "download",
              ),
            ),
          );
        }),
      ),
    ),
  );
}
