import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as elasticloadbalancingv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as path from 'path';

export interface ServiceStackProps extends cdk.StackProps {
  cluster: ecs.Cluster;
  vpc: ec2.Vpc;
  database: rds.DatabaseInstance;
  databaseSecurityGroup: ec2.SecurityGroup;
  databaseEndpoint: string;
  databaseName: string;
  databaseUsername: string;
  databaseSecret: secretsmanager.Secret;
  websocketUrl?: string;
  minCapacity?: number;
  maxCapacity?: number;
  cpuUtilizationTarget?: number;
  tags?: { [key: string]: string };
}

export class ServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, props);

    // Apply tags to all resources in the stack
    if (props.tags) {
      Object.entries(props.tags).forEach(([key, value]) => {
        cdk.Tags.of(this).add(key, value);
      });
    }

    // Create a security group for the services
    const serviceSecurityGroup = new ec2.SecurityGroup(this, 'ServiceSecurityGroup', {
      vpc: props.vpc,
      description: 'Security group for the ECS services',
      allowAllOutbound: true,
    });

    // Grant access to the database from the VPC CIDR block
    // Using VPC CIDR instead of security group reference to avoid circular dependencies
    props.databaseSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(5432),
      'Allow database access from the VPC'
    );

    // Allow inbound ports for API and WebSocket services
    serviceSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(3001),
      'Allow HTTP API access'
    );
    serviceSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(3002),
      'Allow WebSocket access'
    );

    // Build timestamp for cache busting in both Docker images
    const buildTimestamp = new Date().toISOString();
    
    // Build the API Docker image
    const apiImage = new ecr_assets.DockerImageAsset(this, 'ApiDockerImage', {
      directory: path.join(__dirname, '../../../packages/api'),
      buildArgs: {
        NODE_ENV: 'production',
        // BUILD_TIMESTAMP: buildTimestamp, // Force rebuild by changing build args
      },
      platform: ecr_assets.Platform.LINUX_AMD64, // Ensure compatible architecture
    });

    // Build the ETL Docker image
    const etlImage = new ecr_assets.DockerImageAsset(this, 'EtlDockerImage', {
      directory: path.join(__dirname, '../../../packages/etl'),
      buildArgs: {
        // BUILD_TIMESTAMP: buildTimestamp, // Force rebuild by changing build args
      },
      platform: ecr_assets.Platform.LINUX_AMD64, // Ensure compatible architecture
    });

    // Create a task execution role with permissions to pull images and read secrets
    const executionRole = new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // Add permissions to read the database secret
    props.databaseSecret.grantRead(executionRole);

    // Create a task role with any additional permissions the application needs
    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // Create a log group for the task
    const logGroup = new logs.LogGroup(this, 'ServiceLogGroup', {
      logGroupName: `/ecs/${id}`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create a Fargate task definition for both API and ETL
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      memoryLimitMiB: 1024,
      cpu: 512,
      executionRole,
      taskRole,
    });

    // Add the API container to the task
    const apiContainer = taskDefinition.addContainer('ApiContainer', {
      image: ecs.ContainerImage.fromDockerImageAsset(apiImage),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'api',
        logGroup,
      }),
      environment: {
        NODE_ENV: 'production',
        DATABASE_HOST: props.databaseEndpoint,
        DATABASE_NAME: props.databaseName,
        DATABASE_USER: props.databaseUsername,
        DATABASE_PASSWORD: 'postgres', // Using a simple standard password for PostgreSQL
      },
      // No secrets needed
      portMappings: [
        { containerPort: 3001, hostPort: 3001, protocol: ecs.Protocol.TCP }, // HTTP API
        { containerPort: 3002, hostPort: 3002, protocol: ecs.Protocol.TCP }, // WebSocket
      ],
      // healthCheck: {
      //   // This checks if the API is running, not necessarily if the database is connected
      //   command: ['CMD-SHELL', 'curl -s http://localhost:3001/health | grep -q status || exit 1'],
      //   interval: cdk.Duration.seconds(30),
      //   timeout: cdk.Duration.seconds(5),
      //   retries: 5,
      //   startPeriod: cdk.Duration.seconds(120), // Longer start period to allow for database setup
      // },
    });

    // Add the ETL container to the task
    const etlContainer = taskDefinition.addContainer('EtlContainer', {
      image: ecs.ContainerImage.fromDockerImageAsset(etlImage),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'etl',
        logGroup,
      }),
      environment: {
        RUST_LOG: 'info', // Increase log verbosity for debugging
        DATABASE_HOST: props.databaseEndpoint,
        DATABASE_NAME: props.databaseName,
        DATABASE_USER: props.databaseUsername,
        DATABASE_PASSWORD: 'postgres', // Using a simple standard password for PostgreSQL
        DATABASE_PORT: '5432',
        DATABASE_URL: `postgres://${props.databaseUsername}:postgres@${props.databaseEndpoint}:5432/${props.databaseName}`,
        WEBSOCKET_URL: props.websocketUrl || 'wss://staging.riselabs.xyz/ws',
        // Add networking debugging options
        SQLX_OFFLINE: 'false',
        PGCONNECT_TIMEOUT: '10', // Longer connection timeout (in seconds)
      },
      // No secrets needed
      // healthCheck: {
      //   // Simple process check - make sure the binary is running
      //   command: ['CMD-SHELL', 'ps aux | grep rise-etl | grep -v grep || exit 1'],
      //   interval: cdk.Duration.seconds(30),
      //   timeout: cdk.Duration.seconds(10),
      //   retries: 5,
      //   startPeriod: cdk.Duration.seconds(120), // Longer start period to allow for database setup
      // },
    });

    // Create a Fargate service for the task
    const service = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'Service', {
      cluster: props.cluster,
      taskDefinition,
      desiredCount: 1,
      securityGroups: [serviceSecurityGroup],
      // Place the tasks in private subnets but assign a public IP for internet access
      assignPublicIp: true,
      publicLoadBalancer: true,
      listenerPort: 80,
      targetProtocol: elasticloadbalancingv2.ApplicationProtocol.HTTP,
      // Specify VPC subnets for the tasks - use the same subnet type as the database for connectivity
      taskSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      }
    });

    // Configure auto-scaling for the service
    const scaling = service.service.autoScaleTaskCount({
      minCapacity: props.minCapacity || 1,
      maxCapacity: props.maxCapacity || 5,
    });

    // Scale based on CPU utilization
    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: props.cpuUtilizationTarget || 70,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    // Add health check for the load balancer target group
    service.targetGroup.configureHealthCheck({
      path: '/health',
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(5),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
    });

    // Output the load balancer URL
    new cdk.CfnOutput(this, 'ServiceUrl', {
      value: `http://${service.loadBalancer.loadBalancerDnsName}`,
      description: 'The URL of the load balancer',
    });
  }
}