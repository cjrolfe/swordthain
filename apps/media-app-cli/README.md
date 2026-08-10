# swordthain-media-app-cli

A command-line tool for bulk-uploading a local folder tree into Swordthain, as an alternative to the browser upload UI for large imports. Reuses the exact same secure API the web app uses — same sign-in, same permissions, no new AWS credentials, no backend changes.

## What it does

Given a local directory, it mirrors that directory's structure into Swordthain folders (creating them if they don't already exist, matching by exact title) and uploads every supported photo/video inside, recursively — with real concurrency and resumable large-file uploads.

## Setup

Requires Node.js 20+.

```bash
cd apps/media-app-cli
npm install
```

## Usage

```bash
npx tsx src/cli.ts <local-dir> [options]
```

Or, after building (`npm run build`), run the compiled command directly:

```bash
node dist/cli.js <local-dir> [options]
```

### Options

| Flag | Description |
|---|---|
| `--parent <title>` | Remote parent folder title to mirror into (default: root). Supports nested paths, e.g. `--parent "Family/2026"`. |
| `--concurrency <n>` | Parallel file uploads (default: `4`). |
| `--dry-run` | Resolves the folder plan and lists what would be uploaded — no folders are created and nothing is uploaded. |
| `--email <address>` | Skip the interactive email prompt on first sign-in. |
| `--help` | Show usage. |

### Example

```bash
npx tsx src/cli.ts ~/Movies/"Rhodes 2024" --parent "Family Videos"
```

## First-run sign-in

The first time you run it, you'll be prompted for your email, then the 6-digit code sent to it (same passwordless sign-in as the web app). The session is cached at `~/.swordthain-cli/session.json` and refreshes itself automatically for up to a year — you shouldn't need to sign in again after that.

## What gets uploaded

Supported file types: JPEG, PNG, HEIC/HEIF, MP4, MOV, M4V — matching the web app exactly. Dotfiles (like `.DS_Store`) and any other file type are skipped with a one-line warning; the run continues rather than aborting.

## Notes

- Folder matching is exact and case-sensitive. If a local folder name matches more than one existing remote folder under the same parent, the run stops and asks you to dedupe them in the web app first, rather than guessing.
- Files over 5GB use the same resumable multipart upload as the browser — if the tool is interrupted partway through a large file, re-running it picks up from the last completed part instead of starting over.
- A failed file is logged and skipped; it doesn't stop the rest of the run. The tool exits with a non-zero status if anything failed, so it's safe to use in a script.
