import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { CloudWatchClient, GetMetricDataCommand, MetricDataQuery } from "@aws-sdk/client-cloudwatch";
import { DynamoDBClient, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import { SESv2Client, GetAccountCommand } from "@aws-sdk/client-sesv2";
import { isOwner } from "./authz";
import { jsonResponse } from "./http";

const cloudwatch = new CloudWatchClient({});
// CloudFront-scope WAF metrics only exist in us-east-1, regardless of this
// Lambda's own eu-west-1 region — confirmed against the real deployed
// metrics, not assumed from docs.
const cloudwatchUsEast1 = new CloudWatchClient({ region: "us-east-1" });
const ddb = new DynamoDBClient({});
// SES sending actually happens from us-east-1 (see invites.ts) — GetAccount
// reflects sandbox/production status and quota per-region, so this must
// target the same region invites.ts sends from, not this Lambda's own.
const ses = new SESv2Client({ region: "us-east-1" });

const MEDIA_BUCKET_NAME = process.env.MEDIA_BUCKET_NAME!;
const MEDIA_TABLE_NAME = process.env.MEDIA_TABLE_NAME!;
const FOLDERS_TABLE_NAME = process.env.FOLDERS_TABLE_NAME!;
const FOLDER_SHARES_TABLE_NAME = process.env.FOLDER_SHARES_TABLE_NAME!;
const ACTIVITY_LOG_TABLE_NAME = process.env.ACTIVITY_LOG_TABLE_NAME!;
const PLAYLISTS_TABLE_NAME = process.env.PLAYLISTS_TABLE_NAME!;
const PLAYLIST_ITEMS_TABLE_NAME = process.env.PLAYLIST_ITEMS_TABLE_NAME!;
const LAMBDA_FUNCTIONS: { label: string; functionName: string }[] = JSON.parse(process.env.LAMBDA_FUNCTIONS_JSON!);
const SITE_WAF_NAME = process.env.SITE_WAF_NAME!;
const HTTP_API_ID = process.env.HTTP_API_ID!;

/**
 * eu-west-1 per-GB monthly rates for the storage tiers actually in use,
 * matching the "no Glacier tiering" decision recorded in infra/README.md.
 * Static constants rather than a live Cost Explorer lookup — Cost
 * Explorer's API costs $0.01/call and these list-price rates are stable
 * enough for a rough estimate refreshed on every admin page load.
 */
const RATE_PER_GB = {
  standard: 0.023,
  intelligentTieringFrequent: 0.023,
  intelligentTieringInfrequent: 0.0125,
  intelligentTieringArchiveInstant: 0.004,
};

const storageMetric = (id: string, storageType: string): MetricDataQuery => ({
  Id: id,
  MetricStat: {
    Metric: {
      Namespace: "AWS/S3",
      MetricName: "BucketSizeBytes",
      Dimensions: [
        { Name: "BucketName", Value: MEDIA_BUCKET_NAME },
        { Name: "StorageType", Value: storageType },
      ],
    },
    Period: 86400,
    Stat: "Average",
  },
});

export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  if (!isOwner(event.requestContext.authorizer.jwt.claims)) {
    return jsonResponse(403, { error: "Owner access required" });
  }

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const queries: MetricDataQuery[] = [
    storageMetric("standard", "StandardStorage"),
    storageMetric("itFrequent", "IntelligentTieringFAStorage"),
    storageMetric("itInfrequent", "IntelligentTieringIAStorage"),
    storageMetric("itArchiveInstant", "IntelligentTieringAIAStorage"),
    {
      Id: "objectCount",
      MetricStat: {
        Metric: {
          Namespace: "AWS/S3",
          MetricName: "NumberOfObjects",
          Dimensions: [
            { Name: "BucketName", Value: MEDIA_BUCKET_NAME },
            { Name: "StorageType", Value: "AllStorageTypes" },
          ],
        },
        Period: 86400,
        Stat: "Average",
      },
    },
    ...LAMBDA_FUNCTIONS.map(
      ({ functionName }, i): MetricDataQuery => ({
        Id: `lambdaErrors${i}`,
        MetricStat: {
          Metric: {
            Namespace: "AWS/Lambda",
            MetricName: "Errors",
            Dimensions: [{ Name: "FunctionName", Value: functionName }],
          },
          Period: 604800,
          Stat: "Sum",
        },
      })
    ),
    ...(["4XXError", "5XXError", "ThrottleCount"] as const).map(
      (metricName): MetricDataQuery => ({
        Id: `api${metricName}`,
        MetricStat: {
          Metric: {
            Namespace: "AWS/ApiGateway",
            MetricName: metricName,
            Dimensions: [{ Name: "ApiId", Value: HTTP_API_ID }],
          },
          Period: 604800,
          Stat: "Sum",
        },
      })
    ),
  ];

  // WAF's CloudWatch metrics only exist in us-east-1 (CloudFront-scope),
  // so this is a separate GetMetricData call via cloudwatchUsEast1 rather
  // than another entry in `queries` above.
  const wafQuery: MetricDataQuery = {
    Id: "wafBlocked",
    MetricStat: {
      Metric: {
        Namespace: "AWS/WAFV2",
        MetricName: "BlockedRequests",
        // Rule=<the ACL's own metricName> is WAF's aggregate "blocked by
        // any rule" count, not a specific rule group — confirmed against
        // the real deployed metrics rather than assumed from docs.
        Dimensions: [
          { Name: "WebACL", Value: SITE_WAF_NAME },
          { Name: "Rule", Value: SITE_WAF_NAME },
        ],
      },
      Period: 604800,
      Stat: "Sum",
    },
  };

  const [metrics, wafMetrics, tableCounts, sesAccount] = await Promise.all([
    cloudwatch.send(new GetMetricDataCommand({ MetricDataQueries: queries, StartTime: weekAgo, EndTime: now })),
    cloudwatchUsEast1.send(
      new GetMetricDataCommand({ MetricDataQueries: [wafQuery], StartTime: weekAgo, EndTime: now })
    ),
    Promise.all(
      (
        [
          ["media", MEDIA_TABLE_NAME],
          ["folders", FOLDERS_TABLE_NAME],
          ["shares", FOLDER_SHARES_TABLE_NAME],
          ["activity", ACTIVITY_LOG_TABLE_NAME],
          ["playlists", PLAYLISTS_TABLE_NAME],
          ["playlistItems", PLAYLIST_ITEMS_TABLE_NAME],
        ] as const
      ).map(async ([key, tableName]) => {
        const result = await ddb.send(new DescribeTableCommand({ TableName: tableName }));
        return [key, result.Table?.ItemCount ?? 0] as const;
      })
    ),
    ses.send(new GetAccountCommand({})).catch(() => null),
  ]);

  // GetMetricData defaults to ScanBy TimestampDescending, so index 0 is the
  // most recent daily datapoint for the once-a-day S3 storage metrics.
  const byId = new Map(
    [...(metrics.MetricDataResults ?? []), ...(wafMetrics.MetricDataResults ?? [])].map((r) => [r.Id, r.Values ?? []])
  );
  const latestOf = (id: string) => byId.get(id)?.[0] ?? 0;
  const sumOf = (id: string) => (byId.get(id) ?? []).reduce((a, b) => a + b, 0);

  const standardBytes = latestOf("standard");
  const itFrequentBytes = latestOf("itFrequent");
  const itInfrequentBytes = latestOf("itInfrequent");
  const itArchiveInstantBytes = latestOf("itArchiveInstant");

  const gib = (bytes: number) => bytes / 1024 ** 3;
  const estimatedMonthlyCostUsd =
    gib(standardBytes) * RATE_PER_GB.standard +
    gib(itFrequentBytes) * RATE_PER_GB.intelligentTieringFrequent +
    gib(itInfrequentBytes) * RATE_PER_GB.intelligentTieringInfrequent +
    gib(itArchiveInstantBytes) * RATE_PER_GB.intelligentTieringArchiveInstant;

  return jsonResponse(200, {
    storage: {
      totalBytes: standardBytes + itFrequentBytes + itInfrequentBytes + itArchiveInstantBytes,
      objectCount: latestOf("objectCount"),
      byTier: {
        standardBytes,
        intelligentTieringFrequentBytes: itFrequentBytes,
        intelligentTieringInfrequentBytes: itInfrequentBytes,
        intelligentTieringArchiveInstantBytes: itArchiveInstantBytes,
      },
      estimatedMonthlyCostUsd,
    },
    security: {
      wafBlockedRequests: sumOf("wafBlocked"),
      api4xxErrors: sumOf("api4XXError"),
      api5xxErrors: sumOf("api5XXError"),
      apiThrottleCount: sumOf("apiThrottleCount"),
    },
    itemCounts: Object.fromEntries(tableCounts),
    lambdaErrors: LAMBDA_FUNCTIONS.map(({ label }, i) => ({
      label,
      errorsLast7Days: sumOf(`lambdaErrors${i}`),
    })),
    ses: sesAccount
      ? {
          productionAccessEnabled: sesAccount.ProductionAccessEnabled ?? false,
          max24HourSend: sesAccount.SendQuota?.Max24HourSend ?? 0,
          sentLast24Hours: sesAccount.SendQuota?.SentLast24Hours ?? 0,
        }
      : null,
  });
};
