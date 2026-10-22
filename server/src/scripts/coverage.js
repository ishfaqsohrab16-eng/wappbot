// Writes docs/query-coverage.md: every entry of queries.txt mapped to the bot
// intent that answers it (or the reason it is not exposed), plus example
// phrasings per intent. Usage: npm run coverage
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { coverage } from "../engine/inventory.js";
import { ENTITIES } from "../engine/entities.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const text = fs.readFileSync(path.join(root, "queries.txt"), "utf8");
const { entries, summary } = coverage(text);
const { PHRASES } = await import(new URL("../../test/fixtures/phrasebook.js", import.meta.url));

const byEntity = {};
for (const [q, op, ent] of PHRASES) (byEntity[ent] ||= []).push(`${q.replace(/\n+/g, " ")} → \`${op}\``);

const lines = [
  "# Query coverage",
  "",
  `Generated from \`queries.txt\` (${entries.length} read queries of the LMS app).`,
  "",
  `- **${summary.intent || 0}** answered by a bot intent`,
  `- **${summary.excluded || 0}** deliberately not exposed in chat (reason given)`,
  `- **${summary.replaced || 0}** replaced (the LMS's AI SQL path; this bot never runs LLM SQL)`,
  `- **${summary.unknown || 0}** unmapped`,
  "",
  "## Intents",
  "",
  "Each intent is an entity × operation (count, list, details, count_by, sum, avg, top, current) with filters",
  "(batch, center, course, gender, status, district, date, CNIC / roll no / phone / name).",
  "",
];
for (const [name, e] of Object.entries(ENTITIES)) {
  lines.push(`### ${name}`, "", `Tables: ${Object.keys(e.uses).map((t) => `\`${t}\``).join(", ")} · Filters: ${Object.keys(e.filters || {}).join(", ")}${e.date ? ", date" : ""} · Breakdowns: ${(e.dims || []).join(", ") || "—"}`, "");
  for (const p of (byEntity[name] || []).slice(0, 12)) lines.push(`- ${p}`);
  lines.push("");
}
lines.push("## Inventory entries", "", "| # | Source | Tables | Covered by |", "|---|---|---|---|");
for (const e of entries) {
  const how = e.covered === "intent" ? e.by.join(", ") : `${e.covered}: ${e.reason || ""}`;
  lines.push(`| ${e.section}${e.no} | \`${e.source}\` | ${e.tables.join(", ")} | ${how} |`);
}
fs.mkdirSync(path.join(root, "docs"), { recursive: true });
fs.writeFileSync(path.join(root, "docs", "query-coverage.md"), `${lines.join("\n")}\n`);
console.log(`docs/query-coverage.md written: ${JSON.stringify(summary)}`);
