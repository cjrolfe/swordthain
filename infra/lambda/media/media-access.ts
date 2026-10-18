import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyHandlerV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { S3Client, GetObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { isOwner } from "./authz";
import { hasPermission, resolveAccess } from "./access";
import { jsonResponse } from "./http";
import { deletePlaylistItemRow } from "./playlist-items";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

const FOLDERS_TABLE_NAME = process.env.FOLDERS_TABLE_NAME!;
const FOLDER_SHARES_TABLE_NAME = process.env.FOLDER_SHARES_TABLE_NAME!;
const MEDIA_TABLE_NAME = process.env.MEDIA_TABLE_NAME!;
const MEDIA_BUCKET_NAME = process.env.MEDIA_BUCKET_NAME!;
const ACTIVITY_LOG_TABLE_NAME = process.env.ACTIVITY_LOG_TABLE_NAME!;
const PLAYLISTS_TABLE_NAME = process.env.PLAYLISTS_TABLE_NAME!;
const PLAYLIST_ITEMS_TABLE_NAME = process.env.PLAYLIST_ITEMS_TABLE_NAME!;

// Short-lived — reissued on every view/download rather than cached client-side.
const URL_EXPIRY_SECONDS = 300;

export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  const mediaId = event.pathParameters?.mediaId;
  if (!mediaId) return jsonResponse(400, { error: "mediaId is required" });

  if (event.routeKey === "DELETE /media/{mediaId}") {
    return deleteMedia(event, mediaId);
  }
  if (event.routeKey === "PATCH /media/{mediaId}") {
    return updateMedia(event, mediaId);
  }

  const action = event.routeKey === "GET /media/{mediaId}/download-url" ? "download" : "view";

  const owner = isOwner(event.requestContext.authorizer.jwt.claims);
  const userId = event.requestContext.authorizer.jwt.claims.sub as string;

  const media = await ddb.send(new GetCommand({ TableName: MEDIA_TABLE_NAME, Key: { mediaId } }));
  if (!media.Item) return jsonResponse(404, { error: "Media not found" });

  if (!owner) {
    const access = await resolveAccess(ddb, FOLDERS_TABLE_NAME, FOLDER_SHARES_TABLE_NAME, media.Item.folderId, userId);
    if (!access || !hasPermission(access.permission, action)) {
      return jsonResponse(403, { error: `${action} permission required for this folder` });
    }
  }

  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: MEDIA_BUCKET_NAME,
      Key: media.Item.s3Key,
      ...(action === "download"
        ? { ResponseContentDisposition: `attachment; filename="${media.Item.fileName}"` }
        : {}),
    }),
    { expiresIn: URL_EXPIRY_SECONDS }
  );

  await ddb.send(
    new PutCommand({
      TableName: ACTIVITY_LOG_TABLE_NAME,
      Item: {
        logId: randomUUID(),
        userId,
        mediaId,
        folderId: media.Item.folderId,
        action,
        timestamp: new Date().toISOString(),
      },
    })
  );

  return jsonResponse(200, { url, expiresIn: URL_EXPIRY_SECONDS });
};

async function deleteMedia(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  mediaId: string
): Promise<APIGatewayProxyStructuredResultV2> {
  const owner = isOwner(event.requestContext.authorizer.jwt.claims);
  if (!owner) return jsonResponse(403, { error: "Owner access required" });

  const media = await ddb.send(new GetCommand({ TableName: MEDIA_TABLE_NAME, Key: { mediaId } }));
  if (!media.Item) return jsonResponse(404, { error: "Media not found" });

  await s3.send(
    new DeleteObjectsCommand({
      Bucket: MEDIA_BUCKET_NAME,
      Delete: { Objects: [{ Key: media.Item.s3Key }, { Key: media.Item.thumbnailKey }] },
    })
  );

  await ddb.send(new DeleteCommand({ TableName: MEDIA_TABLE_NAME, Key: { mediaId } }));

  try {
    await cleanupPlaylistReferences(mediaId);
  } catch (err) {
    console.error("cleanupPlaylistReferences failed for", mediaId, err);
    // Best-effort tidiness, not correctness-critical — an orphaned row is
    // already tolerated gracefully by listPlaylistItems (available: false)
    // if this fails, same as before this cleanup existed.
  }

  return jsonResponse(200, { mediaId, deleted: true });
}

/**
 * Finds every PlaylistItems row referencing mediaId (across every playlist,
 * possibly more than one row per playlist since addPlaylistItem doesn't
 * dedupe) via the byMedia GSI, deletes each row, and decrements itemCount
 * on each affected playlist by however many of its rows were actually
 * removed. Safe under concurrent deleteMedia/removePlaylistItem calls: see
 * deletePlaylistItemRow's own idempotency guarantee in playlist-items.ts.
 */
