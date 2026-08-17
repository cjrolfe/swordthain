import type { Api } from "../api.js";
import { assert } from "../assert.js";
import { createSyntheticVideoItem, deleteMediaItemRow } from "../db.js";

/** Playlist create → add item → list → remove item → delete. */
export async function run(api: Api): Promise<void> {
  const stamp = Date.now();
  const mediaId = await createSyntheticVideoItem(`regression-video-${stamp}.mp4`);
  const playlist = await api.createPlaylist(`regression-playlist-${stamp}`);

  try {
    await api.addPlaylistItem(playlist.playlistId, mediaId);
    const { items } = await api.getPlaylistItems(playlist.playlistId);
    assert(items.length === 1, `expected 1 item in the playlist, got ${items.length}`);
    assert(items[0].mediaId === mediaId, "the added item should be the one we just created");

    await api.removePlaylistItem(playlist.playlistId, items[0].position);
    const { items: afterRemove } = await api.getPlaylistItems(playlist.playlistId);
    assert(afterRemove.length === 0, "playlist should be empty after removing the only item");

    await api.deletePlaylist(playlist.playlistId);
    const { playlists } = await api.listPlaylists();
    assert(!playlists.some((p) => p.playlistId === playlist.playlistId), "playlist should be gone after delete");
  } finally {
    await api.deletePlaylist(playlist.playlistId).catch(() => {});
    await deleteMediaItemRow(mediaId).catch(() => {});
  }

  await runCascadeCleanup(api);
}

/**
 * One media item added to TWO playlists, plus an unrelated item in one of
 * them (to prove untouched items keep their position/count), deleted via
 * the real DELETE /media/{id} endpoint — proves MediaAccessFn's byMedia-GSI
 * cascade removes the PlaylistItems row from every playlist that had it and
 * decrements each affected playlist's itemCount, not just that GET reports
 * available:false (the pre-existing advisory behavior, unrelated to this).
 */
async function runCascadeCleanup(api: Api): Promise<void> {
  const stamp = Date.now();
  const cascadeMediaId = await createSyntheticVideoItem(`regression-cascade-${stamp}.mp4`);
  const otherMediaId = await createSyntheticVideoItem(`regression-cascade-other-${stamp}.mp4`);
  const playlistA = await api.createPlaylist(`regression-cascade-a-${stamp}`);
  const playlistB = await api.createPlaylist(`regression-cascade-b-${stamp}`);

  try {
    await api.addPlaylistItem(playlistA.playlistId, cascadeMediaId);
    await api.addPlaylistItem(playlistB.playlistId, cascadeMediaId);
    const otherAdd = await api.addPlaylistItem(playlistA.playlistId, otherMediaId);

    await api.deleteMedia(cascadeMediaId);

    const [itemsA, itemsB, plA, plB] = await Promise.all([
      api.getPlaylistItems(playlistA.playlistId),
      api.getPlaylistItems(playlistB.playlistId),
      api.getPlaylist(playlistA.playlistId),
      api.getPlaylist(playlistB.playlistId),
    ]);
    assert(
      !itemsA.items.some((i) => i.mediaId === cascadeMediaId),
      "cascade-deleted media should be gone from playlist A's items, not just marked unavailable"
    );
    assert(!itemsB.items.some((i) => i.mediaId === cascadeMediaId), "cascade-deleted media should be gone from playlist B");
    assert(
      itemsA.items.some((i) => i.mediaId === otherMediaId && i.position === otherAdd.position),
      "unrelated item in playlist A should be untouched, at its original position"
    );
    assert(plA.itemCount === 1, `playlist A itemCount should be 1 after cascade cleanup, got ${plA.itemCount}`);
    assert(plB.itemCount === 0, `playlist B itemCount should be 0 after cascade cleanup, got ${plB.itemCount}`);
  } finally {
    await api.deletePlaylist(playlistA.playlistId).catch(() => {});
    await api.deletePlaylist(playlistB.playlistId).catch(() => {});
    await deleteMediaItemRow(otherMediaId).catch(() => {});
    await deleteMediaItemRow(cascadeMediaId).catch(() => {}); // no-op if deleteMedia already removed it
  }
}
