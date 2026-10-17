import type { Api, MediaItem } from "../api.js";
import { ApiError } from "../api.js";
import { assert } from "../assert.js";
import { CI_TEST_FOLDER_ID } from "../config.js";
import { tinyJpegBytes } from "./media.js";

// A 2-second, 64x64 H.264 clip (~2KB) — real enough for ffmpeg to grab a
// frame at 00:00:01, which is where ThumbnailFn looks (a 1s clip would have
// no frame there at all).
const TINY_MP4_BASE64 =
  "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAPgbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAB9AAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAwt0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAB9AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAEAAAABAAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAfQAAAIAAABAAAAAAKDbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAUABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAACLm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAe5zdGJsAAAAwnN0c2QAAAAAAAAAAQAAALJhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAEAAQABIAAAASAAAAAAAAAABFExhdmM2My4xLjEwMiBsaWJ4MjY0AAAAAAAAAAAAAAAAGP//AAAAOGF2Y0MBZAAK/+EAGmdkAAqscgREJsBEAAADAAQAAAMAUDxIlhGAAQAHaOhDg5LIsP34+AAAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAAPeAAAAAAAAAAYc3R0cwAAAAAAAAABAAAAFAAABAAAAAAYc3RzcwAAAAAAAAACAAAAAQAAAAsAAABgY3R0cwAAAAAAAAAKAAAAAQAACAAAAAABAAAoAAAAAAEAABAAAAAAAwAAAAAAAAAEAAAEAAAAAAEAAAgAAAAAAQAAKAAAAAABAAAQAAAAAAMAAAAAAAAABAAABAAAAAAcc3RzYwAAAAAAAAABAAAAAQAAABQAAAABAAAAZHN0c3oAAAAAAAAAAAAAABQAAALSAAAADQAAAA0AAAANAAAADQAAAA0AAAANAAAADQAAAA0AAAANAAAAIgAAAA0AAAANAAAADQAAAA0AAAANAAAADQAAAA0AAAANAAAADQAAABRzdGNvAAAAAAAAAAEAAAQQAAAAYXVkdGEAAABZbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAsaWxzdAAAACSpdG9vAAAAHGRhdGEAAAABAAAAAExhdmY2My4xLjEwMgAAAAhmcmVlAAAD5m1kYXQAAAKuBgX//6rcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIzMjIyIGIzNTYwNWEgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MTYgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDEzMyBtZT11bWggc3VibWU9MTAgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0yNCBjaHJvbWFfbWU9MSB0cmVsbGlzPTIgOHg4ZGN0PTEgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0yIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9OCBiX3B5cmFtaWQ9MiBiX2FkYXB0PTIgYl9iaWFzPTAgZGlyZWN0PTMgd2VpZ2h0Yj0xIG9wZW5fZ29wPTAgd2VpZ2h0cD0yIGtleWludD0xMCBrZXlpbnRfbWluPTEgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD0xMCByYz1jcmYgbWJ0cmVlPTEgY3JmPTQwLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAcZYiBAAI//tkHwKVjrQlUrJKLfzLw3ow/rrFbwQAAAAlBmgktiG//AsYAAAAJQZ4QhxBD/zghAAAACQGeGCaIb/9GQAAAAAkBnhhGiG//RkEAAAAJAZ4YZohv/0ZBAAAACQGeGK1Ib/9GQQAAAAkBnhjNSG//RkEAAAAJAZ4Y7Uhv/0ZAAAAACQGeGQ1Ib/9GQAAAAB5liICAAJ///uVF5ljbrcIS9MuAkNi9Fao7nbngS4EAAAAJQZoJLYhv/wLGAAAACUGeEIcQQ/84IAAAAAkBnhgmiG//RkEAAAAJAZ4YRohv/0ZBAAAACQGeGGaIb/9GQQAAAAkBnhitSG//RkAAAAAJAZ4YzUhv/0ZAAAAACQGeGO1Ib/9GQQAAAAkBnhkNSG//RkA=";

function tinyMp4Bytes(): Uint8Array {
  return Uint8Array.from(Buffer.from(TINY_MP4_BASE64, "base64"));
}

