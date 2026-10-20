import { useState } from "react";
import { api } from "../lib/api.js";
import { usePoll } from "../lib/usePoll.js";
import { duration, phone } from "../lib/format.js";
import StatusDot from "../components/StatusDot.jsx";

const loadStatus = () => api("/status");

function ServiceCard({ title, ok, detail, sub }) {
  return (
    <div className="card service">
      <div className="service-head">
        <h3>{title}</h3>
        <StatusDot ok={ok} />
      </div>
      <div className="service-detail">{detail}</div>
      {sub && <div className="muted small">{sub}</div>}
    </div>
  );
}

export default function Overview() {
  const { data, error, loading, reload } = usePoll(loadStatus, 15000);
  const [hook, setHook] = useState(null);

  async function registerWebhook() {
    setHook({ busy: true });
    try {
      const r = await api("/whatsapp/webhook", { method: "POST" });
      setHook({ ok: true, msg: `Webhook registered: ${r.url}` });
    } catch (e) {
      setHook({ ok: false, msg: e.message });
    }
  }

  if (loading) return <div className="muted">Loading…</div>;
  if (error && !data) return <div className="alert bad">{error}</div>;

  const { llm, db, stt, whatsapp, schema, config: cfg } = data;
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Overview</h1>
          <p className="muted">Up {duration(data.uptimeSec)} · refreshes every 15s</p>
        </div>
        <button className="btn" onClick={reload}>Refresh</button>
      </header>

      <div className="grid4">
        <ServiceCard
          title="AI model"
          ok={llm.ok}
          detail={llm.ok ? `${cfg.provider || "local"} · ${cfg.model}` : llm.error}
          sub={
            [
              llm.queue && `Queue: ${llm.queue.active} running · ${llm.queue.waiting} waiting`,
              cfg.fallback && cfg.provider === "google" ? `Fallback: ${cfg.localModel}` : null,
              llm.cooldownMs ? `Gemini cooldown ${Math.ceil(llm.cooldownMs / 60000)}m` : null,
            ]
              .filter(Boolean)
              .join(" · ") || undefined
          }
        />
        <ServiceCard
          title="Database"
          ok={db.ok}
          detail={db.ok ? db.database : db.error}
          sub={db.ok ? `${schema.tableCount} tables · ${schema.mode} mode · ${db.latencyMs}ms` : schema.error}
        />
        <ServiceCard title="Voice (STT)" ok={stt.ok} detail={stt.ok ? stt.provider : stt.error} sub={`Provider: ${cfg.sttProvider}`} />
        <ServiceCard
          title="WhatsApp"
          ok={whatsapp.ok}
          detail={whatsapp.state ?? whatsapp.error}
          sub={`Instance: ${cfg.evolutionInstance || "—"}`}
        />
      </div>

      <div className="grid2">
        <div className="card">
          <h3>Bot settings</h3>
          <dl className="kv">
            <dt>Bot name</dt><dd>{cfg.botName}</dd>
            <dt>Provider</dt><dd>{cfg.provider || "local"}</dd>
            <dt>Model</dt><dd>{cfg.model}</dd>
            <dt>Fallback</dt><dd>{cfg.fallback === "local" ? cfg.localModel : cfg.fallback || "—"}</dd>
            <dt>Reasoning</dt><dd>{cfg.reasoningEffort}</dd>
            <dt>Max reply tokens</dt><dd>{cfg.maxTokens}</dd>
            <dt>Rate limit</dt><dd>{cfg.rateLimitPerMin} / min per user</dd>
            <dt>Admins</dt><dd>{cfg.adminNumbers.map(phone).join(", ") || "—"}</dd>
          </dl>
        </div>
        <div className="card">
          <h3>Evolution webhook</h3>
          <p className="muted small">
            Evolution API sends incoming WhatsApp messages to this URL (event <code>MESSAGES_UPSERT</code>).
            It is registered automatically on startup; use the button to register it again.
          </p>
          <code className="block">{cfg.webhookUrl || "Set PUBLIC_URL and WEBHOOK_SECRET"}</code>
          <button className="btn primary" onClick={registerWebhook} disabled={!cfg.webhookUrl || hook?.busy}>
            {hook?.busy ? "Registering…" : "Register webhook"}
          </button>
          {hook?.msg && <div className={hook.ok ? "alert ok" : "alert bad"}>{hook.msg}</div>}
        </div>
      </div>
    </div>
  );
}
