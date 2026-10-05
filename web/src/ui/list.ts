/**
 * One store card for both tabs (radius search and all stores). They differ only in the leading
 * element (store icon + distance vs. PLZ badge) and the second store button. All data goes through
 * h() into text nodes.
 */

import { formatDay } from "../dates";
import { h } from "../dom";
import { formatKm } from "../geo";
import { icon } from "../icons";
import type { DayView, Hit, LeafletView, StoreView } from "../search";

const MAX_SIBLINGS = 5;
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function classes(...names: (string | false)[]): string {
  return names.filter(Boolean).join(" ");
}

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

/* ---------- Calendar (one per store) ---------- */

function dayNote(day: DayView): string {
  if (day.closed) return "zu";
  return day.hours ?? (day.today ? "heute" : "");
}

function dayCell(day: DayView | null): HTMLSpanElement {
  if (!day) return h("span", { class: "cal__day cal__day--empty" });
  return h(
    "span",
    {
      class: classes(
        "cal__day",
        day.tone !== null && `is-valid tone-${day.tone}`,
        day.today && "is-today",
        day.closed && "is-closed",
        day.hours !== undefined && "is-special",
        day.sunday && "is-sunday",
      ),
    },
    h("span", { class: "cal__date" }, day.day),
    h("span", { class: "cal__note" }, dayNote(day)),
  );
}

/**
 * From today: one row per week (Mo–So) up to the end of the last leaflet. Days of a running leaflet
 * are green, days of an upcoming one blue — the same colours as the leaflet titles below.
 * Visual only: the leaflet headers and the hidden summary carry the same facts.
 */
function calendar(view: StoreView): HTMLDivElement {
  return h(
    "div",
    { class: "cal", "aria-hidden": "true" },
    h(
      "div",
      { class: "cal__row cal__row--head" },
      h("span", { class: "cal__kw" }),
      ...WEEKDAYS.map((d) => h("span", { class: "cal__weekday" }, d)),
    ),
    ...view.weeks.map((week) =>
      h(
        "div",
        { class: "cal__row" },
        h("span", { class: "cal__kw" }, `KW ${String(week.kw)}`),
        ...week.days.map(dayCell),
      ),
    ),
  );
}

/** Closures and special hours as text for screen readers (the calendar is aria-hidden). */
function calendarSummary(view: StoreView): HTMLParagraphElement | false {
  const days = view.weeks.flatMap((w) => w.days).filter((d): d is DayView => d !== null);
  const closed = days.filter((d) => d.closed).map((d) => formatDay(d.iso));
  const special = days
    .filter((d) => d.hours)
    .map((d) => `${formatDay(d.iso)} ${d.hours ?? ""} Uhr`);
  if (closed.length === 0 && special.length === 0) return false;
  return h(
    "p",
    { class: "visually-hidden" },
    closed.length > 0 && `Geschlossen am ${closed.join(", ")} `, // dates end with "."
    special.length > 0 && `Sonderöffnungszeiten: ${special.join(", ")}.`,
  );
}

/* ---------- Leaflet panel ---------- */

