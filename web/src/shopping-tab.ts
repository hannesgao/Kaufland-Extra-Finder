/**
 * The "Einkaufszettel" tab: choose a store, pick from its offers, edit the list, print it.
 * Loaded when the tab is first shown. The list is kept in local storage (see `shopping.ts`).
 */

import { DataError, type IsoDate, type PlzIndex } from "./data";
import {
  berlinToday,
  formatDate,
  formatDay,
  formatRange,
  formatStamp,
  isoWeek,
  weekdayShort,
} from "./dates";
import { h, replaceChildren } from "./dom";
import { formatKm } from "./geo";
import { icon, type IconName } from "./icons";
import {
  departmentCounts,
  groupCounts,
  filterOffers,
  findStores,
  loadOfferCatalog,
  loadOfferIndex,
  loadStoreFile,
  nearestStores,
  OFFER_SORTS,
  offerWeeks,
  startDays,
  storeOffers,
  type Offer,
  type OfferCatalog,
  type OfferFilter,
  type OfferIndex,
  type OfferSort,
  type OfferStore,
  type OfferWeek,
  type StoreChoice,
} from "./offers";
import {
  addOffer,
  addText,
  clearList,
  groupItems,
  hasOffer,
  isFull,
  itemStatus,
  LAYOUTS,
  loadList,
  planTrips,
  MAX_ITEMS,
  MAX_TEXT,
  refreshOffer,
  removeItem,
  removeOffer,
  saveList,
  setLayout,
  setNote,
  setQuantity,
  setStore,
  type Layout,
  type ListItem,
  type ShoppingList,
  type Trip,
} from "./shopping";
import { setupSelect, type SelectOption } from "./ui/select";
import {
  departmentIcon,
  renderGroupTitle,
  renderItem,
  renderOfferTile,
  renderSheet,
  tripText,
  type ItemHandlers,
} from "./ui/shopping";

export interface ShoppingContext {
  /** Site base path, with trailing slash. */
  base: string;
  plz: PlzIndex;
  /** The PLZ of the other tabs' search, to suggest nearby stores. */
  currentPlz(): string | null;
  /** Called with the number of entries whenever the list changes. */
  onCount(count: number): void;
  now(): Date;
}

export interface ShoppingTab {
  /** The tab became visible. */
  show(): void;
}

const PAGE_SIZE = 48;
const STORE_CHOICES = 6;
type View = "angebote" | "zettel";

