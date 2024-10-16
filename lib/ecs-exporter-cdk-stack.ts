import { Stack, type StackProps } from "aws-cdk-lib";
import {
  AutoScalingGroup,
  BlockDeviceVolume,
} from "aws-cdk-lib/aws-autoscaling";
import { InstanceType, Port, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import {
  AmiHardwareType,
  AsgCapacityProvider,
  AwsLogDriver,
  Cluster,
  ContainerDefinitionOptions,
  ContainerImage,
  CpuArchitecture,
  Ec2Service,
  Ec2TaskDefinition,
  EcsOptimizedImage,
  FargateService,
  FargateTaskDefinition,
  NetworkMode,
  OperatingSystemFamily,
} from "aws-cdk-lib/aws-ecs";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

export class EcsExporterCdkStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // The human-readable name for many resources we create here.
    const resourceName = "prom-ecs-exporter-sandbox";

    // Image variants to deploy. You can deploy multiple variants to compare
    // them side-by-side. Each variant gets a task on Fargate and a task on EC2.
    const variants: ReadonlyArray<{
      variant: string;
      image: ContainerImage;
      containerOverrides?: Partial<ContainerDefinitionOptions>;
    }> = [
      {
        variant: "main",
        image: ContainerImage.fromRegistry(
          "quay.io/prometheuscommunity/ecs-exporter:main",
        ),
      },
      {
        variant: "isker",
        image: ContainerImage.fromAsset("./custom-build", {
          platform: Platform.LINUX_ARM64,
          buildArgs: {
            SOURCE:
              "https://github.com/isker/ecs_exporter.git#14b73afc2d7a9ce96a50ebb1f4126d08ff290c74",
          },
        }),
      },
    ];

    // The VPC matters for tasks on EC2 instances. Create one that only has a
    // public subnet and no NAT gateways to simplify/encheapen things.
    const vpc = new Vpc(this, "Vpc", {
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: "subnet",
          subnetType: SubnetType.PUBLIC,
        },
      ],
    });

    const cluster = new Cluster(this, "Cluster", {
      clusterName: resourceName,
      vpc,
      enableFargateCapacityProviders: true,
    });

    // ASG capacity provider used for tasks on EC2 instances.
    const autoScalingGroup = new AutoScalingGroup(this, "ASG", {
      vpc,
      autoScalingGroupName: resourceName,
      instanceType: new InstanceType("t4g.nano"),
      machineImage: EcsOptimizedImage.amazonLinux2023(AmiHardwareType.ARM),
      minCapacity: 0,
      maxCapacity: 2 * variants.length,
      blockDevices: [
        { deviceName: "/dev/xvda", volume: BlockDeviceVolume.ebs(40) },
      ],
      newInstancesProtectedFromScaleIn: false,
    });
    autoScalingGroup.connections.allowFromAnyIpv4(Port.tcp(9779));
    const capacityProvider = new AsgCapacityProvider(this, "Capacity", {
      capacityProviderName: resourceName,
      instanceWarmupPeriod: 0,
      enableManagedTerminationProtection: false,
      autoScalingGroup,
    });
    cluster.addAsgCapacityProvider(capacityProvider);

    variants.forEach(({ variant, image, containerOverrides }) => {
      {
        // Create an EC2 task.
        const name = `${resourceName}-${variant}-ec2`;
        const taskDefinition = new Ec2TaskDefinition(
          this,
          `${name}-task-definition`,
          {
            family: name,
            networkMode: NetworkMode.HOST,
          },
        );
        taskDefinition.addContainer(`${name}-ecs-exporter`, {
          containerName: "ecs-exporter",
          image,
          command: ["--log.format=json", "--log.level=debug"],
          portMappings: [{ containerPort: 9779 }],
          logging: new AwsLogDriver({
            logRetention: RetentionDays.ONE_DAY,
            streamPrefix: "ecs-exporter",
          }),
          memoryReservationMiB: 128,
          memoryLimitMiB: 256,
          cpu: 256,
          ...containerOverrides,
        });

        new Ec2Service(this, `${name}-service`, {
          serviceName: name,
          cluster,
          taskDefinition,
          desiredCount: 1,
          minHealthyPercent: 0,
          capacityProviderStrategies: [
            {
              capacityProvider: capacityProvider.capacityProviderName,
              weight: 1,
            },
          ],
        });
      }

      {
        // Create a Fargate task.
        const name = `${resourceName}-${variant}-fargate`;
        const taskDefinition = new FargateTaskDefinition(
          this,
          `${name}-task-definition`,
          {
            family: name,
            runtimePlatform: {
              cpuArchitecture: CpuArchitecture.ARM64,
              operatingSystemFamily: OperatingSystemFamily.LINUX,
            },
          },
        );
        taskDefinition.addContainer(`${name}-ecs-exporter`, {
          containerName: "ecs-exporter",
          image,
          command: ["--log.format=json", "--log.level=debug"],
          portMappings: [{ containerPort: 9779 }],
          logging: new AwsLogDriver({
            logRetention: RetentionDays.ONE_DAY,
            streamPrefix: "ecs-exporter",
          }),
          ...containerOverrides,
        });

        const service = new FargateService(this, `${name}-service`, {
          serviceName: name,
          cluster,
          taskDefinition,
          desiredCount: 1,
          minHealthyPercent: 0,
          assignPublicIp: true,
        });
        service.connections.allowFromAnyIpv4(Port.tcp(9779));
      }
    });
  }
}
