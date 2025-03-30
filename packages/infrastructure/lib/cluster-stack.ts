import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';

export interface ClusterStackProps extends cdk.StackProps {
  tags?: { [key: string]: string };
}

export class ClusterStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly cluster: ecs.Cluster;

  constructor(scope: Construct, id: string, props?: ClusterStackProps) {
    super(scope, id, props);

    // Apply tags to all resources in the stack
    if (props?.tags) {
      Object.entries(props.tags).forEach(([key, value]) => {
        cdk.Tags.of(this).add(key, value);
      });
    }

    // Create a new VPC for the ECS cluster
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
      ],
    });

    // Create a log group for the cluster
    const logGroup = new logs.LogGroup(this, 'ClusterLogs', {
      logGroupName: `/ecs/${id}`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create an ECS cluster for running the services
    this.cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: this.vpc,
      containerInsights: true,
      defaultCloudMapNamespace: {
        name: 'shred-explorer.local',
      },
    });

    // Output the VPC ID
    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      description: 'The ID of the VPC',
    });

    // Output the Cluster Name
    new cdk.CfnOutput(this, 'ClusterName', {
      value: this.cluster.clusterName,
      description: 'The name of the ECS cluster',
    });
  }
}