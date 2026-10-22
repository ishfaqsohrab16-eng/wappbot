import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { coverage, EXCLUDED } = await import("../src/engine/inventory.js");
const inventoryPath = new URL("../../queries.txt", import.meta.url);

test("every queries.txt entry is preserved and accounted for", { skip: !fs.existsSync(inventoryPath) }, () => {
  const text = fs.readFileSync(inventoryPath, "utf8");
  const { entries, summary } = coverage(text);
  // The file's own summary: 610 runtime ORM + 25 raw SELECT + 1 dynamic + 7 scripts
  assert.equal(entries.length, 643);
  assert.equal(entries.filter((e) => e.section === "A").length, 25);
  assert.equal(entries.filter((e) => e.section === "B").length, 1);
  assert.equal(entries.filter((e) => e.section === "C").length, 610);
  assert.equal(entries.filter((e) => e.section === "D").length, 7);
  const unknown = entries.filter((e) => e.covered === "unknown");
  assert.deepEqual(unknown.map((e) => e.source), [], "unmapped inventory entries");
  for (const e of entries.filter((x) => x.covered === "excluded")) assert.ok(e.reason);
  assert.ok(summary.intent >= 580, JSON.stringify(summary));
  assert.ok(Object.keys(EXCLUDED).length > 0);
});
