import { useState } from "react";
import { loadSession, clearSession, Session } from "./auth";
import { Login } from "./components/Login";
import { FolderBrowser } from "./components/FolderBrowser";
import { PermissionsMatrix } from "./components/PermissionsMatrix";
import { Friends } from "./components/Friends";
import { Activity } from "./components/Activity";

type Tab = "folders" | "permissions" | "friends" | "activity";

export function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [tab, setTab] = useState<Tab>("folders");

  if (!session) {
    return <Login onLogin={setSession} />;
  }

  function handleSignOut() {
    clearSession();
    setSession(null);
  }

  return (
    <div className="app">
      <header>
        <h1>Swordthain Admin</h1>
        <button className="link" onClick={handleSignOut}>
          Sign out
        </button>
      </header>
      <nav className="tabs">
        <button className={tab === "folders" ? "active" : ""} onClick={() => setTab("folders")}>
          Folders
        </button>
        <button className={tab === "permissions" ? "active" : ""} onClick={() => setTab("permissions")}>
          Permissions
        </button>
        <button className={tab === "friends" ? "active" : ""} onClick={() => setTab("friends")}>
          Friends
        </button>
        <button className={tab === "activity" ? "active" : ""} onClick={() => setTab("activity")}>
          Activity
        </button>
      </nav>
      <main>
        {tab === "folders" && <FolderBrowser />}
        {tab === "permissions" && <PermissionsMatrix />}
        {tab === "friends" && <Friends />}
        {tab === "activity" && <Activity />}
      </main>
    </div>
  );
}
