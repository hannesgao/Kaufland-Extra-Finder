/**
 * A dropdown with an icon per option, in the same outlined pill as the other controls
 * (WAI-ARIA "select-only combobox": a button that opens a listbox; focus stays on the button
 * and the active option is announced through aria-activedescendant).
 */

import { h, replaceChildren } from "../dom";
import { icon, type IconName } from "../icons";

export interface SelectOption {
  value: string;
  label: string;
  icon: IconName;
  /** Shown after the label, e.g. the number of offers. */
  count?: number;
}

export interface Select {
  /** Replace the options; `value` must be one of them (otherwise the first is selected). */
  setOptions(options: readonly SelectOption[], value: string): void;
}

export function setupSelect(
  root: HTMLElement,
  label: string,
  onChange: (value: string) => void,
): Select {
  const id = root.id;
  const current = h("span", { class: "select__value" });
  const button = h(
    "button",
    {
      type: "button",
      class: "select",
      id: `${id}-button`,
      role: "combobox",
      "aria-haspopup": "listbox",
      "aria-expanded": "false",
      "aria-controls": `${id}-list`,
      "aria-label": label,
    },
    current,
    icon("expand_more", "icon select__arrow"),
  );
  const list = h("ul", {
    class: "select__list",
    id: `${id}-list`,
    role: "listbox",
    "aria-label": label,
    tabindex: "-1",
    hidden: true,
  });
  root.classList.add("select-wrap");
  replaceChildren(root, button, list);

  let options: readonly SelectOption[] = [];
  let selected = 0;
  let active = 0;
  let typed = "";
  let typedAt = 0;

  const items = () => [...list.children] as HTMLLIElement[];
  const isOpen = () => !list.hidden;

  function text(option: SelectOption): string {
    return option.count === undefined ? option.label : `${option.label} (${String(option.count)})`;
  }

  function showValue(): void {
    const option = options[selected];
    if (!option) return;
    replaceChildren(
      current,
      icon(option.icon, "icon select__icon"),
      h("span", { class: "select__label" }, text(option)),
    );
  }

  function setActive(index: number): void {
    active = Math.max(0, Math.min(options.length - 1, index));
    items().forEach((item, i) => {
      item.classList.toggle("is-active", i === active);
    });
    const item = items()[active];
    if (item) {
      button.setAttribute("aria-activedescendant", item.id);
      if (isOpen()) item.scrollIntoView({ block: "nearest" });
    }
  }

  function open(): void {
    if (isOpen()) return;
    list.hidden = false;
    button.setAttribute("aria-expanded", "true");
    // On a phone the field is often near the bottom edge: bring the whole list into view.
    list.scrollIntoView({ block: "nearest" });
    setActive(selected);
  }

  function close(): void {
    if (!isOpen()) return;
    list.hidden = true;
    button.setAttribute("aria-expanded", "false");
    button.removeAttribute("aria-activedescendant");
  }

  function choose(index: number): void {
    const option = options[index];
    close();
    if (!option || index === selected) return;
    selected = index;
    items().forEach((item, i) => {
      item.setAttribute("aria-selected", String(i === selected));
    });
    showValue();
    onChange(option.value);
  }

  /** Typing letters jumps to the next option that starts with them. */
  function typeahead(key: string): void {
    const now = Date.now();
    typed = now - typedAt > 700 ? key : typed + key;
    typedAt = now;
    const from = typed.length === 1 ? active + 1 : active;
    const order = options.map((_, i) => (from + i) % options.length);
    const match = order.find((i) =>
      options[i]?.label.toLocaleLowerCase("de").startsWith(typed.toLocaleLowerCase("de")),
    );
    if (match !== undefined) setActive(match);
  }

  button.addEventListener("click", () => {
    if (isOpen()) close();
    else open();
  });

  button.addEventListener("keydown", (event) => {
    const { key } = event;
    if (!isOpen()) {
      if (["ArrowDown", "ArrowUp", "Enter", " ", "Home", "End"].includes(key)) {
        event.preventDefault();
        open();
        if (key === "Home") setActive(0);
        if (key === "End") setActive(options.length - 1);
      } else if (key.length === 1 && key !== " ") {
        open();
        typeahead(key);
      }
      return;
    }
    const moves: Record<string, number> = {
      ArrowDown: active + 1,
      ArrowUp: active - 1,
      Home: 0,
      End: options.length - 1,
      PageDown: active + 8,
      PageUp: active - 8,
    };
    const target = moves[key];
    if (target !== undefined) {
      event.preventDefault();
      setActive(target);
    } else if (key === "Enter" || key === " ") {
      event.preventDefault();
      choose(active);
    } else if (key === "Escape") {
      event.preventDefault();
      close();
    } else if (key === "Tab") {
      choose(active); // like a native select: leaving it keeps the highlighted option
    } else if (key.length === 1) {
      typeahead(key);
    }
  });

  // Keep the focus on the button when an option is pressed.
  list.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  list.addEventListener("click", (event) => {
    const item = (event.target as Element).closest<HTMLLIElement>('[role="option"]');
    if (item) choose(items().indexOf(item));
  });
  list.addEventListener("mousemove", (event) => {
    const item = (event.target as Element).closest<HTMLLIElement>('[role="option"]');
    if (item) setActive(items().indexOf(item));
  });
  document.addEventListener("pointerdown", (event) => {
    if (event.target instanceof Node && !root.contains(event.target)) close();
  });
  button.addEventListener("blur", close);

  return {
    setOptions(next, value) {
      options = next;
      selected = Math.max(
        0,
        next.findIndex((o) => o.value === value),
      );
      replaceChildren(
        list,
        ...next.map((option, i) =>
          h(
            "li",
            {
              class: "select__option",
              id: `${id}-option-${String(i)}`,
              role: "option",
              "aria-selected": String(i === selected),
            },
            icon(option.icon, "icon select__icon"),
            h("span", { class: "select__label" }, option.label),
            option.count !== undefined &&
              h("span", { class: "select__count" }, String(option.count)),
            icon("check", "icon select__check"),
          ),
        ),
      );
      showValue();
      if (isOpen()) setActive(Math.min(active, next.length - 1));
    },
  };
}
