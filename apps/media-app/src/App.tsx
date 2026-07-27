import { useEffect, useState } from "react";
import { loadSession, clearSession, isOwner, Session } from "./auth";
import { useIdleTimeout } from "./useIdleTimeout";
import { Login } from "./components/Login";
import { FolderBrowser } from "./components/FolderBrowser";
import { PermissionsMatrix } from "./components/PermissionsMatrix";
import { Friends } from "./components/Friends";
import { Activity } from "./components/Activity";

type Tab = "folders" | "permissions" | "friends" | "activity";

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
    <div className="app">
      {showWarning && (
        <div className="idle-warning">
          <p>You've been inactive — you'll be signed out in 2 minutes.</p>
          <button onClick={stayActive}>Stay signed in</button>
        </div>
      )}
      <header>
        <h1>{owner ? "Swordthain Admin" : "Swordthain"}</h1>
        <button className="link" onClick={handleSignOut}>
          Sign out
        </button>
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
        </nav>
      )}
      <main>
        {owner ? (
          <>
            {tab === "folders" && <FolderBrowser isOwner />}
            {tab === "permissions" && <PermissionsMatrix />}
            {tab === "friends" && <Friends />}
            {tab === "activity" && <Activity />}
          </>
        ) : (
          <FolderBrowser isOwner={false} />
        )}
      </main>
    </div>
  );
}
