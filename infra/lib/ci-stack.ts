import { Stack, StackProps, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";

export interface CiStackProps extends StackProps {
  githubOrg: string;
  githubRepo: string;
  /** Branches allowed to assume these roles, e.g. ["main"]. */
  allowedBranches: string[];
  playgroundBucketName: string;
  playgroundLambdaFunctionName: string;
  playgroundDistributionId: string;
  /**
   * apps/media-app's static-site bucket (SwordthainMediaAppDataStack,
   * eu-west-1) and distribution (SwordthainMediaAppHostingStack,
   * us-east-1). Bucket referenced by name only — the IAM policy below
   * only ever needed it to build an ARN (`arn:aws:s3:::{name}`, which has
   * no region field anyway), so this avoids a cross-region construct
   * reference for a value that doesn't need one. Mirrors
   * `playgroundBucketName` above.
   */
  mediaAppSiteBucketName: string;
  mediaAppSiteDistributionId: string;
  /**
   * Regions any stack in this app deploys to — the infra CI role needs to
   * assume CDK bootstrap roles in each one. Both us-east-1 (CloudFront/ACM/
   * WAFv2-for-CloudFront/Cognito/playground) and eu-west-1 (media-app's
   * data plane) since the region split — see infra/README.md.
   */
  bootstrapRegions: string[];
  /** CDK bootstrap qualifier (default "hnb659fds") — used to build the bootstrap role ARNs. */
  cdkQualifier?: string;
}

/**
 * GitHub Actions OIDC trust + purpose-scoped deploy roles, so CI never
 * holds long-lived AWS keys. One role per app, matching "CI/CD for each
 * app independently" — a playground-only change can't touch infra
 * permissions and vice versa.
 */
export class CiStack extends Stack {
  constructor(scope: Construct, id: string, props: CiStackProps) {
    super(scope, id, props);

    const provider = new iam.OpenIdConnectProvider(this, "GitHubOidcProvider", {
      url: "https://token.actions.githubusercontent.com",
      clientIds: ["sts.amazonaws.com"],
    });

    // GitHub now includes immutable owner/repo IDs in the OIDC subject
    // claim (e.g. "repo:org@12345/repo@67890:ref:refs/heads/main") rather
    // than the classic name-only form — confirmed via CloudTrail on an
    // actual failed AssumeRoleWithWebIdentity call. Wildcard the ID
    // segments since the org/repo name match already scopes this tightly
    // enough for a single-owner account.
    const subjects = props.allowedBranches.map(
      (branch) => `repo:${props.githubOrg}@*/${props.githubRepo}@*:ref:refs/heads/${branch}`
    );

    const oidcPrincipal = new iam.OpenIdConnectPrincipal(provider, {
      StringEquals: {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      },
      StringLike: {
        "token.actions.githubusercontent.com:sub": subjects,
      },
    });

    // --- apps/playground: scoped to exactly what its manual deploy did ---
    const playgroundRole = new iam.Role(this, "PlaygroundCiRole", {
      roleName: "swordthain-playground-ci",
      assumedBy: oidcPrincipal,
      description: "GitHub Actions deploy role for apps/playground",
    });

    const playgroundBucketArn = `arn:aws:s3:::${props.playgroundBucketName}`;
    playgroundRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:ListBucket"],
        resources: [playgroundBucketArn],
      })
    );
    playgroundRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        resources: [`${playgroundBucketArn}/*`],
      })
    );
    playgroundRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["lambda:UpdateFunctionCode", "lambda:GetFunction"],
        resources: [
          `arn:aws:lambda:${this.region}:${this.account}:function:${props.playgroundLambdaFunctionName}`,
        ],
      })
    );
    playgroundRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:CreateInvalidation"],
        resources: [
          `arn:aws:cloudfront::${this.account}:distribution/${props.playgroundDistributionId}`,
        ],
      })
    );

    // --- apps/media-app: scoped to exactly what a static-site deploy needs ---
    const mediaAppRole = new iam.Role(this, "MediaAppCiRole", {
      roleName: "swordthain-media-app-ci",
      assumedBy: oidcPrincipal,
      description: "GitHub Actions deploy role for apps/media-app",
    });

    const mediaAppSiteBucketArn = `arn:aws:s3:::${props.mediaAppSiteBucketName}`;
    mediaAppRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:ListBucket"],
        resources: [mediaAppSiteBucketArn],
      })
    );
    mediaAppRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        resources: [`${mediaAppSiteBucketArn}/*`],
      })
    );
    mediaAppRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:CreateInvalidation"],
        resources: [
          `arn:aws:cloudfront::${this.account}:distribution/${props.mediaAppSiteDistributionId}`,
        ],
      })
    );

    // --- infra/ (CDK): only needs to assume the CDK bootstrap roles.     ---
    // Those roles (created by `cdk bootstrap`) already carry the
    // permissions CDK needs to actually create/update resources — this
    // role is deliberately just a narrow bridge into them, not a second
    // copy of AdministratorAccess.
    const qualifier = props.cdkQualifier ?? "hnb659fds";
    const bootstrapRoleArns = props.bootstrapRegions.flatMap((region) =>
      ["deploy-role", "file-publishing-role", "lookup-role"].map(
        (role) => `arn:aws:iam::${this.account}:role/cdk-${qualifier}-${role}-${this.account}-${region}`
      )
    );

    const infraRole = new iam.Role(this, "InfraCiRole", {
      roleName: "swordthain-infra-ci",
      assumedBy: oidcPrincipal,
      description: "GitHub Actions deploy role for infra/ (assumes CDK bootstrap roles)",
    });
    infraRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole", "sts:TagSession"],
        resources: bootstrapRoleArns,
      })
    );

    // --- infra/regression-tests: only needs to read the fixed test-account ---
    // OTP so it can sign in with zero human interaction. No S3/Lambda/
    // CloudFront access at all — everything else it does is a plain HTTPS
    // call to Cognito's public API and the app's own API Gateway, same as
    // any real client.
    const regressionTestRole = new iam.Role(this, "RegressionTestCiRole", {
      roleName: "swordthain-regression-test-ci",
      assumedBy: oidcPrincipal,
      description: "GitHub Actions role for the post-deploy regression-test suite",
    });
    regressionTestRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/swordthain/regression-test/otp-code`,
        ],
      })
    );
    // scenarios/playlists.ts inserts/removes a synthetic MediaItems row
    // directly (src/db.ts) rather than a real video upload — see that
    // file's comment for why. eu-west-1 explicitly: MediaItems lives in
    // the media-app data plane's region, not this stack's (us-east-1) —
    // same cross-region-by-literal-ARN pattern used elsewhere in infra/lib.
    regressionTestRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:PutItem", "dynamodb:DeleteItem"],
        resources: [`arn:aws:dynamodb:eu-west-1:${this.account}:table/swordthain-media-items`],
      })
    );

    // --- infra/a11y-tests: same fixed-OTP sign-in as the regression suite ---
    // above. Also needs the same narrow synthetic-media-item grant that
    // role has, for the same reason (tests/modal.spec.ts's Lightbox/
    // PlaylistPlayer focus-trap check needs a real openable item, and
    // there's no guarantee real media exists in the CI Test folder at scan
    // time) — see infra/a11y-tests/src/db.ts.
    const a11yTestRole = new iam.Role(this, "A11yTestCiRole", {
      roleName: "swordthain-a11y-test-ci",
      assumedBy: oidcPrincipal,
      description: "GitHub Actions role for the post-deploy accessibility test suite",
    });
    a11yTestRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/swordthain/regression-test/otp-code`,
        ],
      })
    );
    a11yTestRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:PutItem", "dynamodb:DeleteItem"],
        resources: [`arn:aws:dynamodb:eu-west-1:${this.account}:table/swordthain-media-items`],
      })
    );

    new CfnOutput(this, "PlaygroundCiRoleArn", { value: playgroundRole.roleArn });
    new CfnOutput(this, "MediaAppCiRoleArn", { value: mediaAppRole.roleArn });
    new CfnOutput(this, "InfraCiRoleArn", { value: infraRole.roleArn });
    new CfnOutput(this, "RegressionTestCiRoleArn", { value: regressionTestRole.roleArn });
    new CfnOutput(this, "A11yTestCiRoleArn", { value: a11yTestRole.roleArn });
  }
}
