import { Duration, RemovalPolicy, Stack, StackProps, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as ses from "aws-cdk-lib/aws-ses";
import * as path from "path";

export interface AuthStackProps extends StackProps {
  /** Root domain, e.g. "swordthain.com" — used for SES sending identity and passkey relying party ID. */
  domainName: string;
  /** Existing Route 53 hosted zone ID for domainName (used to auto-verify the SES identity via DNS). */
  hostedZoneId: string;
}

/**
 * Shared auth infrastructure: a single Cognito User Pool used by both the
 * friend-facing media app (Member role) and the owner-only playground
 * (Owner group), passwordless email-OTP via a custom auth Lambda trigger
 * chain, backed by a short-lived DynamoDB table for the OTP codes.
 */
export class AuthStack extends Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const otpTable = new dynamodb.Table(this, "OtpCodesTable", {
      tableName: "swordthain-otp-codes",
      partitionKey: { name: "email", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiresAt",
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, "HostedZone", {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.domainName,
    });

    // Verifies swordthain.com as an SES sending identity via DKIM CNAME
    // records added automatically to the existing hosted zone.
    const sesIdentity = new ses.EmailIdentity(this, "SesIdentity", {
      identity: ses.Identity.publicHostedZone(hostedZone),
      mailFromDomain: `mail.${props.domainName}`,
    });

    const sesFromAddress = `Swordthain <noreply@${props.domainName}>`;

    const lambdaDir = path.join(__dirname, "..", "lambda", "auth");
    const nodeJsFunctionProps = {
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      memorySize: 256,
    };

    const defineAuthChallengeFn = new NodejsFunction(this, "DefineAuthChallengeFn", {
      ...nodeJsFunctionProps,
      entry: path.join(lambdaDir, "define-auth-challenge.ts"),
    });

    const createAuthChallengeFn = new NodejsFunction(this, "CreateAuthChallengeFn", {
      ...nodeJsFunctionProps,
      entry: path.join(lambdaDir, "create-auth-challenge.ts"),
      environment: {
        OTP_TABLE_NAME: otpTable.tableName,
        SES_FROM_ADDRESS: sesFromAddress,
      },
    });
    otpTable.grantWriteData(createAuthChallengeFn);
    createAuthChallengeFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ses:SendEmail"],
        resources: [sesIdentity.emailIdentityArn],
      })
    );

    const verifyAuthChallengeResponseFn = new NodejsFunction(this, "VerifyAuthChallengeResponseFn", {
      ...nodeJsFunctionProps,
      entry: path.join(lambdaDir, "verify-auth-challenge-response.ts"),
      environment: {
        OTP_TABLE_NAME: otpTable.tableName,
      },
    });
    otpTable.grantReadWriteData(verifyAuthChallengeResponseFn);

    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: "swordthain-users",
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      accountRecovery: cognito.AccountRecovery.NONE,
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lambdaTriggers: {
        defineAuthChallenge: defineAuthChallengeFn,
        createAuthChallenge: createAuthChallengeFn,
        verifyAuthChallengeResponse: verifyAuthChallengeResponseFn,
      },
    });

    this.userPoolClient = new cognito.UserPoolClient(this, "UserPoolClient", {
      userPool: this.userPool,
      userPoolClientName: "swordthain-media-app",
      generateSecret: false,
      authFlows: { custom: true },
      disableOAuth: true,
      preventUserExistenceErrors: true,
      authSessionValidity: Duration.minutes(3),
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(365),
      enableTokenRevocation: true,
    });

    new cognito.CfnUserPoolGroup(this, "OwnerGroup", {
      userPoolId: this.userPool.userPoolId,
      groupName: "Owner",
      description: "Site owner — full admin access, including the labs.swordthain.com playground.",
      precedence: 0,
    });

    new cognito.CfnUserPoolGroup(this, "MemberGroup", {
      userPoolId: this.userPool.userPoolId,
      groupName: "Member",
      description: "Invited friend — view/download access to shared folders only.",
      precedence: 10,
    });

    new CfnOutput(this, "UserPoolId", { value: this.userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: this.userPoolClient.userPoolClientId });
    new CfnOutput(this, "OtpTableName", { value: otpTable.tableName });
  }
}
