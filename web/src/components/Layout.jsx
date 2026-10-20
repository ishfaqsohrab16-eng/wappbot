export default function Layout({ pages, current, onLogout, children }) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">💬</span>
          <span>WappBot</span>
        </div>
        <nav>
          {Object.entries(pages).map(([key, p]) => (
            <a key={key} href={`#/${key}`} className={key === current ? "nav-item active" : "nav-item"}>
              <span className="nav-icon" aria-hidden="true">{p.icon}</span>
              {p.label}
            </a>
          ))}
        </nav>
        <button className="btn ghost logout" onClick={onLogout}>
          Sign out
        </button>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
