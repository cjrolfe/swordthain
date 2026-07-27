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

  if (error) return <p className="error">{error}</p>;
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
      setAddFolderId("");
      setAddPermission("view");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add access");
    } finally {
      setBusy(false);
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

            {availableFolders.length > 0 && (
              <div className="inline-form">
                <select value={addFolderId} onChange={(e) => setAddFolderId(e.target.value)}>
                  <option value="">— choose a folder —</option>
                  {availableFolders.map((f) => (
                    <option key={f.folderId} value={f.folderId}>
                      {f.title}
                    </option>
                  ))}
                </select>
                <select value={addPermission} onChange={(e) => setAddPermission(e.target.value as Permission)}>
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
