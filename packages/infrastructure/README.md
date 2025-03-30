# Shred Explorer Infrastructure

This project contains the AWS CDK infrastructure code for deploying the Shred Explorer application to AWS.

## Architecture

The Shred Explorer infrastructure consists of:

1. **PostgreSQL Database (RDS)** - A managed PostgreSQL database for storing blockchain data
2. **ECS Cluster (Fargate)** - A serverless container orchestration service for running the API and ETL services
3. **Load Balancer** - For routing traffic to the services
4. **Secrets Management** - For securely storing database credentials

## Prerequisites

- AWS CLI configured with SSO credentials
- Node.js 14 or higher
- AWS CDK CLI installed (`npm install -g aws-cdk`)
- Docker installed locally for building container images

## Setup with AWS SSO

1. Configure AWS SSO in your AWS CLI if you haven't already:

```bash
aws sso login --profile riselabs-prod
```

Follow the prompts to set up your SSO login.

2. Copy the `.env.example` file to `.env` and customize the values:

```bash
cp .env.example .env
```

3. In your `.env` file, set the AWS_PROFILE to your SSO profile name:

```
AWS_PROFILE=your-sso-profile-name
```

4. Install dependencies:

```bash
npm install
```

## Deployment

You can deploy the infrastructure using the following command:

```bash
./deploy.sh
```

This script will:
1. Check if you have a valid AWS SSO session and prompt you to login if not
2. Bootstrap the CDK in your account if needed
3. Build the CDK code
4. Synthesize CloudFormation templates
5. Deploy all stacks to your AWS account

Alternatively, you can deploy individual stacks after logging in with SSO:

```bash
aws sso login --profile your-profile-name
npx cdk deploy ShredExplorer-dev-Database
npx cdk deploy ShredExplorer-dev-Cluster
npx cdk deploy ShredExplorer-dev-Service
```

## Environment Variables

The deployment can be customized with the following environment variables in your `.env` file:

- `AWS_PROFILE`: Your AWS SSO profile name (e.g., 'dev-admin')
- `AWS_REGION`: The AWS region to deploy to (e.g., 'us-east-1')
- `ENVIRONMENT`: Environment name (e.g., 'dev', 'staging', 'prod')
- `DATABASE_NAME`: Name of the PostgreSQL database
- `DATABASE_USERNAME`: Username for the database
- `DATABASE_INSTANCE_TYPE`: RDS instance type (e.g., 'db.t3.small')
- `DATABASE_BACKUP_RETENTION_DAYS`: Number of days to retain backups
- `ECS_SERVICE_MIN_CAPACITY`: Minimum number of ECS tasks
- `ECS_SERVICE_MAX_CAPACITY`: Maximum number of ECS tasks
- `ECS_SERVICE_CPU_UTILIZATION_TARGET`: CPU utilization target for auto-scaling
- `WEBSOCKET_URL`: URL for the WebSocket service

## Infrastructure Components

### Database Stack

This stack creates:
- A VPC with public, private, and isolated subnets
- A PostgreSQL RDS instance in the isolated subnet
- A security group for the database
- A secret in AWS Secrets Manager for the database credentials

### Cluster Stack

This stack creates:
- A VPC with public and private subnets
- An ECS cluster for running Fargate services
- A CloudMap namespace for service discovery

### Service Stack

This stack creates:
- Task definitions for the API and ETL services
- A Fargate service for running the containers
- A load balancer for routing traffic to the service
- Auto-scaling policies based on CPU utilization
- Security groups for the services

## Cleaning Up

To remove all deployed resources:

```bash
aws sso login --profile your-profile-name
npx cdk destroy --all
```

Note: This will delete all resources except for RDS snapshots that were created as part of the removal policy.