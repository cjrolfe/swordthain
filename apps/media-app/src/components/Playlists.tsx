import { useEffect, useState, useCallback, FormEvent } from "react";
import { api, ApiError, Playlist, PlaylistItem } from "../api";
import { PlaylistPlayer } from "./PlaylistPlayer";

export function Playlists({ isOwner }: { isOwner: boolean }) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [openPlaylist, setOpenPlaylist] = useState<Playlist | null>(null);
  const [items, setItems] = useState<PlaylistItem[] | null>(null);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { playlists } = await api.listPlaylists();
      setPlaylists(playlists);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load playlists");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function loadItems(playlist: Playlist) {
    setOpenPlaylist(playlist);
    setItems(null);
    setItemsError(null);
    try {
      const result = await api.getPlaylistItems(playlist.playlistId);
      setItems(result.items);
    } catch (err) {
      setItemsError(err instanceof Error ? err.message : "Failed to load playlist items");
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      await api.createPlaylist(newName.trim());
      setNewName("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create playlist");
    }
  }

  async function handleRename(playlistId: string) {
    if (!renameValue.trim()) return;
    try {
      await api.renamePlaylist(playlistId, renameValue.trim());
      setRenamingId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename playlist");
    }
  }

  async function handleDelete(playlist: Playlist) {
    if (!confirm(`Delete "${playlist.name}"?`)) return;
    try {
      await api.deletePlaylist(playlist.playlistId);
      if (openPlaylist?.playlistId === playlist.playlistId) setOpenPlaylist(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete playlist");
    }
  }

  async function handleRemoveItem(position: number) {
    if (!openPlaylist) return;
    try {
      await api.removePlaylistItem(openPlaylist.playlistId, position);
      loadItems(openPlaylist);
      load();
    } catch (err) {
      setItemsError(err instanceof Error ? err.message : "Failed to remove item");
    }
  }

  async function handleMoveItem(position: number, direction: "up" | "down") {
    if (!openPlaylist) return;
    try {
      await api.movePlaylistItem(openPlaylist.playlistId, position, direction);
      loadItems(openPlaylist);
    } catch (err) {
      setItemsError(err instanceof Error ? err.message : "Failed to reorder");
    }
  }

  return (
    <div>
      <h3>{isOwner ? "New playlist" : "Create a playlist"}</h3>
      <form onSubmit={handleCreate} className="inline-form">
        <input placeholder="Playlist name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button type="submit">Create</button>
      </form>

      {error && <p className="error">{error}</p>}
      {loading && <p>Loading…</p>}

      <ul className="folder-list">
        {playlists.map((playlist) => (
          <li key={playlist.playlistId}>
            {renamingId === playlist.playlistId ? (
              <>
                <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
                <button onClick={() => handleRename(playlist.playlistId)}>Save</button>
                <button className="link" onClick={() => setRenamingId(null)}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button className="link folder-name" onClick={() => loadItems(playlist)}>
                  🎞️ {playlist.name} <span className="badge">{playlist.itemCount}</span>
                </button>
                {isOwner && !playlist.isMine && playlist.ownerEmail && (
                  <span className="hint"> — {playlist.ownerEmail}</span>
                )}
                <button
                  className="link"
                  onClick={() => {
                    setRenamingId(playlist.playlistId);
                    setRenameValue(playlist.name);
                  }}
                >
                  Rename
                </button>
                <button className="link danger" onClick={() => handleDelete(playlist)}>
                  Delete
                </button>
              </>
            )}
          </li>
        ))}
        {playlists.length === 0 && !loading && <li className="empty">No playlists yet.</li>}
      </ul>

      {openPlaylist && (
        <>
          <h3>"{openPlaylist.name}"</h3>
          {itemsError && <p className="error">{itemsError}</p>}
          {!items && !itemsError && <p>Loading…</p>}

          {items && items.length > 0 && (
            <>
              <button onClick={() => setPlaying(true)}>
                ▶ Play
              </button>
              <ul className="folder-list">
                {items.map((item, i) => (
                  <li key={item.position}>
                    {item.thumbnailUrl && (
                      <img src={item.thumbnailUrl} alt="" style={{ width: 40, height: 40, objectFit: "cover" }} />
                    )}{" "}
                    {item.available ? item.fileName : <em>Removed from the library</em>}
                    {item.available && !item.accessible && (
                      <span className="badge">you no longer have access</span>
                    )}
                    <button
                      className="link"
                      disabled={i === 0}
                      onClick={() => handleMoveItem(item.position, "up")}
                      aria-label="Move up"
                    >
                      ↑
                    </button>
                    <button
                      className="link"
                      disabled={i === items.length - 1}
                      onClick={() => handleMoveItem(item.position, "down")}
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                    <button className="link danger" onClick={() => handleRemoveItem(item.position)}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {items && items.length === 0 && <p className="empty">No videos in this playlist yet.</p>}
        </>
      )}

      {playing && openPlaylist && items && (
        <PlaylistPlayer playlistName={openPlaylist.name} items={items} onClose={() => setPlaying(false)} />
      )}
    </div>
  );
}
