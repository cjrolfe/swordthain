import type { VerifyAuthChallengeResponseTriggerHandler } from "aws-lambda";
import { createHash } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const OTP_TABLE_NAME = process.env.OTP_TABLE_NAME!;

const hashCode = (code: string) => createHash("sha256").update(code).digest("hex");

export const handler: VerifyAuthChallengeResponseTriggerHandler = async (event) => {
  const submitted = (event.request.challengeAnswer ?? "").trim();

  const { Item } = await ddb.send(
    new GetCommand({ TableName: OTP_TABLE_NAME, Key: { email: event.userName } })
  );

  const now = Math.floor(Date.now() / 1000);
  const isValid = !!Item && Item.expiresAt > now && Item.codeHash === hashCode(submitted);

  if (isValid) {
    // Single-use: remove the code once it's been consumed.
    await ddb.send(
      new DeleteCommand({ TableName: OTP_TABLE_NAME, Key: { email: event.userName } })
    );
  }

  event.response.answerCorrect = isValid;
  return event;
};
