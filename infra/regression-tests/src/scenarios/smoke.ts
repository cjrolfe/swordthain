import type { Api } from "../api.js";
import { assert } from "../assert.js";
import { CI_TEST_FOLDER_ID } from "../config.js";

/** Fast canary: sign-in already happened before this runs, so this just confirms the CI Test folder is actually reachable. */
export async function run(api: Api): Promise<void> {
  const { folders } = await api.listFolders(CI_TEST_FOLDER_ID);
  assert(Array.isArray(folders), "listFolders should return an array even when empty");
}
