import { test } from "node:test";
import assert from "node:assert/strict";

const { smallTalkReply, looksLikeDataQuestion } = await import("../src/bot/intent.js");
const { extractIdent, normalize } = await import("../src/engine/parser.js");
const { resolveDate } = await import("../src/engine/dictionary.js");
const { stripThink } = await import("../src/llm/client.js");
const { speakable } = await import("../src/tts/speak.js");

test("smallTalkReply only for pure greetings", () => {
  assert.ok(smallTalkReply("Hi"));
  assert.ok(smallTalkReply("Assalam o Alaikum!"));
  assert.ok(smallTalkReply("السلام علیکم").includes("وعلیکم"));
  assert.ok(smallTalkReply("thank you so much"));
  assert.equal(smallTalkReply("hi how many students in batch 10"), null);
  assert.equal(smallTalkReply("which batch is running"), null);
  assert.ok(looksLikeDataQuestion("Can you tell me which batch is currently running"));
  assert.ok(!looksLikeDataQuestion("Hello"));
});

test("identifiers: CNIC, roll number, phone, email", () => {
  assert.deepEqual(extractIdent("54401-6647329-0"), { type: "cnic", value: "5440166473290", display: "54401-6647329-0" });
  assert.equal(extractIdent("cnic 5440166473290 please").type, "cnic");
  assert.equal(extractIdent("roll no db10-0240252-0").value, "DB10-0240252-0");
  assert.equal(extractIdent("+92 333 7881264").value, "3337881264");
  assert.equal(extractIdent("0333-7881264").type, "phone");
  assert.equal(extractIdent("a.b@Mail.com").value, "a.b@mail.com");
  assert.equal(extractIdent("how many students in batch 10"), null);
});

test("normalize fixes common misspellings and Roman Urdu", () => {
  assert.equal(normalize("hw mny studnts in btch 10"), "how many students in batch 10");
  assert.equal(normalize("kitny trainr hain"), "kitne trainer hain");
  assert.equal(normalize("attendence todey"), "attendance today");
});

test("date phrases", () => {
  const now = new Date("2026-10-22T10:00:00Z");
  assert.deepEqual(resolveDate("today", now), { from: "2026-10-22", to: "2026-10-22", label: "today" });
  assert.equal(resolveDate("is mahine", now).from, "2026-10-01");
  assert.equal(resolveDate("last month", now).to, "2026-09-30");
  assert.equal(resolveDate("in september", now).from, "2026-09-01");
  assert.equal(resolveDate("on 20/10/2026", now).from, "2026-10-20");
  assert.equal(resolveDate("last 7 days", now).from, "2026-10-16");
  assert.equal(resolveDate("students in batch 10", now), null);
});

test("stripThink removes reasoning blocks", () => {
  assert.equal(stripThink("<think>hmm</think>\n{\"a\":1}"), '{"a":1}');
  assert.equal(stripThink("plain"), "plain");
});

test("speakable strips WhatsApp formatting for voice replies", () => {
  assert.equal(speakable("*42* students\n_Batch 10_"), "42 students, Batch 10");
});
