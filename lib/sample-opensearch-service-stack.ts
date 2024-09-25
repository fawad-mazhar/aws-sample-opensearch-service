import { Stack, StackProps, Tags, RemovalPolicy, CfnJson, CustomResource, Duration, CfnOutput } from 'aws-cdk-lib';
import { UserPool, CfnIdentityPool, CfnUserPoolGroup, IUserPool, CfnIdentityPoolRoleAttachment, CfnUserPoolDomain } from 'aws-cdk-lib/aws-cognito'
import { FederatedPrincipal, Role, ServicePrincipal, ManagedPolicy, PolicyStatement, Effect, AnyPrincipal, Policy } from 'aws-cdk-lib/aws-iam'
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId, Provider } from 'aws-cdk-lib/custom-resources'
import { CfnDeliveryStream } from 'aws-cdk-lib/aws-kinesisfirehose'
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs"
import * as lambda from 'aws-cdk-lib/aws-lambda' 
import * as path from "path"
import * as os from 'aws-cdk-lib/aws-opensearchservice'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import { Construct } from 'constructs'

interface SampleOpensearchServiceStackProps extends StackProps {
  stage: string
  appPrefix: string
  osDomainInstanceType: string
  osDomainEbsVolumeSize: number
  osIndexes: string[]
  vpcId: string
  subnetIds: any
}

export class SampleOpensearchServiceStack extends Stack {
  constructor(scope: Construct, id: string, props: SampleOpensearchServiceStackProps) {
    super(scope, id, props);

    const applicationPrefix = props.appPrefix
    const applicationSuffix = props.stage
    const osDomainName = `${applicationPrefix}-cluster-${applicationSuffix}`

    Tags.of(this).add('stack', applicationPrefix, {
      applyToLaunchedInstances: true
    })


    /**
     * Configure Cognito User and Identity Pool
     */
    const userPool = this.createUserPool(props)
    const idPool = this.createIdentityPool(props)


    /**
     * Create the required roles:
     * limitedUserRole: Can read data of specific indexes only, can login to Kibana
     * adminUserRole: Can do everything with the cluster, can create indexes, can configure open distro
     * osServiceRole: Is only used to configure Cognito within the elasticsearch cluster
     * lambdaServiceRole,firehoseServiceRole: Used by the lambda that handles the elasticsearch requests to configure open distro and
     * execute other elasticsearch requests. Can also be used to insert index templates and even data.
     */
    const opensearchLimitedUserRole = this.createUserRole(idPool, `${applicationPrefix}-LimitedUserRole-${applicationSuffix}`)
    const opensearchAdminUserRole = this.createUserRole(idPool, `${applicationPrefix}-AdminUserRole-${applicationSuffix}`)
    const opensearchServiceRole = this.createServiceRole(`${applicationPrefix}-ServiceRole-${applicationSuffix}`, 'es.amazonaws.com', ['AmazonESCognitoAccess'])
    const lambdaServiceRole = this.createServiceRole(`${applicationPrefix}-lambdaServiceRole-${applicationSuffix}`, 'lambda.amazonaws.com', ['service-role/AWSLambdaBasicExecutionRole'])
    const firehoseServiceRole = this.createServiceRole(`${applicationPrefix}-firehoseServiceRole-${applicationSuffix}`, 'firehose.amazonaws.com', ['AmazonESFullAccess', 'AmazonKinesisFullAccess'])


    /**
     * Create two user groups within the Cognito UserPool: 
     * opensearch-admins
     * opensearch-limited users
     */
    this.createAdminUserGroup(userPool.userPoolId, opensearchAdminUserRole.roleArn)
    this.createLimitedUserGroup(userPool.userPoolId, opensearchLimitedUserRole.roleArn)


    /**
     * Create the Opensearch domain
     */
    const opensearchDomain = this.createOpensearchDomain(osDomainName, idPool, opensearchServiceRole, opensearchLimitedUserRole, lambdaServiceRole, firehoseServiceRole, userPool, props)


    /**
     * Add the esLimitedUserRole as the default role when a user gets authenticated.
     */
    this.configureIdentityPool(userPool, idPool, applicationPrefix, opensearchDomain, opensearchLimitedUserRole);

    
    /**
     * Execute a diversity in calls to configure the open distro in the running cluster
     */
    this.executeOpenDistroConfiguration(lambdaServiceRole, firehoseServiceRole,  opensearchDomain, opensearchAdminUserRole, opensearchLimitedUserRole, props)


    /**
     * Kinesis Data Firehose Setup
     * 
     */
    this.deliveryStreamSetup(opensearchDomain, firehoseServiceRole, props)

  } // end constructor

