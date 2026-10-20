import { useState } from "react";
import { api } from "../lib/api.js";
import { usePoll } from "../lib/usePoll.js";
import { phone, timeAgo } from "../lib/format.js";

const loadUsers = () => api("/users");

export default function Users() {
  const { data, error, loading, reload } = usePoll(loadUsers, 30000);
  const [form, setForm] = useState({ phone: "", name: "" });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api("/users", { method: "POST", body: form });
      setMsg({ ok: true, text: r.existed ? `${phone(r.user.phone)} already has access` : `Added ${phone(r.user.phone)}` });
      setForm({ phone: "", name: "" });
      reload();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function remove(p) {
    if (!window.confirm(`Remove access for ${phone(p)}?`)) return;
    try {
      await api(`/users/${p}`, { method: "DELETE" });
      setMsg({ ok: true, text: `Removed ${phone(p)}` });
      reload();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  }

  const q = filter.trim().toLowerCase();
  const users = (data?.users || []).filter((u) => !q || u.phone.includes(q) || u.name?.toLowerCase().includes(q));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>WhatsApp users</h1>
          <p className="muted">
            Only these numbers can use the bot. Admins can also send <code>/add 03001234567 Name</code> or{" "}
            <code>/remove 03001234567</code> on WhatsApp.
          </p>
        </div>
      </header>

      <form className="card row-form" onSubmit={add}>
        <label className="field">
          <span>Phone number</span>
          <input
            placeholder="03001234567 or +92 300 1234567"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            inputMode="tel"
          />
        </label>
        <label className="field">
          <span>Name (optional)</span>
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </label>
        <button className="btn primary" disabled={busy || !form.phone.trim()}>
          {busy ? "Adding…" : "Add user"}
        </button>
      </form>
      {msg && <div className={msg.ok ? "alert ok" : "alert bad"}>{msg.text}</div>}
      {error && <div className="alert bad">{error}</div>}

      <div className="card">
        <div className="table-head">
          <h3>
            Allowed numbers <span className="muted">({data?.users.length ?? 0} + {data?.admins.length ?? 0} admin)</span>
          </h3>
          <input className="search" placeholder="Search…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        {loading ? (
          <div className="muted">Loading…</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Name</th>
                  <th>Added</th>
                  <th>Last message</th>
                  <th>Messages</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.admins.map((a) => (
                  <tr key={`admin-${a}`}>
                    <td className="mono">{phone(a)}</td>
                    <td><span className="badge ok">Admin</span></td>
                    <td className="muted">from ADMIN_NUMBERS</td>
                    <td />
                    <td />
                    <td />
                  </tr>
                ))}
                {users.map((u) => (
                  <tr key={u.phone}>
                    <td className="mono">{phone(u.phone)}</td>
                    <td>{u.name || <span className="muted">—</span>}</td>
                    <td className="muted">{timeAgo(u.addedAt)}</td>
                    <td className="muted">{timeAgo(u.lastSeenAt)}</td>
                    <td>{u.messageCount || 0}</td>
                    <td className="right">
                      <button className="btn danger small" onClick={() => remove(u.phone)}>Remove</button>
                    </td>
                  </tr>
                ))}
                {!users.length && (
                  <tr>
                    <td colSpan={6} className="muted center">No users yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
