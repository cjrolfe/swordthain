#!/usr/bin/env node
import { parseArgs } from "node:util";
import { resolve, basename } from "node:path";
import { mirrorTree, resolveParentPath, type MirrorEvent } from "./mirror.js";
import { runUploads, type UploadEvent } from "./upload.js";

const HELP = `
Usage: swordthain-upload <local-dir> [options]

Mirrors a local directory tree into Swordthain folders and uploads every
supported photo/video inside it, recursively.

Options:
  --parent <title>     Remote parent folder title to mirror into (default: root).
                        Supports nested paths, e.g. --parent "Family/2026".
  --concurrency <n>     Parallel file uploads (default: 4)
  --dry-run             Resolve folders and list files without uploading or creating anything
  --email <address>     Skip the interactive email prompt (first sign-in only)
  --help                Show this help
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      parent: { type: "string" },
      concurrency: { type: "string", default: "4" },
      "dry-run": { type: "boolean", default: false },
      email: { type: "string" },
      help: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length === 0) {
    console.log(HELP);
    process.exitCode = values.help ? 0 : 1;
    return;
  }

  const localRoot = resolve(positionals[0]);
  const concurrency = Number.parseInt(values.concurrency ?? "4", 10) || 4;
  const emailArg = values.email;
  const dryRun = values["dry-run"] ?? false;

  console.log(`Resolving remote folders for "${basename(localRoot)}"${values.parent ? ` under "${values.parent}"` : ""}...`);
  const remoteParentId = await resolveParentPath(values.parent, emailArg, dryRun);

  let foldersFound = 0;
  let foldersCreated = 0;
  let skipped = 0;
  const tasks = await mirrorTree(localRoot, remoteParentId, emailArg, dryRun, (event: MirrorEvent) => {
    if (event.type === "folder") {
      const verb = event.created ? (dryRun ? "would create" : "created") : "found existing";
      console.log(`[folder] ${event.label} -> ${verb} (${event.folderId})`);
      if (event.created) foldersCreated++;
      else foldersFound++;
    } else {
      console.log(`[skip]   ${event.label} -> ${event.reason}`);
      skipped++;
    }
  });

  console.log(`\nFound ${tasks.length} file(s) to upload across ${foldersCreated + foldersFound} folder(s) (${foldersCreated} ${dryRun ? "would be created" : "created"}).`);

  if (dryRun) {
    for (const task of tasks) console.log(`[dry-run] would upload ${task.folderLabel}/${task.fileName}`);
    console.log("\nDry run — nothing was uploaded or created.");
    return;
  }

  if (tasks.length === 0) {
    console.log("Nothing to upload.");
    return;
  }

  const startedAt = Date.now();
  const { succeeded, failed } = await runUploads(tasks, concurrency, emailArg, (event: UploadEvent) => {
    switch (event.type) {
      case "upload-start":
        console.log(`[upload] ${event.task.folderLabel}/${event.task.fileName} -> uploading...`);
        break;
      case "upload-progress":
        console.log(`[upload] ${event.task.folderLabel}/${event.task.fileName} -> ${event.message}`);
        break;
      case "upload-done":
        console.log(`[upload] ${event.task.folderLabel}/${event.task.fileName} -> done`);
        break;
      case "upload-error":
        console.log(`[error]  ${event.task.folderLabel}/${event.task.fileName} -> failed: ${event.message}`);
        break;
    }
  });

  const elapsedMin = ((Date.now() - startedAt) / 60_000).toFixed(1);
  console.log(
    `\nSummary: ${succeeded} uploaded, ${skipped} skipped, ${failed} failed, ${foldersCreated} folders created, ${elapsedMin}m elapsed`
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
