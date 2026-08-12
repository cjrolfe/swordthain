import { Fragment, useEffect, useState, useCallback } from "react";
import { api, Folder, MediaItem, ApiError, Playlist, SharedFolder } from "../api";
import { Lightbox } from "./Lightbox";

const ROOT = "ROOT";

const SUPPORTED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
  "video/x-m4v",
]);

/**
 * Browser MIME detection for .m4v is inconsistent across OS/browser (could
 * report video/x-m4v, video/mp4, or empty string) — detect by extension and
 * normalize to a single canonical type instead of trusting file.type.
 */
function effectiveContentType(file: File): string {
  if (file.name.toLowerCase().endsWith(".m4v")) return "video/x-m4v";
  return file.type;
}

// S3's hard limit for a single presigned PUT. Files at or under this stay
// on the simple single-PUT flow, unchanged; larger files use the
// resumable multipart flow below.
const MULTIPART_THRESHOLD = 5 * 1024 * 1024 * 1024;

interface UploadStatus {
  name: string;
  status: "uploading" | "done" | "error";
  message?: string;
  /** Only set for an in-progress multipart upload — lets the UI offer Cancel. */
  cancel?: () => void;
}

interface MultipartUploadState {
  mediaId: string;
  s3Key: string;
  uploadId: string;
  partSize: number;
  totalParts: number;
  completedParts: { partNumber: number; etag: string }[];
}

function multipartStorageKey(folderId: string, file: File): string {
  return `swordthain-multipart:${folderId}:${file.name}:${file.size}:${file.lastModified}`;
}

/** XMLHttpRequest is the only way to get real byte-level upload progress — fetch() has no upload-progress event. */
function xhrPut(url: string, file: File, contentType: string, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Upload failed (network error)"));
    xhr.send(file);
  });
}

/**
 * Resumable multipart upload: tracks completed parts in localStorage keyed
 * to the file (folder + name + size + lastModified), so re-selecting the
 * same file after a refresh/crash resumes from the next un-uploaded part
 * instead of restarting. Same browser/device only — no server-side
 * tracking. Parts upload sequentially, not in parallel, to keep this
 * simple and avoid concurrent localStorage writes.
 */
async function uploadMultipart(
  file: File,
  folderId: string,
  onProgress: (doneParts: number, totalParts: number) => void,
  onReadyToCancel: (cancel: () => void) => void
): Promise<void> {
  const storageKey = multipartStorageKey(folderId, file);
  const saved = localStorage.getItem(storageKey);
  const state: MultipartUploadState = saved
    ? JSON.parse(saved)
    : {
        ...(await api.initMultipartUpload({
          folderId,
          fileName: file.name,
          contentType: effectiveContentType(file),
          fileSize: file.size,
        })),
        completedParts: [],
      };
  if (!saved) localStorage.setItem(storageKey, JSON.stringify(state));

  let cancelled = false;
  onReadyToCancel(async () => {
    cancelled = true;
    localStorage.removeItem(storageKey);
    await api.abortMultipartUpload({ folderId, s3Key: state.s3Key, uploadId: state.uploadId });
  });

  const completedPartNumbers = new Set(state.completedParts.map((p) => p.partNumber));
  onProgress(state.completedParts.length, state.totalParts);

  for (let partNumber = 1; partNumber <= state.totalParts; partNumber++) {
    if (cancelled) return;
    if (completedPartNumbers.has(partNumber)) continue;

    const { url } = await api.getMultipartPartUrl({
      folderId,
      s3Key: state.s3Key,
      uploadId: state.uploadId,
      partNumber,
    });
    const start = (partNumber - 1) * state.partSize;
    const chunk = file.slice(start, start + state.partSize);
    const res = await fetch(url, { method: "PUT", body: chunk });
    if (!res.ok) throw new Error(`Part ${partNumber} of ${state.totalParts} failed (${res.status})`);
    const etag = res.headers.get("ETag");
    if (!etag) throw new Error(`Part ${partNumber} response missing ETag`);

    state.completedParts.push({ partNumber, etag });
    localStorage.setItem(storageKey, JSON.stringify(state));
    onProgress(state.completedParts.length, state.totalParts);
  }

  if (cancelled) return;
  await api.completeMultipartUpload({
    folderId,
    s3Key: state.s3Key,
    uploadId: state.uploadId,
    parts: state.completedParts,
  });
  localStorage.removeItem(storageKey);
}

