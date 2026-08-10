import { useEffect, useState } from "react";
import { loadSession, clearSession, isOwner, Session } from "./auth";
import { useIdleTimeout } from "./useIdleTimeout";
import { Login } from "./components/Login";
import { FolderBrowser } from "./components/FolderBrowser";
import { PermissionsMatrix } from "./components/PermissionsMatrix";
import { Friends } from "./components/Friends";
import { Activity } from "./components/Activity";
import { Storage } from "./components/Storage";
import { Playlists } from "./components/Playlists";
import { UploadTool } from "./components/UploadTool";

type Tab = "folders" | "playlists" | "permissions" | "friends" | "activity" | "storage" | "upload-tool";

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

  // Can't be reached through the tab nav itself, but guards against e.g. an
  // Owner signing out and a Member signing in on the same page load, which
  // would otherwise leave `tab` pointed at an owner-only view.
  useEffect(() => {
    if (!owner && tab !== "folders" && tab !== "playlists") setTab("folders");
  }, [owner, tab]);

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
        <nav className="tabs">
          <button className={tab === "folders" ? "active" : ""} onClick={() => setTab("folders")}>
            Folders
          </button>
          <button className={tab === "playlists" ? "active" : ""} onClick={() => setTab("playlists")}>
            Playlists
          </button>
          {owner && (
            <>
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
              <button className={tab === "upload-tool" ? "active" : ""} onClick={() => setTab("upload-tool")}>
                Upload Tool
              </button>
            </>
          )}
        </nav>
        <main>
          {tab === "folders" && <FolderBrowser isOwner={owner} />}
          {tab === "playlists" && <Playlists isOwner={owner} />}
          {owner && tab === "permissions" && <PermissionsMatrix />}
          {owner && tab === "friends" && <Friends />}
          {owner && tab === "activity" && <Activity />}
          {owner && tab === "storage" && <Storage />}
          {owner && tab === "upload-tool" && <UploadTool />}
        </main>
      </div>
    </div>
  );
}
