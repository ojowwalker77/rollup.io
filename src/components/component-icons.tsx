import {
  Activity,
  Boxes,
  Cpu,
  Database,
  Gauge,
  Globe,
  HardDrive,
  KeyRound,
  Layers,
  LineChart,
  Network,
  Radio,
  RadioTower,
  Search,
  Send,
  Server,
  Shield,
  Smartphone,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";

const AWS_ICON_URLS: Record<string, string> = {
  aws_amplify: "/assets/aws-icons/Arch_AWS-Amplify_32.svg",
  aws_appsync: "/assets/aws-icons/Arch_AWS-AppSync_32.svg",
  aws_route53: "/assets/aws-icons/Arch_Amazon-Route-53_32.svg",
  aws_waf: "/assets/aws-icons/Arch_AWS-WAF_32.svg",
  aws_cloudfront: "/assets/aws-icons/Arch_Amazon-CloudFront_32.svg",
  aws_alb: "/assets/aws-icons/Arch_Elastic-Load-Balancing_32.svg",
  aws_api_gateway: "/assets/aws-icons/Arch_Amazon-API-Gateway_32.svg",
  aws_vpc_lattice: "/assets/aws-icons/Arch_Amazon-VPC-Lattice_32.svg",
  aws_ec2_asg: "/assets/aws-icons/Arch_Amazon-EC2-Auto-Scaling_32.svg",
  aws_ecs_fargate: "/assets/aws-icons/Arch_AWS-Fargate_32.svg",
  aws_eks: "/assets/aws-icons/Arch_Amazon-Elastic-Kubernetes-Service_32.svg",
  aws_lambda: "/assets/aws-icons/Arch_AWS-Lambda_32.svg",
  aws_rds: "/assets/aws-icons/Arch_Amazon-RDS_32.svg",
  aws_aurora: "/assets/aws-icons/Arch_Amazon-Aurora_32.svg",
  aws_dynamodb: "/assets/aws-icons/Arch_Amazon-DynamoDB_32.svg",
  aws_elasticache_redis: "/assets/aws-icons/Arch_Amazon-ElastiCache_32.svg",
  aws_s3: "/assets/aws-icons/Arch_Amazon-Simple-Storage-Service_32.svg",
  aws_efs: "/assets/aws-icons/Arch_Amazon-EFS_32.svg",
  aws_opensearch: "/assets/aws-icons/Arch_Amazon-OpenSearch-Service_32.svg",
  aws_sqs: "/assets/aws-icons/Arch_Amazon-Simple-Queue-Service_32.svg",
  aws_sns: "/assets/aws-icons/Arch_Amazon-Simple-Notification-Service_32.svg",
  aws_eventbridge: "/assets/aws-icons/Arch_Amazon-EventBridge_32.svg",
  aws_kinesis: "/assets/aws-icons/Arch_Amazon-Kinesis-Data-Streams_32.svg",
  aws_msk: "/assets/aws-icons/Arch_Amazon-Managed-Streaming-for-Apache-Kafka_32.svg",
  aws_step_functions: "/assets/aws-icons/Arch_AWS-Step-Functions_32.svg",
  aws_cognito: "/assets/aws-icons/Arch_Amazon-Cognito_32.svg",
  aws_secrets_manager: "/assets/aws-icons/Arch_AWS-Secrets-Manager_32.svg",
  aws_cloudwatch: "/assets/aws-icons/Arch_Amazon-CloudWatch_32.svg",
  aws_redshift: "/assets/aws-icons/Arch_Amazon-Redshift_32.svg",
  aws_glue: "/assets/aws-icons/Arch_AWS-Glue_32.svg",
  aws_athena: "/assets/aws-icons/Arch_Amazon-Athena_32.svg",
};

const LUCIDE_ICONS: Record<string, LucideIcon> = {
  client: Users,
  web_client: Globe,
  mobile_client: Smartphone,
  partner_api: Users,
  api_gateway: Gauge,
  app_server: Server,
  sql: Database,
  cache: Zap,
  redis: Zap,
  nosql: Boxes,
  object_store: HardDrive,
  cdn: RadioTower,
  search_index: Search,
  event_queue: Send,
  realtime_gateway: Radio,
  inference_server: Cpu,
  observability: Activity,
  gcp_cloud_load_balancing: Network,
  gcp_api_gateway: Gauge,
  gcp_cloud_cdn: RadioTower,
  gcp_compute_mig: Server,
  gcp_cloud_run: Layers,
  gcp_gke: Boxes,
  gcp_cloud_functions: Zap,
  gcp_cloud_sql: Database,
  gcp_spanner: Database,
  gcp_firestore: Database,
  gcp_memorystore_redis: Zap,
  gcp_cloud_storage: HardDrive,
  gcp_pubsub: Send,
  gcp_bigquery: LineChart,
  gcp_dataflow: Send,
  gcp_cloud_monitoring: LineChart,
  gcp_secret_manager: KeyRound,
};

export function ComponentIcon({
  type,
  className,
  style,
}: {
  type: string;
  className?: string;
  style?: CSSProperties;
}) {
  const src = AWS_ICON_URLS[type];
  if (src) {
    return <img src={src} alt="" className={className} style={style} draggable={false} />;
  }

  const Icon = LUCIDE_ICONS[type] ?? Shield;
  return <Icon className={className} style={style} />;
}
