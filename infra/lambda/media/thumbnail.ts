import type { S3Handler } from "aws-lambda";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import sharp from "sharp";

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const MEDIA_TABLE_NAME = process.env.MEDIA_TABLE_NAME!;
const THUMBNAIL_SIZE = 400;

// Sharp's prebuilt Lambda binary excludes HEIF support (libheif licensing),
// so HEIC/HEIF stills are routed through ffmpeg instead of Sharp.
const SHARP_IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);
const FFMPEG_IMAGE_TYPES = new Set(["image/heic", "image/heif"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/x-m4v"]);

// Lambda's /tmp tops out at 10GiB (see ephemeralStorageSize in
// media-app-data-stack.ts) — the hard ceiling for the download-then-ffmpeg
// fallback below. Headroom left for the extracted frame and ffmpeg's own
// scratch files.
const MAX_DOWNLOAD_FALLBACK_BYTES = 9 * 1024 ** 3;
const PRESIGNED_READ_EXPIRY_SECONDS = 900;
// Where Lambda's (Amazon Linux) CA bundle lives — the static ffmpeg build
// is linked against GnuTLS but doesn't know that path by default.
const CA_BUNDLE_CANDIDATES = ["/etc/pki/tls/certs/ca-bundle.crt", "/etc/ssl/certs/ca-certificates.crt"];

const KEY_PATTERN = /^originals\/([^/]+)\/([^/]+)\/(.+)$/;

export const handler: S3Handler = async (event) => {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

    const match = key.match(KEY_PATTERN);
    if (!match) {
      console.warn(`Key ${key} doesn't match originals/{folderId}/{mediaId}/{fileName}, skipping`);
      continue;
    }
    const [, folderId, mediaId, fileName] = match;

    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    const contentType = head.ContentType ?? "application/octet-stream";
    const sizeBytes = head.ContentLength ?? 0;

    let thumbnailBuffer: Buffer;
    let mediaType: "photo" | "video";

    if (SHARP_IMAGE_TYPES.has(contentType)) {
      mediaType = "photo";
      const original = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const originalBuffer = Buffer.from(await original.Body!.transformToByteArray());
      thumbnailBuffer = await sharp(originalBuffer)
        .rotate() // apply EXIF orientation before resizing — Sharp ignores it otherwise
        .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: "inside" })
        .jpeg({ quality: 80 })
        .toBuffer();
    } else if (FFMPEG_IMAGE_TYPES.has(contentType)) {
      mediaType = "photo";
      const original = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      thumbnailBuffer = await extractFrameWithFfmpeg(original.Body as Readable, fileName, "0");
    } else if (VIDEO_TYPES.has(contentType)) {
      mediaType = "video";
      thumbnailBuffer = await extractVideoFrame(bucket, key, fileName, sizeBytes);
    } else {
      console.warn(`Unsupported content type ${contentType} for ${key}, skipping`);
      continue;
    }

    const thumbnailKey = `thumbnails/${folderId}/${mediaId}.jpg`;
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: thumbnailKey,
        Body: thumbnailBuffer,
        ContentType: "image/jpeg",
      })
    );

    await ddb.send(
      new PutCommand({
        TableName: MEDIA_TABLE_NAME,
        Item: {
          mediaId,
          folderId,
          folderIdType: `${folderId}#${mediaType}`,
          type: mediaType,
          s3Key: key,
          thumbnailKey,
          contentType,
          sizeBytes,
          fileName,
          status: "ready",
          uploadedAt: new Date().toISOString(),
        },
      })
    );
  }
};

/**
 * Runs ffmpeg once to grab a single scaled frame from `input` (a local path
 * or an https URL) and returns it as a JPEG buffer. stderr is captured
 * rather than inherited because for a presigned URL ffmpeg echoes the whole
 * signed URL into its banner/errors — that must not end up in CloudWatch.
 */
function grabFrame(input: string, timestamp: string, inputOptions: string[] = []): Buffer {
  const outputPath = `/tmp/${randomUUID()}.jpg`;
  try {
    execFileSync(
      "/opt/bin/ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        ...inputOptions,
        "-i",
        input,
        "-ss",
        timestamp,
        "-frames:v",
        "1",
        "-vf",
        `scale=${THUMBNAIL_SIZE}:-1`,
        outputPath,
      ],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
    return fs.readFileSync(outputPath);
  } finally {
    fs.rmSync(outputPath, { force: true });
  }
}

/**
 * Videos are read by ffmpeg directly from S3 over a short-lived presigned
 * URL (HTTP range requests — it only needs the index plus the first second
 * of picture), instead of being downloaded whole into /tmp first. The old
 * download-first approach capped video size at /tmp's 10GiB: a ~12GB
 * ProRes export uploaded fine but could never be thumbnailed, so it would
 * have sat in S3 with no library entry. If reading over HTTPS fails for any
 * reason, fall back to the proven download path when the file fits.
 */
async function extractVideoFrame(bucket: string, key: string, fileName: string, sizeBytes: number): Promise<Buffer> {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const url = await getSignedUrl(s3, command, { expiresIn: PRESIGNED_READ_EXPIRY_SECONDS });
  const caBundle = CA_BUNDLE_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  try {
    const frame = grabFrame(url, "00:00:01", caBundle ? ["-ca_file", caBundle] : []);
    console.log(`Thumbnail for ${key} read via presigned URL (${sizeBytes} bytes, no download)`);
    return frame;
  } catch (err) {
    const stderr = String((err as { stderr?: Buffer }).stderr ?? "").trim();
    const detail = redactUrl(stderr || (err instanceof Error ? err.message : String(err)), url).slice(0, 500);
    if (sizeBytes > MAX_DOWNLOAD_FALLBACK_BYTES) {
      throw new Error(`ffmpeg could not read ${key} over HTTPS and it is too large to download to /tmp: ${detail}`);
    }
    console.warn(`ffmpeg could not read ${key} over HTTPS (${detail}) — falling back to a full download`);
  }
  const original = await s3.send(command);
  return extractFrameWithFfmpeg(original.Body as Readable, fileName, "00:00:01");
}

function redactUrl(text: string, url: string): string {
  return text.split(url).join("<presigned url>");
}

async function extractFrameWithFfmpeg(inputStream: Readable, fileName: string, timestamp: string): Promise<Buffer> {
  const ext = path.extname(fileName) || ".bin";
  const inputPath = `/tmp/${randomUUID()}${ext}`;
  try {
    // Stream straight to disk rather than buffering the whole object in
    // memory first — for a multi-hundred-MB video, holding it all in a JS
    // Buffer alongside ffmpeg's own decode memory was enough to OOM the
    // Lambda even at 1024MB (confirmed via CloudWatch on a real 490MB
    // upload). Inside the try/finally (not before it) so a failed download
    // still gets cleaned up — otherwise a partial file leaks into /tmp on a
    // reused execution environment and starves the next invocation too.
    await pipeline(inputStream, fs.createWriteStream(inputPath));
    return grabFrame(inputPath, timestamp);
  } finally {
    fs.rmSync(inputPath, { force: true });
  }
}
