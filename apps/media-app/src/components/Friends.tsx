import { useEffect, useState, useCallback, FormEvent } from "react";
import { api, Friend, Folder, Permission } from "../api";

export function Friends() {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [email, setEmail] = useState("");
  const [folderId, setFolderId] = useState("");
  const [permission, setPermission] = useState<Permission>("view");
  const [message, setMessage] = useState("");
  const [subject, setSubject] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");
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

  // Debounced live preview — reuses the exact same buildInviteEmailHtml()
  // the real send uses, so this is guaranteed pixel-identical, not a
  // separately maintained re-implementation of the template.
  useEffect(() => {
    if (!email.trim()) {
      setPreviewHtml("");
      return;
    }
    const timer = setTimeout(() => {
      api
        .previewInvite({ email: email.trim(), message: message.trim() || undefined, subject: subject.trim() || undefined })
        .then((res) => setPreviewHtml(res.html))
        .catch(() => {}); // preview is a convenience — a failure here shouldn't block the form
    }, 400);
    return () => clearTimeout(timer);
  }, [email, message, subject]);

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
        subject: subject.trim() || undefined,
      });
      setSuccess(`Invited ${email}.`);
      setEmail("");
      setMessage("");
      setSubject("");
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

        <label htmlFor="invite-subject">Subject (optional)</label>
        <input
          id="invite-subject"
          type="text"
          placeholder="You're invited to Swordthain"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />

        <label htmlFor="invite-message">Personal note (optional)</label>
        <textarea id="invite-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={3} />

        <button type="submit" disabled={busy}>
          {busy ? "Sending…" : "Send invite"}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {success && <p className="success">{success}</p>}

      {previewHtml && (
        <>
          <h4>Preview</h4>
          <iframe title="Invite email preview" srcDoc={previewHtml} className="invite-preview" />
        </>
      )}

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
