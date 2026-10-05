/**
 * Minimal DOM builder. Strings always become text nodes, attributes are set with setAttribute,
 * and there is deliberately no way to pass HTML. All rendering of scraped data goes through here.
 */

export type Child = Node | string | number | null | undefined | false;

export interface Attrs {
  class?: string;
  /** Event listeners, e.g. `on: { click: handler }`. */
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (event: HTMLElementEventMap[K]) => void }>;
  [attribute: string]: string | number | boolean | undefined | Attrs["on"];
}

const SAFE_URL_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);
const URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction"]);

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (name === "on") {
      for (const [type, listener] of Object.entries(value as NonNullable<Attrs["on"]>)) {
        el.addEventListener(type, listener as EventListener);
      }
    } else if (typeof value === "string" || typeof value === "number") {
      setAttr(el, name, String(value));
    } else if (value === true) {
      setAttr(el, name, "");
    }
  }
  append(el, ...children);
  return el;
}

function setAttr(el: Element, name: string, value: string): void {
  const lower = name.toLowerCase();
  if (lower.startsWith("on")) throw new Error(`event handler attribute ${name} is not allowed`);
  if (URL_ATTRIBUTES.has(lower) && !isSafeUrl(value)) {
    throw new Error(`unsafe URL in ${name}: ${value}`);
  }
  el.setAttribute(name, value);
}

/** Relative URLs and http(s)/mailto only; rejects javascript:, data:, vbscript:, ... */
export function isSafeUrl(value: string): boolean {
  try {
    return SAFE_URL_PROTOCOLS.has(new URL(value, document.baseURI).protocol);
  } catch {
    return false;
  }
}

export function append(parent: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === "object" ? child : document.createTextNode(String(child)));
  }
}

/** Replace all children of `parent`. */
export function replaceChildren(parent: Element, ...children: Child[]): void {
  parent.replaceChildren();
  append(parent, ...children);
}

export function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const el = document.getElementById(id);
  if (!(el instanceof type)) throw new Error(`#${id} is missing or not a ${type.name}`);
  return el;
}
