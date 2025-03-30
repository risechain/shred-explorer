#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DatabaseStack } from '../lib/database-stack';
import { ClusterStack } from '../lib/cluster-stack';
import { ServiceStack } from '../lib/service-stack';
import * as dotenv from 'dotenv';

dotenv.config();

const app = new cdk.App();

// Get profile and region from environment variables
const profile = process.env.AWS_PROFILE || 'default';
const region = process.env.AWS_REGION || 'us-east-1';

// Environment configuration - use SSO-provided credentials
const env = {
  region,
};

// Tags for all resources
const tags = {
  Project: 'ShredExplorer',
  Environment: process.env.ENVIRONMENT || 'dev',
  Owner: 'RISETeam',
  ManagedBy: 'CDK',
};

// Define stack prefix based on environment
const prefix = `ShredExplorer-${process.env.ENVIRONMENT || 'dev'}`;

// Create a new VPC and RDS database
const databaseStack = new DatabaseStack(app, `${prefix}-Database`, {
  env,
  databaseName: process.env.DATABASE_NAME || 'shred_explorer',
  databaseUsername: process.env.DATABASE_USERNAME || 'postgres',
  backupRetentionDays: process.env.DATABASE_BACKUP_RETENTION_DAYS 
    ? parseInt(process.env.DATABASE_BACKUP_RETENTION_DAYS) : 7,
  instanceType: process.env.DATABASE_INSTANCE_TYPE || 'db.t3.small',
  tags,
});

// Create a new ECS cluster with Fargate support
const clusterStack = new ClusterStack(app, `${prefix}-Cluster`, {
  env,
  tags,
});

// Create services in the cluster
new ServiceStack(app, `${prefix}-Service`, {
  env,
  cluster: clusterStack.cluster,
  vpc: clusterStack.vpc,
  database: databaseStack.database,
  databaseSecurityGroup: databaseStack.databaseSecurityGroup,
  databaseEndpoint: databaseStack.databaseEndpoint,
  databaseName: databaseStack.databaseName,
  databaseUsername: databaseStack.databaseUsername,
  databaseSecret: databaseStack.databaseSecret,
  websocketUrl: process.env.WEBSOCKET_URL || 'wss://staging.riselabs.xyz/ws',
  minCapacity: process.env.ECS_SERVICE_MIN_CAPACITY ? parseInt(process.env.ECS_SERVICE_MIN_CAPACITY) : 1,
  maxCapacity: process.env.ECS_SERVICE_MAX_CAPACITY ? parseInt(process.env.ECS_SERVICE_MAX_CAPACITY) : 5,
  cpuUtilizationTarget: process.env.ECS_SERVICE_CPU_UTILIZATION_TARGET 
    ? parseInt(process.env.ECS_SERVICE_CPU_UTILIZATION_TARGET) : 70,
  tags,
});