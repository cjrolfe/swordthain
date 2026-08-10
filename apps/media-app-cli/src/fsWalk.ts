import { readdir } from "node:fs/promises";
import { join } from "node:path";

export interface WalkEntry {
  path: string;
  name: string;
}

/** One directory level (not recursive — the caller recurses so it can interleave folder resolution). */
export async function readDirLevel(dir: string): Promise<{ dirs: WalkEntry[]; files: WalkEntry[] }> {
  const entries = await readdir(dir, { withFileTypes: true });
  const dirs: WalkEntry[] = [];
  const files: WalkEntry[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) dirs.push({ path, name: entry.name });
    else if (entry.isFile()) files.push({ path, name: entry.name });
  }
  return { dirs, files };
}