async function cleanupPlaylistReferences(mediaId: string): Promise<void> {
  const matches = await ddb.send(
    new QueryCommand({
      TableName: PLAYLIST_ITEMS_TABLE_NAME,
      IndexName: "byMedia",
      KeyConditionExpression: "mediaId = :m",
      ExpressionAttributeValues: { ":m": mediaId },
    })
  );
  const items = (matches.Items ?? []) as { playlistId: string; position: number }[];
  if (items.length === 0) return;

  const results = await Promise.all(
    items.map(async (item) => ({
      playlistId: item.playlistId,
      deleted: await deletePlaylistItemRow(ddb, PLAYLIST_ITEMS_TABLE_NAME, item.playlistId, item.position),
    }))
  );

  const decrementsByPlaylist = new Map<string, number>();
  for (const r of results) {
    if (r.deleted) decrementsByPlaylist.set(r.playlistId, (decrementsByPlaylist.get(r.playlistId) ?? 0) + 1);
  }

  await Promise.all(
    [...decrementsByPlaylist.entries()].map(([playlistId, n]) =>
      ddb
        .send(
          new UpdateCommand({
            TableName: PLAYLISTS_TABLE_NAME,
            Key: { playlistId },
            // Tolerates a concurrent deletePlaylist call racing this update
            // — without this, UpdateItem's default upsert would resurrect a
            // ghost {playlistId, itemCount: -n} row for a playlist that no
            // longer exists.
            ConditionExpression: "attribute_exists(playlistId)",
            UpdateExpression: "ADD itemCount :neg SET updatedAt = :now",
            ExpressionAttributeValues: { ":neg": -n, ":now": new Date().toISOString() },
          })
        )
        .catch((err) => {
          if (err instanceof ConditionalCheckFailedException) return;
          throw err;
        })
    )
  );
}

const DESCRIPTION_MAX_LENGTH = 140;

async function updateMedia(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  mediaId: string
): Promise<APIGatewayProxyStructuredResultV2> {
  const owner = isOwner(event.requestContext.authorizer.jwt.claims);
  if (!owner) return jsonResponse(403, { error: "Owner access required" });

  let payload: { description?: unknown; folderId?: unknown };
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  // Two independent updates share this route: `description` (edit the
  // caption) and `folderId` (move to another folder). Either or both.
  if (payload.description === undefined && payload.folderId === undefined) {
    return jsonResponse(400, { error: "description or folderId is required" });
  }

  const updates: string[] = [];
  const values: Record<string, string> = {};

  if (payload.description !== undefined) {
    if (typeof payload.description !== "string") {
      return jsonResponse(400, { error: "description must be a string" });
    }
    const description = payload.description.trim();
    if (description.length > DESCRIPTION_MAX_LENGTH) {
      return jsonResponse(400, { error: `description must be ${DESCRIPTION_MAX_LENGTH} characters or fewer` });
    }
    updates.push("description = :d");
    values[":d"] = description;
  }

  if (payload.folderId !== undefined && (typeof payload.folderId !== "string" || !payload.folderId)) {
    return jsonResponse(400, { error: "folderId must be a non-empty string" });
  }

  const media = await ddb.send(new GetCommand({ TableName: MEDIA_TABLE_NAME, Key: { mediaId } }));
  if (!media.Item) return jsonResponse(404, { error: "Media not found" });

  if (typeof payload.folderId === "string") {
    const destination = await ddb.send(
      new GetCommand({ TableName: FOLDERS_TABLE_NAME, Key: { folderId: payload.folderId } })
    );
    if (!destination.Item) return jsonResponse(404, { error: "Destination folder not found" });

    // A move only re-points the record: which folder an item belongs to
    // (and so who can see it) lives in these two attributes, and every
    // read/delete path uses the item's stored s3Key/thumbnailKey rather than
    // rebuilding a key from the folder. So the S3 objects stay where they
    // are — instant, and no copy to run into S3's 5GB single-copy limit or
    // API Gateway's 30s timeout on a multi-GB video. The folder segment in
    // the key (originals/{folderId}/...) just records where it was uploaded.
    updates.push("folderId = :f", "folderIdType = :ft");
    values[":f"] = payload.folderId;
    values[":ft"] = `${payload.folderId}#${media.Item.type}`;
  }

  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: MEDIA_TABLE_NAME,
        Key: { mediaId },
        UpdateExpression: `SET ${updates.join(", ")}`,
        // Without this, deleting the item between the read above and this
        // write would have UpdateItem silently re-create a half-empty row.
        ConditionExpression: "attribute_exists(mediaId)",
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      })
    );
    return jsonResponse(200, result.Attributes);
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return jsonResponse(404, { error: "Media not found" });
    throw err;
  }
}
