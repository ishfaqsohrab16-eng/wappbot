import { test } from "node:test";
import assert from "node:assert/strict";

const { consumePlan } = await import("../src/bot/assistant.js");

async function* chunks(text, size) {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}

async function run(text, size) {
  let streamed = "";
  const r = await consumePlan(chunks(text, size), (t) => (streamed += t));
  return { ...r, streamed };
}

test("sql action is parsed and never streamed to the user", async () => {
  for (const size of [1, 3, 7, 100]) {
    const r = await run("ACTION: sql\nSELECT name FROM students LIMIT 5", size);
    assert.equal(r.action, "sql");
    assert.equal(r.body, "SELECT name FROM students LIMIT 5");
    assert.equal(r.streamed, "");
  }
});

test("reply action streams only the reply text", async () => {
  for (const size of [1, 2, 5, 100]) {
    const r = await run("ACTION: reply\nوعلیکم السلام! میں آپ کی کیا مدد کر سکتا ہوں؟", size);
    assert.equal(r.action, "reply");
    assert.equal(r.streamed.trim(), "وعلیکم السلام! میں آپ کی کیا مدد کر سکتا ہوں؟");
    assert.equal(r.body, r.streamed.trim());
  }
});

test("model ignoring the format is treated as a reply", async () => {
  const r = await run("Hello! How can I help you today?", 3);
  assert.equal(r.action, "reply");
  assert.equal(r.streamed, "Hello! How can I help you today?");
});

test("single-line action without newline", async () => {
  const r = await run("ACTION: reply Hi there", 4);
  assert.equal(r.action, "reply");
  assert.equal(r.streamed.trim(), "Hi there");
  const t = await run("ACTION: tables students, courses", 4);
  assert.equal(t.action, "tables");
});
