import { useEffect, useRef, useState } from "react";
import { api, streamChat } from "../lib/api.js";

const STATUS_TEXT = {
  thinking: "Thinking…",
  querying: "Querying the database…",
  answering: "Writing the answer…",
};

const SOURCE_TEXT = {
  canned: "instant reply",
  rules: "matched by rules",
  "rules-lowconf": "best guess by rules",
  "learned:exact": "learned pattern",
  "learned:similar": "learned pattern (similar)",
  llm: "understood by AI",
  "llm-chat": "AI chat",
};

const EXAMPLES = ["How many students in the current batch?", "Students by center chart", "Kitne applicants admitted hain?", "Which batch is running?"];

function newSessionId() {
  return Math.random().toString(36).slice(2, 10);
}

function Message({ m }) {
  return (
    <div className={`msg ${m.role}`}>
      <div className="bubble" dir="auto">
        {m.text || (m.pending ? <span className="typing"><i /><i /><i /></span> : null)}
        {m.pending && m.status && <div className="msg-status">{STATUS_TEXT[m.status] || m.status}</div>}
        {m.error && <div className="msg-error">{m.error}</div>}
        {(m.files || []).map((f) =>
          f.kind === "image" ? (
            <img key={f.name} className="msg-image" src={`data:${f.mime};base64,${f.base64}`} alt={f.caption || f.name} />
          ) : (
            <a key={f.name} className="msg-file" download={f.name} href={`data:${f.mime};base64,${f.base64}`}>
              📎 {f.name}
            </a>
          )
        )}
        {m.meta && (
          <div className="msg-status">
            {(m.meta.ms / 1000).toFixed(1)}s · {SOURCE_TEXT[m.meta.source] || m.meta.source || m.meta.action}
            {m.meta.llmCalls ? ` · ${m.meta.llmCalls} AI call${m.meta.llmCalls > 1 ? "s" : ""}` : " · no AI call"}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Chat() {
  const [sessionId, setSessionId] = useState(newSessionId);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef(null);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const patchLast = (fn) =>
    setMessages((ms) => {
      const copy = ms.slice();
      copy[copy.length - 1] = fn(copy[copy.length - 1]);
      return copy;
    });

  async function send(text) {
    const message = (text ?? input).trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    setMessages((ms) => [...ms, { role: "user", text: message }, { role: "bot", text: "", pending: true }]);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await streamChat({
        message,
        sessionId,
        signal: ac.signal,
        onToken: (t) => patchLast((m) => ({ ...m, text: m.text + t })),
        onStatus: (s) => patchLast((m) => ({ ...m, status: s })),
        onFile: (f) => patchLast((m) => ({ ...m, files: [...(m.files || []), f] })),
        onDone: (meta) => patchLast((m) => ({ ...m, pending: false, meta })),
        onError: (e) => patchLast((m) => ({ ...m, pending: false, error: e.message })),
      });
    } catch (err) {
      let error = err.message;
      if (err.name === "AbortError") error = "Stopped.";
      else if (err.status === 503) error = "The assistant is busy. Please try again in a minute.";
      else if (err.status === 429) error = "Slow down — too many messages. Try again shortly.";
      patchLast((m) => ({ ...m, pending: false, error }));
    } finally {
      patchLast((m) => (m.pending ? { ...m, pending: false } : m));
      abortRef.current = null;
      setBusy(false);
    }
  }

  async function reset() {
    abortRef.current?.abort();
    await api("/chat/reset", { method: "POST", body: { sessionId } }).catch(() => {});
    setMessages([]);
    setSessionId(newSessionId());
  }

  return (
    <div className="page chat-page">
      <header className="page-head">
        <div>
          <h1>Test chat</h1>
          <p className="muted">Same assistant as WhatsApp. Replies stream at about 15 tokens/s; the first one takes a few seconds.</p>
        </div>
        <button className="btn" onClick={reset} disabled={!messages.length}>New chat</button>
      </header>

      <div className="card chat">
        <div className="chat-log">
          {!messages.length && (
            <div className="chat-empty">
              <p className="muted">Try one of these:</p>
              {EXAMPLES.map((ex) => (
                <button key={ex} className="chip" dir="auto" onClick={() => send(ex)}>{ex}</button>
              ))}
            </div>
          )}
          {messages.map((m, i) => (
            <Message key={i} m={m} />
          ))}
          <div ref={endRef} />
        </div>
        <form
          className="chat-input"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            dir="auto"
            rows={1}
            placeholder="Ask about your data…"
            value={input}
            maxLength={2000}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          {busy ? (
            <button type="button" className="btn danger" onClick={() => abortRef.current?.abort()}>Stop</button>
          ) : (
            <button className="btn primary" disabled={!input.trim()}>Send</button>
          )}
        </form>
      </div>
    </div>
  );
}
