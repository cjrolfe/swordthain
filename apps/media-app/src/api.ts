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
  listFolderMedia: (folderId: string) => request<{ media: MediaItem[] }>("GET", `/folders/${folderId}/media`),

  permissionsMatrix: () => request<PermissionsMatrix>("GET", "/admin/permissions-matrix"),
  updateShare: (folderId: string, body: { action: "grant" | "revoke"; email: string; permission?: Permission }) =>
    request("POST", `/folders/${folderId}/shares`, body),

  invite: (body: { email: string; folderId?: string; permission?: Permission; message?: string }) =>
    request("POST", "/admin/invites", body),

  viewUrl: (mediaId: string) => request<{ url: string; expiresIn: number }>("GET", `/media/${mediaId}/view-url`),
  downloadUrl: (mediaId: string) =>
    request<{ url: string; expiresIn: number }>("GET", `/media/${mediaId}/download-url`),
};
