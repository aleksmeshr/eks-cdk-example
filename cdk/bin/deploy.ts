import * as cdk from 'aws-cdk-lib';
import * as blueprints from '@aws-quickstart/eks-blueprints';
import { CapacityType, KubernetesVersion, NodegroupAmiType } from 'aws-cdk-lib/aws-eks';
import { InstanceClass, InstanceSize, InstanceType, } from 'aws-cdk-lib/aws-ec2';
import { MonitoringStack } from '../lib/monitoring-stack';
import { DeploymentMode, Mode } from '@aws-quickstart/eks-blueprints';

const account = process.env.AWS_ACCOUNT_ID as string;
const region = process.env.AWS_REGION as string;
const env  = { account, region };

const app = new cdk.App();

// Manual Cluster with a Bastion Host https://github.com/aws-samples/amazon-eks-ethereum-staking/blob/main/lib/eks.ts
// Manual CDK service account and LB https://github.com/aws-samples/amazon-eks-ethereum-staking/blob/main/lib/k8s-baseline.ts
// NodeGroup setup https://github.com/aws-samples/amazon-eks-ethereum-staking/blob/main/lib/nodegroup.ts

const monitoringStack = new MonitoringStack(app, 'MonitoringStack', { env });

// The catalog of blueprints addons: https://aws-quickstart.github.io/cdk-eks-blueprints/addons/

const coreAddOns: Array<blueprints.ClusterAddOn> = [
  new blueprints.addons.VpcCniAddOn(/*{
    enablePrefixDelegation: true,
    warmIpTarget: 4,
  }*/),
  new blueprints.addons.EbsCsiDriverAddOn(),
  new blueprints.addons.CoreDnsAddOn(),
  // To setup Route53 for example for Ngnix Ingress
  /*new blueprints.addons.ExternalDnsAddOn({
    hostedZoneResources: ['MyHostedZone1']
  }),
  
  Requires:
  .resourceProvider("MyHostedZone1", new blueprints.DelegatingHostedZoneProvider({
        parentDomain: 'myglobal-domain.com',
        subdomain: 'dev.myglobal-domain.com', 
        parentAccountId: parentDnsAccountId,
        delegatingRoleName: 'DomainOperatorRole',
        wildcardSubdomain: true
    })
  */
  new blueprints.addons.KubeProxyAddOn(),
  // Required for Grafana addon
  //new blueprints.addons.ExternalsSecretsAddOn(),
  new blueprints.addons.SecretsStoreAddOn(),
  new blueprints.addons.AwsLoadBalancerControllerAddOn(),
  new blueprints.addons.NginxAddOn({
    values: {
      controller: { service: { create: false } },
    },
  }),
  // Certificate Manager - Required for the AdotCollectorAddOn
  new blueprints.addons.CertManagerAddOn(),

  // For per-Pod network security settings. Not compatible with Fargate
  // https://docs.aws.amazon.com/eks/latest/userguide/calico.html
  /*new blueprints.addons.CalicoOperatorAddOn({
    name: 'calico-operator',
    namespace: 'calico-operator',
    version: '3.26.4',
    chart: "tigera-operator",
    release: "bp-addon-calico-operator",
    repository: "https://projectcalico.docs.tigera.io/charts"
  }),*/
];

const observabilityAddOns: Array<blueprints.ClusterAddOn> = [
    // Installs CloudWatchInsightsAddon("Amazon CloudWatch Observability") EKS addon
    // The add-on installs the CloudWatch agent to send infrastructure metrics from the cluster,
    // installs Fluent Bit to send container logs,
    // enables CloudWatch Application Signals to send application performance telemetry.
    // https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/install-CloudWatch-Observability-EKS-addon.html
    new blueprints.addons.CloudWatchInsights(),

    // Deploys `aws-for-fluent-bit` Helm chart
    // Probably conflicts with CloudWatchInsights addon.
    // Can send also to Firehose, Kafka, Elastic, S3 and extract embedded metrics
    // https://github.com/aws/eks-charts/tree/master/stable/aws-for-fluent-bit
    /*new blueprints.addons.CloudWatchLogsAddon({
      //version: '0.1.32',
      logGroupPrefix: '/eks/mycluster1',
      logRetentionDays: 10,
    }),*/

    // OpenTelemetry Collector, should be before CloudWatchAdotAddOn and AmpAddOn
    new blueprints.addons.AdotCollectorAddOn(),
    new blueprints.addons.CloudWatchAdotAddOn(),
    // OpenTelemetry Collector configured to send data into Managed Prometheus
    new blueprints.addons.AmpAddOn({
      ampPrometheusEndpoint: monitoringStack.prometheusEndpoint,
      deploymentMode: DeploymentMode.DEPLOYMENT,
    }),
    new blueprints.addons.GrafanaOperatorAddon(),
];

