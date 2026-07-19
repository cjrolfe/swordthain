import type { CreateAuthChallengeTriggerHandler } from "aws-lambda";
import { randomInt, createHash } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ses = new SESv2Client({});

const OTP_TABLE_NAME = process.env.OTP_TABLE_NAME!;
const SES_FROM_ADDRESS = process.env.SES_FROM_ADDRESS!;
const OTP_TTL_SECONDS = 5 * 60;

const hashCode = (code: string) => createHash("sha256").update(code).digest("hex");

const generateCode = () => randomInt(0, 1_000_000).toString().padStart(6, "0");

export const handler: CreateAuthChallengeTriggerHandler = async (event) => {
  const email = event.request.userAttributes.email ?? event.userName;
  const isFreshChallenge = event.request.session.length === 0;

  if (isFreshChallenge) {
    const code = generateCode();
    const expiresAt = Math.floor(Date.now() / 1000) + OTP_TTL_SECONDS;

    await ddb.send(
      new PutCommand({
        TableName: OTP_TABLE_NAME,
        Item: {
          email: event.userName,
          codeHash: hashCode(code),
          expiresAt,
          attempts: 0,
        },
      })
    );

    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: SES_FROM_ADDRESS,
        Destination: { ToAddresses: [email] },
        Content: {
          Simple: {
            Subject: { Data: "Your Swordthain sign-in code" },
            Body: {
              Text: {
                Data: `Your sign-in code is ${code}. It expires in 5 minutes.\n\nIf you didn't request this, you can ignore this email.`,
              },
            },
          },
        },
      })
    );
  }

  // Never expose the code (or its hash) to the client-visible challenge params.
  event.response.publicChallengeParameters = { email };
  event.response.privateChallengeParameters = {};
  event.response.challengeMetadata = "EMAIL_OTP";
  return event;
};
