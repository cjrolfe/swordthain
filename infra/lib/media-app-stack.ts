import { Duration, RemovalPolicy, Stack, StackProps, CfnOutput, ILocalBundling } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { HttpUserPoolAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
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
  /**
   * Custom domain aliases for the static-site CloudFront distribution below,
   * e.g. ["swordthain.com", "www.swordthain.com"]. Left unset until the DNS
   * cutover (see infra/README.md): CloudFront refuses to let a second
   * distribution claim an alias that's already live on another one, and
   * today those two names are still aliased to playground's existing
   * distribution. Until cutover, this distribution is verified at its own
   * *.cloudfront.net domain instead.
   */
  siteDomainNames?: string[];
  /** ACM cert (us-east-1) covering siteDomainNames — required together with it. */
  siteCertificateArn?: string;
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

const FFMPEG_INSTALLER_VERSION = "1.1.0";

/**
 * Fetches a static linux/x64 ffmpeg binary via npm's cross-platform install
 * flags, same mechanism and same reliability profile as sharpLocalBundling
 * above — no Docker needed. Originally this pulled a static build directly
 * from johnvansickle.com at deploy time; that worked but was a genuine
 * external-website dependency in the build pipeline, and it materialized
 * as a real (if transient) CI failure once GitHub Actions' runners
 * couldn't reach it. Switched to @ffmpeg-installer/ffmpeg, which is
 * sourced entirely from the npm registry via real per-platform
 * optionalDependencies (@ffmpeg-installer/linux-x64, etc.) — the same
 * pattern sharp uses, which has never had a reliability issue here. The
 * trade-off: this ffmpeg build is from 2021 (4.1.x) rather than current —
 * more than sufficient for the poster-frame/HEIC-still extraction this
 * project actually does, which doesn't touch bleeding-edge codec features.
 */
const ffmpegLocalBundling: ILocalBundling = {
  tryBundle(outputDir: string): boolean {
    const installDir = path.join(outputDir, "install");
    fs.mkdirSync(installDir, { recursive: true });
    execSync("npm init -y", { cwd: installDir, stdio: "inherit" });
    execSync(
      `npm install --os=linux --cpu=x64 --libc=glibc @ffmpeg-installer/ffmpeg@${FFMPEG_INSTALLER_VERSION}`,
      { cwd: installDir, stdio: "inherit" }
    );

    const binDir = path.join(outputDir, "bin");
    fs.mkdirSync(binDir, { recursive: true });
    fs.copyFileSync(
      path.join(installDir, "node_modules", "@ffmpeg-installer", "linux-x64", "ffmpeg"),
      path.join(binDir, "ffmpeg")
    );
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
  public readonly siteBucket: s3.Bucket;
  public readonly siteDistribution: cloudfront.Distribution;

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
        bundling: { image: lambda.Runtime.NODEJS_20_X.bundlingImage, local: ffmpegLocalBundling },
      }),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      compatibleArchitectures: [lambda.Architecture.X86_64],
      description: `@ffmpeg-installer/ffmpeg@${FFMPEG_INSTALLER_VERSION} prebuilt for linux/x64 (npm-sourced)`,
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

    // --- Static site hosting (the React SPA itself, not the API below) ---
    // Created before the HTTP API so its CloudFront domain can be added to
    // the API's CORS origins below — the SPA calls this same API from
    // wherever it's served, including its own *.cloudfront.net domain
    // during pre-cutover verification.
    this.siteBucket = new s3.Bucket(this, "SiteBucket", {
      bucketName: `swordthain-site-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // CloudFront-scope WAF (free managed rule groups) — unlike the HTTP API
    // below, a CloudFront distribution *can* have WAFv2 attached directly
    // (see the throttling comment below for why the API itself can't).
    const siteWebAcl = new wafv2.CfnWebACL(this, "SiteWebAcl", {
      scope: "CLOUDFRONT",
      defaultAction: { allow: {} },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: "swordthain-site-waf",
      },
      rules: [
        {
          name: "AWS-AWSManagedRulesCommonRuleSet",
          priority: 0,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: { vendorName: "AWS", name: "AWSManagedRulesCommonRuleSet" },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: "swordthain-site-common",
          },
        },
        {
          name: "AWS-AWSManagedRulesKnownBadInputsRuleSet",
          priority: 1,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: { vendorName: "AWS", name: "AWSManagedRulesKnownBadInputsRuleSet" },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: "swordthain-site-badinputs",
          },
        },
        {
          name: "AWS-AWSManagedRulesAmazonIpReputationList",
          priority: 2,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: { vendorName: "AWS", name: "AWSManagedRulesAmazonIpReputationList" },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: "swordthain-site-ipreputation",
          },
        },
      ],
    });

    const siteCertificate =
      props.siteCertificateArn && props.siteDomainNames?.length
        ? acm.Certificate.fromCertificateArn(this, "SiteCertificate", props.siteCertificateArn)
        : undefined;

    this.siteDistribution = new cloudfront.Distribution(this, "SiteDistribution", {
      comment: "apps/media-app static site (swordthain.com root domain)",
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      webAclId: siteWebAcl.attrArn,
      domainNames: siteCertificate ? props.siteDomainNames : undefined,
      certificate: siteCertificate,
    });

    // --- HTTP API (Cognito-authenticated) ---
    const authorizer = new HttpUserPoolAuthorizer("MediaApiAuthorizer", props.userPool, {
      userPoolClients: [props.userPoolClient],
    });

    const httpApi = new apigwv2.HttpApi(this, "MediaHttpApi", {
      apiName: "swordthain-media-api",
      corsPreflight: {
        // Includes the site distribution's own *.cloudfront.net domain so
        // the SPA can call this API when verified there pre-cutover, on
        // top of the real domain(s) and local dev.
        allowOrigins: [...props.allowedOrigins, `https://${this.siteDistribution.distributionDomainName}`],
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

    // --- Rate limiting on the API ---
    // AWS WAFv2 cannot be associated with API Gateway HTTP APIs (v2) at
    // all — only REST APIs (v1), ALB, AppSync, Cognito, App Runner,
    // Amplify, or Verified Access (confirmed against AWS's own API
    // reference: AssociateWebACL's ResourceArn format is explicitly
    // `/restapis/...`, not `/apis/...`; attempting it here failed with
    // "The ARN isn't valid" and rolled back cleanly). Getting WAF's bot
    // managed-rule-groups in front of this API for real would mean either
    // migrating off HTTP API to REST API, or putting CloudFront in front
    // of it — both bigger moves than "safe pieces," and CloudFront is the
    // more sensible of the two given the spec's own architecture already
    // wants it; bundle that with the deferred playground/root-domain
    // cutover rather than doing a narrower one-off migration now.
    //
    // What HTTP API does support natively: stage-level throttling. It's a
    // global cap across the whole API (not per-IP the way a WAF
    // rate-based rule would be), but it's a real, working mitigation
    // against the backend being overwhelmed, available today with no
    // architecture change.
    const defaultStage = httpApi.defaultStage!.node.defaultChild as apigwv2.CfnStage;
    defaultStage.defaultRouteSettings = {
      throttlingRateLimit: 20, // sustained requests/sec across the whole API
      throttlingBurstLimit: 40,
    };

    new CfnOutput(this, "MediaBucketName", { value: this.mediaBucket.bucketName });
    new CfnOutput(this, "MediaItemsTableName", { value: this.mediaItemsTable.tableName });
    new CfnOutput(this, "FoldersTableName", { value: this.foldersTable.tableName });
    new CfnOutput(this, "FolderSharesTableName", { value: this.folderSharesTable.tableName });
    new CfnOutput(this, "ActivityLogTableName", { value: this.activityLogTable.tableName });
    new CfnOutput(this, "MediaApiUrl", { value: httpApi.apiEndpoint });
    new CfnOutput(this, "SiteBucketName", { value: this.siteBucket.bucketName });
    new CfnOutput(this, "SiteDistributionId", { value: this.siteDistribution.distributionId });
    new CfnOutput(this, "SiteDistributionDomainName", { value: this.siteDistribution.distributionDomainName });
  }
}
