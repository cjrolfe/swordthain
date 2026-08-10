import { extname } from "node:path";

// Matches SUPPORTED_CONTENT_TYPES in infra/lambda/media/upload-url.ts exactly.
// Purely extension-based — Node has no file.type MIME-sniffing API to work
// around at all, unlike the browser, so this is deterministic by design.
const EXTENSION_TO_CONTENT_TYPE: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
};

/** Returns the content type for a supported file extension, or null if unsupported. */
export function contentTypeForFile(fileName: string): string | null {
  const ext = extname(fileName).toLowerCase();
  return EXTENSION_TO_CONTENT_TYPE[ext] ?? null;
}
