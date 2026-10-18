import type { Api, MediaItem } from "../api.js";
import { ApiError } from "../api.js";
import { assert } from "../assert.js";
import { CI_TEST_FOLDER_ID } from "../config.js";
import { tinyJpegBytes } from "./media.js";

async function waitForPhotoIn(api: Api, folderId: string, mediaId: string, attempts = 12, delayMs = 1500): Promise<MediaItem> {
  for (let i = 0; i < attempts; i++) {
    const { media } = await api.listFolderMedia(folderId, "photo");
    const found = media.find((m) => m.mediaId === mediaId);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`ThumbnailFn never produced a MediaItems row for ${mediaId} in folder ${folderId}`);
}

async function expectApiError(fn: () => Promise<unknown>, status: number, label: string): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ApiError && err.status === status) return;
    throw new Error(`expected ${label} to fail with ${status}, got: ${err}`);
  }
  throw new Error(`expected ${label} to be rejected, but it succeeded`);
}

/**
 * Owner-only "move a media item to another folder" (PATCH /media/{id} with
 * folderId). A move re-points the record at the new folder and leaves the S3
 * objects where they were — so besides checking it shows up in the new
 * folder and disappears from the old one, this checks its thumbnail (served
 * from the stored thumbnailKey) still loads afterward, which is exactly what
 * would break if anything rebuilt a key from the folder. Only covers the
 * Owner path: no Member test account exists in this suite to check that a
 * Member gets a 403.
 */
export async function run(api: Api): Promise<void> {
  const stamp = Date.now();
  const from = await api.createFolder({ title: `regression-move-from-${stamp}`, parentFolderId: CI_TEST_FOLDER_ID });
  const to = await api.createFolder({ title: `regression-move-to-${stamp}`, parentFolderId: CI_TEST_FOLDER_ID });
  let mediaId: string | undefined;

  try {
    const fileName = `regression-move-${stamp}.jpg`;
    const upload = await api.getUploadUrl({ folderId: from.folderId, fileName, contentType: "image/jpeg" });
    mediaId = upload.mediaId;
    const put = await fetch(upload.uploadUrl, { method: "PUT", headers: { "content-type": "image/jpeg" }, body: tinyJpegBytes() });
    assert(put.ok, `S3 PUT should succeed, got ${put.status}`);
    await waitForPhotoIn(api, from.folderId, mediaId);

    const moved = await api.moveMedia(mediaId, to.folderId);
    assert(moved.folderId === to.folderId, "the PATCH response should show the new folderId");

    const { media: inTo } = await api.listFolderMedia(to.folderId, "photo");
    const arrived = inTo.find((m) => m.mediaId === mediaId);
    assert(!!arrived, "the item should be listed in the destination folder (also proves folderIdType moved, since listing uses it)");
    const { media: inFrom } = await api.listFolderMedia(from.folderId, "photo");
    assert(!inFrom.some((m) => m.mediaId === mediaId), "the item should no longer be listed in the source folder");

    assert(arrived!.thumbnailUrl !== null, "a moved photo should still have a thumbnail URL");
    const thumb = await fetch(arrived!.thumbnailUrl!);
    assert(thumb.ok, `the moved item's thumbnail should still load from S3, got ${thumb.status}`);

    await expectApiError(() => api.moveMedia(mediaId!, crypto.randomUUID()), 404, "moving into a folder that doesn't exist");
    await expectApiError(() => api.moveMedia(crypto.randomUUID(), to.folderId), 404, "moving a media item that doesn't exist");
    await expectApiError(() => api.patchMediaRaw(mediaId!, {}), 400, "an update with neither description nor folderId");
    await expectApiError(() => api.patchMediaRaw(mediaId!, { folderId: "" }), 400, "an empty folderId");

    // Deleting a moved item has to find its files via the stored keys too.
    await api.deleteMedia(mediaId);
    const { media: afterDelete } = await api.listFolderMedia(to.folderId, "photo");
    assert(!afterDelete.some((m) => m.mediaId === mediaId), "the moved item should be gone after delete");
    mediaId = undefined;
  } finally {
    if (mediaId) await api.deleteMedia(mediaId).catch(() => {});
    await api.deleteFolder(from.folderId).catch(() => {});
    await api.deleteFolder(to.folderId).catch(() => {});
  }
}