interface FigureOptions {
  addToPlaylist?: { label: string; onClick: () => void };
  onDelete?: (item: MediaItem) => void;
  selection?: { checked: boolean; onToggle: () => void };
  editDescription?: {
    editing: boolean;
    value: string;
    onValueChange: (value: string) => void;
    onStart: () => void;
    onSubmit: () => void;
    onCancel: () => void;
  };
}

function renderFigure(
  item: MediaItem,
  onOpen: (item: MediaItem) => void,
  onDownload: (item: MediaItem) => void,
  canDownload: boolean,
  options?: FigureOptions
) {
  const { addToPlaylist, onDelete, selection, editDescription } = options ?? {};
  const displayName = item.description || item.fileName;
  return (
    <figure key={item.mediaId}>
      {selection && (
        <input
          type="checkbox"
          className="thumb-select"
          checked={selection.checked}
          onChange={selection.onToggle}
          aria-label={`Select ${displayName}`}
        />
      )}
      <button
        className={`thumb-button ${item.type === "video" ? "thumb-video" : "thumb-photo"}`}
        onClick={() => onOpen(item)}
      >
        {item.thumbnailUrl ? (
          <img src={item.thumbnailUrl} alt={displayName} loading="lazy" />
        ) : (
          <div className="thumb-placeholder">{item.type === "video" ? "🎬" : "🖼️"}</div>
        )}
      </button>
      {editDescription?.editing ? (
        <>
          <input
            value={editDescription.value}
            onChange={(e) => editDescription.onValueChange(e.target.value)}
            placeholder="Short description"
            autoFocus
          />
          <button onClick={editDescription.onSubmit}>Save</button>
          <button className="link" onClick={editDescription.onCancel}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <figcaption>{displayName}</figcaption>
          {canDownload && (
            <button className="link" onClick={() => onDownload(item)}>
              Download
            </button>
          )}
          {addToPlaylist && (
            <button className="link" onClick={addToPlaylist.onClick}>
              {addToPlaylist.label}
            </button>
          )}
          {editDescription && (
            <button className="link" onClick={editDescription.onStart}>
              Edit
            </button>
          )}
          {onDelete && (
            <button className="link danger" onClick={() => onDelete(item)}>
              Delete
            </button>
          )}
        </>
      )}
    </figure>
  );
}

