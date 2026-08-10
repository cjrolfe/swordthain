import { API_URL } from "./config.js";
import { getValidIdToken } from "./auth.js";

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, emailArg?: string): Promise<T> {
  const idToken = await getValidIdToken(emailArg);
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${idToken}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export interface Folder {
  folderId: string;
  parentFolderId: string;
  title: string;
  guestUploadEnabled: boolean;
}

export const api = {
  listFolders: (parentId: string | undefined, emailArg?: string) =>
    request<{ folders: Folder[] }>(
      "GET",
      `/folders${parentId ? `?parentId=${encodeURIComponent(parentId)}` : ""}`,
      undefined,
      emailArg
    ),
  createFolder: (body: { title: string; parentFolderId?: string }, emailArg?: string) =>
    request<Folder>("POST", "/folders", body, emailArg),

  getUploadUrl: (body: { folderId: string; fileName: string; contentType: string }, emailArg?: string) =>
    request<{ mediaId: string; s3Key: string; uploadUrl: string; expiresIn: number }>(
      "POST",
      "/media/upload-url",
      body,
      emailArg
    ),
  initMultipartUpload: (
    body: { folderId: string; fileName: string; contentType: string; fileSize: number },
    emailArg?: string
  ) =>
    request<{ mediaId: string; s3Key: string; uploadId: string; partSize: number; totalParts: number }>(
      "POST",
      "/media/upload-url/multipart/init",
      body,
      emailArg
    ),
  getMultipartPartUrl: (
    body: { folderId: string; s3Key: string; uploadId: string; partNumber: number },
    emailArg?: string
  ) => request<{ url: string }>("POST", "/media/upload-url/multipart/part-url", body, emailArg),
  completeMultipartUpload: (
    body: { folderId: string; s3Key: string; uploadId: string; parts: { partNumber: number; etag: string }[] },
    emailArg?: string
  ) => request<{ completed: boolean }>("POST", "/media/upload-url/multipart/complete", body, emailArg),
  abortMultipartUpload: (body: { folderId: string; s3Key: string; uploadId: string }, emailArg?: string) =>
    request<{ aborted: boolean }>("POST", "/media/upload-url/multipart/abort", body, emailArg),
};
