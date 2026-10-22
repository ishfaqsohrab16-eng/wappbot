// Rules coverage on 1,000 expected questions. Writes the misses to
// .test-data/phrasebook-misses.txt so they can be fixed or seeded.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const dir = new URL("../.test-data/phrasebook1000", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
fs.rmSync(dir, { recursive: true, force: true });
process.env.DATA_DIR = dir;

const H = await import("./helpers/lms.js");
const { PHRASES_1000, DICT_REAL } = await import("../src/knowledge/phrasebook.js");
const { parse } = await import("../src/engine/parser.js");
const { engineEntities } = await import("../src/engine/engine.js");

const entities = engineEntities(H.lmsSchema());

export function misses() {
  const out = [];
  for (const [q, op, ent, dim] of PHRASES_1000) {
    const p = parse(q, { dict: DICT_REAL, entities });
    if (p.op !== op || p.entity !== ent || (dim && p.dim !== dim) || p.confidence < 0.55) out.push({ q, want: `${op}/${ent}${dim ? `/${dim}` : ""}`, got: `${p.op}/${p.entity}${p.dim ? `/${p.dim}` : ""} conf=${p.confidence}` });
  }
  return out;
}

test("1,000 expected questions: the rules route at least 97% without the LLM", () => {
  assert.equal(PHRASES_1000.length, 1000);
  const m = misses();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(`${dir}/misses.txt`, m.map((x) => `${x.q}\n   want ${x.want}  got ${x.got}`).join("\n"));
  const rate = 1 - m.length / PHRASES_1000.length;
  assert.ok(rate >= 0.97, `only ${(rate * 100).toFixed(1)}% routed; misses in ${dir}/misses.txt\n${m.slice(0, 40).map((x) => `${x.q} → want ${x.want} got ${x.got}`).join("\n")}`);
});
