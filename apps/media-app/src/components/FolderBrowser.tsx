import { useEffect, useState, useCallback } from "react";
import { api, Folder, MediaItem, ApiError } from "../api";

const ROOT = "ROOT";

export function FolderBrowser() {
  const [path, setPath] = useState<Folder[]>([]); // breadcrumb trail; [] means at root
  const [folders, setFolders] = useState<Folder[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const currentFolder = path[path.length - 1] ?? null;
  const currentParentId = currentFolder?.folderId ?? ROOT;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { folders } = await api.listFolders(currentParentId);
      setFolders(folders);
      if (currentFolder) {
        const { media } = await api.listFolderMedia(currentFolder.folderId);
        setMedia(media);
      } else {
        setMedia([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load folders");
    } finally {
      setLoading(false);
    }
  }, [currentParentId, currentFolder]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    try {
      await api.createFolder({
        title: newTitle.trim(),
        parentFolderId: currentFolder?.folderId,
      });
      setNewTitle("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create folder");
    }
  }

  async function handleRename(folderId: string) {
    if (!renameValue.trim()) return;
    try {
      await api.renameFolder(folderId, renameValue.trim());
      setRenamingId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename folder");
    }
  }

  async function handleDelete(folder: Folder) {
    if (!confirm(`Delete "${folder.title}"? This only works if it's empty.`)) return;
    try {
      await api.deleteFolder(folder.folderId);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete folder");
    }
  }

  return (
    <div>
      <nav className="breadcrumbs">
        <button className="link" onClick={() => setPath([])}>
          Home
        </button>
        {path.map((folder, i) => (
          <span key={folder.folderId}>
            {" / "}
            <button className="link" onClick={() => setPath(path.slice(0, i + 1))}>
              {folder.title}
            </button>
          </span>
        ))}
      </nav>

      {error && <p className="error">{error}</p>}
      {loading && <p>Loading…</p>}

      <form onSubmit={handleCreate} className="inline-form">
        <input
          placeholder="New folder title"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
        />
        <button type="submit">Add folder</button>
      </form>

      <ul className="folder-list">
        {folders.map((folder) => (
          <li key={folder.folderId}>
            {renamingId === folder.folderId ? (
              <>
                <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
                <button onClick={() => handleRename(folder.folderId)}>Save</button>
                <button className="link" onClick={() => setRenamingId(null)}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button className="link folder-name" onClick={() => setPath([...path, folder])}>
                  📁 {folder.title}
                </button>
                <button
                  className="link"
                  onClick={() => {
                    setRenamingId(folder.folderId);
                    setRenameValue(folder.title);
                  }}
                >
                  Rename
                </button>
                <button className="link danger" onClick={() => handleDelete(folder)}>
                  Delete
                </button>
              </>
            )}
          </li>
        ))}
        {folders.length === 0 && !loading && <li className="empty">No sub-folders here yet.</li>}
      </ul>

      {currentFolder && (
        <>
          <h3>Media in "{currentFolder.title}"</h3>
          <div className="media-grid">
            {media.map((item) => (
              <figure key={item.mediaId}>
                {item.thumbnailUrl ? (
                  <img src={item.thumbnailUrl} alt={item.fileName} loading="lazy" />
                ) : (
                  <div className="thumb-placeholder">{item.type === "video" ? "🎬" : "🖼️"}</div>
                )}
                <figcaption>{item.fileName}</figcaption>
              </figure>
            ))}
            {media.length === 0 && !loading && <p className="empty">No media uploaded here yet.</p>}
          </div>
        </>
      )}
    </div>
  );
}
