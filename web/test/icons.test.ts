// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { hydrateIcons, icon } from "../src/icons";

describe("icons", () => {
  it("builds decorative SVGs without parsing markup", () => {
    const svg = icon("search");
    expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("viewBox")).toBe("0 -960 960 960");
    expect(svg.querySelector("path")?.getAttribute("d")).toMatch(/^M784-120/);
    expect(icon("github").getAttribute("viewBox")).toBe("0 0 20 20");
  });

  it("replaces placeholders and keeps their classes", () => {
    document.body.replaceChildren();
    const span = document.createElement("span");
    span.dataset.icon = "check";
    span.className = "segment__check";
    document.body.append(span);
    hydrateIcons();
    expect(document.body.querySelector("[data-icon]")).toBeNull();
    expect(document.body.querySelector("svg")?.getAttribute("class")).toBe("icon segment__check");
  });

  it("rejects unknown icon names", () => {
    document.body.replaceChildren();
    const span = document.createElement("span");
    span.dataset.icon = "nope";
    document.body.append(span);
    expect(() => {
      hydrateIcons();
    }).toThrow(/unknown icon/);
  });
});
