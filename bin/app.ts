#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { DeadcodeRadarStack } from "../lib/deadcode-radar-stack";

const app = new cdk.App();
new DeadcodeRadarStack(app, "DeadcodeRadarStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
