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
 * apps/media-app's own resources: media storage bucket, MediaItems table,
 * presigned upload + thumbnail-generation Lambdas, and the HTTP API that
 * fronts them (Cognito-authenticated). Folder CRUD/browsing and per-folder
 * sharing land in a later phase — folderId here is just an opaque string
 * until FolderShares exists to validate access against.
 */
export class MediaAppStack extends Stack {
  public readonly mediaBucket: s3.Bucket;
  public readonly mediaItemsTable: dynamodb.Table;

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

    const lambdaDir = path.join(__dirname, "..", "lambda", "media");

    // --- Presigned upload URL endpoint ---
    const uploadUrlFn = new NodejsFunction(this, "UploadUrlFn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(lambdaDir, "upload-url.ts"),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        MEDIA_BUCKET_NAME: this.mediaBucket.bucketName,
      },
      bundling: {
        // Don't rely on the runtime's bundled AWS SDK for s3-request-presigner —
        // bundle everything to avoid a missing-module surprise.
        externalModules: [],
      },
    });
    this.mediaBucket.grantPut(uploadUrlFn);

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

    // --- HTTP API (Cognito-authenticated) ---
    const authorizer = new HttpUserPoolAuthorizer("MediaApiAuthorizer", props.userPool, {
      userPoolClients: [props.userPoolClient],
    });

    const httpApi = new apigwv2.HttpApi(this, "MediaHttpApi", {
      apiName: "swordthain-media-api",
      corsPreflight: {
        allowOrigins: props.allowedOrigins,
        allowMethods: [apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.GET],
        allowHeaders: ["content-type", "authorization"],
      },
    });

    httpApi.addRoutes({
      path: "/media/upload-url",
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration("UploadUrlIntegration", uploadUrlFn),
      authorizer,
    });

    new CfnOutput(this, "MediaBucketName", { value: this.mediaBucket.bucketName });
    new CfnOutput(this, "MediaItemsTableName", { value: this.mediaItemsTable.tableName });
    new CfnOutput(this, "MediaApiUrl", { value: httpApi.apiEndpoint });
  }
}
