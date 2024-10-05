#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { EcsExporterCdkStack } from "../lib/ecs-exporter-cdk-stack";

const app = new cdk.App();
new EcsExporterCdkStack(app, "EcsExporterCdkStack", {});