async function waitForMediaItem(
  api: Api,
  type: "photo" | "video",
  fileName: string,
  attempts = 20,
  delayMs = 1500
): Promise<MediaItem> {
  for (let i = 0; i < attempts; i++) {
    const { media } = await api.listFolderMedia(CI_TEST_FOLDER_ID, type);
    const found = media.find((m) => m.fileName === fileName);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`ThumbnailFn never produced a MediaItems row for ${fileName} after ${attempts * delayMs}ms`);
}

/**
 * Uploads a tiny photo and a tiny video through the real multipart flow
 * and completes each one WITHOUT sending a parts list — the server asks S3
 * which parts arrived. That's the fix for large web uploads being blocked
 * by the WAF's 8KB request-body limit (a 12GB upload's parts list was
 * 15KB). The video also exercises ThumbnailFn's read-from-presigned-URL
 * path end to end. Last, confirms a half-finished upload is refused
 * rather than finalized as a truncated file.
 */
export async function run(api: Api): Promise<void> {
  const stamp = Date.now();
  const created: string[] = [];
  try {
    for (const { type, contentType, fileName, bytes } of [
      { type: "photo" as const, contentType: "image/jpeg", fileName: `regression-mp-${stamp}.jpg`, bytes: tinyJpegBytes() },
      { type: "video" as const, contentType: "video/mp4", fileName: `regression-mp-${stamp}.mp4`, bytes: tinyMp4Bytes() },
    ]) {
      const init = await api.initMultipartUpload({
        folderId: CI_TEST_FOLDER_ID,
        fileName,
        contentType,
        fileSize: bytes.length,
      });
      created.push(init.mediaId);
      assert(init.totalParts === 1, `a ${bytes.length}-byte file should be a single part, got ${init.totalParts}`);

      const { url } = await api.getMultipartPartUrl({
        folderId: CI_TEST_FOLDER_ID,
        s3Key: init.s3Key,
        uploadId: init.uploadId,
        partNumber: 1,
      });
      const putRes = await fetch(url, { method: "PUT", body: bytes });
      assert(putRes.ok, `part PUT should succeed, got ${putRes.status}`);

      const done = await api.completeMultipartUpload({
        folderId: CI_TEST_FOLDER_ID,
        s3Key: init.s3Key,
        uploadId: init.uploadId,
        totalParts: init.totalParts,
      });
      assert(done.completed === true, "complete (with no parts list) should succeed");

      const item = await waitForMediaItem(api, type, fileName);
      assert(item.mediaId === init.mediaId, `the processed ${type} should carry the mediaId init returned`);
      assert(item.thumbnailUrl !== null, `a ${type} should get a thumbnail once processed`);
    }

    // Truncation guard: claim two parts, upload only the first, try to complete.
    const partial = await api.initMultipartUpload({
      folderId: CI_TEST_FOLDER_ID,
      fileName: `regression-mp-partial-${stamp}.mp4`,
      contentType: "video/mp4",
      fileSize: 60 * 1024 * 1024,
    });
    try {
      assert(partial.totalParts === 2, `60MB should be two 50MB parts, got ${partial.totalParts}`);
      const { url } = await api.getMultipartPartUrl({
        folderId: CI_TEST_FOLDER_ID,
        s3Key: partial.s3Key,
        uploadId: partial.uploadId,
        partNumber: 1,
      });
      assert((await fetch(url, { method: "PUT", body: tinyMp4Bytes() })).ok, "part 1 PUT should succeed");
      try {
        await api.completeMultipartUpload({
          folderId: CI_TEST_FOLDER_ID,
          s3Key: partial.s3Key,
          uploadId: partial.uploadId,
          totalParts: partial.totalParts,
        });
        throw new Error("completing with a part missing should have been refused, but it succeeded");
      } catch (err) {
        assert(err instanceof ApiError && err.status === 409, `expected 409 for a missing part, got: ${err}`);
      }
    } finally {
      await api
        .abortMultipartUpload({ folderId: CI_TEST_FOLDER_ID, s3Key: partial.s3Key, uploadId: partial.uploadId })
        .catch(() => {});
    }
  } finally {
    for (const mediaId of created) await api.deleteMedia(mediaId).catch(() => {});
  }
}
