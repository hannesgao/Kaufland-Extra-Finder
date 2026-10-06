import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

// GitHub Pages project site: https://hannesgao.github.io/Kaufland-Extra-Finder/
const BASE = "/Kaufland-Extra-Finder/";
const FIXTURE = resolve(import.meta.dirname, "fixtures/extra.json");
const DAY_MS = 86_400_000;

// Only same-origin resources, plus OSM tiles (loaded after the first search). Applied to the
// production build only: the dev server injects inline styles for hot reloading.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: https://tile.openstreetmap.org",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/**
 * Serves `data/extra.json`.
 * - dev: the fixture (dates shifted by whole weeks so it looks current), or $KEF_EXTRA_JSON
 * - build: $KEF_EXTRA_JSON is required, so a fixture can never be deployed by accident
 */
function extraJson(): Plugin {
  return {
    name: "kef-extra-json",
    configureServer(server) {
      server.middlewares.use(`${BASE}data/extra.json`, (_req, res) => {
        const source = process.env.KEF_EXTRA_JSON;
        const body = source ? readFileSync(source, "utf-8") : shiftedFixture(new Date());
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(body);
      });
    },
    generateBundle() {
      const source = process.env.KEF_EXTRA_JSON;
      if (!source) {
        this.error("Set KEF_EXTRA_JSON to the extra.json to publish (e.g. fixtures/extra.json).");
      }
      const text = readFileSync(source, "utf-8");
      const parsed = JSON.parse(text) as { schema_version?: unknown };
      if (parsed.schema_version !== 1) {
        this.error(`${source}: unsupported schema_version ${String(parsed.schema_version)}`);
      }
      this.emitFile({ type: "asset", fileName: "data/extra.json", source: text });
    },
  };
}

/** Shift every date in the fixture by whole weeks so its generated_at falls in the current week. */
export function shiftedFixture(now: Date): string {
  const text = readFileSync(FIXTURE, "utf-8");
  const generated = /"generated_at": "(\d{4}-\d{2}-\d{2})/.exec(text)?.[1];
  if (!generated) throw new Error("fixture has no generated_at");
  const weeks = Math.floor((now.getTime() - Date.parse(generated)) / (7 * DAY_MS));
  const shift = (iso: string) =>
    new Date(Date.parse(iso) + weeks * 7 * DAY_MS).toISOString().slice(0, 10);
  return text.replace(/\b(\d{4}-\d{2}-\d{2})(?=[T"])/g, (iso) => shift(iso));
}

/** Replaces `<!-- include:name -->` with `partials/name.html`, so all pages share one footer. */
function partials(): Plugin {
  return {
    name: "kef-partials",
    transformIndexHtml: (html) =>
      html.replace(/<!-- include:([a-z-]+) -->/g, (_match, name: string) =>
        readFileSync(resolve(import.meta.dirname, "partials", `${name}.html`), "utf-8"),
      ),
  };
}

/** "05.10.2026 22:50" in Berlin time, like the author's other projects. */
export function buildStamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}.${get("month")}.${get("year")} ${get("hour")}:${get("minute")}`;
}

/** Fills %KEF_VERSION%, %KEF_BUILD_STAMP% and %KEF_BUILD_ISO% in the HTML pages. */
function buildInfo(): Plugin {
  const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "package.json"), "utf-8")) as {
    version: string;
  };
  const now = new Date();
  const values: Record<string, string> = {
    KEF_VERSION: pkg.version,
    KEF_BUILD_STAMP: buildStamp(now),
    KEF_BUILD_ISO: now.toISOString().slice(0, 16).replace("T", " "),
  };
  return {
    name: "kef-build-info",
    transformIndexHtml: (html) =>
      html.replace(/%(KEF_[A-Z_]+)%/g, (match, key: string) => values[key] ?? match),
  };
}

function contentSecurityPolicy(): Plugin {
  return {
    name: "kef-csp",
    apply: "build",
    transformIndexHtml: () => [
      {
        tag: "meta",
        attrs: { "http-equiv": "Content-Security-Policy", content: CSP },
        injectTo: "head-prepend",
      },
    ],
  };
}

export default defineConfig({
  base: BASE,
  plugins: [extraJson(), partials(), buildInfo(), contentSecurityPolicy()],
  build: {
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        impressum: resolve(import.meta.dirname, "impressum.html"),
        datenschutz: resolve(import.meta.dirname, "datenschutz.html"),
      },
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