  // Cognito User Pool
  private createUserPool(props: SampleOpensearchServiceStackProps) {
    const userPool = new UserPool(this, props.appPrefix + '-dashboard-' + props.stage, {
      userPoolName: `${props.appPrefix}-dashboard-${props.stage}`,
      userInvitation: {
        emailSubject: 'Use Kibana Dashboard with this account.',
        emailBody: 'Hello {username}, you have been invited to join our Kibana app! Your temporary password is {####}',
        smsMessage: 'Hi {username}, your temporary password for our Kibana app is {####}',
      },
      signInAliases: {
        username: true,
        email: true,
      },
      autoVerify: {
        email: true,
      },
      removalPolicy: RemovalPolicy.DESTROY
    })
    const cognitoDomain = `${props.appPrefix}-domain-${props?.stage}`
    new CfnUserPoolDomain(this, cognitoDomain, {
      domain: cognitoDomain,
      userPoolId: userPool.userPoolId
    })
    return userPool
  }

  // Cognito Identity Pool
  private createIdentityPool(props: SampleOpensearchServiceStackProps) {
    return new CfnIdentityPool(this, props.appPrefix + "-IdentityPool-" + props.stage, {
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: []
    });
  }

  // IAM Roles for IAM Users
  private createUserRole(idPool: CfnIdentityPool, identifier: string) {
    return new Role(this, identifier, {
      assumedBy: new FederatedPrincipal('cognito-identity.amazonaws.com', {
        "StringEquals": {"cognito-identity.amazonaws.com:aud": idPool.ref},
        "ForAnyValue:StringLike": {
          "cognito-identity.amazonaws.com:amr": "authenticated"
        }
      }, "sts:AssumeRoleWithWebIdentity")
    });
  }

  // IAM Roles for Services
  private createServiceRole(identifier: string, servicePrincipal: string, policyNames: string[]) {
    return new Role(this, identifier, {
      assumedBy: new ServicePrincipal(servicePrincipal),
      managedPolicies: policyNames.map(policyName => ManagedPolicy.fromAwsManagedPolicyName(policyName)) //[ManagedPolicy.fromAwsManagedPolicyName(policyName)] 
    });
  }

  // ['OS-Admins'] Cognito Group
  private createAdminUserGroup(userPoolId: string, adminUserRoleArn: string) {
    new CfnUserPoolGroup(this, "userPoolAdminGroupPool", {
      userPoolId: userPoolId,
      groupName: "OS-Admins",
      description: "AWS Opensearch admins access.",
      roleArn: adminUserRoleArn
    })
  }

  // ['OS-Limited-Users'] Cognito Group
  private createLimitedUserGroup(userPoolId: string, limitedUserRoleArn: string) {
    new CfnUserPoolGroup(this, "userPoolLimitedGroupPool", {
      userPoolId: userPoolId,
      groupName: "OS-Limited-Users",
      description: "AWS Opensearch limited access.",
      roleArn: limitedUserRoleArn
    })
  }