const SORT_LABELS: Record<OfferSort, string> = { rabatt: "Rabatt", preis: "Preis", name: "Name" };
const LAYOUT_LABELS: Record<Layout, string> = { kacheln: "Kacheln", liste: "Liste" };
const ALL_DEPARTMENTS = "";
const ALL_GROUPS = "";
const ALL_DAYS = "";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function newId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${String(Date.now())}-${String(Math.random()).slice(2)}`;
}

function banner(symbol: IconName, extra = ""): { box: HTMLDivElement; text: HTMLParagraphElement } {
  const text = h("p", { role: "status", "aria-live": "polite" });
  const box = h(
    "div",
    { class: `banner ${extra}`.trim() },
    icon(symbol, "icon banner__icon"),
    text,
  );
  return { box, text };
}

/** Radio buttons in the outlined pill used by the other tabs. */
function segmented<T extends string>(
  legend: string,
  name: string,
  onChange: (value: T) => void,
): {
  field: HTMLFieldSetElement;
  set(options: readonly { value: T; label: string; detail?: string }[], value: T): void;
} {
  const group = h("div", { class: "segmented__group" });
  const field = h(
    "fieldset",
    { class: "outlined segmented" },
    h("legend", { class: "outlined__label" }, legend),
    group,
  );
  field.addEventListener("change", (event) => {
    const input = event.target;
    if (input instanceof HTMLInputElement && input.checked) onChange(input.value as T);
  });
  return {
    field,
    set(options, value) {
      group.style.gridTemplateColumns = `repeat(${String(options.length)}, minmax(0, 1fr))`;
      replaceChildren(
        group,
        ...options.map((option) =>
          h(
            "label",
            { class: "segment" },
            h("input", {
              type: "radio",
              name,
              value: option.value,
              ...(option.value === value && { checked: true }),
            }),
            icon("check", "icon segment__check"),
            option.label,
            // Shown where there is room for it; see `.segment__detail`.
            option.detail && h("span", { class: "segment__detail" }, option.detail),
          ),
        ),
      );
    },
  };
}

/** Calendar weeks are short enough for three segments on a phone; the days follow when there is room. */
function weekOption(week: OfferWeek): { value: IsoDate; label: string; detail: string } {
  return {
    value: week.monday,
    label: `KW\u00a0${String(isoWeek(week.monday))}`,
    // "09.–14.11.", or "30.11.–05.12." across two months
    detail: `${week.from.slice(5, 7) === week.to.slice(5, 7) ? `${week.from.slice(8)}.` : formatDay(week.from)}–${formatDay(week.to)}`,
  };
}

export function mountShopping(root: HTMLElement, ctx: ShoppingContext): ShoppingTab {
  let list: ShoppingList = loadList(storage());
  let stored = true;
  let index: OfferIndex | null | undefined;
  let catalog: OfferCatalog | undefined;
  let offers: Offer[] | null = null;
  let offersFor: string | null = null;
  let byKey: Map<string, Offer> | null = null;
  let view: View = list.items.length ? "zettel" : "angebote";
  let choosing = list.store === null;
  let shown = PAGE_SIZE;
  let confirmClear = false;
  const filter: OfferFilter = {
    query: "",
    department: null,
    group: null,
    week: null,
    start: null,
    sort: "rabatt",
  };

  const today = (): IsoDate => berlinToday(ctx.now());

  // ---------- Store ----------
  const storeSummary = h("div", { class: "zstore__current" });
  const storeInput = h("input", {
    id: "zstore-input",
    type: "text",
    autocomplete: "off",
    placeholder: " ",
    maxlength: "60",
  });
  const storeResults = h("ul", { class: "zstore__results", "aria-label": "Filialen zur Auswahl" });
  const storeHint = h("p", { class: "supporting-text" });
  const storeChooser = h(
    "div",
    { class: "zstore__chooser" },
    h(
      "div",
      { class: "text-field" },
      storeInput,
      h("label", { for: "zstore-input" }, "PLZ, Ort oder Filiale"),
    ),
    storeHint,
    storeResults,
  );
  const storeCard = h(
    "section",
    { class: "card search-card zstore", "aria-label": "Filiale für den Einkaufszettel" },
    storeSummary,
    storeChooser,
  );

  // ---------- Views ----------
  const viewSwitch = segmented<View>("Ansicht", "zettel-view", (value) => {
    view = value;
    render();
  });
  viewSwitch.field.classList.add("zviews");

  // ---------- Offers ----------
  const searchInput = h("input", {
    id: "zsearch",
    type: "search",
    autocomplete: "off",
    placeholder: " ",
    maxlength: "60",
  });
  const weekSwitch = segmented<IsoDate>("Woche", "zettel-week", (value) => {
    filter.week = value;
    filter.start = null;
    shown = PAGE_SIZE;
    renderOffers();
  });
  // The day the price starts to apply: what is new on Thursday or Friday.
  const startSwitch = segmented<string>("Gültig ab", "zettel-start", (value) => {
    filter.start = value === ALL_DAYS ? null : value;
    shown = PAGE_SIZE;
    renderOffers();
  });
  const sortSwitch = segmented<OfferSort>("Sortierung", "zettel-sort", (value) => {
    filter.sort = value;
    shown = PAGE_SIZE;
    renderOffers();
  });
  const departmentRoot = h("div", { id: "zettel-department" });
  const departmentSelect = setupSelect(departmentRoot, "Kategorie", (value) => {
    filter.department = value === ALL_DEPARTMENTS ? null : value;
    filter.group = null;
    shown = PAGE_SIZE;
    renderOffers();
  });
  // Groups of the chosen department, e.g. the kinds of meat.
  const groupList = h("div", { class: "zsub__list" });
  const groupField = h(
    "fieldset",
    { class: "zsub", hidden: true },
    h("legend", { class: "visually-hidden" }, "Gruppe innerhalb der Kategorie"),
    groupList,
  );
  groupField.addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.checked) return;
    filter.group = input.value === ALL_GROUPS ? null : input.value;
    shown = PAGE_SIZE;
    renderOffers();
  });
  const offersStatus = banner("sell");
  const offersAge = banner("schedule");
  const offerGrid = h("ol", { class: "zoffers", "aria-label": "Angebote der Filiale" });
  const moreButton = h(
    "button",
    {
      type: "button",
      class: "btn btn--tonal zoffers__more",
      on: {
        click: () => {
          shown += PAGE_SIZE;
          renderOffers();
        },
      },
    },
    icon("expand_more"),
    "Weitere Angebote anzeigen",
  );
  const offersView = h(
    "div",
    { class: "zview" },
    h(
      "section",
      { class: "card search-card zfilters", "aria-label": "Angebote filtern" },
      h(
        "div",
        { class: "text-field" },
        searchInput,
        h("label", { for: "zsearch" }, "Angebot suchen"),
      ),
      // The date filters share a row; those with nothing to choose are hidden.
      h("div", { class: "zfilters__row" }, weekSwitch.field, startSwitch.field),
      h(
        "div",
        { class: "zfilters__row" },
        h(
          "fieldset",
          { class: "outlined select-field zfilters__department" },
          h("legend", { class: "outlined__label" }, "Kategorie"),
          departmentRoot,
        ),
        sortSwitch.field,
      ),
      groupField,
    ),
    h("div", { class: "status-bar" }, offersStatus.box, offersAge.box),
    offerGrid,
    moreButton,
  );

  // ---------- List ----------
  const textInput = h("input", {
    id: "ztext",
    type: "text",
    autocomplete: "off",
    placeholder: " ",
    maxlength: String(MAX_TEXT),
  });
  const textForm = h(
    "form",
    { class: "zadd", novalidate: true },
    h("div", { class: "text-field" }, textInput, h("label", { for: "ztext" }, "Eigener Eintrag")),
    h("button", { type: "submit", class: "btn btn--tonal" }, icon("add"), "Hinzufügen"),
  );
  const layoutSwitch = segmented<Layout>("Druckbild", "zettel-layout", (value) => {
    change(setLayout(list, value), false);
  });
  const printButton = h(
    "button",
    { type: "button", class: "btn btn--filled", on: { click: () => void print() } },
    icon("print"),
    "Drucken",
  );
  const clearSlot = h("div", { class: "zactions__clear" });
  const listStatus = banner("receipt_long");
  const storageNote = h("p", { class: "supporting-text zlist__storage" });
  const groups = h("div", { class: "zgroups" });
  const listView = h(
    "div",
    { class: "zview" },
    h(
      "section",
      { class: "card search-card zactions", "aria-label": "Einkaufszettel bearbeiten" },
      textForm,
      h("div", { class: "zactions__row" }, layoutSwitch.field, printButton, clearSlot),
      storageNote,
    ),
    h("div", { class: "status-bar status-bar--single" }, listStatus.box),
    groups,
  );

  const sheetHost = h("div", { class: "sheet-host", "aria-hidden": "true" });
  document.body.append(sheetHost);

  const missing = banner("info");
  missing.box.hidden = true;
  replaceChildren(
    root,
    h("h2", { class: "visually-hidden" }, "Einkaufszettel"),
    storeCard,
    missing.box,
    viewSwitch.field,
    offersView,
    listView,
  );

  // ---------- State changes ----------
  function change(next: ShoppingList, rerender = true): void {
    if (next === list) return;
    list = next;
    stored = saveList(storage(), list);
    ctx.onCount(list.items.length);
    if (rerender) render();
    else renderSheetOnly();
  }

  function keepFocus(action: () => void): void {
    const key =
      document.activeElement instanceof HTMLElement
        ? document.activeElement.dataset.focus
        : undefined;
    action();
    if (key)
      root.querySelector<HTMLElement>(`[data-focus="${CSS.escape(key)}"]:not(:disabled)`)?.focus();
  }

  const handlers: ItemHandlers = {
    onQuantity: (id, quantity) => {
      keepFocus(() => {
        change(setQuantity(list, id, quantity));
      });
    },
    onNote: (id, note) => {
      change(setNote(list, id, note), false);
    },
    onRemove: (id) => {
      change(removeItem(list, id));
    },
    onRefresh: (id, offer) => {
      change(refreshOffer(list, id, offer));
    },
  };

  function toggleOffer(offer: Offer): void {
    const next = hasOffer(list, offer.key)
      ? removeOffer(list, offer.key)
      : addOffer(list, offer, newId());
    if (next === list) return;
    list = next;
    stored = saveList(storage(), list);
    ctx.onCount(list.items.length);
    // Only the tile, the view switch and the sheet change: the grid keeps its scroll position.
    const tile = [...offerGrid.children].find(
      (el) => el instanceof HTMLElement && el.dataset.key === offer.key,
    );
    const fresh = renderOfferTile(
      offer,
      hasOffer(list, offer.key),
      isFull(list),
      today(),
      toggleOffer,
    );
    tile?.replaceWith(fresh);
    fresh.querySelector("button")?.focus();
    renderViewSwitch();
    renderSheetOnly();
  }

  // ---------- Rendering ----------
  function renderViewSwitch(): void {
    const count = list.items.length;
    viewSwitch.set(
      [
        { value: "angebote", label: "Angebote" },
        { value: "zettel", label: count ? `Mein Zettel (${String(count)})` : "Mein Zettel" },
      ],
      view,
    );
  }

  function renderStore(): void {
    const { store } = list;
    replaceChildren(
      storeSummary,
      icon("storefront", "icon zstore__icon"),
      h(
        "div",
        { class: "zstore__text" },
        h("p", { class: "zstore__label" }, "Deine Filiale"),
        store
          ? h("p", { class: "zstore__name" }, store.name)
          : h("p", { class: "zstore__name" }, "Noch keine Filiale gewählt"),
        h(
          "p",
          { class: "zstore__address" },
          store
            ? `${store.street}, ${store.plz} ${store.city}`
            : "Angebote und Preise unterscheiden sich je Filiale.",
        ),
      ),
      store &&
        index &&
        h(
          "button",
          {
            type: "button",
            class: "btn btn--sm btn--text",
            "aria-expanded": String(choosing),
            on: {
              click: () => {
                choosing = !choosing;
                renderStore();
                if (choosing) storeInput.focus();
              },
            },
          },
          icon(choosing ? "close" : "search"),
          choosing ? "Schließen" : "Filiale wechseln",
        ),
    );
    storeChooser.hidden = !choosing || !index;
    if (choosing && index) renderChoices();
  }

  function choices(): { found: StoreChoice[]; hint: string } {
    if (!index) return { found: [], hint: "" };
    const text = storeInput.value.trim();
    const plz = /^\d{5}$/.test(text) ? text : text === "" ? ctx.currentPlz() : null;
    const origin = plz ? ctx.plz.get(plz) : undefined;
    if (plz && origin) {
      return {
        found: nearestStores(index.stores, origin, STORE_CHOICES),
        hint: `Nächste Filialen zu PLZ ${plz}:`,
      };
    }
    if (/^\d{5}$/.test(text)) return { found: [], hint: `Die PLZ ${text} ist nicht bekannt.` };
    const found = findStores(index.stores, text, STORE_CHOICES);
    return {
      found,
      hint: found.length ? "Passende Filialen:" : "Keine passende Filiale gefunden.",
    };
  }

  function renderChoices(): void {
    const { found, hint } = choices();
    storeHint.textContent = hint;
    replaceChildren(
      storeResults,
      ...found.map(({ store, distanceKm }) =>
        h(
          "li",
          null,
          h(
            "button",
            {
              type: "button",
              class: `zstore__choice${store.id === list.store?.id ? " zstore__choice--current" : ""}`,
              on: { click: () => void chooseStore(store) },
            },
            h("span", { class: "zstore__choice-name" }, store.name),
            h(
              "span",
              { class: "zstore__choice-address" },
              `${store.street}, ${store.plz} ${store.city}`,
            ),
            distanceKm !== undefined &&
              h("span", { class: "chip chip--distance" }, formatKm(distanceKm)),
          ),
        ),
      ),
    );
  }

  async function chooseStore(store: OfferStore): Promise<void> {
    const { id, name, street, plz, city } = store;
    choosing = false;
    storeInput.value = "";
    change(setStore(list, { id, name, street, plz, city }), false);
    await loadOffers();
  }

  function renderOffers(): void {
    const day = today();
    if (!list.store) {
      offersStatus.text.textContent = "Wähle oben eine Filiale, um ihre Angebote zu sehen.";
      offersAge.box.hidden = true;
      replaceChildren(offerGrid);
      moreButton.hidden = true;
      return;
    }
    if (!offers) return; // loading or failed: the status says so
    const weeks = offerWeeks(offers, day);
    if (!weeks.some((week) => week.monday === filter.week)) filter.week = weeks[0]?.monday ?? null;
    weekSwitch.field.hidden = weeks.length < 2;
    if (weeks[0] && filter.week) {
      weekSwitch.set(weeks.map(weekOption), filter.week);
    }
    const starts = filter.week ? startDays(offers, filter.week, day) : [];
    if (!starts.some((start) => start.day === filter.start)) filter.start = null;
    startSwitch.field.hidden = starts.length < 2;
    startSwitch.set(
      [
        { value: ALL_DAYS, label: "Alle" },
        ...starts.map((start) => ({
          value: start.day,
          label: weekdayShort(start.day),
          detail: String(start.count),
        })),
      ],
      filter.start ?? ALL_DAYS,
    );
    sortSwitch.set(
      OFFER_SORTS.map((value) => ({ value, label: SORT_LABELS[value] })),
      filter.sort,
    );
    const counts = departmentCounts(offers, filter, day);
    if (filter.department !== null && !counts.some((c) => c.department === filter.department)) {
      filter.department = null;
    }
    const options: SelectOption[] = [
      {
        value: ALL_DEPARTMENTS,
        label: "Alle Kategorien",
        icon: "category",
        count: counts.reduce((sum, c) => sum + c.count, 0),
      },
      ...counts.map(({ department, count }) => ({
        value: department,
        label: department,
        icon: departmentIcon(department),
        count,
      })),
    ];
    departmentSelect.setOptions(options, filter.department ?? ALL_DEPARTMENTS);

    const groups = groupCounts(offers, filter, day);
    if (filter.group !== null && !groups.some((g) => g.group === filter.group)) filter.group = null;
    // One group only would be the same choice as "Alle".
    groupField.hidden = groups.length < 2;
    replaceChildren(
      groupList,
      ...[
        { group: ALL_GROUPS, label: "Alle", count: groups.reduce((sum, g) => sum + g.count, 0) },
        ...groups.map((g) => ({ ...g, label: g.group })),
      ].map(({ group, label, count }) =>
        h(
          "label",
          { class: "zsub__chip" },
          h("input", {
            type: "radio",
            name: "zettel-group",
            value: group,
            ...(group === (filter.group ?? ALL_GROUPS) && { checked: true }),
          }),
          label,
          h("span", { class: "zsub__count" }, String(count)),
        ),
      ),
    );

    const found = filterOffers(offers, filter, day);
    const week = weeks.find((w) => w.monday === filter.week);
    const when = filter.start
      ? `, gültig ab ${weekdayShort(filter.start)}, ${formatDate(filter.start)}`
      : week
        ? `, gültig ${formatRange(week.from, week.to)}`
        : "";
    offersStatus.text.textContent = found.length
      ? `${String(found.length)} ${found.length === 1 ? "Angebot" : "Angebote"} in ${list.store.name}${when}.`
      : "Keine Angebote für diese Auswahl.";
    offersAge.box.hidden = !catalog;
    if (catalog)
      offersAge.text.textContent = `Stand der Angebote: ${formatStamp(catalog.generatedAt)}`;
    const full = isFull(list);
    replaceChildren(
      offerGrid,
      ...found
        .slice(0, shown)
        .map((offer) => renderOfferTile(offer, hasOffer(list, offer.key), full, day, toggleOffer)),
    );
    moreButton.hidden = found.length <= shown;
  }

  function renderList(): void {
    const day = today();
    const current = offersFor === list.store?.id ? byKey : null;
    const count = list.items.length;
    layoutSwitch.set(
      LAYOUTS.map((value) => ({ value, label: LAYOUT_LABELS[value] })),
      list.layout,
    );
    printButton.disabled = count === 0;
    replaceChildren(
      clearSlot,
      ...(confirmClear
        ? [
            h("span", { class: "zactions__ask" }, "Alle Einträge löschen?"),
            h(
              "button",
              {
                type: "button",
                class: "btn btn--sm btn--tonal",
                on: {
                  click: () => {
                    confirmClear = false;
                    change(clearList(list));
                  },
                },
              },
              "Ja, leeren",
            ),
            h(
              "button",
              {
                type: "button",
                class: "btn btn--sm btn--text",
                on: {
                  click: () => {
                    confirmClear = false;
                    renderList();
                  },
                },
              },
              "Abbrechen",
            ),
          ]
        : [
            h(
              "button",
              {
                type: "button",
                class: "btn btn--sm btn--text",
                ...(count === 0 && { disabled: true }),
                on: {
                  click: () => {
                    confirmClear = true;
                    renderList();
                  },
                },
              },
              icon("delete"),
              "Zettel leeren",
            ),
          ]),
    );
    storageNote.textContent = stored
      ? "Der Zettel wird nur in diesem Browser gespeichert, nicht auf einem Server."
      : "Dieser Browser erlaubt kein Speichern: Der Zettel geht beim Schließen der Seite verloren.";
    const statuses = list.items.map((item) => itemStatus(item, current, day));
    const stale = statuses.filter((s) => s.kind !== "ok").length;
    listStatus.text.textContent =
      count === 0
        ? "Dein Zettel ist leer. Setze Angebote darauf oder schreibe eigene Einträge."
        : `${String(count)} ${count === 1 ? "Eintrag" : "Einträge"}` +
          (count >= MAX_ITEMS ? ` (Höchstzahl erreicht)` : "") +
          (stale ? `, ${String(stale)} davon nicht mehr aktuell.` : ".");
    const statusOf = new Map(
      list.items.map((item, i) => [item.id, statuses[i] ?? { kind: "ok" as const }]),
    );
    const departments = (items: readonly ListItem[]) =>
      groupItems(items).map((group) =>
        h(
          "section",
          { class: "zgroup" },
          renderGroupTitle(group.title, group.items.length),
          h(
            "ul",
            { class: "zitems" },
            ...group.items.map((item) =>
              renderItem(item, statusOf.get(item.id) ?? { kind: "ok" }, handlers, day),
            ),
          ),
        ),
      );
    // One trip: its days on top of the list. Several (two weeks): a section each, as printed.
    const { trips, other } = planTrips(list.items, day);
    const tripNote = (trip: Trip) =>
      h("p", { class: "ztrip__when" }, icon("fact_check"), tripText(trip));
    const [only] = trips;
    replaceChildren(
      groups,
      ...(only && trips.length === 1
        ? [tripNote(only), ...departments(list.items)]
        : trips.length === 0
          ? departments(list.items)
          : [
              ...trips.map((trip, i) =>
                h(
                  "section",
                  { class: "ztrip" },
                  h("h3", { class: "ztrip__title" }, `Einkauf ${String(i + 1)}`),
                  tripNote(trip),
                  ...departments(trip.items),
                ),
              ),
              ...(other.length
                ? [
                    h(
                      "section",
                      { class: "ztrip" },
                      h("h3", { class: "ztrip__title" }, "Weitere Einträge"),
                      ...departments(other),
                    ),
                  ]
                : []),
            ]),
    );
  }

  function renderSheetOnly(): void {
    replaceChildren(
      sheetHost,
      list.items.length
        ? renderSheet(list.store, list.items, list.layout, catalog?.generatedAt ?? null, today())
        : null,
    );
  }

  function render(): void {
    renderViewSwitch();
    renderStore();
    offersView.hidden = view !== "angebote";
    listView.hidden = view !== "zettel";
    if (view === "angebote") renderOffers();
    else renderList();
    renderSheetOnly();
  }

  // ---------- Loading ----------
  async function loadOffers(): Promise<void> {
    const store = list.store;
    offers = null;
    byKey = null;
    offersFor = null;
    shown = PAGE_SIZE;
    render();
    if (!store || !index) return;
    offersStatus.box.classList.remove("banner--error");
    offersStatus.text.textContent = `Angebote von ${store.name} werden geladen …`;
    try {
      catalog ??= await loadOfferCatalog(ctx.base);
      const file = await loadStoreFile(ctx.base, store.id);
      if (list.store?.id !== store.id) return; // another store was chosen meanwhile
      offers = storeOffers(catalog, file);
      byKey = new Map(offers.map((offer) => [offer.key, offer]));
      offersFor = store.id;
      render();
    } catch (error) {
      console.error(error);
      offersStatus.box.classList.add("banner--error");
      offersStatus.text.textContent =
        error instanceof DataError
          ? "Die Angebote dieser Filiale konnten nicht gelesen werden."
          : "Die Angebote konnten nicht geladen werden. Bitte später erneut versuchen.";
    }
  }

  async function start(): Promise<void> {
    render();
    try {
      index = await loadOfferIndex(ctx.base);
    } catch (error) {
      console.error(error);
      index = null;
    }
    if (!index) {
      missing.box.hidden = false;
      missing.text.textContent =
        "Die Angebote der Filialen liegen noch nicht vor. Eigene Einträge und ein gespeicherter Zettel lassen sich trotzdem bearbeiten und drucken.";
      view = "zettel";
      choosing = false;
      viewSwitch.field.hidden = true;
      render();
      return;
    }
    renderStore();
    await loadOffers();
  }

  // ---------- Printing ----------
  async function print(): Promise<void> {
    if (!list.items.length) return;
    renderSheetOnly();
    // Pictures that have not loaded yet would print as gaps.
    const images = [...sheetHost.querySelectorAll("img")];
    await Promise.all(images.map((img) => img.decode().catch(() => undefined)));
    window.print();
  }

  // Ctrl+P on this tab prints the sheet as well; other tabs print as before.
  window.addEventListener("beforeprint", () => {
    const visible = root.offsetParent !== null && list.items.length > 0;
    document.documentElement.classList.toggle("print-zettel", visible);
  });
  window.addEventListener("afterprint", () => {
    document.documentElement.classList.remove("print-zettel");
  });

  // ---------- Events ----------
  let typing: number | undefined;
  searchInput.addEventListener("input", () => {
    window.clearTimeout(typing);
    typing = window.setTimeout(() => {
      filter.query = searchInput.value;
      shown = PAGE_SIZE;
      renderOffers();
    }, 150);
  });
  storeInput.addEventListener("input", renderChoices);
  textForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const next = addText(list, textInput.value, newId());
    if (next === list) return;
    textInput.value = "";
    change(next);
    textInput.focus();
  });

  ctx.onCount(list.items.length);
  void start();
  return {
    show() {
      render();
    },
  };
}
