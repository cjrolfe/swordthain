import { useEffect, useRef, useState } from "react";
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
import { Architecture } from "./components/Architecture";

type Tab =
  | "folders"
  | "playlists"
  | "permissions"
  | "friends"
  | "activity"
  | "storage"
  | "upload-tool"
  | "architecture";

const TAB_LABELS: Record<Tab, string> = {
  folders: "Folders",
  playlists: "Playlists",
  permissions: "Permissions",
  friends: "Friends",
  activity: "Activity",
  storage: "Storage",
  "upload-tool": "Upload Tool",
  architecture: "Architecture",
};

export function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [tab, setTab] = useState<Tab>("folders");
  const owner = session ? isOwner(session) : false;
  const stayActiveRef = useRef<HTMLButtonElement>(null);

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

  useEffect(() => {
    if (showWarning) stayActiveRef.current?.focus();
  }, [showWarning]);

  if (!session) {
    return <Login onLogin={setSession} />;
  }

  return (
    <div className={owner ? "app" : "app member-theme"}>
      {showWarning && (
        <div className="idle-warning" role="alert">
          <p>You've been inactive — you'll be signed out in 2 minutes.</p>
          <button ref={stayActiveRef} onClick={stayActive}>
            Stay signed in
          </button>
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
          <button
            className={tab === "folders" ? "active" : ""}
            aria-current={tab === "folders" ? "page" : undefined}
            onClick={() => setTab("folders")}
          >
            Folders
          </button>
          <button
            className={tab === "playlists" ? "active" : ""}
            aria-current={tab === "playlists" ? "page" : undefined}
            onClick={() => setTab("playlists")}
          >
            Playlists
          </button>
          {owner && (
            <>
              <button
                className={tab === "permissions" ? "active" : ""}
                aria-current={tab === "permissions" ? "page" : undefined}
                onClick={() => setTab("permissions")}
              >
                Permissions
              </button>
              <button
                className={tab === "friends" ? "active" : ""}
                aria-current={tab === "friends" ? "page" : undefined}
                onClick={() => setTab("friends")}
              >
                Friends
              </button>
              <button
                className={tab === "activity" ? "active" : ""}
                aria-current={tab === "activity" ? "page" : undefined}
                onClick={() => setTab("activity")}
              >
                Activity
              </button>
              <button
                className={tab === "storage" ? "active" : ""}
                aria-current={tab === "storage" ? "page" : undefined}
                onClick={() => setTab("storage")}
              >
                Storage
              </button>
              <button
                className={tab === "upload-tool" ? "active" : ""}
                aria-current={tab === "upload-tool" ? "page" : undefined}
                onClick={() => setTab("upload-tool")}
              >
                Upload Tool
              </button>
              <button
                className={tab === "architecture" ? "active" : ""}
                aria-current={tab === "architecture" ? "page" : undefined}
                onClick={() => setTab("architecture")}
              >
                Architecture
              </button>
            </>
          )}
        </nav>
        <main>
          <h2 className="visually-hidden">{TAB_LABELS[tab]}</h2>
          {tab === "folders" && <FolderBrowser isOwner={owner} />}
          {tab === "playlists" && <Playlists isOwner={owner} />}
          {owner && tab === "permissions" && <PermissionsMatrix />}
          {owner && tab === "friends" && <Friends />}
          {owner && tab === "activity" && <Activity />}
          {owner && tab === "storage" && <Storage />}
          {owner && tab === "upload-tool" && <UploadTool />}
          {owner && tab === "architecture" && <Architecture />}
        </main>
      </div>
    </div>
  );
}
