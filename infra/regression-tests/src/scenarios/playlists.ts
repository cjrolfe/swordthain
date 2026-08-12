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
}
