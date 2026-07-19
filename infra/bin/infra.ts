#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { AuthStack } from "../lib/auth-stack";
import { CiStack } from "../lib/ci-stack";
import { MediaAppStack } from "../lib/media-app-stack";

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: "us-east-1",
};

// Shared infra: Cognito user pool used by both apps/media-app and the
// Owner-gated apps/playground. Deployed independently of either app's
// own stack, which will reference its outputs.
const authStack = new AuthStack(app, "SwordthainAuthStack", {
  env,
  domainName: "swordthain.com",
  hostedZoneId: "Z09793352H82VF3C9TII2",
});

new MediaAppStack(app, "SwordthainMediaAppStack", {
  env,
  allowedOrigins: ["https://swordthain.com", "https://www.swordthain.com"],
  userPool: authStack.userPool,
  userPoolClient: authStack.userPoolClient,
  sesIdentityArn: authStack.sesIdentity.emailIdentityArn,
  sesFromAddress: authStack.sesFromAddress,
  siteUrl: "https://swordthain.com",
});

new CiStack(app, "SwordthainCiStack", {
  env,
  githubOrg: "cjrolfe",
  githubRepo: "swordthain",
  allowedBranches: ["main"],
  playgroundBucketName: "swordthain-demo-sites",
  playgroundLambdaFunctionName: "swordthain-automation",
  playgroundDistributionId: "E1AUXZ6C0Z7J9P",
});
