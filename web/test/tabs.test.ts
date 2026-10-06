// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTabs } from "../src/ui/tabs";

function markup(): HTMLElement {
  document.body.replaceChildren();
  const tablist = document.createElement("div");
  tablist.setAttribute("role", "tablist");
  for (const [tab, label] of [
    ["search", "Umkreissuche"],
    ["all", "Alle"],
  ] as const) {
    const button = document.createElement("button");
    button.setAttribute("role", "tab");
    button.dataset.tab = tab;
    button.id = `tab-${tab}`;
    button.setAttribute("aria-controls", `panel-${tab}`);
    button.textContent = label;
    tablist.append(button);
    const panel = document.createElement("div");
    panel.id = `panel-${tab}`;
    document.body.append(panel);
  }
  document.body.prepend(tablist);
  return tablist;
}

const panel = (tab: string) => document.getElementById(`panel-${tab}`);
const button = (tab: string) => document.getElementById(`tab-${tab}`);

describe("tabs", () => {
  let tablist: HTMLElement;
  beforeEach(() => {
    tablist = markup();
  });

  it("shows exactly one panel and marks the selected tab", () => {
    setupTabs(tablist, vi.fn()).select("all");
    expect(panel("all")?.hidden).toBe(false);
    expect(panel("search")?.hidden).toBe(true);
    expect(button("all")?.getAttribute("aria-selected")).toBe("true");
    expect(button("search")?.getAttribute("tabindex")).toBe("-1");
  });

  it("activates on click and reports the change", () => {
    const onChange = vi.fn();
    setupTabs(tablist, onChange).select("search");
    button("all")?.click();
    expect(onChange).toHaveBeenCalledWith("all");
    expect(panel("all")?.hidden).toBe(false);
  });

  it("supports arrow keys, Home and End", () => {
    const onChange = vi.fn();
    setupTabs(tablist, onChange).select("search", true);
    const key = (k: string) =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: k, bubbles: true }),
      );
    key("ArrowRight");
    expect(document.activeElement).toBe(button("all"));
    key("ArrowRight"); // wraps
    expect(document.activeElement).toBe(button("search"));
    key("End");
    expect(onChange).toHaveBeenLastCalledWith("all");
    key("Home");
    expect(onChange).toHaveBeenLastCalledWith("search");
  });
});