export function FolderBrowser({ isOwner }: { isOwner: boolean }) {
  const [path, setPath] = useState<Folder[]>([]); // breadcrumb trail; [] means at root
  const [folders, setFolders] = useState<Folder[]>([]);
  const [videos, setVideos] = useState<MediaItem[]>([]);
  const [videosCursor, setVideosCursor] = useState<string | null>(null);
  const [loadingMoreVideos, setLoadingMoreVideos] = useState(false);
  const [photos, setPhotos] = useState<MediaItem[]>([]);
  const [photosCursor, setPhotosCursor] = useState<string | null>(null);
  const [loadingMorePhotos, setLoadingMorePhotos] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newGuestUpload, setNewGuestUpload] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameGuestUpload, setRenameGuestUpload] = useState(false);
  const [movingFolder, setMovingFolder] = useState<Folder | null>(null);
  const [movePath, setMovePath] = useState<Folder[]>([]);
  const [moveOptions, setMoveOptions] = useState<Folder[]>([]);
  const [moveLoading, setMoveLoading] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());
  const [editingDescriptionId, setEditingDescriptionId] = useState<string | null>(null);
  const [descriptionValue, setDescriptionValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lightboxItem, setLightboxItem] = useState<MediaItem | null>(null);
  const [uploads, setUploads] = useState<UploadStatus[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState("");
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [sharedWithMe, setSharedWithMe] = useState<SharedFolder[]>([]);

  const currentFolder = path[path.length - 1] ?? null;
  const currentParentId = currentFolder?.folderId ?? ROOT;
  const canUpload = isOwner || currentFolder?.myPermission === "upload";
  const canDownload = isOwner || currentFolder?.myPermission === "download" || currentFolder?.myPermission === "upload";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { folders } = await api.listFolders(currentParentId);
      setFolders(folders);
      if (currentFolder) {
        const [videoPage, photoPage] = await Promise.all([
          api.listFolderMedia(currentFolder.folderId, { type: "video" }),
          api.listFolderMedia(currentFolder.folderId, { type: "photo" }),
        ]);
        setVideos(videoPage.media);
        setVideosCursor(videoPage.nextCursor);
        setPhotos(photoPage.media);
        setPhotosCursor(photoPage.nextCursor);
      } else {
        setVideos([]);
        setVideosCursor(null);
        setPhotos([]);
        setPhotosCursor(null);
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

  useEffect(() => {
    setUploads([]);
    setSelectedPhotoIds(new Set());
    setEditingDescriptionId(null);
  }, [currentFolder?.folderId]);

  useEffect(() => {
    api
      .listPlaylists()
      .then(({ playlists }) => setPlaylists(playlists))
      .catch(() => {}); // non-fatal — the "add to playlist" picker just won't have options yet
  }, []);

  useEffect(() => {
    if (isOwner) return;
    api
      .listSharedWithMe()
      .then(({ shared }) => setSharedWithMe(shared))
      .catch(() => {}); // non-fatal — the section just won't show
  }, [isOwner]);

  function handleOpenSharedFolder(shared: SharedFolder) {
    // Single-entry breadcrumb landing directly on the target folder —
    // deliberately not a multi-level path through its (inaccessible)
    // ancestors, since navigating into e.g. "2009" itself would 404 on
    // listFolderMedia (no access to that folder's own content).
    setPath([shared.folder]);
  }

  async function handleAddToPlaylist(item: MediaItem) {
    if (!selectedPlaylistId) return;
    try {
      await api.addPlaylistItem(selectedPlaylistId, item.mediaId);
      setJustAddedId(item.mediaId);
      setTimeout(() => setJustAddedId((id) => (id === item.mediaId ? null : id)), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add to playlist");
    }
  }

  async function loadMoreVideos() {
    if (!currentFolder || !videosCursor) return;
    setLoadingMoreVideos(true);
    try {
      const page = await api.listFolderMedia(currentFolder.folderId, { type: "video", cursor: videosCursor });
      setVideos((prev) => [...prev, ...page.media]);
      setVideosCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more videos");
    } finally {
      setLoadingMoreVideos(false);
    }
  }

  async function loadMorePhotos() {
    if (!currentFolder || !photosCursor) return;
    setLoadingMorePhotos(true);
    try {
      const page = await api.listFolderMedia(currentFolder.folderId, { type: "photo", cursor: photosCursor });
      setPhotos((prev) => [...prev, ...page.media]);
      setPhotosCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more photos");
    } finally {
      setLoadingMorePhotos(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    try {
      await api.createFolder({
        title: newTitle.trim(),
        parentFolderId: currentFolder?.folderId,
        guestUploadEnabled: newGuestUpload,
      });
      setNewTitle("");
      setNewGuestUpload(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create folder");
    }
  }

  async function handleRename(folderId: string) {
    if (!renameValue.trim()) return;
    try {
      await api.updateFolder(folderId, { title: renameValue.trim(), guestUploadEnabled: renameGuestUpload });
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

  async function loadMoveOptions(parentId: string) {
    setMoveLoading(true);
    setMoveError(null);
    try {
      const { folders } = await api.listFolders(parentId);
      setMoveOptions(folders);
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : "Failed to load folders");
    } finally {
      setMoveLoading(false);
    }
  }

  function handleStartMove(folder: Folder) {
    setMovingFolder(folder);
    setMovePath([]);
    loadMoveOptions(ROOT);
  }

  function handleMoveCancel() {
    setMovingFolder(null);
    setMoveError(null);
  }

  function handleMoveHome() {
    setMovePath([]);
    loadMoveOptions(ROOT);
  }

  function handleMoveBreadcrumb(index: number) {
    const newPath = movePath.slice(0, index + 1);
    setMovePath(newPath);
    loadMoveOptions(newPath[newPath.length - 1].folderId);
  }

  function handleMoveNavigate(folder: Folder) {
    setMovePath([...movePath, folder]);
    loadMoveOptions(folder.folderId);
  }

  async function handleMoveHere() {
    if (!movingFolder) return;
    const destinationId = movePath[movePath.length - 1]?.folderId ?? ROOT;
    try {
      await api.moveFolder(movingFolder.folderId, destinationId);
      setMovingFolder(null);
      load();
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : "Failed to move folder");
    }
  }

  async function handleDownload(item: MediaItem) {
    try {
      const { url } = await api.downloadUrl(item.mediaId);
      const a = document.createElement("a");
      a.href = url;
      a.download = item.fileName;
      a.click();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download");
    }
  }

  async function handleDeleteMedia(item: MediaItem) {
    if (!confirm(`Delete "${item.fileName}"? This can't be undone.`)) return;
    try {
      await api.deleteMedia(item.mediaId);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  function handleTogglePhotoSelect(mediaId: string) {
    setSelectedPhotoIds((prev) => {
      const next = new Set(prev);
      if (next.has(mediaId)) next.delete(mediaId);
      else next.add(mediaId);
      return next;
    });
  }

  function handleStartEditDescription(item: MediaItem) {
    setEditingDescriptionId(item.mediaId);
    setDescriptionValue(item.description ?? "");
  }

  function handleCancelEditDescription() {
    setEditingDescriptionId(null);
  }

  async function handleSubmitDescription(mediaId: string) {
    try {
      await api.updateMediaDescription(mediaId, descriptionValue.trim());
      setEditingDescriptionId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update description");
    }
  }

  async function handleBulkDeleteSelected() {
    const ids = Array.from(selectedPhotoIds);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} selected photo${ids.length === 1 ? "" : "s"}? This can't be undone.`)) return;
    const results = await Promise.allSettled(ids.map((id) => api.deleteMedia(id)));
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) setError(`Failed to delete ${failed} of ${ids.length} selected photos`);
    setSelectedPhotoIds(new Set());
    load();
  }

  async function handleUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0 || !currentFolder) return;
    const files = Array.from(fileList);
    setUploads(files.map((f) => ({ name: f.name, status: "uploading" })));

    await Promise.all(
      files.map(async (file, i) => {
        const setStatus = (status: UploadStatus["status"], message?: string) =>
          setUploads((prev) => prev.map((u, idx) => (idx === i ? { ...u, status, message } : u)));
        const setCancel = (cancel: () => void) =>
          setUploads((prev) => prev.map((u, idx) => (idx === i ? { ...u, cancel } : u)));
        try {
          const contentType = effectiveContentType(file);
          if (!SUPPORTED_CONTENT_TYPES.has(contentType)) {
            throw new Error(`Unsupported file type: ${contentType || "unknown"}`);
          }

          if (file.size <= MULTIPART_THRESHOLD) {
            const { uploadUrl } = await api.getUploadUrl({
              folderId: currentFolder.folderId,
              fileName: file.name,
              contentType,
            });
            await xhrPut(uploadUrl, file, contentType, (percent) => setStatus("uploading", `${percent}%`));
          } else {
            await uploadMultipart(
              file,
              currentFolder.folderId,
              (done, total) => setStatus("uploading", `Part ${done}/${total} (${Math.round((done / total) * 100)}%)`),
              setCancel
            );
          }
          setStatus("done");
        } catch (err) {
          setStatus("error", err instanceof Error ? err.message : "Upload failed");
        }
      })
    );

    load();
    // Thumbnail generation happens async off an S3 event, so a fresh upload
    // often isn't in listFolderMedia yet on the first refresh above.
    setTimeout(load, 2000);
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

      {!isOwner && path.length === 0 && sharedWithMe.length > 0 && (
        <>
          <h3>Shared with me</h3>
          <ul className="folder-list">
            {sharedWithMe.map((shared) => (
              <li key={shared.folder.folderId}>
                <button className="link folder-name" onClick={() => handleOpenSharedFolder(shared)}>
                  📁 {shared.folder.title}
                </button>
                {shared.path.length > 0 && (
                  <span className="hint">in {shared.path.map((p) => p.title).join(" / ")}</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {error && <p className="error">{error}</p>}
      {loading && <p>Loading…</p>}

      {isOwner && (
        <form onSubmit={handleCreate} className="inline-form">
          <input
            placeholder="New folder title"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <label>
            <input
              type="checkbox"
              checked={newGuestUpload}
              onChange={(e) => setNewGuestUpload(e.target.checked)}
            />{" "}
            Guests can upload here
          </label>
          <button type="submit">Add folder</button>
        </form>
      )}

      <ul className="folder-list">
        {folders.map((folder) => (
          <Fragment key={folder.folderId}>
            <li>
              {isOwner && renamingId === folder.folderId ? (
                <>
                  <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
                  <label>
                    <input
                      type="checkbox"
                      checked={renameGuestUpload}
                      onChange={(e) => setRenameGuestUpload(e.target.checked)}
                    />{" "}
                    Guests can upload here
                  </label>
                  <button onClick={() => handleRename(folder.folderId)}>Save</button>
                  <button className="link" onClick={() => setRenamingId(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button className="link folder-name" onClick={() => setPath([...path, folder])}>
                    📁 {folder.title}
                    {folder.guestUploadEnabled && <span className="badge">guest upload</span>}
                  </button>
                  {isOwner && (
                    <>
                      <button
                        className="link"
                        onClick={() => {
                          setRenamingId(folder.folderId);
                          setRenameValue(folder.title);
                          setRenameGuestUpload(folder.guestUploadEnabled);
                        }}
                      >
                        Rename
                      </button>
                      <button className="link" onClick={() => handleStartMove(folder)}>
                        Move
                      </button>
                      <button className="link danger" onClick={() => handleDelete(folder)}>
                        Delete
                      </button>
                    </>
                  )}
                </>
              )}
            </li>
            {movingFolder?.folderId === folder.folderId && (
              <li className="notify-dialog move-picker">
                <p>
                  Move "{movingFolder.title}" to:
                </p>
                <nav className="breadcrumbs">
                  <button className="link" onClick={handleMoveHome}>
                    Home
                  </button>
                  {movePath.map((f, i) => (
                    <span key={f.folderId}>
                      {" / "}
                      <button className="link" onClick={() => handleMoveBreadcrumb(i)}>
                        {f.title}
                      </button>
                    </span>
                  ))}
                </nav>
                {moveError && <p className="error">{moveError}</p>}
                {moveLoading && <p>Loading…</p>}
                <ul className="folder-list">
                  {moveOptions
                    .filter((f) => f.folderId !== movingFolder.folderId)
                    .map((f) => (
                      <li key={f.folderId}>
                        <button className="link folder-name" onClick={() => handleMoveNavigate(f)}>
                          📁 {f.title}
                        </button>
                      </li>
                    ))}
                  {moveOptions.length === 0 && !moveLoading && <li className="empty">No sub-folders here.</li>}
                </ul>
                <button onClick={handleMoveHere}>Move here</button>
                <button className="link" onClick={handleMoveCancel}>
                  Cancel
                </button>
              </li>
            )}
          </Fragment>
        ))}
        {folders.length === 0 && !loading && (
          <li className="empty">{isOwner ? "No sub-folders here yet." : "No folders shared with you here yet."}</li>
        )}
      </ul>

      {currentFolder && (
        <>
          <h3>Media in "{currentFolder.title}"</h3>
          {!isOwner && (videos.length > 0 || photos.length > 0) && (
            <p className="hint">Click on the image/video to view.</p>
          )}
          {canUpload && (
            <div className="inline-form">
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png,image/heic,image/heif,video/mp4,video/quicktime,.m4v,video/x-m4v"
                onChange={(e) => {
                  handleUpload(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
          )}
          {uploads.length > 0 && (
            <ul className="folder-list">
              {uploads.map((u, i) => (
                <li key={i}>
                  {u.name} — {u.status}
                  {u.message && (
                    <span className={u.status === "error" ? "error" : "hint"}> ({u.message})</span>
                  )}
                  {u.cancel && u.status === "uploading" && (
                    <button className="link danger" onClick={u.cancel}>
                      Cancel
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {videos.length > 0 && (
            <>
              <h4>Videos</h4>
              {playlists.length > 0 && (
                <div className="inline-form">
                  <label htmlFor="add-to-playlist-select">Add videos to</label>
                  <select
                    id="add-to-playlist-select"
                    value={selectedPlaylistId}
                    onChange={(e) => setSelectedPlaylistId(e.target.value)}
                  >
                    <option value="">— choose a playlist —</option>
                    {playlists.map((p) => (
                      <option key={p.playlistId} value={p.playlistId}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="media-grid">
                {videos.map((item) =>
                  renderFigure(item, setLightboxItem, handleDownload, canDownload, {
                    addToPlaylist: selectedPlaylistId
                      ? {
                          label: justAddedId === item.mediaId ? "Added ✓" : "+ Playlist",
                          onClick: () => handleAddToPlaylist(item),
                        }
                      : undefined,
                    onDelete: isOwner ? handleDeleteMedia : undefined,
                    editDescription: isOwner
                      ? {
                          editing: editingDescriptionId === item.mediaId,
                          value: descriptionValue,
                          onValueChange: setDescriptionValue,
                          onStart: () => handleStartEditDescription(item),
                          onSubmit: () => handleSubmitDescription(item.mediaId),
                          onCancel: handleCancelEditDescription,
                        }
                      : undefined,
                  })
                )}
              </div>
              {videosCursor && (
                <button className="link" disabled={loadingMoreVideos} onClick={loadMoreVideos}>
                  {loadingMoreVideos ? "Loading…" : "Load more videos"}
                </button>
              )}
            </>
          )}

          {photos.length > 0 && (
            <>
              <h4>Photos</h4>
              {isOwner && (
                <div className="inline-form">
                  <button
                    className="link danger"
                    disabled={selectedPhotoIds.size === 0}
                    onClick={handleBulkDeleteSelected}
                  >
                    Delete selected ({selectedPhotoIds.size})
                  </button>
                </div>
              )}
              <div className="media-grid">
                {photos.map((item) =>
                  renderFigure(item, setLightboxItem, handleDownload, canDownload, {
                    onDelete: isOwner ? handleDeleteMedia : undefined,
                    selection: isOwner
                      ? { checked: selectedPhotoIds.has(item.mediaId), onToggle: () => handleTogglePhotoSelect(item.mediaId) }
                      : undefined,
                    editDescription: isOwner
                      ? {
                          editing: editingDescriptionId === item.mediaId,
                          value: descriptionValue,
                          onValueChange: setDescriptionValue,
                          onStart: () => handleStartEditDescription(item),
                          onSubmit: () => handleSubmitDescription(item.mediaId),
                          onCancel: handleCancelEditDescription,
                        }
                      : undefined,
                  })
                )}
              </div>
              {photosCursor && (
                <button className="link" disabled={loadingMorePhotos} onClick={loadMorePhotos}>
                  {loadingMorePhotos ? "Loading…" : "Load more photos"}
                </button>
              )}
            </>
          )}

          {videos.length === 0 && photos.length === 0 && !loading && (
            <p className="empty">No media uploaded here yet.</p>
          )}
        </>
      )}

      {lightboxItem && <Lightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />}
    </div>
  );
}
