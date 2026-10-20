import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { usePoll } from "../lib/usePoll.js";
import { phone } from "../lib/format.js";
import StatusDot from "../components/StatusDot.jsx";

const loadWhatsApp = () => api("/whatsapp");
const QR_REFRESH_MS = 20000;

function formatPairing(code) {
  return code && code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

function Connected({ info, onLogout, busy }) {
  return (
    <div className="card wa-connected">
      {info.profilePicUrl ? (
        <img className="wa-avatar" src={info.profilePicUrl} alt="" />
      ) : (
        <div className="wa-avatar placeholder" aria-hidden="true">💬</div>
      )}
      <div className="wa-who">
        <div className="wa-name">{info.profileName || "WhatsApp connected"}</div>
        <div className="mono muted">{phone(info.phone)}</div>
        <StatusDot ok label="Connected" />
      </div>
      <button className="btn danger" onClick={onLogout} disabled={busy}>
        {busy ? "Logging out…" : "Log out"}
      </button>
    </div>
  );
}

export default function WhatsApp() {
  const [linking, setLinking] = useState(null); // null | "qr" | "code"
  const { data, error, loading, reload } = usePoll(loadWhatsApp, linking ? 3000 : 10000);
  const [qr, setQr] = useState(null);
  const [pairingCode, setPairingCode] = useState(null);
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const refreshTimer = useRef(null);

  const connected = data?.state === "open";

  // Stop linking once the phone is connected.
  useEffect(() => {
    if (connected && linking) {
      setLinking(null);
      setQr(null);
      setPairingCode(null);
      setMsg({ ok: true, text: "WhatsApp linked. The bot is live." });
    }
  }, [connected, linking]);

  // QR codes expire; fetch a fresh one while the user is scanning.
  useEffect(() => {
    if (linking !== "qr") return undefined;
    refreshTimer.current = setInterval(() => startQr(true), QR_REFRESH_MS);
    return () => clearInterval(refreshTimer.current);
  }, [linking]);

  async function startQr(silent = false) {
    if (!silent) {
      setBusy(true);
      setMsg(null);
      setPairingCode(null);
    }
    try {
      const r = await api("/whatsapp/connect", { method: "POST", body: {} });
      if (r.qr) setQr(r.qr);
      setLinking("qr");
      if (!r.qr && r.state !== "open" && !silent) setMsg({ ok: false, text: "No QR code yet. Wait a few seconds and try again." });
      reload();
    } catch (e) {
      if (!silent) setMsg({ ok: false, text: e.message });
    } finally {
      if (!silent) setBusy(false);
    }
  }

  async function startCode(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setQr(null);
    try {
      const r = await api("/whatsapp/connect", { method: "POST", body: { number } });
      if (!r.pairingCode) throw new Error("WhatsApp did not return a code. Try again in a few seconds, or use the QR code.");
      setPairingCode(r.pairingCode);
      setLinking("code");
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (!window.confirm("Log out WhatsApp? The bot stops replying until you link a phone again.")) return;
    setBusy(true);
    try {
      await api("/whatsapp/logout", { method: "POST" });
      setMsg({ ok: true, text: "Logged out." });
      reload();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setLinking(null);
    setQr(null);
    setPairingCode(null);
  }

  if (loading) return <div className="muted">Loading…</div>;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>WhatsApp</h1>
          <p className="muted">
            Link the phone number the bot will use. Use a separate number, not your personal WhatsApp.
          </p>
        </div>
        {data?.configured && (
          <StatusDot ok={connected} label={connected ? "Connected" : data.state === "connecting" ? "Waiting for scan" : "Not linked"} />
        )}
      </header>

      {error && <div className="alert bad">{error}</div>}
      {msg && <div className={msg.ok ? "alert ok" : "alert bad"}>{msg.text}</div>}

      {data && !data.configured && (
        <div className="card">
          Evolution API is not configured. Set <code>EVOLUTION_BASE_URL</code>, <code>EVOLUTION_API_KEY</code> and{" "}
          <code>EVOLUTION_INSTANCE</code>.
        </div>
      )}

      {data?.configured && connected && <Connected info={data} onLogout={logout} busy={busy} />}

      {data?.configured && !connected && (
        <div className="grid2">
          <div className="card wa-link">
            <h3>Option 1 · Scan a QR code</h3>
            <ol className="steps">
              <li>On the bot phone open <b>WhatsApp → Settings → Linked devices</b>.</li>
              <li>Tap <b>Link a device</b> and scan the code below.</li>
            </ol>
            {linking === "qr" && qr ? (
              <div className="qr-box">
                <img src={qr} alt="WhatsApp QR code" />
                <div className="muted small">Refreshes automatically. Waiting for scan…</div>
              </div>
            ) : (
              <button className="btn primary" onClick={() => startQr()} disabled={busy}>
                {busy && linking !== "code" ? "Loading…" : "Show QR code"}
              </button>
            )}
          </div>

          <div className="card wa-link">
            <h3>Option 2 · Pairing code</h3>
            <p className="muted small">Use this when you can't scan, for example when the bot number is on this same phone.</p>
            {linking === "code" && pairingCode ? (
              <div className="pair-box">
                <div className="pair-code mono">{formatPairing(pairingCode)}</div>
                <ol className="steps">
                  <li>On the bot phone open <b>Linked devices → Link a device</b>.</li>
                  <li>Tap <b>Link with phone number instead</b> and enter this code.</li>
                </ol>
              </div>
            ) : (
              <form className="row-form" onSubmit={startCode}>
                <label className="field">
                  <span>Bot's WhatsApp number</span>
                  <input
                    placeholder="03001234567"
                    inputMode="tel"
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                  />
                </label>
                <button className="btn primary" disabled={busy || !number.trim()}>
                  {busy && linking !== "qr" ? "Requesting…" : "Get code"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {linking && !connected && (
        <div>
          <button className="btn ghost" onClick={cancel}>Cancel</button>
        </div>
      )}

      {data?.configured && (
        <div className="card">
          <h3>Details</h3>
          <dl className="kv">
            <dt>Instance</dt><dd className="mono">{data.instanceName}</dd>
            <dt>State</dt><dd>{data.state}</dd>
            <dt>Messages</dt><dd>Incoming messages reach the bot through the webhook, which is set up automatically.</dd>
          </dl>
        </div>
      )}
    </div>
  );
}
