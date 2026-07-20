import { useEffect, useState, useCallback } from "react";
import { api, ActivityEntry, Folder, Friend } from "../api";

export function Activity() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [folderId, setFolderId] = useState("");
  const [userId, setUserId] = useState("");
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.permissionsMatrix().then((matrix) => {
      setFolders(matrix.folders);
      setFriends(matrix.friends);
    });
  }, []);

  const load = useCallback(async () => {
    if (!folderId && !userId) {
      setEntries(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { activity } = await api.activity({ folderId: folderId || undefined, userId: userId || undefined });
      setEntries(activity);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load activity");
    } finally {
      setLoading(false);
    }
  }, [folderId, userId]);

  useEffect(() => {
    load();
  }, [load]);

  function exportCsv() {
    if (!entries || entries.length === 0) return;
    const header = ["Timestamp", "Friend", "Action", "File", "Folder"];
    const rows = entries.map((e) => [e.timestamp, e.email, e.action, e.fileName, e.folderTitle]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `swordthain-activity-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div>
      <div className="inline-form">
        <select value={folderId} onChange={(e) => setFolderId(e.target.value)}>
          <option value="">— any folder —</option>
          {folders.map((f) => (
            <option key={f.folderId} value={f.folderId}>
              {f.title}
            </option>
          ))}
        </select>
        <select value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">— any friend —</option>
          {friends.map((f) => (
            <option key={f.userId} value={f.userId}>
              {f.email}
            </option>
          ))}
        </select>
        <button onClick={exportCsv} disabled={!entries || entries.length === 0}>
          Export CSV
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {loading && <p>Loading…</p>}
      {!folderId && !userId && !loading && <p className="empty">Pick a folder and/or a friend to see activity.</p>}
      {entries && entries.length === 0 && !loading && <p className="empty">No activity found.</p>}

      {entries && entries.length > 0 && (
        <table className="matrix">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Friend</th>
              <th>Action</th>
              <th>File</th>
              <th>Folder</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.logId}>
                <td>{new Date(e.timestamp).toLocaleString()}</td>
                <td>{e.email}</td>
                <td>{e.action}</td>
                <td>{e.fileName}</td>
                <td>{e.folderTitle}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
