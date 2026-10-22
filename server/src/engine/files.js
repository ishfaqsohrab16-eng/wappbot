import ExcelJS from "exceljs";
import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel, WidthType } from "docx";
import { log } from "../logger.js";

// Files generated locally on the server: Excel sheets, PNG charts, Word reports.
// Each returns { kind, mime, name, base64, caption } ready for WhatsApp.

const stamp = () => new Date().toISOString().slice(0, 10);
const safeName = (s) => String(s || "report").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 50) || "report";

function cellValue(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v;
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  // Keep CNIC/phone/roll numbers as text (leading zeros, no scientific notation).
  if (/^\d{8,}$/.test(s) || /^0\d+$/.test(s)) return s;
  return /^-?\d+(\.\d+)?$/.test(s) && s.length < 12 ? Number(s) : s;
}

/** rows: array of plain objects with display labels as keys. */
export async function excelFile(title, rows, { sheet = "Data" } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "WappBot";
  const ws = wb.addWorksheet(sheet.slice(0, 31));
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  ws.columns = cols.map((c) => ({ header: c, key: c, width: Math.min(40, Math.max(10, c.length + 2)) }));
  for (const r of rows) ws.addRow(Object.fromEntries(cols.map((c) => [c, cellValue(r[c])])));
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF128C6E" } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  for (const col of ws.columns) {
    let w = col.width;
    col.eachCell?.({ includeEmpty: false }, (cell) => (w = Math.max(w, Math.min(50, String(cell.value ?? "").length + 2))));
    col.width = w;
  }
  const buf = await wb.xlsx.writeBuffer();
  return {
    kind: "document",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    name: `${safeName(title)}-${stamp()}.xlsx`,
    base64: Buffer.from(buf).toString("base64"),
    caption: `📎 ${title} (${rows.length} rows)`,
  };
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const PALETTE = ["#128C6E", "#2F80ED", "#F2994A", "#9B51E0", "#EB5757", "#27AE60", "#F2C94C", "#56CCF2", "#BB6BD9", "#6FCF97"];

/** Horizontal bar chart (pie for ≤ 4 slices) as SVG. data: [{label, value}] */
export function chartSvg(title, data, { subtitle = "" } = {}) {
  const items = data.slice(0, 15);
  const total = items.reduce((s, d) => s + d.value, 0) || 1;
  const W = 1000;
  if (items.length <= 4) {
    const H = 620;
    const cx = 330;
    const cy = 360;
    const r = 210;
    let a = -Math.PI / 2;
    const slices = items.map((d, i) => {
      const angle = (d.value / total) * Math.PI * 2;
      const x1 = cx + r * Math.cos(a);
      const y1 = cy + r * Math.sin(a);
      a += angle;
      const x2 = cx + r * Math.cos(a);
      const y2 = cy + r * Math.sin(a);
      const large = angle > Math.PI ? 1 : 0;
      const path = items.length === 1 ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${PALETTE[i]}"/>` : `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z" fill="${PALETTE[i]}" stroke="#fff" stroke-width="3"/>`;
      const ly = 230 + i * 60;
      return `${path}<rect x="610" y="${ly - 22}" width="28" height="28" rx="6" fill="${PALETTE[i]}"/><text x="652" y="${ly}" font-size="26" fill="#17201d">${esc(String(d.label).slice(0, 22))}</text><text x="652" y="${ly + 28}" font-size="22" fill="#64716c">${d.value.toLocaleString("en-US")} (${Math.round((d.value / total) * 100)}%)</text>`;
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#ffffff"/><text x="40" y="60" font-size="34" font-weight="700" fill="#17201d">${esc(title)}</text><text x="40" y="100" font-size="22" fill="#64716c">${esc(subtitle)}</text>${slices.join("")}</svg>`;
  }
  const barH = 40;
  const gap = 16;
  const top = 130;
  const left = 300;
  const H = top + items.length * (barH + gap) + 60;
  const max = Math.max(...items.map((d) => d.value), 1);
  const bars = items.map((d, i) => {
    const y = top + i * (barH + gap);
    const w = Math.max(4, ((W - left - 160) * d.value) / max);
    return `<text x="${left - 16}" y="${y + 28}" font-size="22" text-anchor="end" fill="#17201d">${esc(String(d.label).slice(0, 24))}</text><rect x="${left}" y="${y}" width="${w}" height="${barH}" rx="6" fill="${PALETTE[i % PALETTE.length]}"/><text x="${left + w + 12}" y="${y + 28}" font-size="22" fill="#17201d">${d.value.toLocaleString("en-US")}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#ffffff"/><text x="40" y="60" font-size="34" font-weight="700" fill="#17201d">${esc(title)}</text><text x="40" y="100" font-size="22" fill="#64716c">${esc(subtitle)}</text>${bars.join("")}</svg>`;
}

let Resvg = null;
async function renderPng(svg) {
  if (Resvg === null) {
    try {
      ({ Resvg } = await import("@resvg/resvg-js"));
    } catch (err) {
      log.warn("Chart renderer unavailable:", err.message);
      Resvg = false;
    }
  }
  if (!Resvg) return null;
  const r = new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: "DejaVu Sans" }, fitTo: { mode: "width", value: 1000 } });
  return Buffer.from(r.render().asPng());
}

export async function chartFile(title, data, { subtitle } = {}) {
  const png = await renderPng(chartSvg(title, data, { subtitle }));
  if (!png) return null;
  return { kind: "image", mime: "image/png", name: `${safeName(title)}.png`, base64: png.toString("base64"), caption: `📊 ${title}` };
}

/** Word report: heading, summary lines, optional table. */
export async function wordFile(title, { summary = [], rows = [], subtitle = "" } = {}) {
  const children = [
    new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ children: [new TextRun({ text: `${subtitle ? `${subtitle} · ` : ""}Generated ${stamp()}`, italics: true, color: "64716C" })] }),
    ...summary.map((s) => new Paragraph({ children: [new TextRun(String(s).replace(/[*_]/g, ""))] })),
  ];
  if (rows.length) {
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].slice(0, 8);
    const cell = (text, bold = false) =>
      new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: String(text ?? ""), bold, size: 18 })] })] });
    children.push(
      new Paragraph(""),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ tableHeader: true, children: cols.map((c) => cell(c, true)) }),
          ...rows.slice(0, 500).map((r) => new TableRow({ children: cols.map((c) => cell(r[c] ?? "")) })),
        ],
      })
    );
  }
  const buf = await Packer.toBuffer(new Document({ creator: "WappBot", title, sections: [{ children }] }));
  return {
    kind: "document",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    name: `${safeName(title)}-${stamp()}.docx`,
    base64: buf.toString("base64"),
    caption: `📄 ${title}`,
  };
}
