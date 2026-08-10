import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { MULTIPART_STATE_DIR } from "./config.js";

export interface MultipartUploadState {
  mediaId: string;
  s3Key: string;
  uploadId: string;
  partSize: number;
  totalParts: number;
  completedParts: { partNumber: number; etag: string }[];
}

/** Same identity tuple the browser uses for its localStorage resume key, hashed for a safe filename. */
function stateKey(folderId: string, fileName: string, fileSize: number, mtimeMs: number): string {
  const raw = `${folderId}:${fileName}:${fileSize}:${mtimeMs}`;
  return createHash("sha256").update(raw).digest("hex");
}

function stateFilePath(key: string): string {
  return join(MULTIPART_STATE_DIR, `${key}.json`);
}

export async function loadMultipartState(
  folderId: string,
  fileName: string,
  fileSize: number,
  mtimeMs: number
): Promise<MultipartUploadState | null> {
  try {
    const raw = await readFile(stateFilePath(stateKey(folderId, fileName, fileSize, mtimeMs)), "utf8");
    return JSON.parse(raw) as MultipartUploadState;
  } catch {
    return null;
  }
}

export async function saveMultipartState(
  folderId: string,
  fileName: string,
  fileSize: number,
  mtimeMs: number,
  state: MultipartUploadState
): Promise<void> {
  await mkdir(MULTIPART_STATE_DIR, { recursive: true });
  await writeFile(stateFilePath(stateKey(folderId, fileName, fileSize, mtimeMs)), JSON.stringify(state));
}

export async function clearMultipartState(
  folderId: string,
  fileName: string,
  fileSize: number,
  mtimeMs: number
): Promise<void> {
  await rm(stateFilePath(stateKey(folderId, fileName, fileSize, mtimeMs)), { force: true });
}
