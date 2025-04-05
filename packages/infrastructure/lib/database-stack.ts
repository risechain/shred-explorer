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

    // Create a new VPC for the database with a larger CIDR block
    this.vpc = new ec2.Vpc(this, 'VPC', {
      // Use a larger CIDR to ensure all our resources fit
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
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
        // Make sure isolated subnets are configured even though we're not using them
        {
          name: 'isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
      // Enable DNS support
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });

    // Create a security group for the database
    this.databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc: this.vpc,
      description: 'Allow database access',
      allowAllOutbound: true,
    });
    
    // Add a broad ingress rule for the database for troubleshooting
    // Caution: This is permissive for development purposes only
    this.databaseSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(5432),
      'Allow PostgreSQL connections from within the VPC'
    );
    
    // Allow connections from any IP within the VPC
    this.databaseSecurityGroup.addIngressRule(
      ec2.Peer.ipv4('0.0.0.0/0'),
      ec2.Port.tcp(5432),
      'Allow PostgreSQL connections from anywhere (for development only)'
    );

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
        // Use PRIVATE_WITH_EGRESS instead of PRIVATE_ISOLATED to enable connectivity
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [this.databaseSecurityGroup],
      databaseName: props.databaseName,
      // Use a simple standard password for easier connections
      credentials: rds.Credentials.fromUsername('postgres', {
        password: cdk.SecretValue.unsafePlainText('postgres')
      }),
      backupRetention: cdk.Duration.days(props.backupRetentionDays || 7),
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: rds.StorageType.GP2,
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
      autoMinorVersionUpgrade: true,
      publiclyAccessible: true, // Allow public access for development only
      // Add parameter group to allow connections from all IP ranges
      parameterGroup: new rds.ParameterGroup(this, 'ParameterGroup', {
        engine: rds.DatabaseInstanceEngine.postgres({
          version: rds.PostgresEngineVersion.VER_15,
        }),
        parameters: {
          // Set max_connections higher
          'max_connections': '200',
          // These help with RDS connectivity
          'rds.force_ssl': '0',
        }
      }),
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