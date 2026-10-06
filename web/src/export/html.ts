/**
 * The store list as a standalone HTML file: inline styles, no scripts, no external resources.
 * Every value is escaped; the table repeats its header row on each printed page.
 */

import { PALETTE as C } from "./layout";
import type { ExportTable } from "./table";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

const STYLE = `
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 32px; color: ${C.text}; font: 13px/1.35 system-ui, -apple-system, "Segoe UI",
    Roboto, Arial, sans-serif; }
  header { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between;
    gap: 4px 24px; margin-bottom: 10px; }
  h1 { margin: 0; color: ${C.accent}; font-size: 22px; }
  .subtitle { margin: 0; color: ${C.muted}; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th { padding: 6px 8px; background: ${C.accent}; color: ${C.onAccent}; font-size: 11px; letter-spacing: 0.04em;
    text-align: left; text-transform: uppercase; }
  td { padding: 4px 8px; border-bottom: 1px solid ${C.rule}; overflow-wrap: anywhere; }
  tbody tr:nth-child(even) td { background: ${C.zebra}; }
  th.strong, td.strong { text-align: center; }
  td.strong { color: ${C.accent}; font-weight: 700; font-variant-numeric: tabular-nums; }
  footer { margin-top: 10px; color: ${C.muted}; font-size: 11px; }
  @page { margin: 14mm; }
  @media print { body { margin: 0; } thead { display: table-header-group; }
    tr { break-inside: avoid; } }
`;

export function exportHtml(table: ExportTable): Blob {
  const cols = table.columns.map((c) => `<col style="width:${String(c.width)}%">`).join("");
  const head = table.columns
    .map((c) => `<th${c.strong ? ' class="strong"' : ""}>${escapeHtml(c.header)}</th>`)
    .join("");
  const body = table.rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell, i) => {
            const strong = table.columns[i]?.strong ? ' class="strong"' : "";
            return `<td${strong}>${escapeHtml(cell)}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("\n");
  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(table.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<header><h1>${escapeHtml(table.title)}</h1><p class="subtitle">${escapeHtml(table.subtitle)}</p></header>
<table>
<colgroup>${cols}</colgroup>
<thead><tr>${head}</tr></thead>
<tbody>
${body}
</tbody>
</table>
<footer>${escapeHtml(table.footer)}</footer>
</body>
</html>
`;
  return new Blob([html], { type: "text/html;charset=utf-8" });
}
