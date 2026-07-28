import { useEffect, useState, useCallback } from "react";
import { api, Folder, MediaItem, ApiError } from "../api";
import { Lightbox } from "./Lightbox";

const ROOT = "ROOT";

const SUPPORTED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
]);

interface UploadStatus {
  name: string;
  status: "uploading" | "done" | "error";
  message?: string;
}

function renderFigure(
  item: MediaItem,
  onOpen: (item: MediaItem) => void,
  onDownload: (item: MediaItem) => void,
  canDownload: boolean
) {
  return (
    <figure key={item.mediaId}>
      <button
        className={`thumb-button ${item.type === "video" ? "thumb-video" : "thumb-photo"}`}
        onClick={() => onOpen(item)}
      >
        {item.thumbnailUrl ? (
          <img src={item.thumbnailUrl} alt={item.fileName} loading="lazy" />
        ) : (
          <div className="thumb-placeholder">{item.type === "video" ? "🎬" : "🖼️"}</div>
        )}
      </button>
      <figcaption>{item.fileName}</figcaption>
      {canDownload && (
        <button className="link" onClick={() => onDownload(item)}>
          Download
        </button>
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
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lightboxItem, setLightboxItem] = useState<MediaItem | null>(null);
  const [uploads, setUploads] = useState<UploadStatus[]>([]);

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

  async function handleUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0 || !currentFolder) return;
    const files = Array.from(fileList);
    setUploads(files.map((f) => ({ name: f.name, status: "uploading" })));

    await Promise.all(
      files.map(async (file, i) => {
        const setStatus = (status: UploadStatus["status"], message?: string) =>
          setUploads((prev) => prev.map((u, idx) => (idx === i ? { ...u, status, message } : u)));
        try {
          if (!SUPPORTED_CONTENT_TYPES.has(file.type)) {
            throw new Error(`Unsupported file type: ${file.type || "unknown"}`);
          }
          const { uploadUrl } = await api.getUploadUrl({
            folderId: currentFolder.folderId,
            fileName: file.name,
            contentType: file.type,
          });
          const res = await fetch(uploadUrl, {
            method: "PUT",
            headers: { "content-type": file.type },
            body: file,
          });
          if (!res.ok) throw new Error(`Upload failed (${res.status})`);
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

      {error && <p className="error">{error}</p>}
      {loading && <p>Loading…</p>}

      {isOwner && (
        <form onSubmit={handleCreate} className="inline-form">
          <input
            placeholder="New folder title"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <button type="submit">Add folder</button>
        </form>
      )}

      <ul className="folder-list">
        {folders.map((folder) => (
          <li key={folder.folderId}>
            {isOwner && renamingId === folder.folderId ? (
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
                {isOwner && (
                  <>
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
              </>
            )}
          </li>
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
                accept="image/jpeg,image/png,image/heic,image/heif,video/mp4,video/quicktime"
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
                  {u.status === "error" && u.message && <span className="error"> ({u.message})</span>}
                </li>
              ))}
            </ul>
          )}

          {videos.length > 0 && (
            <>
              <h4>Videos</h4>
              <div className="media-grid">
                {videos.map((item) => renderFigure(item, setLightboxItem, handleDownload, canDownload))}
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
              <div className="media-grid">
                {photos.map((item) => renderFigure(item, setLightboxItem, handleDownload, canDownload))}
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
