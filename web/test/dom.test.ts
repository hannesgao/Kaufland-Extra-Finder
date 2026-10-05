// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { h, isSafeUrl, replaceChildren } from "../src/dom";

const PAYLOAD = '<img src=x onerror="alert(1)"><script>alert(2)</script>';

describe("h", () => {
  it("renders strings as text, never as HTML", () => {
    const el = h("p", null, PAYLOAD);
    expect(el.textContent).toBe(PAYLOAD);
    expect(el.children).toHaveLength(0);
    expect(el.querySelector("img, script")).toBeNull();
  });

  it("escapes attribute values", () => {
    const el = h("div", { title: '"><img src=x>' });
    expect(el.getAttribute("title")).toBe('"><img src=x>');
    expect(el.children).toHaveLength(0);
  });

  it("sets boolean and numeric attributes, skips false/undefined", () => {
    const el = h("input", {
      required: true,
      maxlength: 5,
      disabled: false,
      placeholder: undefined,
    });
    expect(el.hasAttribute("required")).toBe(true);
    expect(el.getAttribute("maxlength")).toBe("5");
    expect(el.hasAttribute("disabled")).toBe(false);
    expect(el.hasAttribute("placeholder")).toBe(false);
  });

  it("attaches listeners via `on`", () => {
    const click = vi.fn();
    h("button", { on: { click } }).click();
    expect(click).toHaveBeenCalledOnce();
  });

  it("refuses inline event handler attributes", () => {
    expect(() => h("div", { onclick: "alert(1)" })).toThrow(/not allowed/);
    expect(() => h("div", { ONMOUSEOVER: "alert(1)" })).toThrow(/not allowed/);
  });

  it.each(["javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,<b>x</b>", "vbscript:x"])(
    "refuses unsafe URL %s",
    (href) => {
      expect(() => h("a", { href })).toThrow(/unsafe URL/);
    },
  );

  it("allows https and relative URLs", () => {
    expect(h("a", { href: "https://leaflets.kaufland.com/x" }).getAttribute("href")).toBe(
      "https://leaflets.kaufland.com/x",
    );
    expect(isSafeUrl("impressum.html")).toBe(true);
  });

  it("skips empty children and replaces content", () => {
    const el = h("ul", null, null, undefined, false, h("li", null, "a"), 0);
    expect(el.textContent).toBe("a0");
    replaceChildren(el, "b");
    expect(el.textContent).toBe("b");
  });
});
