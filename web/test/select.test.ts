// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { sectionIcon } from "../src/ui/deals";
import { setupSelect, type SelectOption } from "../src/ui/select";

const OPTIONS: SelectOption[] = [
  { value: "", label: "Alle Kategorien", icon: "category", count: 27 },
  { value: "Fisch", label: "Fisch", icon: "set_meal", count: 1 },
  { value: "Getränke, Spirituosen", label: "Getränke, Spirituosen", icon: "liquor", count: 4 },
  { value: "Grundnahrungsmittel", label: "Grundnahrungsmittel", icon: "grocery", count: 2 },
];

let root: HTMLDivElement;
let changes: string[];

function setup(value = "") {
  const select = setupSelect(root, "Kategorie", (v) => changes.push(v));
  select.setOptions(OPTIONS, value);
  const button = root.querySelector("button");
  const list = root.querySelector("ul");
  if (!button || !list) throw new Error("select not built");
  const press = (key: string) =>
    button.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  const active = () => root.querySelector(".is-active .select__label")?.textContent;
  return { select, button, list, press, active };
}

beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement("div");
  root.id = "cat";
  document.body.append(root);
  changes = [];
});

describe("setupSelect", () => {
  it("shows the selected option with its icon and count", () => {
    const { button, list } = setup("Fisch");
    expect(button.querySelector(".select__label")?.textContent).toBe("Fisch (1)");
    expect(button.querySelectorAll("svg")).toHaveLength(2); // category icon and arrow
    expect(button.getAttribute("role")).toBe("combobox");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-controls")).toBe(list.id);
    expect(list.hidden).toBe(true);
    expect(list.querySelectorAll('[role="option"]')).toHaveLength(4);
    expect(list.querySelector('[aria-selected="true"] .select__label')?.textContent).toBe("Fisch");
    expect(list.querySelector('[aria-selected="true"] .select__count')?.textContent).toBe("1");
  });

  it("opens on click and selects an option", () => {
    const { button, list } = setup();
    button.click();
    expect(list.hidden).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    list.querySelectorAll<HTMLLIElement>('[role="option"]')[2]?.click();
    expect(changes).toEqual(["Getränke, Spirituosen"]);
    expect(list.hidden).toBe(true);
    expect(button.querySelector(".select__label")?.textContent).toBe("Getränke, Spirituosen (4)");
    button.click();
    button.click();
    expect(list.hidden).toBe(true);
  });

  it("works with the keyboard", () => {
    const { button, list, press, active } = setup();
    press("ArrowDown");
    expect(list.hidden).toBe(false);
    expect(active()).toBe("Alle Kategorien");
    press("ArrowDown");
    press("ArrowDown");
    expect(active()).toBe("Getränke, Spirituosen");
    expect(button.getAttribute("aria-activedescendant")).toBe("cat-option-2");
    press("End");
    expect(active()).toBe("Grundnahrungsmittel");
    press("ArrowDown"); // stays on the last option
    expect(active()).toBe("Grundnahrungsmittel");
    press("Home");
    press("ArrowUp");
    expect(active()).toBe("Alle Kategorien");
    press("ArrowDown");
    press("Enter");
    expect(changes).toEqual(["Fisch"]);
    expect(list.hidden).toBe(true);
    expect(button.hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("closes with Escape without changing the value", () => {
    const { list, press } = setup("Fisch");
    press("Enter");
    press("ArrowDown");
    press("Escape");
    expect(list.hidden).toBe(true);
    expect(changes).toEqual([]);
  });

  it("jumps to an option by typing", () => {
    const { press, active } = setup();
    press("g");
    expect(active()).toBe("Getränke, Spirituosen");
    press("r");
    expect(active()).toBe("Grundnahrungsmittel");
  });

  it("does not report the option that is already selected", () => {
    const { press } = setup("Fisch");
    press("Enter");
    press("Enter");
    expect(changes).toEqual([]);
  });

  it("closes on a press outside and keeps the selection when options change", () => {
    const { select, button, list } = setup("Fisch");
    button.click();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(list.hidden).toBe(true);
    select.setOptions(OPTIONS.slice(0, 2), "Fisch");
    expect(button.querySelector(".select__label")?.textContent).toBe("Fisch (1)");
    select.setOptions(OPTIONS.slice(0, 1), "Fisch"); // gone: falls back to the first
    expect(button.querySelector(".select__label")?.textContent).toBe("Alle Kategorien (27)");
  });

  it("renders labels as text", () => {
    const { select, list } = setup();
    select.setOptions([{ value: "x", label: "<img src=x>", icon: "sell" }], "x");
    expect(list.querySelector("img")).toBeNull();
    expect(list.querySelector(".select__label")?.textContent).toBe("<img src=x>");
  });
});

describe("sectionIcon", () => {
  it("knows Kaufland's categories", () => {
    expect(sectionIcon("Getränke, Spirituosen")).toBe("liquor");
    expect(sectionIcon("Fleisch, Geflügel, Wurst")).toBe("kebab_dining");
    expect(sectionIcon("Fisch")).toBe("set_meal");
    expect(sectionIcon("Molkereiprodukte, Fette")).toBe("egg");
    expect(sectionIcon("Kaffee, Tee, Süßwaren, Knabberartikel")).toBe("coffee");
    expect(sectionIcon("Obst, Gemüse, Pflanzen")).toBe("nutrition");
    expect(sectionIcon("Bäckerei")).toBe("bakery_dining");
    expect(sectionIcon("Markenartikel in Bio-Qualität")).toBe("eco");
    expect(sectionIcon("Genuss aus deiner Region")).toBe("location_on");
    expect(sectionIcon("Drogerie, Tiernahrung")).toBe("soap");
    expect(sectionIcon("Tiefkühlkost")).toBe("ac_unit");
  });

  it("falls back to the price tag", () => {
    expect(sectionIcon("Pre Black Week")).toBe("sell");
    expect(sectionIcon("")).toBe("sell");
  });
});
