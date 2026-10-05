/** Accessible tabs (WAI-ARIA tabs pattern, automatic activation, roving tabindex). */

import { TABS, type Tab } from "../url";

export interface Tabs {
  select(tab: Tab, focus?: boolean): void;
}

function isTab(value: string | undefined): value is Tab {
  return (TABS as readonly (string | undefined)[]).includes(value);
}

export function setupTabs(tablist: HTMLElement, onChange: (tab: Tab) => void): Tabs {
  const buttons = [...tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]')];

  function select(tab: Tab, focus = false): void {
    for (const button of buttons) {
      const active = button.dataset.tab === tab;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
      const panel = document.getElementById(button.getAttribute("aria-controls") ?? "");
      if (panel) panel.hidden = !active;
      if (active && focus) button.focus();
    }
  }

  function activate(button: HTMLButtonElement | undefined, focus: boolean): void {
    const tab = button?.dataset.tab;
    if (!isTab(tab)) return;
    select(tab, focus);
    onChange(tab);
  }

  tablist.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[role="tab"]');
    if (button) activate(button, false);
  });

  tablist.addEventListener("keydown", (event) => {
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (current === -1) return;
    const next: Record<string, number> = {
      ArrowRight: (current + 1) % buttons.length,
      ArrowLeft: (current - 1 + buttons.length) % buttons.length,
      Home: 0,
      End: buttons.length - 1,
    };
    const index = next[event.key];
    if (index === undefined) return;
    event.preventDefault();
    activate(buttons[index], true);
  });

  return { select };
}
