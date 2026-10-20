import { useState } from "react";
import { api } from "../lib/api.js";
import { usePoll } from "../lib/usePoll.js";

const loadSchema = () => api("/schema");

export default function Database() {
  const { data, error, loading, setData } = usePoll(loadSchema);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    try {
      setData(await api("/schema/refresh", { method: "POST" }));
    } finally {
      setBusy(false);
    }
  }

  const q = filter.trim().toLowerCase();
  const tables = (data?.tables || []).filter(
    (t) => !q || t.name.toLowerCase().includes(q) || t.columns.some((c) => c.toLowerCase().includes(q))
  );

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Database</h1>
          <p className="muted">
            What the assistant can see (read-only). Sensitive columns such as passwords and tokens are hidden.
            {data?.mode === "two-step" && " The schema is large, so the bot first picks tables, then writes SQL."}
          </p>
        </div>
        <button className="btn" onClick={refresh} disabled={busy}>{busy ? "Reloading…" : "Reload schema"}</button>
      </header>
      {(error || data?.error) && <div className="alert bad">{error || `Schema error: ${data.error}`}</div>}
      <div className="card">
        <div className="table-head">
          <h3>
            Tables <span className="muted">({data?.tableCount ?? 0})</span>
          </h3>
          <input className="search" placeholder="Search tables or columns…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        {loading ? (
          <div className="muted">Loading…</div>
        ) : (
          <div className="schema-list">
            {tables.map((t) => (
              <details key={t.name} className="schema-item">
                <summary>
                  <span className="mono">{t.name}</span>
                  <span className="muted small">
                    {t.columns.length} columns · ~{t.rows.toLocaleString()} rows
                  </span>
                </summary>
                <div className="cols">
                  {t.columns.map((c) => (
                    <span key={c} className="chip mono">{c}</span>
                  ))}
                </div>
              </details>
            ))}
            {!tables.length && <div className="muted center">No tables.</div>}
          </div>
        )}
      </div>
    </div>
  );
}
