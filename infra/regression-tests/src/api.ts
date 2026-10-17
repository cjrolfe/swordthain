import { API_URL } from "./config.js";

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export interface Folder {
  folderId: string;
  parentFolderId: string;
  title: string;
  guestUploadEnabled: boolean;
}

export interface MediaItem {
  mediaId: string;
  folderId: string;
  type: "photo" | "video";
  fileName: string;
  description?: string;
  thumbnailUrl: string | null;
}

async function request<T>(method: string, path: string, idToken: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${idToken}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export function makeApi(idToken: string) {
  return {
    listFolders: (parentId: string) =>
      request<{ folders: Folder[] }>("GET", `/folders?parentId=${encodeURIComponent(parentId)}`, idToken),
    createFolder: (body: { title: string; parentFolderId: string }) =>
      request<Folder>("POST", "/folders", idToken, body),
    updateFolder: (folderId: string, body: Partial<Pick<Folder, "title" | "parentFolderId">>) =>
      request<Folder>("PATCH", `/folders/${folderId}`, idToken, body),
    deleteFolder: (folderId: string) => request<{ deleted: boolean }>("DELETE", `/folders/${folderId}`, idToken),
    listFolderMedia: (folderId: string, type: "photo" | "video") =>
      request<{ media: MediaItem[] }>("GET", `/folders/${folderId}/media?type=${type}`, idToken),

    getUploadUrl: (body: { folderId: string; fileName: string; contentType: string }) =>
      request<{ mediaId: string; uploadUrl: string }>("POST", "/media/upload-url", idToken, body),
    updateMediaDescription: (mediaId: string, description: string) =>
      request<MediaItem>("PATCH", `/media/${mediaId}`, idToken, { description }),
    deleteMedia: (mediaId: string) => request<{ deleted: boolean }>("DELETE", `/media/${mediaId}`, idToken),

    listPlaylists: () => request<{ playlists: { playlistId: string; name: string }[] }>("GET", "/playlists", idToken),
    createPlaylist: (name: string) => request<{ playlistId: string; name: string }>("POST", "/playlists", idToken, { name }),
    getPlaylist: (playlistId: string) =>
      request<{ playlistId: string; name: string; itemCount: number; nextPosition: number }>(
        "GET",
        `/playlists/${playlistId}`,
        idToken
      ),
    deletePlaylist: (playlistId: string) =>
      request<{ deleted: boolean }>("DELETE", `/playlists/${playlistId}`, idToken),
    getPlaylistItems: (playlistId: string) =>
      request<{ items: { position: number; mediaId: string; fileName: string | null; description?: string }[] }>(
        "GET",
        `/playlists/${playlistId}/items`,
        idToken
      ),
    addPlaylistItem: (playlistId: string, mediaId: string) =>
      request<{ position: number }>("POST", `/playlists/${playlistId}/items`, idToken, { mediaId }),
    removePlaylistItem: (playlistId: string, position: number) =>
      request<{ deleted: boolean }>("DELETE", `/playlists/${playlistId}/items/${position}`, idToken),

    initMultipartUpload: (body: { folderId: string; fileName: string; contentType: string; fileSize: number }) =>
      request<{ mediaId: string; s3Key: string; uploadId: string; partSize: number; totalParts: number }>(
        "POST",
        "/media/upload-url/multipart/init",
        idToken,
        body
      ),
    getMultipartPartUrl: (body: { folderId: string; s3Key: string; uploadId: string; partNumber: number }) =>
      request<{ url: string }>("POST", "/media/upload-url/multipart/part-url", idToken, body),
    // No `parts` list — the server asks S3 which parts arrived (see
    // upload-url.ts); that's the whole point of what the multipart scenario checks.
    completeMultipartUpload: (body: { folderId: string; s3Key: string; uploadId: string; totalParts: number }) =>
      request<{ completed: boolean }>("POST", "/media/upload-url/multipart/complete", idToken, body),
    abortMultipartUpload: (body: { folderId: string; s3Key: string; uploadId: string }) =>
      request<{ aborted: boolean }>("POST", "/media/upload-url/multipart/abort", idToken, body),

    getSettings: () => request<{ introEnabled: boolean }>("GET", "/settings", idToken),
    updateSettings: (introEnabled: boolean) =>
      request<{ introEnabled: boolean }>("PATCH", "/settings", idToken, { introEnabled }),
  };
}

export type Api = ReturnType<typeof makeApi>;