const autoscalingAddons: Array<blueprints.ClusterAddOn> = [
  new blueprints.addons.MetricsServerAddOn(),
  new blueprints.addons.KedaAddOn({
    namespace: 'keda',
    podSecurityContextFsGroup: 1001,
    securityContextRunAsGroup: 1001,
    securityContextRunAsUser: 1001,
    irsaRoles: ["CloudWatchFullAccess", "AmazonSQSFullAccess"],
  }),
  /*new blueprints.addons.KarpenterAddOn({
    requirements: [
      { key: 'node.kubernetes.io/instance-type', op: 'In', vals: ['m3.medium'] },
      { key: 'topology.kubernetes.io/zone', op: 'NotIn', vals: ['us-east-1e']},
      { key: 'kubernetes.io/arch', op: 'In', vals: ['amd64']},
      { key: 'karpenter.sh/capacity-type', op: 'In', vals: ['spot']},
    ],
    subnetTags: {
      "Name": "my-karpenter-subnet-tag",
    },
    securityGroupTags: {
      "kubernetes.io/cluster/blueprint-construct-dev": "owned",
    },
    taints: [{
      key: "workload",
      value: "test",
      effect: "NoSchedule",
    }],
    amiSelector: {
      "karpenter.sh/discovery/MyClusterName": '*',
    },
    consolidation: { enabled: true },
    ttlSecondsUntilExpired: 2592000,
    weight: 20,
    interruptionHandling: true,
    limits: {
        resources: {
            cpu: 20,
            memory: "64Gi",
        }
    },
    tags: {
        schedule: 'always-on'
    }
  }),*/
];

// The order of addons is important
const addOns: Array<blueprints.ClusterAddOn> = [
  ...coreAddOns,
  ...observabilityAddOns,
  ...autoscalingAddons,
  new blueprints.addons.ArgoCDAddOn({
    bootstrapRepo: {
      repoUrl: 'https://github.com/aleksmeshr/eks-cdk-example.git',
      path: 'envs/dev',
    },
  }),
];

const clusterProvider = new blueprints.GenericClusterProvider({
  clusterName: 'mycluster1',
  version: KubernetesVersion.V1_27,
  managedNodeGroups: [
    {
      id: 'mycluster1-base',
      amiType: NodegroupAmiType.AL2_X86_64,
      enableSsmPermissions: true,
      instanceTypes: [InstanceType.of(InstanceClass.T3, InstanceSize.LARGE)],
      minSize: 2,
      nodeGroupCapacityType: CapacityType.SPOT,
    }
  ]
  /*autoscalingNodeGroups:[
    {
      id: 'mycluster1-base',
      autoScalingGroupName: 'mycluster1-base',
      bootstrapOptions: {
        kubeletExtraArgs: '--max-pods=40',
        useMaxPods: false,
      },
      instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.MEDIUM),
      minSize: 3,
      //spotPrice: '0.6',
    }
  ],*/
});

const stack = blueprints.EksBlueprint.builder()
  .account(account)
  .region(region)
  .version('auto')
  .clusterProvider(clusterProvider)
  .addOns(...addOns)
  /*.resourceProvider(
    GlobalResources.HostedZone,
    new ImportHostedZoneProvider(parameters.hostedZoneID, parameters.subdomain)
  )
  .resourceProvider(
    GlobalResources.Certificate,
    new blueprints.CreateCertificateProvider(
      "ingress-wildcard",
      `*.${parameters.subdomain}`,
      GlobalResources.HostedZone
    )
  )*/
  .enableControlPlaneLogTypes(blueprints.ControlPlaneLogType.API, blueprints.ControlPlaneLogType.SCHEDULER)
  .useDefaultSecretEncryption(true)
  .build(app, 'example-app1');

/*
function addCustomNodeGroup(): blueprints.ManagedNodeGroup {

  const userData = ec2.UserData.forLinux();
  userData.addCommands(`/etc/eks/bootstrap.sh ${blueprintID}`);

  return {
      id: "mng2-customami",
      amiType: NodegroupAmiType.AL2_X86_64,
      instanceTypes: [new ec2.InstanceType('t3.large')],
      nodeGroupCapacityType: CapacityType.SPOT,
      desiredSize: 0,
      minSize: 0,
      nodeRole: blueprints.getNamedResource("node-role") as iam.Role,
      launchTemplate: {
          tags: {
              "Name": "Mng2",
              "Type": "Managed-Node-Group",
              "LaunchTemplate": "Custom",
              "Instance": "SPOT"
          },
          machineImage: ec2.MachineImage.genericLinux({
              'eu-west-1': 'ami-00805477850d62b8c',
              'us-east-1': 'ami-08e520f5673ee0894',
              'us-west-2': 'ami-0403ff342ceb30967',
              'us-east-2': 'ami-07109d69738d6e1ee',
              'us-west-1': 'ami-07bda4b61dc470985',
              'us-gov-west-1': 'ami-0e9ebbf0d3f263e9b',
              'us-gov-east-1':'ami-033eb9bc6daf8bfb1'
          }),
          userData: userData,
      }
  };
}*/
