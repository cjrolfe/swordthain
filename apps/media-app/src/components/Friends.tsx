import { useEffect, useState, useCallback, FormEvent } from "react";
import { api, Friend, Folder, Permission } from "../api";

export function Friends() {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [email, setEmail] = useState("");
  const [folderId, setFolderId] = useState("");
  const [permission, setPermission] = useState<Permission>("view");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [matrix, rootFolders] = await Promise.all([api.permissionsMatrix(), api.listFolders()]);
    setFriends(matrix.friends);
    setFolders(rootFolders.folders);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      await api.invite({
        email: email.trim(),
        folderId: folderId || undefined,
        permission: folderId ? permission : undefined,
        message: message.trim() || undefined,
      });
      setSuccess(`Invited ${email}.`);
      setEmail("");
      setMessage("");
      setFolderId("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send invite");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h3>Invite a friend</h3>
      <form onSubmit={handleInvite} className="invite-form">
        <label htmlFor="invite-email">Email</label>
        <input id="invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />

        <label htmlFor="invite-folder">Give access to (optional)</label>
        <select id="invite-folder" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
          <option value="">— none yet —</option>
          {folders.map((f) => (
            <option key={f.folderId} value={f.folderId}>
              {f.title}
            </option>
          ))}
        </select>

        {folderId && (
          <>
            <label htmlFor="invite-permission">Permission</label>
            <select
              id="invite-permission"
              value={permission}
              onChange={(e) => setPermission(e.target.value as Permission)}
            >
              <option value="view">view</option>
              <option value="download">download</option>
              <option value="upload">upload</option>
            </select>
          </>
        )}

        <label htmlFor="invite-message">Personal note (optional)</label>
        <textarea id="invite-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={3} />

        <button type="submit" disabled={busy}>
          {busy ? "Sending…" : "Send invite"}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {success && <p className="success">{success}</p>}

      <h3>Friends</h3>
      <ul className="friend-list">
        {friends.map((f) => (
          <li key={f.userId}>
            {f.email} <span className="badge">{f.status}</span>
          </li>
        ))}
        {friends.length === 0 && <li className="empty">No friends invited yet.</li>}
      </ul>
    </div>
  );
}
