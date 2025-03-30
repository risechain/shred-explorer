import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export interface DatabaseStackProps extends cdk.StackProps {
  databaseName: string;
  databaseUsername: string;
  backupRetentionDays?: number;
  instanceType?: string;
  tags?: { [key: string]: string };
}

export class DatabaseStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly database: rds.DatabaseInstance;
  public readonly databaseSecurityGroup: ec2.SecurityGroup;
  public readonly databaseEndpoint: string;
  public readonly databaseName: string;
  public readonly databaseUsername: string;
  public readonly databaseSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    // Apply tags to all resources in the stack
    if (props.tags) {
      Object.entries(props.tags).forEach(([key, value]) => {
        cdk.Tags.of(this).add(key, value);
      });
    }

    // Create a new VPC for the database
    this.vpc = new ec2.Vpc(this, 'VPC', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: 'isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // Create a security group for the database
    this.databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc: this.vpc,
      description: 'Allow database access',
      allowAllOutbound: true,
    });

    // Create a password secret
    this.databaseSecret = new secretsmanager.Secret(this, 'DatabaseSecret', {
      secretName: `${id}-credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          username: props.databaseUsername,
        }),
        excludePunctuation: true,
        includeSpace: false,
        generateStringKey: 'password',
      },
    });
    
    // Parse instance type if provided as string (e.g., 'db.t3.small')
    let instanceType: ec2.InstanceType;
    if (props.instanceType) {
      const [classType, size] = props.instanceType.replace('db.', '').split('.');
      instanceType = ec2.InstanceType.of(
        classType as any,
        size as any
      );
    } else {
      instanceType = ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.SMALL
      );
    }
    
    // Create a Postgres database instance
    this.database = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      instanceType,
      vpc: this.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [this.databaseSecurityGroup],
      databaseName: props.databaseName,
      credentials: rds.Credentials.fromSecret(this.databaseSecret),
      backupRetention: cdk.Duration.days(props.backupRetentionDays || 7),
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: rds.StorageType.GP2,
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
      autoMinorVersionUpgrade: true,
      publiclyAccessible: false,
    });

    // Store outputs
    this.databaseEndpoint = this.database.dbInstanceEndpointAddress;
    this.databaseName = props.databaseName;
    this.databaseUsername = props.databaseUsername;

    // Output the database endpoint
    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: this.databaseEndpoint,
      description: 'The endpoint of the database',
    });

    // Output the secret ARN
    new cdk.CfnOutput(this, 'DatabaseSecretArn', {
      value: this.databaseSecret.secretArn,
      description: 'The ARN of the database credentials secret',
    });
  }
}