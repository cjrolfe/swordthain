import { useEffect, useState } from "react";
import { loadSession, clearSession, isOwner, Session } from "./auth";
import { useIdleTimeout } from "./useIdleTimeout";
import { Login } from "./components/Login";
import { FolderBrowser } from "./components/FolderBrowser";
import { PermissionsMatrix } from "./components/PermissionsMatrix";
import { Friends } from "./components/Friends";
import { Activity } from "./components/Activity";
import { Storage } from "./components/Storage";

type Tab = "folders" | "permissions" | "friends" | "activity" | "storage";

export function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [tab, setTab] = useState<Tab>("folders");
  const owner = session ? isOwner(session) : false;

  function handleSignOut() {
    clearSession();
    setSession(null);
  }

  useEffect(() => {
    if (session) document.title = owner ? "Swordthain Admin" : "Swordthain Film Archive";
  }, [session, owner]);

  const { showWarning, stayActive } = useIdleTimeout(!!session, handleSignOut);

  if (!session) {
    return <Login onLogin={setSession} />;
  }

  return (
    <div className={owner ? "app" : "app member-theme"}>
      {showWarning && (
        <div className="idle-warning">
          <p>You've been inactive — you'll be signed out in 2 minutes.</p>
          <button onClick={stayActive}>Stay signed in</button>
        </div>
      )}
      <div className="app-content">
        <header>
          <h1>{owner ? "Swordthain Admin" : "Swordthain"}</h1>
          <div className="header-actions">
            {owner && (
              <a className="link" href="https://labs.swordthain.com" target="_blank" rel="noopener noreferrer">
                Labs
              </a>
            )}
            <button className="link" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </header>
        {owner && (
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
            <button className={tab === "storage" ? "active" : ""} onClick={() => setTab("storage")}>
              Storage
            </button>
          </nav>
        )}
        <main>
          {owner ? (
            <>
              {tab === "folders" && <FolderBrowser isOwner />}
              {tab === "permissions" && <PermissionsMatrix />}
              {tab === "friends" && <Friends />}
              {tab === "activity" && <Activity />}
              {tab === "storage" && <Storage />}
            </>
          ) : (
            <FolderBrowser isOwner={false} />
          )}
        </main>
      </div>
    </div>
  );
}
