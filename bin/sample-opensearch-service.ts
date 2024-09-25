#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { SampleOpensearchServiceStack } from '../lib/sample-opensearch-service-stack';

const app = new cdk.App();
new SampleOpensearchServiceStack(app, 'sample-opensearch-service-dev', {
  env: {
    account: 'XXXXXXXXXXXX',
    region: 'eu-west-1',
  },
  stage: 'dev',
  appPrefix: 'sample-os',
  // Read about supported instance types https://docs.aws.amazon.com/opensearch-service/latest/developerguide/supported-instance-types.html
  osDomainInstanceType: 'or1.medium.search',
  osDomainEbsVolumeSize: 20,
  // The number of distinctive opensearch indexes
  osIndexes: ['index-01', 'index-02'],
  vpcId: 'vpc-xxx',
  subnetIds: {
    public: ['subnet-xxx', 'subnet-yyy', 'subnet-zzz'],
  },
})