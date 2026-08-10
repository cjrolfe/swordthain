import { open, readFile, stat } from "node:fs/promises";
import { api } from "./api.js";
import type { UploadTask } from "./mirror.js";
import { loadMultipartState, saveMultipartState, clearMultipartState } from "./multipartState.js";

// Same threshold as apps/media-app/src/components/FolderBrowser.tsx and the
// server's presigned-PUT limit — S3's hard cap for a single PUT.
const MULTIPART_THRESHOLD = 5 * 1024 * 1024 * 1024;

export type UploadEvent =
  | { type: "upload-start"; task: UploadTask }
  | { type: "upload-progress"; task: UploadTask; message: string }
  | { type: "upload-done"; task: UploadTask }
  | { type: "upload-error"; task: UploadTask; message: string };

/**
 * S3 presigned PUT URLs reject chunked transfer encoding (501 Not
 * Implemented) — Node's fetch only avoids chunking when the body has a
 * known byte length, so reads must be buffered rather than streamed. Whole
 * files for single-PUT (≤5GB), byte ranges for multipart parts (≤50MB) —
 * bounded by the same threshold that decides which path is used at all.
 */
async function readRange(path: string, start?: number, end?: number): Promise<Buffer> {
  if (start === undefined) return readFile(path);
  const length = end! - start + 1;
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    return buffer;
  } finally {
    await handle.close();
  }
}

async function putBuffer(url: string, path: string, contentType: string, start?: number, end?: number): Promise<Response> {
  const body = await readRange(path, start, end);
  return fetch(url, { method: "PUT", headers: { "content-type": contentType }, body });
}

async function uploadSingle(task: UploadTask, emailArg: string | undefined): Promise<void> {
  const { uploadUrl } = await api.getUploadUrl(
    { folderId: task.folderId, fileName: task.fileName, contentType: task.contentType },
    emailArg
  );
  const res = await putBuffer(uploadUrl, task.localPath, task.contentType);
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
}

async function uploadMultipart(
  task: UploadTask,
  emailArg: string | undefined,
  onProgress: (message: string) => void
): Promise<void> {
  const stats = await stat(task.localPath);
  const existing = await loadMultipartState(task.folderId, task.fileName, stats.size, stats.mtimeMs);

  const state = existing ?? {
    ...(await api.initMultipartUpload(
      { folderId: task.folderId, fileName: task.fileName, contentType: task.contentType, fileSize: stats.size },
      emailArg
    )),
    completedParts: [] as { partNumber: number; etag: string }[],
  };
  if (!existing) await saveMultipartState(task.folderId, task.fileName, stats.size, stats.mtimeMs, state);

  const completedPartNumbers = new Set(state.completedParts.map((p) => p.partNumber));
  onProgress(`Part ${state.completedParts.length}/${state.totalParts}`);

  for (let partNumber = 1; partNumber <= state.totalParts; partNumber++) {
    if (completedPartNumbers.has(partNumber)) continue;

    const { url } = await api.getMultipartPartUrl(
      { folderId: task.folderId, s3Key: state.s3Key, uploadId: state.uploadId, partNumber },
      emailArg
    );
    const start = (partNumber - 1) * state.partSize;
    const end = Math.min(start + state.partSize, stats.size) - 1;
    const res = await putBuffer(url, task.localPath, task.contentType, start, end);
    if (!res.ok) throw new Error(`Part ${partNumber} of ${state.totalParts} failed (${res.status})`);
    const etag = res.headers.get("ETag");
    if (!etag) throw new Error(`Part ${partNumber} response missing ETag`);

    state.completedParts.push({ partNumber, etag });
    await saveMultipartState(task.folderId, task.fileName, stats.size, stats.mtimeMs, state);
    onProgress(`Part ${state.completedParts.length}/${state.totalParts} (${Math.round((state.completedParts.length / state.totalParts) * 100)}%)`);
  }

  await api.completeMultipartUpload(
    { folderId: task.folderId, s3Key: state.s3Key, uploadId: state.uploadId, parts: state.completedParts },
    emailArg
  );
  await clearMultipartState(task.folderId, task.fileName, stats.size, stats.mtimeMs);
}

async function uploadOne(task: UploadTask, emailArg: string | undefined, emit: (e: UploadEvent) => void): Promise<boolean> {
  emit({ type: "upload-start", task });
  try {
    const stats = await stat(task.localPath);
    if (stats.size <= MULTIPART_THRESHOLD) {
      await uploadSingle(task, emailArg);
    } else {
      await uploadMultipart(task, emailArg, (message) => emit({ type: "upload-progress", task, message }));
    }
    emit({ type: "upload-done", task });
    return true;
  } catch (err) {
    emit({ type: "upload-error", task, message: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/** Runs uploads with a bounded worker pool; never aborts the run for one file's failure. */
export async function runUploads(
  tasks: UploadTask[],
  concurrency: number,
  emailArg: string | undefined,
  emit: (e: UploadEvent) => void
): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = next++;
      if (index >= tasks.length) return;
      const ok = await uploadOne(tasks[index], emailArg, emit);
      if (ok) succeeded++;
      else failed++;
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
  return { succeeded, failed };
}
