import { api } from "../lib/api.js";
import { usePoll } from "../lib/usePoll.js";
import { phone, timeAgo } from "../lib/format.js";

const loadActivity = () => api("/activity?limit=150");

const STATUS_CLASS = { ok: "ok", denied: "bad", rate_limited: "warn" };

export default function Activity() {
  const { data, error, loading, reload } = usePoll(loadActivity, 10000);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Activity</h1>
          <p className="muted">Recent WhatsApp messages since the last restart · refreshes every 10s</p>
        </div>
        <button className="btn" onClick={reload}>Refresh</button>
      </header>
      {error && <div className="alert bad">{error}</div>}
      <div className="card">
        {loading ? (
          <div className="muted">Loading…</div>
        ) : !data.items.length ? (
          <div className="muted center">No messages yet.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>From</th>
                  <th>Type</th>
                  <th>Message</th>
                  <th>Reply</th>
                  <th>Status</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((a, i) => (
                  <tr key={`${a.at}-${i}`}>
                    <td className="muted nowrap" title={a.at}>{timeAgo(a.at)}</td>
                    <td className="mono nowrap">
                      {phone(a.phone)}
                      {a.name && <div className="muted small">{a.name}</div>}
                    </td>
                    <td>{a.kind === "audio" ? "🎤 voice" : a.kind}{a.language && <div className="muted small">{a.language}</div>}</td>
                    <td className="clip" dir="auto">{a.text}</td>
                    <td className="clip" dir="auto">
                      {a.reply}
                      {a.source && (
                        <div className="muted small">
                          {a.source} · {a.llm ? `${a.llm} AI call(s)` : "no AI call"}
                          {a.files?.length ? ` · 📎 ${a.files.join(", ")}` : ""}
                        </div>
                      )}
                    </td>
                    <td><span className={`badge ${STATUS_CLASS[a.status] || "bad"}`}>{a.status}</span></td>
                    <td className="muted nowrap">{a.ms ? `${(a.ms / 1000).toFixed(1)}s` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
