import type { Api, MediaItem } from "../api.js";
import { assert } from "../assert.js";
import { CI_TEST_FOLDER_ID } from "../config.js";

// A minimal valid 1x1 JPEG — small enough to embed directly, real enough
// for Sharp (the photo thumbnail path) to process without error.
const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=";

function tinyJpegBytes(): Uint8Array {
  const bin = atob(TINY_JPEG_BASE64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function waitForMediaItem(api: Api, fileName: string, attempts = 10, delayMs = 1500): Promise<MediaItem> {
  for (let i = 0; i < attempts; i++) {
    const { media } = await api.listFolderMedia(CI_TEST_FOLDER_ID, "photo");
    const found = media.find((m) => m.fileName === fileName);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`ThumbnailFn never produced a MediaItems row for ${fileName} after ${attempts * delayMs}ms`);
}

/**
 * Upload → thumbnail generation completing → set/clear description →
 * delete, confirming each step against the real deployed pipeline (S3 +
 * ThumbnailFn + DynamoDB), not just the API's immediate response.
 */
export async function run(api: Api): Promise<void> {
  const fileName = `regression-photo-${Date.now()}.jpg`;
  const { mediaId, uploadUrl } = await api.getUploadUrl({
    folderId: CI_TEST_FOLDER_ID,
    fileName,
    contentType: "image/jpeg",
  });

  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": "image/jpeg" },
    body: tinyJpegBytes(),
  });
  assert(putRes.ok, `S3 PUT should succeed, got ${putRes.status}`);

  try {
    const item = await waitForMediaItem(api, fileName);
    assert(item.mediaId === mediaId, "the processed item should have the mediaId the presign call returned");
    assert(item.thumbnailUrl !== null, "a photo should get a thumbnail URL once processed");

    const described = await api.updateMediaDescription(mediaId, "Regression test description");
    assert(described.description === "Regression test description", "description should be set");

    const cleared = await api.updateMediaDescription(mediaId, "");
    assert(!cleared.description, "an empty description should clear it back to falling back on the filename");

    await api.deleteMedia(mediaId);
    const { media: afterDelete } = await api.listFolderMedia(CI_TEST_FOLDER_ID, "photo");
    assert(!afterDelete.some((m) => m.mediaId === mediaId), "media should be gone after delete");
  } finally {
    await api.deleteMedia(mediaId).catch(() => {});
  }
}
