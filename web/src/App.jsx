import { useEffect, useState } from "react";
import { getToken, setToken, onUnauthorized } from "./lib/api.js";
import Login from "./pages/Login.jsx";
import Layout from "./components/Layout.jsx";
import Overview from "./pages/Overview.jsx";
import Users from "./pages/Users.jsx";
import Chat from "./pages/Chat.jsx";
import Activity from "./pages/Activity.jsx";
import Database from "./pages/Database.jsx";
import WhatsApp from "./pages/WhatsApp.jsx";

const PAGES = {
  overview: { label: "Overview", icon: "◉", component: Overview },
  whatsapp: { label: "WhatsApp", icon: "☏", component: WhatsApp },
  users: { label: "Users", icon: "☺", component: Users },
  chat: { label: "Test chat", icon: "✎", component: Chat },
  activity: { label: "Activity", icon: "≡", component: Activity },
  database: { label: "Database", icon: "▦", component: Database },
};

function pageFromHash() {
  const p = window.location.hash.replace(/^#\/?/, "");
  return PAGES[p] ? p : "overview";
}

export default function App() {
  const [authed, setAuthed] = useState(() => Boolean(getToken()));
  const [page, setPage] = useState(pageFromHash);

  useEffect(() => onUnauthorized(() => {
    setToken(null);
    setAuthed(false);
  }), []);

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (!authed) return <Login onLogin={() => setAuthed(true)} />;

  const Page = PAGES[page].component;
  return (
    <Layout
      pages={PAGES}
      current={page}
      onLogout={() => {
        setToken(null);
        setAuthed(false);
      }}
    >
      <Page />
    </Layout>
  );
}
