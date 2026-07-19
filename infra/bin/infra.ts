#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { AuthStack } from "../lib/auth-stack";

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: "us-east-1",
};

// Shared infra: Cognito user pool used by both apps/media-app and the
// Owner-gated apps/playground. Deployed independently of either app's
// own stack, which will reference its outputs.
new AuthStack(app, "SwordthainAuthStack", {
  env,
  domainName: "swordthain.com",
  hostedZoneId: "Z09793352H82VF3C9TII2",
});
