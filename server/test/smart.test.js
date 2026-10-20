import { test } from "node:test";
import assert from "node:assert/strict";

const { looksLikeDataQuestion, queryTokens } = await import("../src/bot/intent.js");
const { scoreMatch, rankCatalog, fold } = await import("../src/db/catalog.js");
const { isQuotaOrRateLimit } = await import("../src/llm/failover.js");

test("looksLikeDataQuestion distinguishes chat from data", () => {
  assert.equal(looksLikeDataQuestion("Hello, how are you?"), false);
  assert.equal(looksLikeDataQuestion("I am good"), false);
  assert.ok(looksLikeDataQuestion("Can you tell me how many students are enrolled in batch 10 in dgbis?"));
  assert.ok(looksLikeDataQuestion("pull all the centers data"));
  assert.ok(looksLikeDataQuestion("ITTI machine stock Coeta QTA batch 10"));
});

test("queryTokens drops stopwords and keeps codes", () => {
  const t = queryTokens("how many students are enrolled in ITTI machine stock Coeta QTA in batch 10");
  assert.ok(t.includes("itti"));
  assert.ok(t.includes("qta"));
  assert.ok(t.includes("10"));
  assert.ok(!t.includes("how"));
  assert.ok(!t.includes("many"));
});

test("fold expands city abbreviations", () => {
  assert.equal(fold("Coeta QTA"), "coeta quetta");
});

test("scoreMatch maps messy speech and acronyms to official names", () => {
  const official = "ITTI Machine Stock COETA Quetta";
  assert.ok(scoreMatch("ITTI machine stock Coeta QTA", official) >= 70);
  assert.ok(scoreMatch("dgbis", "DGBIS") >= 80);
  assert.ok(scoreMatch("dgbis", "Digi Bizz Institute Sukkur") >= 70);
  assert.ok(scoreMatch("dgbis", "Karachi Main Campus") < 50);
});

test("rankCatalog returns official spellings", () => {
  const catalog = {
    groups: [
      {
        table: "centers",
        column: "name",
        values: ["Karachi Main Campus", "ITTI Machine Stock COETA Quetta", "DGBIS Quetta", "Lahore Center"],
      },
      { table: "batches", column: "name", values: ["Batch 9", "Batch 10", "Batch 11"] },
    ],
  };
  const hits = rankCatalog(catalog, "students in itti machine stock coeta qta batch 10");
  const names = hits.map((h) => h.value);
  assert.ok(names.some((n) => /itti/i.test(n)));
  assert.ok(names.some((n) => /batch 10/i.test(n)));
});

test("isQuotaOrRateLimit detects Gemini quota errors", () => {
  assert.ok(isQuotaOrRateLimit({ status: 429, message: "Too Many Requests" }));
  assert.ok(isQuotaOrRateLimit({ message: "RESOURCE_EXHAUSTED: Quota exceeded" }));
  assert.ok(isQuotaOrRateLimit({ error: { status: "RESOURCE_EXHAUSTED", message: "quota" } }));
  assert.equal(isQuotaOrRateLimit({ status: 500, message: "internal" }), false);
});
