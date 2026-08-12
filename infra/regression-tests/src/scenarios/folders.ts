import type { Api } from "../api.js";
import { ApiError } from "../api.js";
import { assert } from "../assert.js";
import { CI_TEST_FOLDER_ID } from "../config.js";

/**
 * Folder create/rename/move/delete, including the two move guard rails
 * added with the Move feature: rejecting a move into itself (400) and
 * into one of its own descendants (409). Cleans up everything it creates
 * even if an assertion fails partway through.
 */
export async function run(api: Api): Promise<void> {
  const stamp = Date.now();
  const a = await api.createFolder({ title: `regression-a-${stamp}`, parentFolderId: CI_TEST_FOLDER_ID });
  const b = await api.createFolder({ title: `regression-b-${stamp}`, parentFolderId: CI_TEST_FOLDER_ID });

  try {
    const { folders: rootChildren } = await api.listFolders(CI_TEST_FOLDER_ID);
    assert(rootChildren.some((f) => f.folderId === a.folderId), "new folder A should appear under CI Test");
    assert(rootChildren.some((f) => f.folderId === b.folderId), "new folder B should appear under CI Test");

    const renamed = await api.updateFolder(a.folderId, { title: `regression-a-renamed-${stamp}` });
    assert(renamed.title === `regression-a-renamed-${stamp}`, "rename should take effect");

    await api.updateFolder(a.folderId, { parentFolderId: b.folderId });
    const { folders: bChildren } = await api.listFolders(b.folderId);
    assert(bChildren.some((f) => f.folderId === a.folderId), "A should now be listed under B after the move");
    const { folders: rootAfterMove } = await api.listFolders(CI_TEST_FOLDER_ID);
    assert(!rootAfterMove.some((f) => f.folderId === a.folderId), "A should no longer be listed directly under CI Test");

    await assertApiError(() => api.updateFolder(b.folderId, { parentFolderId: b.folderId }), 400, "move into itself");
    await assertApiError(
      () => api.updateFolder(b.folderId, { parentFolderId: a.folderId }),
      409,
      "move into own descendant"
    );

    // A is now inside B — delete A first, then B, matching the app's
    // "must be empty first" delete rule.
    await api.deleteFolder(a.folderId);
    await api.deleteFolder(b.folderId);
    const { folders: rootAfterDelete } = await api.listFolders(CI_TEST_FOLDER_ID);
    assert(!rootAfterDelete.some((f) => f.folderId === a.folderId || f.folderId === b.folderId), "both should be gone");
  } finally {
    // Best-effort cleanup regardless of where an assertion failed above —
    // deletes are no-ops (404, ignored) if already removed by the happy path.
    await api.deleteFolder(a.folderId).catch(() => {});
    await api.deleteFolder(b.folderId).catch(() => {});
  }
}

async function assertApiError(fn: () => Promise<unknown>, expectedStatus: number, label: string): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ApiError && err.status === expectedStatus) return;
    throw new Error(`expected ${label} to fail with ${expectedStatus}, got: ${err}`);
  }
  throw new Error(`expected ${label} to be rejected, but it succeeded`);
}
