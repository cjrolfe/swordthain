import { getValidIdToken } from "./auth";

const API_URL = import.meta.env.VITE_API_URL;

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await getValidIdToken();
  if (!token) throw new ApiError("Not signed in", 401);

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export interface Folder {
  folderId: string;
  parentFolderId: string;
  title: string;
  date: string | null;
  guestUploadEnabled: boolean;
  coverThumbnail: string | null;
  createdAt: string;
  /** Only present for a Member's own folders — their resolved permission on this folder. */
  myPermission?: Permission;
}

export interface MediaItem {
  mediaId: string;
  folderId: string;
  type: "photo" | "video";
  fileName: string;
  thumbnailUrl: string | null;
  uploadedAt: string;
}

export type Permission = "view" | "download" | "upload";

export interface Friend {
  userId: string;
  email: string;
  enabled: boolean;
  status: string;
}

export interface Share {
  folderId: string;
  userId: string;
  email: string;
  permission: Permission;
  grantedAt: string;
}

export interface PermissionsMatrix {
  folders: Folder[];
  friends: Friend[];
  shares: Share[];
}

export const api = {
  listFolders: (parentId?: string) =>
    request<{ folders: Folder[] }>("GET", `/folders${parentId ? `?parentId=${encodeURIComponent(parentId)}` : ""}`),
  getFolder: (folderId: string) => request<Folder>("GET", `/folders/${folderId}`),
  createFolder: (body: { title: string; parentFolderId?: string; date?: string }) =>
    request<Folder>("POST", "/folders", body),
  renameFolder: (folderId: string, title: string) => request<Folder>("PATCH", `/folders/${folderId}`, { title }),
  deleteFolder: (folderId: string) => request<{ deleted: boolean }>("DELETE", `/folders/${folderId}`),
  listFolderMedia: (folderId: string, opts: { type: "photo" | "video"; cursor?: string; limit?: number }) => {
    const params = new URLSearchParams({ type: opts.type });
    if (opts.cursor) params.set("cursor", opts.cursor);
    if (opts.limit) params.set("limit", String(opts.limit));
    return request<{ media: MediaItem[]; nextCursor: string | null }>(
      "GET",
      `/folders/${folderId}/media?${params.toString()}`
    );
  },
  getUploadUrl: (body: { folderId: string; fileName: string; contentType: string }) =>
    request<{ mediaId: string; s3Key: string; uploadUrl: string; expiresIn: number }>(
      "POST",
      "/media/upload-url",
      body
    ),

  permissionsMatrix: () => request<PermissionsMatrix>("GET", "/admin/permissions-matrix"),
  updateShare: (folderId: string, body: { action: "grant" | "revoke"; email: string; permission?: Permission }) =>
    request("POST", `/folders/${folderId}/shares`, body),

  invite: (body: { email: string; folderId?: string; permission?: Permission; message?: string }) =>
    request("POST", "/admin/invites", body),

  viewUrl: (mediaId: string) => request<{ url: string; expiresIn: number }>("GET", `/media/${mediaId}/view-url`),
  downloadUrl: (mediaId: string) =>
    request<{ url: string; expiresIn: number }>("GET", `/media/${mediaId}/download-url`),

  activity: (filter: { folderId?: string; userId?: string }) => {
    const params = new URLSearchParams();
    if (filter.folderId) params.set("folderId", filter.folderId);
    if (filter.userId) params.set("userId", filter.userId);
    return request<{ activity: ActivityEntry[] }>("GET", `/admin/activity?${params.toString()}`);
  },

  stats: () => request<StorageStats>("GET", "/admin/stats"),

  listPlaylists: () => request<{ playlists: Playlist[] }>("GET", "/playlists"),
  createPlaylist: (name: string) => request<Playlist>("POST", "/playlists", { name }),
  renamePlaylist: (playlistId: string, name: string) =>
    request<Playlist>("PATCH", `/playlists/${playlistId}`, { name }),
  deletePlaylist: (playlistId: string) => request<{ deleted: boolean }>("DELETE", `/playlists/${playlistId}`),
  getPlaylistItems: (playlistId: string) =>
    request<{ playlistId: string; name: string; items: PlaylistItem[] }>("GET", `/playlists/${playlistId}/items`),
  addPlaylistItem: (playlistId: string, mediaId: string) =>
    request<{ position: number }>("POST", `/playlists/${playlistId}/items`, { mediaId }),
  removePlaylistItem: (playlistId: string, position: number) =>
    request<{ deleted: boolean }>("DELETE", `/playlists/${playlistId}/items/${position}`),
};

export interface ActivityEntry {
  logId: string;
  userId: string;
  email: string;
  mediaId: string;
  fileName: string;
  folderId: string;
  folderTitle: string;
  action: "view" | "download";
  timestamp: string;
}

export interface Playlist {
  playlistId: string;
  ownerUserId: string;
  name: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
  /** True if the current signed-in user created this playlist. */
  isMine: boolean;
  /** Only present when the caller is Owner viewing everyone's playlists. */
  ownerEmail?: string;
}

export interface PlaylistItem {
  position: number;
  mediaId: string;
  addedAt: string;
  fileName: string | null;
  folderId: string | null;
  thumbnailUrl: string | null;
  /** False if the underlying media record no longer exists. */
  available: boolean;
  /**
   * Advisory only, computed at list-time — for greying out UI. The
   * authoritative access check is api.viewUrl(mediaId), called fresh at
   * playback time, which re-validates on every call. Never gate playback
   * itself on this flag.
   */
  accessible: boolean;
}

export interface StorageStats {
  storage: {
    totalBytes: number;
    objectCount: number;
    byTier: {
      standardBytes: number;
      intelligentTieringFrequentBytes: number;
      intelligentTieringInfrequentBytes: number;
      intelligentTieringArchiveInstantBytes: number;
    };
    estimatedMonthlyCostUsd: number;
  };
  security: {
    wafBlockedRequests: number;
    api4xxErrors: number;
    api5xxErrors: number;
    apiThrottleCount: number;
  };
  itemCounts: Record<string, number>;
  lambdaErrors: { label: string; errorsLast7Days: number }[];
  ses: { productionAccessEnabled: boolean; max24HourSend: number; sentLast24Hours: number } | null;
}
