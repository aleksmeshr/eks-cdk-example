import * as cdk from 'aws-cdk-lib';
import * as blueprints from '@aws-quickstart/eks-blueprints';
import { KubernetesVersion } from 'aws-cdk-lib/aws-eks';
import { InstanceClass, InstanceSize, InstanceType, } from 'aws-cdk-lib/aws-ec2';
import { MonitoringStack } from '../lib/monitoring-stack';
import { DeploymentMode } from '@aws-quickstart/eks-blueprints';

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
  new blueprints.addons.VpcCniAddOn(),
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
  /*new blueprints.addons.CalicoOperatorAddOn({
    name: 'calico-operator',
    namespace: 'calico-operator',
    version: 'v3.26.4',
    chart: "tigera-operator",
    release: "bp-addon-calico-operator",
    repository: "https://projectcalico.docs.tigera.io/charts"
  }),*/
];

const observabilityAddOns: Array<blueprints.ClusterAddOn> = [
    // Deploys a FluntBit and Container Insights dashboard
    // Installs "Amazon CloudWatch Observability" addon
    new blueprints.addons.CloudWatchInsights(),
    // Deploys FluentBit - is it needed when CloudWatchInsights is enabled?
    new blueprints.addons.CloudWatchLogsAddon({
      logGroupPrefix: '/eks/mycluster1',
      logRetentionDays: 10,
    }),
    // OpenTelemetry Collector, should be before CloudWatchAdotAddOn and AmpAddOn
    new blueprints.addons.AdotCollectorAddOn(),
    //new blueprints.addons.CloudWatchAdotAddOn(),
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

/*const clusterProvider = new blueprints.MngClusterProvider({
  version: KubernetesVersion.V1_27,
  amiType: NodegroupAmiType.BOTTLEROCKET_X86_64,
  instanceTypes: [InstanceType.of(InstanceClass.T3, InstanceSize.MEDIUM)],
  clusterName: 'mycluster1',
  nodegroupName: 'mycluster1-spot-medium',
  nodeGroupCapacityType: CapacityType.SPOT,
  minSize: 2,
  desiredSize: 2,
  /*launchTemplate: {
    machineImage: new BottleRocketImage(),
    userData: UserData.custom(''),
    //securityGroup
  }
});*/

const clusterProvider = new blueprints.GenericClusterProvider({
  clusterName: 'mycluster1',
  version: KubernetesVersion.V1_27,
  autoscalingNodeGroups:[
    {
      id: 'mycluster1-base',
      autoScalingGroupName: 'mycluster1-base',
      bootstrapOptions: {
        kubeletExtraArgs: '--max-pods=50',
        useMaxPods: false,
      },
      instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.MEDIUM),
    }
  ],
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
