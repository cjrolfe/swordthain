import {
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
  CfnOutput,
  DockerImage,
  ILocalBundling,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { HttpUserPoolAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface MediaAppStackProps extends StackProps {
  /** Origins allowed to issue presigned multipart uploads directly to the bucket. */
  allowedOrigins: string[];
  /** Shared Cognito pool from SwordthainAuthStack — gates the media API. */
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  /** Shared SES sending identity from SwordthainAuthStack — reused for invite emails. */
  sesIdentityArn: string;
  sesFromAddress: string;
  /** Root site URL included in invite emails, e.g. "https://swordthain.com". */
  siteUrl: string;
}

const SHARP_VERSION = "0.33.5";

/** Fetches Sharp's prebuilt linux/x64 binary via npm's cross-platform install flags — no Docker needed. */
const sharpLocalBundling: ILocalBundling = {
  tryBundle(outputDir: string): boolean {
    const nodejsDir = path.join(outputDir, "nodejs");
    fs.mkdirSync(nodejsDir, { recursive: true });
    execSync("npm init -y", { cwd: nodejsDir, stdio: "inherit" });
    execSync(`npm install --os=linux --cpu=x64 --libc=glibc sharp@${SHARP_VERSION}`, {
      cwd: nodejsDir,
      stdio: "inherit",
    });
    return true;
  },
};

/** Downloads a static linux/amd64 ffmpeg build into a Lambda-layer-shaped bin/ dir — no Docker needed. */
const ffmpegLocalBundling: ILocalBundling = {
  tryBundle(outputDir: string): boolean {
    const binDir = path.join(outputDir, "bin");
    fs.mkdirSync(binDir, { recursive: true });
    const workDir = fs.mkdtempSync("/tmp/ffmpeg-build-");
    execSync(
      `curl -fsSL https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz -o ffmpeg.tar.xz && ` +
        `tar -xJf ffmpeg.tar.xz`,
      { cwd: workDir, stdio: "inherit" }
    );
    const extracted = fs.readdirSync(workDir).find((name) => name.startsWith("ffmpeg-") && name.endsWith("-amd64-static"));
    if (!extracted) {
      throw new Error("ffmpeg static build extraction failed — unexpected archive contents");
    }
    fs.copyFileSync(path.join(workDir, extracted, "ffmpeg"), path.join(binDir, "ffmpeg"));
    fs.chmodSync(path.join(binDir, "ffmpeg"), 0o755);
    return true;
  },
};

/**
 * apps/media-app's own resources: media storage bucket, DynamoDB tables
 * (MediaItems, Folders, FolderShares), presigned upload, thumbnail
 * generation, folder browsing, per-folder sharing, and friend invites —
 * fronted by a single Cognito-authenticated HTTP API.
 */
export class MediaAppStack extends Stack {
  public readonly mediaBucket: s3.Bucket;
  public readonly mediaItemsTable: dynamodb.Table;
  public readonly foldersTable: dynamodb.Table;
  public readonly folderSharesTable: dynamodb.Table;
  public readonly activityLogTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: MediaAppStackProps) {
    super(scope, id, props);

    this.mediaBucket = new s3.Bucket(this, "MediaBucket", {
      bucketName: `swordthain-media-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      // No public/permanent links — everything is served through
      // short-lived presigned or signed URLs (issued by the app layer).
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.POST, s3.HttpMethods.GET],
          allowedOrigins: props.allowedOrigins,
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          id: "intelligent-tiering-from-day-0",
          enabled: true,
          // Only the built-in Frequent/Infrequent/Archive-Instant-Access
          // tiers apply automatically — those are the only ones with zero
          // retrieval delay. The optional Archive Access / Deep Archive
          // Access tiers are NOT opted into here (that would need a
          // separate bucket-level Intelligent-Tiering configuration) since
          // both carry a multi-hour restore delay, which the spec rules
          // out for anything friends browse casually. True Glacier
          // (Flexible Retrieval / Deep Archive) is applied per-folder by
          // the app, on demand, via explicit storage class changes —
          // not a blanket bucket lifecycle rule.
          transitions: [
            {
              storageClass: s3.StorageClass.INTELLIGENT_TIERING,
              transitionAfter: Duration.days(0),
            },
          ],
        },
        {
          id: "abort-incomplete-multipart-uploads",
          enabled: true,
          abortIncompleteMultipartUploadAfter: Duration.days(7),
        },
      ],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.mediaItemsTable = new dynamodb.Table(this, "MediaItemsTable", {
      tableName: "swordthain-media-items",
      partitionKey: { name: "mediaId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    this.mediaItemsTable.addGlobalSecondaryIndex({
      indexName: "byFolder",
      partitionKey: { name: "folderId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "uploadedAt", type: dynamodb.AttributeType.STRING },
    });

    this.foldersTable = new dynamodb.Table(this, "FoldersTable", {
      tableName: "swordthain-folders",
      partitionKey: { name: "folderId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    this.foldersTable.addGlobalSecondaryIndex({
      indexName: "byParent",
      partitionKey: { name: "parentFolderId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
    });

    this.folderSharesTable = new dynamodb.Table(this, "FolderSharesTable", {
      tableName: "swordthain-folder-shares",
      partitionKey: { name: "folderId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    this.folderSharesTable.addGlobalSecondaryIndex({
      indexName: "byUser",
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "folderId", type: dynamodb.AttributeType.STRING },
    });

    // Write-only for now — POST-side of the spec's ActivityLog (view-url /
    // download-url log every access). The owner-facing dashboard to query
    // this ("per-album and per-item activity, filterable by friend") is a
    // later phase; the byUser/byFolder GSIs are added now since they're
    // the natural filters that dashboard will need, cheap to add upfront
    // and awkward to retrofit onto existing data later.
    this.activityLogTable = new dynamodb.Table(this, "ActivityLogTable", {
      tableName: "swordthain-activity-log",
      partitionKey: { name: "logId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    this.activityLogTable.addGlobalSecondaryIndex({
      indexName: "byUser",
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "timestamp", type: dynamodb.AttributeType.STRING },
    });
    this.activityLogTable.addGlobalSecondaryIndex({
      indexName: "byFolder",
      partitionKey: { name: "folderId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "timestamp", type: dynamodb.AttributeType.STRING },
    });

    const lambdaDir = path.join(__dirname, "..", "lambda", "media");

    // --- Presigned upload URL endpoint ---
    const uploadUrlFn = new NodejsFunction(this, "UploadUrlFn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(lambdaDir, "upload-url.ts"),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        MEDIA_BUCKET_NAME: this.mediaBucket.bucketName,
        FOLDERS_TABLE_NAME: this.foldersTable.tableName,
        FOLDER_SHARES_TABLE_NAME: this.folderSharesTable.tableName,
      },
      bundling: {
        // Don't rely on the runtime's bundled AWS SDK for s3-request-presigner —
        // bundle everything to avoid a missing-module surprise.
        externalModules: [],
      },
    });
    this.mediaBucket.grantPut(uploadUrlFn);
    this.foldersTable.grantReadData(uploadUrlFn);
    this.folderSharesTable.grantReadData(uploadUrlFn);

    // --- Thumbnail generation (S3-triggered) ---
    const sharpLayer = new lambda.LayerVersion(this, "SharpLayer", {
      code: lambda.Code.fromAsset(path.join(__dirname, "..", "lambda", "layers", "sharp"), {
        bundling: { image: lambda.Runtime.NODEJS_20_X.bundlingImage, local: sharpLocalBundling },
      }),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      compatibleArchitectures: [lambda.Architecture.X86_64],
      description: `sharp@${SHARP_VERSION} prebuilt for linux/x64`,
    });

    const ffmpegLayer = new lambda.LayerVersion(this, "FfmpegLayer", {
      code: lambda.Code.fromAsset(path.join(__dirname, "..", "lambda", "layers", "ffmpeg"), {
        bundling: { image: DockerImage.fromRegistry("public.ecr.aws/docker/library/busybox"), local: ffmpegLocalBundling },
      }),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      compatibleArchitectures: [lambda.Architecture.X86_64],
      description: "Static ffmpeg (linux/amd64) from johnvansickle.com",
    });

    const thumbnailFn = new NodejsFunction(this, "ThumbnailFn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.X86_64,
      entry: path.join(lambdaDir, "thumbnail.ts"),
      timeout: Duration.seconds(60),
      memorySize: 1024,
      layers: [sharpLayer, ffmpegLayer],
      environment: {
        MEDIA_TABLE_NAME: this.mediaItemsTable.tableName,
      },
      bundling: {
        externalModules: ["sharp"],
      },
    });
    this.mediaBucket.grantReadWrite(thumbnailFn);
    this.mediaItemsTable.grantWriteData(thumbnailFn);

    this.mediaBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(thumbnailFn),
      { prefix: "originals/" }
    );

    // --- Folder browsing (create, list children, get, list media in folder) ---
    const foldersFn = new NodejsFunction(this, "FoldersFn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(lambdaDir, "folders.ts"),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        FOLDERS_TABLE_NAME: this.foldersTable.tableName,
        FOLDER_SHARES_TABLE_NAME: this.folderSharesTable.tableName,
        MEDIA_TABLE_NAME: this.mediaItemsTable.tableName,
        MEDIA_BUCKET_NAME: this.mediaBucket.bucketName,
      },
      bundling: {
        externalModules: [],
      },
    });
    this.foldersTable.grantReadWriteData(foldersFn);
    this.folderSharesTable.grantReadData(foldersFn);
    this.mediaItemsTable.grantReadData(foldersFn);
    this.mediaBucket.grantRead(foldersFn);

    // --- Folder sharing: grant/revoke access, permissions matrix ---
    const sharesFn = new NodejsFunction(this, "SharesFn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(lambdaDir, "shares.ts"),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        FOLDERS_TABLE_NAME: this.foldersTable.tableName,
        FOLDER_SHARES_TABLE_NAME: this.folderSharesTable.tableName,
        USER_POOL_ID: props.userPool.userPoolId,
      },
      bundling: {
        externalModules: [],
      },
    });
    this.foldersTable.grantReadData(sharesFn);
    this.folderSharesTable.grantReadWriteData(sharesFn);
    sharesFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cognito-idp:AdminGetUser", "cognito-idp:ListUsersInGroup"],
        resources: [props.userPool.userPoolArn],
      })
    );

    // --- Friend invites (Cognito account + SES email) ---
    const invitesFn = new NodejsFunction(this, "InvitesFn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(lambdaDir, "invites.ts"),
      timeout: Duration.seconds(15),
      memorySize: 256,
      environment: {
        FOLDERS_TABLE_NAME: this.foldersTable.tableName,
        FOLDER_SHARES_TABLE_NAME: this.folderSharesTable.tableName,
        USER_POOL_ID: props.userPool.userPoolId,
        SES_FROM_ADDRESS: props.sesFromAddress,
        SITE_URL: props.siteUrl,
      },
      bundling: {
        externalModules: [],
      },
    });
    this.foldersTable.grantReadData(invitesFn);
    this.folderSharesTable.grantWriteData(invitesFn);
    invitesFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cognito-idp:AdminCreateUser", "cognito-idp:AdminAddUserToGroup"],
        resources: [props.userPool.userPoolArn],
      })
    );
    invitesFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ses:SendEmail"],
        resources: [props.sesIdentityArn],
      })
    );

    // --- Signed view/download URLs (progressive streaming — see infra/README.md
    // for why this isn't true adaptive HLS yet: that needs CloudFront with
    // signed cookies in front of the bucket, not just presigned S3 URLs,
    // since a single presigned URL can't cover a manifest's segment files) ---
    const mediaAccessFn = new NodejsFunction(this, "MediaAccessFn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(lambdaDir, "media-access.ts"),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        FOLDERS_TABLE_NAME: this.foldersTable.tableName,
        FOLDER_SHARES_TABLE_NAME: this.folderSharesTable.tableName,
        MEDIA_TABLE_NAME: this.mediaItemsTable.tableName,
        MEDIA_BUCKET_NAME: this.mediaBucket.bucketName,
        ACTIVITY_LOG_TABLE_NAME: this.activityLogTable.tableName,
      },
      bundling: {
        externalModules: [],
      },
    });
    this.foldersTable.grantReadData(mediaAccessFn);
    this.folderSharesTable.grantReadData(mediaAccessFn);
    this.mediaItemsTable.grantReadData(mediaAccessFn);
    this.mediaBucket.grantRead(mediaAccessFn);
    this.activityLogTable.grantWriteData(mediaAccessFn);

    // --- Activity dashboard (read side of ActivityLog — MediaAccessFn is the write side) ---
    const activityFn = new NodejsFunction(this, "ActivityFn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(lambdaDir, "activity.ts"),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        ACTIVITY_LOG_TABLE_NAME: this.activityLogTable.tableName,
        MEDIA_TABLE_NAME: this.mediaItemsTable.tableName,
        FOLDERS_TABLE_NAME: this.foldersTable.tableName,
        USER_POOL_ID: props.userPool.userPoolId,
      },
      bundling: {
        externalModules: [],
      },
    });
    this.activityLogTable.grantReadData(activityFn);
    this.mediaItemsTable.grantReadData(activityFn);
    this.foldersTable.grantReadData(activityFn);
    activityFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cognito-idp:ListUsers"],
        resources: [props.userPool.userPoolArn],
      })
    );

    // --- HTTP API (Cognito-authenticated) ---
    const authorizer = new HttpUserPoolAuthorizer("MediaApiAuthorizer", props.userPool, {
      userPoolClients: [props.userPoolClient],
    });

    const httpApi = new apigwv2.HttpApi(this, "MediaHttpApi", {
      apiName: "swordthain-media-api",
      corsPreflight: {
        allowOrigins: props.allowedOrigins,
        allowMethods: [
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.PATCH,
          apigwv2.CorsHttpMethod.DELETE,
        ],
        allowHeaders: ["content-type", "authorization"],
      },
    });

    httpApi.addRoutes({
      path: "/media/upload-url",
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration("UploadUrlIntegration", uploadUrlFn),
      authorizer,
    });

    const foldersIntegration = new HttpLambdaIntegration("FoldersIntegration", foldersFn);
    httpApi.addRoutes({
      path: "/folders",
      methods: [apigwv2.HttpMethod.POST, apigwv2.HttpMethod.GET],
      integration: foldersIntegration,
      authorizer,
    });
    httpApi.addRoutes({
      path: "/folders/{folderId}",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.PATCH, apigwv2.HttpMethod.DELETE],
      integration: foldersIntegration,
      authorizer,
    });
    httpApi.addRoutes({
      path: "/folders/{folderId}/media",
      methods: [apigwv2.HttpMethod.GET],
      integration: foldersIntegration,
      authorizer,
    });

    const sharesIntegration = new HttpLambdaIntegration("SharesIntegration", sharesFn);
    httpApi.addRoutes({
      path: "/folders/{folderId}/shares",
      methods: [apigwv2.HttpMethod.POST],
      integration: sharesIntegration,
      authorizer,
    });
    httpApi.addRoutes({
      path: "/admin/permissions-matrix",
      methods: [apigwv2.HttpMethod.GET],
      integration: sharesIntegration,
      authorizer,
    });

    httpApi.addRoutes({
      path: "/admin/invites",
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration("InvitesIntegration", invitesFn),
      authorizer,
    });

    httpApi.addRoutes({
      path: "/admin/activity",
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration("ActivityIntegration", activityFn),
      authorizer,
    });

    const mediaAccessIntegration = new HttpLambdaIntegration("MediaAccessIntegration", mediaAccessFn);
    httpApi.addRoutes({
      path: "/media/{mediaId}/view-url",
      methods: [apigwv2.HttpMethod.GET],
      integration: mediaAccessIntegration,
      authorizer,
    });
    httpApi.addRoutes({
      path: "/media/{mediaId}/download-url",
      methods: [apigwv2.HttpMethod.GET],
      integration: mediaAccessIntegration,
      authorizer,
    });

    new CfnOutput(this, "MediaBucketName", { value: this.mediaBucket.bucketName });
    new CfnOutput(this, "MediaItemsTableName", { value: this.mediaItemsTable.tableName });
    new CfnOutput(this, "FoldersTableName", { value: this.foldersTable.tableName });
    new CfnOutput(this, "FolderSharesTableName", { value: this.folderSharesTable.tableName });
    new CfnOutput(this, "ActivityLogTableName", { value: this.activityLogTable.tableName });
    new CfnOutput(this, "MediaApiUrl", { value: httpApi.apiEndpoint });
  }
}
