export default function StatusDot({ ok, label }) {
  return (
    <span className={ok ? "badge ok" : "badge bad"}>
      <span className="dot" aria-hidden="true" />
      {label ?? (ok ? "Online" : "Offline")}
    </span>
  );
}
