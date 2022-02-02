import {Stack, StackProps} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {ConfigParams, IConfigParams} from "./config-params";
import {
    InstanceType,
    ISecurityGroup,
    IVpc,
    NatProvider,
    Peer,
    Port,
    SecurityGroup,
    SubnetType,
    Vpc
} from "aws-cdk-lib/aws-ec2";
import {
    Cluster,
    ContainerImage,
    FargateService,
    FargateTaskDefinition,
    ListenerConfig,
    LogDriver,
    Protocol
} from "aws-cdk-lib/aws-ecs";
import {Repository} from "aws-cdk-lib/aws-ecr";
import {
    ApplicationListener,
    ApplicationLoadBalancer,
    ApplicationProtocol, ListenerAction, ListenerCondition
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import {ARecord, PrivateHostedZone, RecordTarget} from "aws-cdk-lib/aws-route53";
import {LoadBalancerTarget} from "aws-cdk-lib/aws-route53-targets";

export class CdkEcsStack extends Stack {

    private configParams: IConfigParams;
    private vpc: IVpc;
    private internetAlbSecurityGroup: ISecurityGroup;
    private internetAlbListener: ApplicationListener;
    private internalAlbSecurityGroup: ISecurityGroup;
    private internalAlbListener: ApplicationListener;
    private cluster: Cluster;
    private internalAlb: ApplicationLoadBalancer;

    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);
        this.configParams = ConfigParams;

        //Setup ECR repositories for docker images
        this.setupECR();

        //Setup VPC
        this.setupVPC();

        //Setup ECS cluster
        this.setupEcsCluster();

        //Setup Internet-Facing ALB for sending traffic to Frontend app
        this.setupInternetFacingAlb();

        //Setup Internal ALB for inter service communication
        this.setupInternalAlb();

        //Setup ECS services
        this.setupEcsServices();

        this.setupRoute53HostedZone();
    }

    private setupECR = () => {
        for (let service of this.configParams.services) {
            new Repository(this, `ECR-Repository-${service.name}`, {
                repositoryName: service.name
            });
        }
    }

    private setupVPC = () => {
        this.vpc = new Vpc(this, `VPC-for-ECS`, {
            maxAzs: 2,
            natGatewayProvider: NatProvider.instance({
                instanceType: new InstanceType('t2.micro')
            })
        });
    }

    private setupEcsCluster = () => {
        this.cluster = new Cluster(this, 'ECS-Cluster', {
            vpc: this.vpc
        })
    }

    private setupInternetFacingAlb = () => {
        this.internetAlbSecurityGroup = new SecurityGroup(this, 'InternetFacingAlbSG', {
            vpc: this.vpc
        });

        this.internetAlbSecurityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(80), 'HTTP Access')

        const alb = new ApplicationLoadBalancer(this, 'InternetFacingAlB', {
            vpc: this.vpc,
            internetFacing: true,
            vpcSubnets: {subnetType: SubnetType.PUBLIC},
            securityGroup: this.internetAlbSecurityGroup
        });

        this.internetAlbListener = alb.addListener('HTTPListenerForWeb', {
            port: 80,
        });

        this.internetAlbListener.addAction('DefaultAction', {
            action: ListenerAction.fixedResponse(200, {
                messageBody: "No routes defined"
            })
        });
    }

    private setupInternalAlb = () => {
        this.internalAlbSecurityGroup = new SecurityGroup(this, 'InternalAlbSG', {
            vpc: this.vpc
        });

        this.internalAlbSecurityGroup.addIngressRule(Peer.ipv4(this.vpc.vpcCidrBlock),Port.tcp(80),'Internal HTTP Access');

        this.internalAlb = new ApplicationLoadBalancer(this, 'InternalAlb', {
            vpc: this.vpc,
            internetFacing: false,
            vpcSubnets: {subnetType: SubnetType.PRIVATE_WITH_NAT},
            securityGroup: this.internalAlbSecurityGroup

        });

        this.internalAlbListener = this.internalAlb.addListener('InternalHttpListener', {
            port: 80
        });

        this.internalAlbListener.addAction('DefaultAction', {
            action: ListenerAction.fixedResponse(200, {
                messageBody: "No routes defined"
            })
        });
    }

    private setupEcsServices = () => {
        for (let service of this.configParams.services) {
            const {
                name, internetFacing,
                memoryLimit, cpuLimit, containerPort, desiredCount, priority, healthCheckPath,albPath
            } = service;


            //Creating the ECS task definition
            const taskDefinition = new FargateTaskDefinition(this, `${name}-TaskDefinition`, {
                memoryLimitMiB: memoryLimit,
                cpu: cpuLimit
            });

            //Creating the container definition
            const containerDefinition = taskDefinition.addContainer(`${name}-Container`, {
                image: ContainerImage.fromEcrRepository(Repository.fromRepositoryName(this, `${name}-ECR-Image`, name)),
                logging: LogDriver.awsLogs({
                    streamPrefix: `${name}-Logs`
                }),
                portMappings: [{
                    containerPort,
                    protocol: Protocol.TCP
                }]
            });


            //Creating the ECS service
            const ecsService = new FargateService(this, `${name}-ECS-Service`, {
                cluster: this.cluster,
                taskDefinition,
                desiredCount,
                assignPublicIp: internetFacing,
                //securityGroups: [serviceSecurityGroup]
            });

            //Register with load balancer targets
            ecsService.registerLoadBalancerTargets({
                containerName: containerDefinition.containerName,
                newTargetGroupId: `${name}-TargetGroup`,
                listener: ListenerConfig.applicationListener(internetFacing ? this.internetAlbListener : this.internalAlbListener, {
                    protocol: ApplicationProtocol.HTTP,
                    priority,
                    healthCheck: {
                        path: healthCheckPath
                    },
                    conditions: [
                        ListenerCondition.pathPatterns([albPath])
                    ]
                }),
            });
        }
    }

    private setupRoute53HostedZone = ()=> {
        const privateHostedZone = new PrivateHostedZone(this, 'Route53-Private-HostedZone',{
            vpc: this.vpc,
            zoneName: "service.internal",
        });

        const aliasRecordForInternalAlb = new ARecord(this, 'AliasRecord',{
            target: RecordTarget.fromAlias(new LoadBalancerTarget(this.internalAlb)),
            zone: privateHostedZone
        })
    }
}
