import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  aws_aps as aps,
  aws_eks as eks,
  aws_ec2 as ec2,
  aws_iam as iam,
  aws_grafana as grafana,
} from 'aws-cdk-lib';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';

export type MonitoringStackProps = cdk.StackProps & {
    //eksCluster: eks.Cluster;
    //vpc: ec2.Vpc;
  };
  
export class MonitoringStack extends cdk.Stack {
  public readonly prometheusEndpoint: string;

  constructor(scope: Construct, id: string, props?: MonitoringStackProps) {
    super(scope, id, props);

    const ampLogGroup = new LogGroup(this, 'AmpLogGroup', {
      logGroupName: '/aws/prometheus/my1',
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const prometheusWorkspace = new aps.CfnWorkspace(this, 'MyPrometheusWorkspace', {
      alias: 'alias',
      loggingConfiguration: {
        logGroupArn: ampLogGroup.logGroupArn,
      }
    });
    this.prometheusEndpoint = prometheusWorkspace.attrPrometheusEndpoint;

    const vpc = ec2.Vpc.fromLookup(this, 'Vpc', { isDefault: true });
    this.deployGrafana(vpc, prometheusWorkspace.attrArn);

    /*const ingestCondition = new CfnJson(this, 'IngestCondition', {
      value: {
        [`${props.eksCluster.clusterOpenIdConnectIssuer}:sub`]:
          'system:serviceaccount:monitoring:amp-iamproxy-ingest-service-account',
      },
    });

    const ingestRole = new iam.Role(this, 'IngestRole', {
      assumedBy: new iam.PrincipalWithConditions(
        new iam.WebIdentityPrincipal(
          `arn:aws:iam::${this.account}:oidc-provider/${props.eksCluster.openIdConnectProvider.openIdConnectProviderIssuer}`
        ),
        {
          StringEquals: ingestCondition,
        }
      ),
      description: 'Role for ingesting Prometheus metrics',
      inlinePolicies: {
        amp: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [
                'aps:RemoteWrite',
                'aps:GetSeries',
                'aps:GetLabels',
                'aps:GetMetricMetadata',
              ],
              effect: iam.Effect.ALLOW,
              resources: ['*'],
            }),
          ],
        }),
      },
    });

    const queryCondition = new CfnJson(this, 'QueryCondition', {
      value: {
        [`${props.eksCluster.clusterOpenIdConnectIssuer}:sub`]: [
          'system:serviceaccount:monitoring:amp-iamproxy-query-service-account',
          'system:serviceaccount:monitoring:amp-iamproxy-query-service-account',
        ],
      },
    });

    new iam.Role(this, 'QueryRole', {
      assumedBy: new iam.PrincipalWithConditions(
        new iam.WebIdentityPrincipal(
          `arn:aws:iam::${this.account}:oidc-provider/${props.eksCluster.openIdConnectProvider.openIdConnectProviderIssuer}`
        ),
        {
          StringEquals: queryCondition,
        }
      ),
      description: 'Role for querying Prometheus metrics',
      inlinePolicies: {
        amp: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [
                'aps:QueryMetrics',
                'aps:GetSeries',
                'aps:GetLabels',
                'aps:GetMetricMetadata',
              ],
              effect: iam.Effect.ALLOW,
              resources: ['*'],
            }),
          ],
        }),
      },
    });

    new eks.HelmChart(this, 'Prometheus', {
      cluster: props.eksCluster,
      chart: 'kube-prometheus-stack',
      repository: 'https://prometheus-community.github.io/helm-charts',
      namespace: 'monitoring',
      release: 'kube-prometheus',
      createNamespace: true,
      values: {
        prometheus: {
          serviceAccount: {
            create: true,
            name: 'amp-iamproxy-ingest-service-account',
            annotations: {
              'eks.amazonaws.com/role-arn': ingestRole.roleArn,
            },
          },
          prometheusSpec: {
            remoteWrite: [
              {
                url: `https://aps-workspaces.${this.region}.amazonaws.com/workspaces/${cfnWorkspace.attrWorkspaceId}/api/v1/remote_write`,
                sigv4: {
                  region: this.region,
                },
                queueConfig: {
                  maxSamplesPerSend: 1000,
                  maxShards: 200,
                  capacity: 2500,
                },
              },
            ],
          },
        },
        alertmaanger: {
          enabled: false
        },
        grafana: {
          enabled: false
        },
        promtheusOperator: {
          tls: {
            enabled: false
          },
          admissionWebhooks: {
            enabled: false,
            patch: {
              enabled: false
            }
          },
        },
      },
    });
    */
  }

  private deployGrafana(vpc: ec2.IVpc, prometheusWorkspaceArn: string) {
    const grafanaSg = new ec2.SecurityGroup(this, 'GrafanaSG', {
      vpc,
      allowAllOutbound: true,
      description: 'SG for Managed Grafana',
    });

    const grafanaRole = new iam.Role(this, 'GrafanaRole', {
      description: 'Role for Grafana workspace',
      assumedBy: new iam.ServicePrincipal('grafana.amazonaws.com'),
      managedPolicies: [{
        managedPolicyArn: 'arn:aws:iam::aws:policy/AmazonPrometheusFullAccess',
      }],
      /*inlinePolicies: {
        'list-amp': new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['aps:ListWorkspaces'],
              effect: iam.Effect.ALLOW,
              resources: [
                `arn:aws:aps:${this.region}:${this.account}:/workspaces`,
              ],
            }),
          ],
        }),
        'query-amp': new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [
                'aps:GetLabels',
                'aps:GetMetricMetadata',
                'aps:GetSeries',
                'aps:QueryMetrics',
                'aps:DescribeWorkspace',
              ],
              effect: iam.Effect.ALLOW,
              resources: [prometheusWorkspaceArn],
            }),
          ],
        }),
      },*/
    });

    new grafana.CfnWorkspace(this, 'Grafana', {
      name: 'my1',
      accountAccessType: 'CURRENT_ACCOUNT',
      permissionType: 'SERVICE_MANAGED',
      roleArn: grafanaRole.roleArn,
      authenticationProviders: ['SAML'],
      notificationDestinations: ['SNS'],
      vpcConfiguration: {
        securityGroupIds: [grafanaSg.securityGroupId],
        subnetIds: vpc.selectSubnets({
          availabilityZones: [`${this.region}a`, `${this.region}b`, `${this.region}c`]
        }).subnetIds,
      },
      dataSources: ['PROMETHEUS'],
      pluginAdminEnabled: true,
    });
  }
}
