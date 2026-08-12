import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";

// media-items lives in eu-west-1 regardless of Cognito's region — same
// pattern and same reasoning as infra/regression-tests/src/db.ts.
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "eu-west-1" }));
const MEDIA_TABLE_NAME = "swordthain-media-items";
const CI_TEST_FOLDER_ID = "29b9e0e4-6440-4efd-813d-5f4281b77bd3";

/**
 * Inserts a synthetic photo/video row directly, bypassing a real upload —
 * modal.spec.ts's only need is a real, openable mediaId to click through to
 * Lightbox/PlaylistPlayer for the focus-trap check; the CI Test folder
 * isn't guaranteed to have real media in it at scan time (infra/regression-
 * tests cleans up after itself, and this suite shouldn't depend on that
 * timing). Doesn't touch S3/ThumbnailFn — see infra/regression-tests/
 * src/db.ts's identical comment for why that's fine for this purpose.
 */
export async function createSyntheticItem(type: "photo" | "video"): Promise<string> {
  const mediaId = randomUUID();
  const fileName = `a11y-test-${type}.${type === "video" ? "mp4" : "jpg"}`;
  await ddb.send(
    new PutCommand({
      TableName: MEDIA_TABLE_NAME,
      Item: {
        mediaId,
        folderId: CI_TEST_FOLDER_ID,
        folderIdType: `${CI_TEST_FOLDER_ID}#${type}`,
        type,
        s3Key: `originals/${CI_TEST_FOLDER_ID}/${mediaId}/${fileName}`,
        thumbnailKey: `thumbnails/${CI_TEST_FOLDER_ID}/${mediaId}.jpg`,
        contentType: type === "video" ? "video/mp4" : "image/jpeg",
        sizeBytes: 0,
        fileName,
        status: "ready",
        uploadedAt: new Date().toISOString(),
      },
    })
  );
  return mediaId;
}

export async function deleteSyntheticItem(mediaId: string): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: MEDIA_TABLE_NAME, Key: { mediaId } }));
}