  // Opensearch Domain
  private createOpensearchDomain(domainName: string, idPool: CfnIdentityPool, osServiceRole: Role, osLimitedUserRole: Role, lambdaServiceRole: Role, firehoseServiceRole: Role, userPool: IUserPool, props: SampleOpensearchServiceStackProps) {
    const domainArn = "arn:aws:es:" + this.region + ":" + this.account + ":domain/" + domainName + "/*"
    
    const domain = new os.Domain(this, domainName, {
      version: os.EngineVersion.OPENSEARCH_2_15,
      domainName: domainName,
      zoneAwareness: {
        enabled: false
      },
      enableVersionUpgrade: false,
      capacity: {
        dataNodes: 1,
        dataNodeInstanceType: props.osDomainInstanceType,
        multiAzWithStandbyEnabled: false,
      },
      ebs: {
        volumeSize: props.osDomainEbsVolumeSize,
        volumeType: ec2.EbsDeviceVolumeType.GP3,
      },
      logging: {
        appLogEnabled: false,
        slowSearchLogEnabled: false,
        slowIndexLogEnabled: false,
      },
      nodeToNodeEncryption: true,
      encryptionAtRest: {
        enabled: true
      },
      enforceHttps: true,
      accessPolicies: [new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["es:ESHttp*"],
        principals: [new AnyPrincipal()],
        resources: [domainArn],
      })
      ],
      cognitoDashboardsAuth: {
        identityPoolId: idPool.ref,
        role: osServiceRole,
        userPoolId: userPool.userPoolId
      },
      fineGrainedAccessControl: {
        masterUserArn: lambdaServiceRole.roleArn
      },
      removalPolicy: RemovalPolicy.DESTROY
    })


    new ManagedPolicy(this, 'limitedUserPolicy', {
      roles: [osLimitedUserRole, lambdaServiceRole, firehoseServiceRole],
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          resources: [domainArn],
          actions: ['es:ESHttp*']
        })
      ]
    })

    // CFN Outputs
    new CfnOutput(this, `${props.appPrefix}-dashboard-endpoint-${props.stage}`, {
      description: "Opensearch dashboard endpoint.",
      value: `https://${domain.domainEndpoint}/_dashboards`
    })

    return domain
  }

  // Configure Identity Pool
  private configureIdentityPool(userPool: IUserPool, identityPool: CfnIdentityPool, applicationPrefix: string, opensearchDomain: os.Domain, osLimitedUserRole: Role) { 
    /**
     * The goal here is to set the authenticated role for the IdentityPool
     * obtain a reference to a client for the UserPool. We use the provided
     * CognitoIdentityServiceProvider and call the method listUserPoolClients
     */
    const userPoolClients = new AwsCustomResource(this, 'clientIdResource', {
      policy: AwsCustomResourcePolicy.fromSdkCalls({resources: [userPool.userPoolArn]}),
      onCreate: {
        service: 'CognitoIdentityServiceProvider',
        action: 'listUserPoolClients',
        parameters: {
          UserPoolId: userPool.userPoolId
        },
        physicalResourceId: PhysicalResourceId.of(`ClientId-${applicationPrefix}`)
      }
    });
    userPoolClients.node.addDependency(opensearchDomain);

    const clientId = userPoolClients.getResponseField('UserPoolClients.0.ClientId'); 
    const providerName = `cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}:${clientId}`

    new CfnIdentityPoolRoleAttachment(this, 'userPoolRoleAttachment', {
      identityPoolId: identityPool.ref,
      roles: {
        'authenticated': osLimitedUserRole.roleArn
      },
      roleMappings: new CfnJson(this, 'roleMappingsJson', {
        value: {
          [providerName]: {
              Type: 'Token',
              AmbiguousRoleResolution: 'AuthenticatedRole'
          }
        }
      })
    })
  }

  
  // Open Distro Configuration
  private executeOpenDistroConfiguration(lambdaServiceRole: Role, firehoseServiceRole: Role, osDomain: os.Domain, osAdminUserRole: Role, osLimitedUserRole: Role, props: SampleOpensearchServiceStackProps) {
    /**
     * Function implementing the requests to Amazon Elasticsearch Service
     * for the custom resource.
     */
    const osRequestsFn = new NodejsFunction(this, 'osRequestsFn', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler',
      entry: path.join(__dirname, '/../functions/opensearch-requests/opensearch-requests.js'),
      timeout: Duration.seconds(30),
      role: lambdaServiceRole,
      environment: {
        "DOMAIN": osDomain.domainEndpoint,
        "REGION": this.region
      }
    })

    const osRequestProvider = new Provider(this, 'osRequestProvider', {
      onEventHandler: osRequestsFn
    })
    new CustomResource(this, 'osRequestsResource', {
      serviceToken: osRequestProvider.serviceToken,
      properties: {
        requests: [
          {
            "method": "PUT",
            "path": "_opendistro/_security/api/rolesmapping/all_access",
            "body": {
              "backend_roles": [
                osAdminUserRole.roleArn,
                lambdaServiceRole.roleArn,
                firehoseServiceRole.roleArn
              ],
              "hosts": [],
              "users": []
            }
          },
          {
            "method": "PUT",
            "path": "_opendistro/_security/api/rolesmapping/security_manager",
            "body": {
              "backend_roles": [
                lambdaServiceRole.roleArn,
                osAdminUserRole.roleArn,
                firehoseServiceRole.roleArn
              ],
              "hosts": [],
              "users": []
            }
          },
          {
            "method": "PUT",
            "path": "_opendistro/_security/api/roles/kibana_limited_role",
            "body": {
              "cluster_permissions": [
                "cluster_composite_ops",
                "indices_monitor"
              ],
              "index_permissions": [{
                "index_patterns": props.osIndexes!,
                "dls": "",
                "fls": [],
                "masked_fields": [],
                "allowed_actions": [
                  "read"
                ]
              }],
              "tenant_permissions": [{
                "tenant_patterns": [
                  "global"
                ],
                "allowed_actions": [
                  "kibana_all_read"
                ]
              }]
            }
          },
          {
            "method": "PUT",
            "path": "_opendistro/_security/api/rolesmapping/kibana_limited_role",
            "body": {
              "backend_roles": [
                osLimitedUserRole.roleArn,
                firehoseServiceRole.roleArn
              ],
              "hosts": [],
              "users": []
            }
          }
        ]
      }
    })
  }

  // Firehose Setup
  private deliveryStreamSetup(Domain: os.Domain, deliveryStreamRole: Role, props: SampleOpensearchServiceStackProps) {
    props.osIndexes.forEach(osIndex => {    
      // Bucket to be used for retry deliveryStream attempts
      const retryBucket = new s3.Bucket(this, `${props.appPrefix}-${osIndex}-delivery-stream-bucket-${props.stage}`, {
        bucketName: `${props.appPrefix}-${osIndex}-retry-stream-bucket-${props.stage}`,
        encryption: s3.BucketEncryption.S3_MANAGED,
        publicReadAccess: false,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        removalPolicy: RemovalPolicy.DESTROY
      })
      
      const deliveryStreamPolicy = new Policy(this, `${props.appPrefix}-${osIndex}-delivery-stream-policy-${props.stage}`, {
        statements: [
          new PolicyStatement({
            resources: ['*'],
            actions: ['kms:*', 'logs:*']
          }),
          new PolicyStatement({
            resources: [
              `${retryBucket.bucketArn}/*`,
              retryBucket.bucketArn
            ],
            actions: [
              's3:AbortMultipartUpload',
              's3:GetBucketLocation',
              's3:GetObject',
              's3:ListBucket',
              's3:ListBucketMultipartUploads',
              's3:PutObject'
            ]
          }),
          new PolicyStatement({
            resources: [
              Domain.domainArn,
              `${Domain.domainArn}/*`
            ],
            actions: [
              'es:DescribeElasticsearchDomain',
              'es:DescribeElasticsearchDomains',
              'es:DescribeElasticsearchDomainConfig',
              'es:ESHttpPost',
              'es:ESHttpPut'
            ]
          })
        ]
      });
      deliveryStreamPolicy.attachToRole(deliveryStreamRole)

      const deliveryStream = new CfnDeliveryStream(this, `${props.appPrefix}-${osIndex}-delivery-stream-${props.stage}`, {
        deliveryStreamName: `${props?.appPrefix}-${osIndex}-delivery-stream-${props.stage}`,
        deliveryStreamType: 'DirectPut',
        elasticsearchDestinationConfiguration: {
          bufferingHints: {
            intervalInSeconds: 60,
            sizeInMBs: 1
          },
          domainArn: Domain.domainArn,
          indexName: osIndex,
          indexRotationPeriod: 'NoRotation',
          retryOptions: {
            durationInSeconds: 60
          },
          roleArn: deliveryStreamRole.roleArn,
          s3BackupMode: 'AllDocuments',
          s3Configuration: {
            bucketArn: retryBucket.bucketArn,
            bufferingHints: {
              intervalInSeconds: 60,
              sizeInMBs: 1,
            },
            compressionFormat: 'UNCOMPRESSED',
            roleArn: deliveryStreamRole.roleArn,
          },
        }
      })
      
           
      // CFN Outputs
      new CfnOutput(this, `firehose-${props?.appPrefix}-${osIndex}-delivery-stream-${props.stage}`, {
        description: "Firehose delivery stream.",
        value: `arn:aws:firehose:${this.region}:${this.account}:deliverystream/${props.appPrefix}-${osIndex}-delivery-stream-${props.stage}`
      })
      return deliveryStream
    })
  }

}
