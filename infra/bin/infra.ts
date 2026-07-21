#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { AuthStack } from "../lib/auth-stack";
import { CiStack } from "../lib/ci-stack";
import { MediaAppDataStack } from "../lib/media-app-data-stack";
import { MediaAppHostingStack } from "../lib/media-app-hosting-stack";
import { PlaygroundStack } from "../lib/playground-stack";

const app = new cdk.App();

const account = process.env.CDK_DEFAULT_ACCOUNT;

// us-east-1: everything CloudFront/ACM/WAFv2-for-CloudFront needs (a hard
// AWS constraint, not a choice) plus Cognito/SES/playground, which stay
// here regardless — see infra/README.md's "Region split" section for why
// (short version: playground's REST API Cognito authorizer requires
// same-region, and playground's API + Lambda are us-east-1).
const usEast1 = { account, region: "us-east-1" };

// eu-west-1: apps/media-app's data plane (media bucket, DynamoDB, Lambdas,
// HTTP API, the static site's own bucket) — the part that actually matters
// for UK download/streaming latency and EU data residency, since presigned
// S3 GET URLs go straight from browser to bucket, bypassing CloudFront.
const euWest1 = { account, region: "eu-west-1" };

// Shared infra: Cognito user pool used by both apps/media-app and the
// Owner-gated apps/playground. Deployed independently of either app's
// own stack, which will reference its outputs.
const authStack = new AuthStack(app, "SwordthainAuthStack", {
  env: usEast1,
  domainName: "swordthain.com",
  hostedZoneId: "Z09793352H82VF3C9TII2",
});

// MediaAppDataStack (eu-west-1) needs AuthStack's (us-east-1) Cognito pool
// and SES identity, but as plain IDs/ARNs rather than construct references
// — CDK's cross-stack reference mechanism (Fn::ImportValue) is region-
// scoped and can't cross this boundary without opting into
// `crossRegionReferences`, which this codebase avoids in favor of
// referencing already-stable values directly (same pattern as
// `hostedZoneId`/`playgroundApiId` elsewhere). Both values are safe to
// hardcode: the user pool has `deletionProtection: true`, and the SES
// identity ARN is fully deterministic from the account + domain name.
const USER_POOL_ID = "us-east-1_7psnNcO5d";
const USER_POOL_ARN = `arn:aws:cognito-idp:us-east-1:${account}:userpool/${USER_POOL_ID}`;
const USER_POOL_CLIENT_ID = "71qr9fcrcspphp0n2p8htiq8ug";
const SES_IDENTITY_ARN = `arn:aws:ses:us-east-1:${account}:identity/swordthain.com`;
const SES_FROM_ADDRESS = "Swordthain <noreply@swordthain.com>";

// Same reasoning: MediaAppHostingStack (us-east-1) needs MediaAppDataStack's
// (eu-west-1) SiteBucket by name only — not pulled off a construct
// reference, for the same cross-region reason. Computed the same way
// MediaAppDataStack computes it internally (`swordthain-site-${this.account}`),
// which is not a prop on that stack, so this must be kept in sync by hand.
//
// This exact name briefly, repeatedly hit a transient S3 409 ("A
// conflicting conditional operation is currently in progress") while
// recreating it after the old us-east-1 stack's bucket of the same name
// was deleted — retried across ~45 minutes before it finally cleared on
// its own. Not a permanent lock after all; kept the original name.
const MEDIA_SITE_BUCKET_NAME = `swordthain-site-${account}`;

new MediaAppDataStack(app, "SwordthainMediaAppDataStack", {
  env: euWest1,
  // localhost:5173 (Vite's default dev port) is included for local admin
  // UI development against the real deployed API — tighten this once the
  // admin UI has a real hosted origin. The hosting stack's own
  // *.cloudfront.net domain (ddnqinqtg4lyz.cloudfront.net) is included as
  // a literal for pre-cutover verification — same two-phase bootstrap
  // used when the site distribution was first created: deployed without
  // it, then added once the real (randomly-assigned) domain was known.
  allowedOrigins: [
    "https://swordthain.com",
    "https://www.swordthain.com",
    "http://localhost:5173",
    "https://ddnqinqtg4lyz.cloudfront.net",
  ],
  userPoolArn: USER_POOL_ARN,
  userPoolId: USER_POOL_ID,
  userPoolClientId: USER_POOL_CLIENT_ID,
  sesIdentityArn: SES_IDENTITY_ARN,
  sesFromAddress: SES_FROM_ADDRESS,
  siteUrl: "https://swordthain.com",
});

const mediaAppHostingStack = new MediaAppHostingStack(app, "SwordthainMediaAppHostingStack", {
  env: usEast1,
  siteBucketName: MEDIA_SITE_BUCKET_NAME,
  siteBucketRegion: "eu-west-1",
  // DNS cutover: aliases freed from playground's old distribution first
  // (see infra/README.md), then claimed here. Reuses the existing ACM
  // cert — it already covers both names, since it was issued for the old
  // playground distribution originally.
  siteDomainNames: ["swordthain.com", "www.swordthain.com"],
  siteCertificateArn: "arn:aws:acm:us-east-1:584000479246:certificate/710894e4-c91f-4986-a21d-812e52eaceb5",
});

const playgroundStack = new PlaygroundStack(app, "SwordthainPlaygroundStack", {
  env: usEast1,
  domainName: "swordthain.com",
  hostedZoneId: "Z09793352H82VF3C9TII2",
  labsSubdomain: "labs.swordthain.com",
  playgroundBucketName: "swordthain-demo-sites",
  playgroundApiId: "x7g9r0sdmc",
  userPool: authStack.userPool,
});

new CiStack(app, "SwordthainCiStack", {
  env: usEast1,
  githubOrg: "cjrolfe",
  githubRepo: "swordthain",
  allowedBranches: ["main"],
  playgroundBucketName: "swordthain-demo-sites",
  playgroundLambdaFunctionName: "swordthain-automation",
  // The pre-cutover playground distribution (E1AUXZ6C0Z7J9P) was
  // decommissioned once swordthain.com moved to MediaAppHostingStack —
  // LabsDistribution (labs.swordthain.com) is playground's real
  // distribution now, and both CI's invalidation permission and
  // deploy-playground.yml's invalidation call needed updating together,
  // or the next playground deploy would invalidate a distribution that
  // no longer exists.
  playgroundDistributionId: playgroundStack.distribution.distributionId,
  mediaAppSiteBucketName: MEDIA_SITE_BUCKET_NAME,
  mediaAppSiteDistributionId: mediaAppHostingStack.siteDistribution.distributionId,
  bootstrapRegions: ["us-east-1", "eu-west-1"],
});
