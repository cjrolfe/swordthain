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
  /** CDK bootstrap qualifier (default "hnb659fds") — used to build the bootstrap role ARNs. */
  cdkQualifier?: string;
}

/**
 * GitHub Actions OIDC trust + two purpose-scoped deploy roles, so CI never
 * holds long-lived AWS keys. One role per app, matching "CI/CD for both
 * apps independently" — a playground-only change can't touch infra
 * permissions and vice versa.
 */
export class CiStack extends Stack {
  constructor(scope: Construct, id: string, props: CiStackProps) {
    super(scope, id, props);

    const provider = new iam.OpenIdConnectProvider(this, "GitHubOidcProvider", {
      url: "https://token.actions.githubusercontent.com",
      clientIds: ["sts.amazonaws.com"],
    });

    const subjects = props.allowedBranches.map(
      (branch) => `repo:${props.githubOrg}/${props.githubRepo}:ref:refs/heads/${branch}`
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

    // --- infra/ (CDK): only needs to assume the CDK bootstrap roles.     ---
    // Those roles (created by `cdk bootstrap`) already carry the
    // permissions CDK needs to actually create/update resources — this
    // role is deliberately just a narrow bridge into them, not a second
    // copy of AdministratorAccess.
    const qualifier = props.cdkQualifier ?? "hnb659fds";
    const bootstrapRoleArns = ["deploy-role", "file-publishing-role", "lookup-role"].map(
      (role) => `arn:aws:iam::${this.account}:role/cdk-${qualifier}-${role}-${this.account}-${this.region}`
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

    new CfnOutput(this, "PlaygroundCiRoleArn", { value: playgroundRole.roleArn });
    new CfnOutput(this, "InfraCiRoleArn", { value: infraRole.roleArn });
  }
}
