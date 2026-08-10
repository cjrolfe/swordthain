import { basename } from "node:path";
import { api, type Folder } from "./api.js";
import { readDirLevel } from "./fsWalk.js";
import { contentTypeForFile } from "./contentType.js";

interface ResolvedFolder {
  folderId: string;
  created: boolean;
  /** True once anywhere on this path a folder was hypothetical (--dry-run, not yet created) — descendants must stay hypothetical too, since there's nothing real to list children of. */
  hypothetical: boolean;
}

/**
 * Finds or creates a remote folder matching `title` under `parentFolderId`
 * (undefined means root). Exact case-sensitive match only — folder titles
 * aren't unique-constrained server-side, so fuzzy/case-insensitive matching
 * risks silently merging or picking the wrong one of several near-matches.
 * Two or more matches abort the whole run rather than guessing.
 *
 * In dry-run mode (or once any ancestor was only hypothetically "created"),
 * never calls the mutating create API — reports what *would* happen instead.
 */
export async function findOrCreateFolder(
  title: string,
  parentFolderId: string | undefined,
  emailArg: string | undefined,
  dryRun: boolean,
  parentHypothetical = false
): Promise<ResolvedFolder> {
  if (parentHypothetical) {
    // Nothing real exists under a not-yet-created parent — nothing to list, must be a hypothetical create.
    return { folderId: `(dry-run: ${title})`, created: true, hypothetical: true };
  }

  const { folders } = await api.listFolders(parentFolderId, emailArg);
  const matches = folders.filter((f) => f.title === title);

  if (matches.length > 1) {
    const detail = matches.map((f) => `"${f.title}" (${f.folderId})`).join(", ");
    throw new Error(
      `Ambiguous: ${matches.length} folders named "${title}" already exist under this parent: ${detail}. ` +
        `Rename/dedupe them in the web app first, then re-run.`
    );
  }
  if (matches.length === 1) return { folderId: matches[0].folderId, created: false, hypothetical: false };

  if (dryRun) return { folderId: `(dry-run: ${title})`, created: true, hypothetical: true };

  const folder: Folder = await api.createFolder({ title, parentFolderId }, emailArg);
  return { folderId: folder.folderId, created: true, hypothetical: false };
}

/** Resolves a "/"-separated remote parent path (e.g. "A/B"), creating segments as needed. */
export async function resolveParentPath(
  parentPath: string | undefined,
  emailArg: string | undefined,
  dryRun: boolean
): Promise<string | undefined> {
  if (!parentPath) return undefined;
  let currentParentId: string | undefined;
  let hypothetical = false;
  for (const segment of parentPath.split("/").filter(Boolean)) {
    const resolved = await findOrCreateFolder(segment, currentParentId, emailArg, dryRun, hypothetical);
    currentParentId = resolved.folderId;
    hypothetical = resolved.hypothetical;
  }
  return currentParentId;
}

export interface UploadTask {
  localPath: string;
  fileName: string;
  contentType: string;
  folderId: string;
  folderLabel: string;
}

export type MirrorEvent =
  | { type: "folder"; label: string; folderId: string; created: boolean }
  | { type: "skip"; label: string; reason: string };

/**
 * Recursively mirrors `localRoot` into remote folders under `remoteParentId`
 * (find-or-create at each level), interleaving folder resolution with file
 * discovery so nothing downstream of an ambiguous/duplicate folder is queued.
 * Emits one event per folder resolved and per file skipped via `onEvent`;
 * returns the flat list of files to upload. In dry-run mode, no folders are
 * actually created and no files are queued for a real upload call.
 */
export async function mirrorTree(
  localRoot: string,
  remoteParentId: string | undefined,
  emailArg: string | undefined,
  dryRun: boolean,
  onEvent: (event: MirrorEvent) => void
): Promise<UploadTask[]> {
  const tasks: UploadTask[] = [];

  async function walk(localDir: string, parentId: string | undefined, parentHypothetical: boolean, label: string): Promise<void> {
    const resolved = await findOrCreateFolder(basename(localDir), parentId, emailArg, dryRun, parentHypothetical);
    const folderLabel = label ? `${label}/${basename(localDir)}` : basename(localDir);
    onEvent({ type: "folder", label: folderLabel, folderId: resolved.folderId, created: resolved.created });

    const { dirs, files } = await readDirLevel(localDir);

    for (const file of files) {
      if (file.name.startsWith(".")) {
        onEvent({ type: "skip", label: `${folderLabel}/${file.name}`, reason: "dotfile" });
        continue;
      }
      const contentType = contentTypeForFile(file.name);
      if (!contentType) {
        onEvent({ type: "skip", label: `${folderLabel}/${file.name}`, reason: "unsupported file type" });
        continue;
      }
      tasks.push({
        localPath: file.path,
        fileName: file.name,
        contentType,
        folderId: resolved.folderId,
        folderLabel,
      });
    }

    for (const dir of dirs) {
      await walk(dir.path, resolved.folderId, resolved.hypothetical, folderLabel);
    }
  }

  await walk(localRoot, remoteParentId, false, "");
  return tasks;
}
