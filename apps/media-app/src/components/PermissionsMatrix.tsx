import { useEffect, useState, useCallback } from "react";
import { api, PermissionsMatrix as MatrixData, Permission, Folder, Share } from "../api";

const PERMISSIONS: Permission[] = ["view", "download", "upload"];

export function PermissionsMatrix() {
  const [data, setData] = useState<MatrixData | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [addFolderId, setAddFolderId] = useState("");
  const [addPermission, setAddPermission] = useState<Permission>("view");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Session-only (not persisted): folderIds granted to a friend during this
  // browser session that haven't been emailed about yet. Keyed by
  // friend.userId so switching between friends doesn't lose a pending
  // notify batch for someone else. Lost on refresh — deliberate, not a bug.
  const [pendingNotify, setPendingNotify] = useState<Record<string, string[]>>({});
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyNote, setNotifyNote] = useState("");
  const [notifyBusy, setNotifyBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.permissionsMatrix());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load permissions");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <p className="error" role="status">{error}</p>;
  if (!data) return <p>Loading…</p>;

  const selectedFriend = data.friends.find((f) => f.userId === selectedUserId) ?? null;

  const grants = selectedFriend
    ? data.shares
        .filter((s) => s.userId === selectedFriend.userId)
        .map((s) => ({ share: s, folder: data.folders.find((f) => f.folderId === s.folderId) }))
        .filter((g): g is { share: Share; folder: Folder } => g.folder !== undefined)
    : [];
  const grantedFolderIds = new Set(grants.map((g) => g.folder.folderId));
  const availableFolders = data.folders.filter((f) => !grantedFolderIds.has(f.folderId));

  async function handleChangePermission(folderId: string, permission: Permission) {
    if (!selectedFriend) return;
    setBusy(true);
    try {
      await api.updateShare(folderId, { action: "grant", email: selectedFriend.email, permission });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update access");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(folderId: string) {
    if (!selectedFriend) return;
    setBusy(true);
    try {
      await api.updateShare(folderId, { action: "revoke", email: selectedFriend.email });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove access");
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd() {
    if (!selectedFriend || !addFolderId) return;
    setBusy(true);
    try {
      await api.updateShare(addFolderId, { action: "grant", email: selectedFriend.email, permission: addPermission });
      // A brand-new share (only reached on success) — track it as
      // pending-notify. handleChangePermission never touches this, since
      // it only ever operates on already-shared folders.
      const friendUserId = selectedFriend.userId;
      setPendingNotify((prev) => ({
        ...prev,
        [friendUserId]: [...(prev[friendUserId] ?? []), addFolderId],
      }));
      setAddFolderId("");
      setAddPermission("view");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add access");
    } finally {
      setBusy(false);
    }
  }

  function clearPending(userId: string) {
    setPendingNotify((prev) => {
      const { [userId]: _removed, ...rest } = prev;
      return rest;
    });
  }

  async function handleSendNotify() {
    if (!selectedFriend) return;
    const folderIds = pendingNotify[selectedFriend.userId] ?? [];
    if (folderIds.length === 0) return;
    setNotifyBusy(true);
    try {
      await api.notifyShares({ email: selectedFriend.email, folderIds, message: notifyNote || undefined });
      clearPending(selectedFriend.userId);
      setNotifyOpen(false);
      setNotifyNote("");
    } catch (err) {
      // Preserve pendingNotify on failure so the Owner can retry.
      setError(err instanceof Error ? err.message : "Failed to send notification");
    } finally {
      setNotifyBusy(false);
    }
  }

  return (
    <div className="permissions-layout">
      <ul className="friend-list permissions-friend-list">
        {data.friends.map((friend) => (
          <li key={friend.userId}>
            <button
              className={`link folder-name${selectedUserId === friend.userId ? " active" : ""}`}
              onClick={() => setSelectedUserId(friend.userId)}
            >
              {friend.email}
            </button>
            {friend.status !== "CONFIRMED" && <span className="badge">{friend.status}</span>}
          </li>
        ))}
        {data.friends.length === 0 && <li className="empty">No friends invited yet — see the Friends tab.</li>}
      </ul>

      <div className="permissions-detail">
        {!selectedFriend ? (
          <p className="empty">Select a friend to manage their folder access.</p>
        ) : (
          <>
            <h3>{selectedFriend.email}</h3>
            <ul className="folder-list">
              {grants.map(({ share, folder }) => (
                <li key={folder.folderId}>
                  <span className="folder-name">{folder.title}</span>
                  <select
                    value={share.permission}
                    disabled={busy}
                    aria-label={`Change access to "${folder.title}" for ${selectedFriend.email}`}
                    onChange={(e) => handleChangePermission(folder.folderId, e.target.value as Permission)}
                  >
                    {PERMISSIONS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <button className="link danger" disabled={busy} onClick={() => handleRemove(folder.folderId)}>
                    Remove
                  </button>
                </li>
              ))}
              {grants.length === 0 && <li className="empty">No folders shared with this friend yet.</li>}
            </ul>

            {(pendingNotify[selectedFriend.userId]?.length ?? 0) > 0 && (
              <div className="notify-banner">
                <span>
                  {pendingNotify[selectedFriend.userId].length} new folder
                  {pendingNotify[selectedFriend.userId].length > 1 ? "s" : ""} granted this session.
                </span>{" "}
                <button onClick={() => setNotifyOpen(true)}>Notify {selectedFriend.email}</button>{" "}
                <button className="link" onClick={() => clearPending(selectedFriend.userId)}>
                  Dismiss
                </button>
              </div>
            )}

            {notifyOpen && (
              <div className="notify-dialog">
                <p>Send {selectedFriend.email} an email about new media?</p>
                <textarea
                  placeholder="Optional personal note…"
                  value={notifyNote}
                  onChange={(e) => setNotifyNote(e.target.value)}
                  rows={3}
                />
                <button disabled={notifyBusy} onClick={handleSendNotify}>
                  {notifyBusy ? "Sending…" : "Send"}
                </button>{" "}
                <button className="link" disabled={notifyBusy} onClick={() => setNotifyOpen(false)}>
                  Cancel
                </button>
              </div>
            )}

            {availableFolders.length > 0 && (
              <div className="inline-form">
                <label htmlFor="add-folder-select" className="visually-hidden">
                  Folder to share with {selectedFriend.email}
                </label>
                <select
                  id="add-folder-select"
                  value={addFolderId}
                  onChange={(e) => setAddFolderId(e.target.value)}
                >
                  <option value="">— choose a folder —</option>
                  {availableFolders.map((f) => (
                    <option key={f.folderId} value={f.folderId}>
                      {f.title}
                    </option>
                  ))}
                </select>
                <label htmlFor="add-permission-select" className="visually-hidden">
                  Permission level
                </label>
                <select
                  id="add-permission-select"
                  value={addPermission}
                  onChange={(e) => setAddPermission(e.target.value as Permission)}
                >
                  {PERMISSIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <button disabled={busy || !addFolderId} onClick={handleAdd}>
                  Add
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