/** Title (in the leaflet's calendar colour), then "Gültig von … bis …" and the relative time. */
function leafletHeader(view: LeafletView): HTMLDivElement {
  return h(
    "div",
    { class: `lp-head tone-${view.tone}` },
    h("p", { class: "lp-head__title" }, view.heading),
    h(
      "div",
      { class: "lp-head__line" },
      h("p", { class: "lp-head__range" }, view.rangeText),
      h("span", { class: "chip lp-head__relative" }, view.relative),
    ),
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

/** One leaflet: warning, dates, siblings, buttons. */
function leafletPanel(view: LeafletView, storeName: string): HTMLLIElement {
  const description = `Extra-Angebote ${storeName}, ${view.range}`;
  return h(
    "li",
    { class: "leaflet" },
    pdfWarning(view),
    leafletHeader(view),
    view.unusable &&
      h(
        "p",
        { class: "notice notice--error" },
        icon("event_busy"),
        "Filiale in diesem Zeitraum geschlossen.",
      ),
    siblingsCard(view),
    h(
      "div",
      { class: "actions" },
      externalButton(
        view.leaflet.viewer,
        "Extra-Prospekt ansehen",
        description,
        "btn--tonal",
        "open_in_new",
      ),
      externalButton(view.leaflet.pdf, "PDF", description, "btn--outlined", "download"),
    ),
  );
}

/* ---------- Store card ---------- */

export interface CardOptions {
  /** Radius search: distance chip next to the name; otherwise the PLZ badge leads. */
  distanceKm?: number;
  /** Second store button: "Auf Karte zeigen" (search) or "In Umkreissuche zeigen" (list). */
  action: { label: string; icon: Parameters<typeof icon>[0]; onClick: () => void };
  /** Click on the store name (search: select on the map). */
  onTitleClick?: () => void;
  note?: string;
}

export function renderStoreCard(view: StoreView, options: CardOptions): HTMLLIElement {
  const { store } = view;
  const headingId = `store-${store.id}`;
  const { distanceKm, action, onTitleClick, note } = options;
  const lead =
    distanceKm === undefined
      ? h("span", { class: "store__plz", "aria-hidden": "true" }, store.plz)
      : icon("storefront", "icon store__avatar");
  return h(
    "li",
    {
      class: classes("store", view.closed && "store--closed", view.foreignOnly && "store--foreign"),
      "data-id": store.id,
    },
    h(
      "article",
      { class: "store__body", "aria-labelledby": headingId },
      note && h("p", { class: "store__note" }, icon("near_me"), note),
      h(
        "div",
        { class: "store__header" },
        lead,
        h(
          "div",
          { class: "store__heading" },
          h(
            "h3",
            { class: "store__title", id: headingId },
            onTitleClick
              ? h(
                  "button",
                  {
                    type: "button",
                    class: "store__select",
                    title: "Auf der Karte zeigen",
                    on: { click: onTitleClick },
                  },
                  store.name,
                )
              : store.name,
          ),
          h("p", { class: "store__address" }, `${store.street}, ${store.plz} ${store.city}`),
        ),
        distanceKm !== undefined &&
          h(
            "span",
            { class: "chip chip--distance", "aria-label": `Entfernung ${formatKm(distanceKm)}` },
            icon("location_on"),
            formatKm(distanceKm),
          ),
      ),
      view.closed &&
        h("p", { class: "chip chip--closed" }, icon("event_busy"), "Vorübergehend geschlossen"),
      view.foreignOnly &&
        h(
          "p",
          { class: "chip chip--foreign" },
          icon("warning"),
          "Extra-Prospekt einer anderen Filiale",
        ),
      calendar(view),
      calendarSummary(view),
      h("ul", { class: "leaflets" }, ...view.leaflets.map((l) => leafletPanel(l, store.name))),
      h(
        "div",
        { class: "actions store__actions" },
        store.url &&
          externalButton(store.url, "Filialseite", store.name, "btn--outlined", "storefront"),
        h(
          "button",
          { type: "button", class: "btn btn--sm btn--outlined", on: { click: action.onClick } },
          icon(action.icon),
          action.label,
        ),
      ),
    ),
  );
}

/** Radius search card: store icon, distance, "Auf Karte zeigen". */
export function renderHit(hit: Hit, onSelect: (id: string) => void, note?: string): HTMLLIElement {
  const select = () => {
    onSelect(hit.store.id);
  };
  return renderStoreCard(hit, {
    distanceKm: hit.distanceKm,
    action: { label: "Auf Karte zeigen", icon: "map", onClick: select },
    onTitleClick: select,
    ...(note !== undefined && { note }),
  });
}

/** "Alle Extra-Filialen" card: PLZ badge, "In Umkreissuche zeigen". */
export function renderRow(view: StoreView, onShowInSearch: (id: string) => void): HTMLLIElement {
  return renderStoreCard(view, {
    action: {
      label: "In Umkreissuche zeigen",
      icon: "near_me",
      onClick: () => {
        onShowInSearch(view.store.id);
      },
    },
  });
}
