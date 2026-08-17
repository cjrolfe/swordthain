import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, DeleteCommand } from "@aws-sdk/lib-dynamodb";

/**
 * Deletes one PlaylistItems row by its real primary key {playlistId, position}.
 * Shared by playlists.ts's user-initiated removePlaylistItem and
 * media-access.ts's deleteMedia cascade cleanup — both need the same
 * conditional-delete-and-tolerate-already-gone mechanics.
 *
 * Returns false (not a thrown error) if the row was already gone — a benign
 * race (e.g. a concurrent removePlaylistItem call, or two concurrent
 * deleteMedia calls for the same mediaId), not a caller failure. Callers
 * must only count a `true` result toward an itemCount decrement, never the
 * row count they expected to delete — otherwise concurrent duplicate calls
 * could double-decrement itemCount below the real value.
 */
export async function deletePlaylistItemRow(
  ddb: DynamoDBDocumentClient,
  playlistItemsTableName: string,
  playlistId: string,
  position: number
): Promise<boolean> {
  try {
    await ddb.send(
      new DeleteCommand({
        TableName: playlistItemsTableName,
        Key: { playlistId, position },
        ConditionExpression: "attribute_exists(playlistId)",
      })
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}
