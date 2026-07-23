import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import * as path from "path";

export class DeadcodeRadarStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DynamoDB table for storing analysis results
    const table = new dynamodb.Table(this, "JobsTable", {
      tableName: "deadcode-radar-jobs",
      partitionKey: { name: "jobId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Lambda Function using NodejsFunction for esbuild bundling
    const handler = new NodejsFunction(this, "HandlerFunction", {
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 1024,
      timeout: cdk.Duration.minutes(5),
      ephemeralStorageSize: cdk.Size.mebibytes(512),
      entry: path.join(__dirname, "..", "lambda", "handler.ts"),
      handler: "handler",
      environment: {
        GITHUB_TOKEN: process.env.GITHUB_TOKEN || "",
        TABLE_NAME: table.tableName,
        BEDROCK_INFERENCE_PROFILE_ID: process.env.BEDROCK_INFERENCE_PROFILE_ID || "us.anthropic.claude-sonnet-4-6",
      },
      bundling: {
        // Include knip and ts-prune as real node_modules in the deployment package.
        // These are invoked as CLI subprocesses, not as ES imports, so they cannot
        // be bundled/tree-shaken by esbuild.
        nodeModules: ["knip", "ts-prune"],
        externalModules: ["@aws-sdk/*"],
      },
    });

    // Grant Lambda read/write permissions on the DynamoDB table
    table.grantReadWriteData(handler);

    // Grant Lambda permission to invoke Bedrock models
    handler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: [
          "arn:aws:bedrock:*::foundation-model/*",
          `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
        ],
      })
    );

    // Lambda Function URL with CORS configured
    const functionUrl = handler.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ["*"],
        allowedMethods: [lambda.HttpMethod.POST, lambda.HttpMethod.GET],
        allowedHeaders: ["*"],
      },
    });

    // Explicit L1 resource-based policy to allow public invocation via Function URL.
    // Using CfnPermission directly because addPermission() high-level API does not
    // reliably produce the FunctionUrlAuthType condition in all CDK versions.
    new lambda.CfnPermission(this, "AllowPublicFunctionUrl", {
      action: "lambda:InvokeFunctionUrl",
      functionName: handler.functionName,
      principal: "*",
      functionUrlAuthType: "NONE",
    });

    // Output the Function URL
    new cdk.CfnOutput(this, "FunctionUrl", {
      value: functionUrl.url,
      description: "DeadCode Radar Lambda Function URL",
    });
  }
}
