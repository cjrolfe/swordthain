import { useEffect, useState, useCallback } from "react";
import { api, PermissionsMatrix as MatrixData, Permission } from "../api";

const PERMISSIONS: (Permission | "none")[] = ["none", "view", "download", "upload"];

export function PermissionsMatrix() {
  const [data, setData] = useState<MatrixData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyCell, setBusyCell] = useState<string | null>(null);

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

  async function handleChange(folderId: string, email: string, value: string) {
    const cellKey = `${folderId}:${email}`;
    setBusyCell(cellKey);
    try {
      if (value === "none") {
        await api.updateShare(folderId, { action: "revoke", email });
      } else {
        await api.updateShare(folderId, { action: "grant", email, permission: value as Permission });
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update access");
    } finally {
      setBusyCell(null);
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading…</p>;

  const currentPermission = (folderId: string, userId: string) =>
    data.shares.find((s) => s.folderId === folderId && s.userId === userId)?.permission ?? "none";

  return (
    <div className="matrix-wrap">
      {data.friends.length === 0 ? (
        <p className="empty">No friends invited yet — see the Friends tab.</p>
      ) : data.folders.length === 0 ? (
        <p className="empty">No folders yet — create one in the Folders tab.</p>
      ) : (
        <table className="matrix">
          <thead>
            <tr>
              <th>Friend</th>
              {data.folders.map((f) => (
                <th key={f.folderId}>{f.title}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.friends.map((friend) => (
              <tr key={friend.userId}>
                <td>
                  {friend.email}
                  {friend.status !== "CONFIRMED" && <span className="badge">{friend.status}</span>}
                </td>
                {data.folders.map((folder) => {
                  const cellKey = `${folder.folderId}:${friend.email}`;
                  return (
                    <td key={folder.folderId}>
                      <select
                        value={currentPermission(folder.folderId, friend.userId)}
                        disabled={busyCell === cellKey}
                        onChange={(e) => handleChange(folder.folderId, friend.email, e.target.value)}
                      >
                        {PERMISSIONS.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
