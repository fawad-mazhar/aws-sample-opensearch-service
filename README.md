# Sample Openseach Service
---

Fawad Mazhar <fawadmazhar@hotmail.com> 2024

---

This project showcases the power of cloud-native technologies and provides a robust foundation for building advanced search and analytics solutions using Amazon Opensearch. Whether you're new to Opensearch or an experienced user, this project offers valuable insights into deploying and managing a production-ready Opensearch cluster on AWS.

## Project Overview

This project demonstrates how to deploy and configure a highly available, scalable, and resilient Amazon OpenSearch service using a range of cloud-native AWS services. The aim is to showcase how different AWS tools can be stitched together to provide a seamless and powerful experience for managing and searching data using OpenSearch.

This project connects several AWS services to provide a complete OpenSearch solution:

1. <b>Amazon OpenSearch</b> - The core component that allows you to create and manage search indexes.
2. <b>Amazon S3</b> - Stores backup data and acts as a long-term, durable storage solution.
3. <b>Kinesis Data Firehose</b> - Streams real-time data directly into OpenSearch for indexing and searching.
4. <b>Amazon Cognito</b> - Manages user authentication and access controls for the OpenSearch dashboard and Kibana.
5. <b>Kibana Dashboard</b> - A visualization tool where users can explore and interact with data in OpenSearch.


#### Key Features

- <b>Easy Deployment:</b> Seamlessly deploy an OpenSearch cluster with pre-configured AWS services.
- <b>Scalability:</b> Effortlessly scale your OpenSearch data nodes and handle large datasets.
- <b>Resiliency:</b> Built-in resilience and failover capabilities ensure that your OpenSearch service remains reliable and highly available.
- <b>Integration with AWS Services:</b> Easily stream, index, and visualize data using Kinesis Data Firehose and Kibana, while leveraging secure storage in Amazon S3.
- <b>User Authentication:</b> Secure your OpenSearch deployment with Amazon Cognito, enabling user authentication and role-based access control.
- <b>Visualization</b>: Utilize Kibana Dashboard for powerful data visualization and exploration.


#### Key Workflow

1. Data is ingested into Kinesis Data Firehose, which is streamed to the OpenSearch cluster.
2. The OpenSearch cluster indexes and stores the incoming data.
3. Users can interact with the data through the Kibana Dashboard to create visualizations and analyze trends.
4.  Amazon Cognito secures the entire setup by managing user authentication.

#### Scaling OpenSearch

To scale the OpenSearch data nodes, simply update the cluster capacity configuration and redeploy. The project is designed to easily accommodate scaling based on the workload.


## Pre-requisites
  - 🔧 AWS CLI Installed & Configured 👉 [Get help here](https://aws.amazon.com/cli/)
  - 🔧 Node.js 18.x+
  - 🔧 AWS CDK 👉 [Get help here](https://docs.aws.amazon.com/cdk/latest/guide/getting_started.html) 
  - 🔧 A VPC deployed [Get help here](https://github.com/fawad1985/aws-sample-vpc)

## Installation
Run command:
```bash
  npm install
  npm run bootstrap:dev
```


## Deploying (eu-west-1)
Run command:
```bash
  npm run deploy:dev
```


## License

This project is licensed under the MIT License. See the LICENSE file for more details.