import { llmHealth } from "./llm/client.js";
import { dbHealth } from "./db/pool.js";
import { getSchema, schemaSummary } from "./db/schema.js";
import { sttHealth } from "./stt/transcribe.js";
import { evolutionHealth } from "./whatsapp/evolution.js";

export async function collectHealth() {
  const [llm, db, stt, whatsapp, schema] = await Promise.all([
    llmHealth(),
    dbHealth(),
    sttHealth(),
    evolutionHealth(),
    getSchema(),
  ]);
  const s = schemaSummary(schema);
  return {
    ok: llm.ok && db.ok,
    llm,
    db,
    stt,
    whatsapp,
    schema: { tableCount: s.tableCount, mode: s.mode, error: s.error, loadedAt: s.loadedAt },
    uptimeSec: Math.round(process.uptime()),
  };
}
