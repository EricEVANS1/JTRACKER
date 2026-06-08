// ============================================================
// _lib/ats-matcher.ts
// Deterministic ATS / JD matching layer — v3 fixed
//
// Fixes included:
// - Keeps newlines during dynamic extraction so bullet/section patterns work.
// - Does not split on "/" so terms like CI/CD, C++, REST/API-style phrases survive.
// - Uses hands[-\s]?on instead of hands.on.
// - Dynamic requirement extraction across departments.
// - Scored department detection instead of first-match-wins.
// - Evidence shape matches frontend: ats_keyword_evidence uses evidence: string[].
// ============================================================

import type { AnalysisResult, StructuredCV, StructuredJD } from './types.ts';
import { deduplicateKeywords } from './helpers.ts';

export type AtsMatchStatus = 'matched' | 'partial' | 'missing';
export type AtsRequirementPriority = 'critical' | 'required' | 'nice_to_have';

export interface AtsKeywordEvidence {
  keyword: string;
  canonical: string;
  status: AtsMatchStatus;
  priority: AtsRequirementPriority;
  matched_as?: string | null;
  evidence: string[];
  reason?: string | null;
}

export interface AtsEvidenceReport {
  matched_keywords: string[];
  partial_keywords: string[];
  missing_keywords: string[];
  critical_missing_skills: string[];
  learnable_missing_skills: string[];
  nice_to_have_missing_skills: string[];
  strongest_transferable_skills: Array<{ skill: string; reason: string }>;
  strengths: string[];
  gaps: string[];
  ai_recommendations: string[];
  cv_improvement_actions: string[];
  ats_match_score: number;
  skill_gap_score: number;
  keyword_coverage_score: number;
  evidence: AtsKeywordEvidence[];
}

// ============================================================
// SYNONYMS
// Canonical key => accepted variants.
// ============================================================
const SYNONYMS: Record<string, string[]> = {
  // Microsoft / Office
  'active directory': ['active directory', 'ad', 'azure ad', 'entra id', 'microsoft entra', 'directory services', 'ldap'],
  'microsoft 365': ['microsoft 365', 'office 365', 'o365', 'm365', 'microsoft office 365'],
  'microsoft office': ['microsoft office', 'ms office', 'office suite', 'office applications'],
  'excel': ['excel', 'microsoft excel', 'spreadsheets', 'advanced excel'],
  'word': ['word', 'microsoft word'],
  'powerpoint': ['powerpoint', 'power point', 'microsoft powerpoint', 'presentations'],
  'outlook': ['outlook', 'microsoft outlook', 'exchange online'],
  'teams': ['teams', 'microsoft teams', 'ms teams'],
  'exchange': ['exchange', 'exchange server', 'exchange online', 'microsoft exchange'],
  'sharepoint': ['sharepoint', 'share point', 'microsoft sharepoint'],
  'confluence': ['confluence', 'atlassian confluence'],

  // Windows / Infrastructure
  'windows server': ['windows server', 'server environments', 'server administration', 'windows server 2016', 'windows server 2019', 'windows server 2022'],
  'windows': ['windows', 'windows 10', 'windows 11', 'windows os', 'microsoft windows'],
  'linux': ['linux', 'ubuntu', 'debian', 'red hat', 'rhel', 'centos'],
  'hardware troubleshooting': ['hardware troubleshooting', 'hardware support', 'hardware issues', 'hardware repair', 'hardware maintenance'],
  'software troubleshooting': ['software troubleshooting', 'software support', 'software issues', 'application issues'],
  'end user support': ['end user support', 'end-user support', 'user support', 'desktop support', 'deskside support'],
  'access management': ['access management', 'user account management', 'account provisioning', 'account management', 'permissions management', 'iam', 'identity and access management'],
  'authentication': ['authentication', 'sso', 'single sign-on', 'saml', 'oauth', 'mfa', 'multi-factor authentication', '2fa', 'two-factor authentication'],
  'mfa': ['mfa', 'multi-factor authentication', '2fa', 'two-factor', 'authenticator'],
  'permissions': ['permissions', 'access control', 'rbac', 'role-based access', 'entitlements', 'access rights'],
  'citrix': ['citrix', 'citrix xenapp', 'citrix workspace', 'thin client'],
  'vpn': ['vpn', 'virtual private network', 'remote access', 'anyconnect', 'globalprotect'],
  'remote desktop': ['remote desktop', 'rdp', 'remote troubleshooting', 'remote support', 'remote assistance', 'teamviewer'],
  'monitoring tools': ['monitoring tools', 'monitoring', 'system monitoring', 'alerts', 'alerting', 'observability', 'nagios', 'zabbix', 'prtg', 'solarwinds'],
  'system logs': ['system logs', 'logs', 'event viewer', 'log analysis', 'log management', 'audit logs', 'siem logs'],

  // Databases
  'sql server': ['sql server', 'microsoft sql server', 'mssql', 'ms sql', 't-sql', 'transact-sql'],
  'sql': ['sql', 'database querying', 'queries', 'relational database', 'relational databases', 'database management'],
  'mysql': ['mysql', 'mariadb'],
  'postgresql': ['postgresql', 'postgres', 'pg'],
  'mongodb': ['mongodb', 'mongo', 'document database', 'nosql'],
  'redis': ['redis', 'cache', 'in-memory database'],
  'elasticsearch': ['elasticsearch', 'elastic search', 'opensearch', 'elk stack', 'kibana'],

  // Cloud
  'azure': ['azure', 'microsoft azure', 'azure fundamentals', 'az-900', 'az-104', 'az-204', 'azure cloud'],
  'aws': ['aws', 'amazon web services', 'amazon cloud', 'aws certified', 'ec2', 's3', 'lambda', 'cloudformation'],
  'gcp': ['gcp', 'google cloud', 'google cloud platform', 'gke', 'bigquery', 'cloud run'],

  // Virtualisation
  'vmware': ['vmware', 'vcenter', 'vsphere', 'esxi', 'vmware workstation'],
  'hyper-v': ['hyper-v', 'hyper v', 'microsoft hyper-v'],
  'virtualization': ['virtualization', 'virtualisation', 'virtual machines', 'vm', 'vms', 'vmware', 'hyper-v', 'hypervisor'],

  // ITSM / Support
  'itil': ['itil', 'itil v3', 'itil v4', 'itil4', 'incident management', 'problem management', 'change management', 'service management', 'itsm'],
  'incident management': ['incident management', 'incident', 'tickets', 'ticketing', 'issue resolution', 'p1', 'p2', 'major incident'],
  'problem management': ['problem management', 'root cause', 'rca', 'root cause analysis', 'recurring issues'],
  'change management': ['change management', 'change requests', 'change advisory board', 'cab', 'release management'],
  'sla': ['sla', 'service level agreement', 'service level', 'kpi', 'response time', 'resolution time'],
  'service desk': ['service desk', 'help desk', 'helpdesk', 'it support desk', 'it helpdesk'],
  'technical support': ['technical support', 'tech support', 'support engineer', 'support specialist', 'support analyst', 'it support', 'l1 support', 'l2 support', 'tier 1', 'tier 2'],
  'customer support': ['customer support', 'customer service', 'client support', 'user support', 'customer success', 'customer care'],
  'application support': ['application support', 'enterprise applications', 'app support', 'software support', 'line of business applications', 'lob'],
  'troubleshooting': ['troubleshooting', 'debugging', 'diagnosing', 'fault finding', 'root cause', 'issue resolution'],
  'documentation': ['documentation', 'ticket notes', 'knowledge base', 'kb articles', 'process documentation'],
  'escalation': ['escalation', 'escalations', 'escalated', 'escalate'],

  // Ticketing / CRM
  'jira': ['jira', 'atlassian jira', 'atlassian', 'jira service management', 'jsm'],
  'servicenow': ['servicenow', 'service now', 'snow', 'itsm platform'],
  'zendesk': ['zendesk', 'zen desk'],
  'salesforce': ['salesforce', 'salesforce crm', 'sfdc', 'sales cloud', 'service cloud'],
  'hubspot': ['hubspot', 'hub spot', 'hubspot crm'],
  'crm': ['crm', 'customer relationship management', 'salesforce', 'hubspot', 'dynamics 365', 'crm system'],

  // Scripting / DevOps
  'powershell': ['powershell', 'power shell', 'ps scripts', 'ps1', 'windows scripting', 'shell scripting'],
  'bash': ['bash', 'shell', 'shell scripting', 'linux scripting', 'zsh', 'unix scripting'],
  'ci/cd': ['ci/cd', 'continuous integration', 'continuous deployment', 'continuous delivery', 'devops pipeline', 'pipelines', 'build pipelines'],
  'docker': ['docker', 'containerisation', 'containerization', 'containers', 'container images', 'dockerfile'],
  'kubernetes': ['kubernetes', 'k8s', 'kubectl', 'container orchestration', 'helm', 'eks', 'aks', 'gke'],
  'terraform': ['terraform', 'infrastructure as code', 'iac', 'hcl'],
  'ansible': ['ansible', 'configuration management', 'playbooks'],
  'github': ['github', 'github actions', 'git hub', 'github enterprise'],
  'gitlab': ['gitlab', 'gitlab ci', 'gitlab pipelines'],
  'git': ['git', 'version control', 'source control', 'github', 'gitlab', 'bitbucket', 'svn'],
  'argocd': ['argocd', 'argo', 'gitops', 'flux'],
  'prometheus': ['prometheus', 'grafana', 'metrics', 'alertmanager'],
  'grafana': ['grafana', 'prometheus', 'monitoring dashboards'],
  'datadog': ['datadog', 'dd', 'data dog', 'apm', 'application performance monitoring'],
  'splunk': ['splunk', 'splunk enterprise', 'siem', 'security information and event management'],

  // Security
  'soc': ['soc', 'security operations center', 'security operations centre', 'security analyst', 'security monitoring'],
  'siem': ['siem', 'security information and event management', 'splunk', 'qradar', 'sentinel', 'microsoft sentinel'],
  'penetration testing': ['penetration testing', 'pen testing', 'pentest', 'ethical hacking', 'vulnerability assessment', 'red team'],
  'vulnerability management': ['vulnerability management', 'cve', 'patching', 'patch management', 'security patching', 'vuln management'],
  'iso 27001': ['iso 27001', 'iso27001', 'iso/iec 27001', 'information security management', 'isms'],
  'nist': ['nist', 'nist framework', 'nist csf', 'cybersecurity framework'],
  'zero trust': ['zero trust', 'ztna', 'zero-trust', 'least privilege'],
  'firewalls': ['firewalls', 'firewall', 'palo alto', 'fortinet', 'checkpoint', 'cisco asa', 'network security'],
  'endpoint security': ['endpoint security', 'edr', 'endpoint detection', 'crowdstrike', 'defender', 'antivirus', 'mdm'],

  // Languages / frameworks
  'python': ['python', 'python 3', 'py'],
  'javascript': ['javascript', 'js', 'vanilla js', 'es6', 'es2015'],
  'typescript': ['typescript', 'ts'],
  'java': ['java', 'jvm', 'java ee', 'spring java'],
  'c#': ['c#', 'csharp', 'c sharp', '.net c#', 'dotnet c#'],
  'c++': ['c++', 'cpp', 'c plus plus'],
  'go': ['go', 'golang', 'go lang'],
  'rust': ['rust', 'rust lang'],
  'ruby': ['ruby', 'ruby on rails', 'rails'],
  'php': ['php', 'laravel', 'symfony'],
  'swift': ['swift', 'swiftui', 'xcode swift'],
  'kotlin': ['kotlin', 'android kotlin'],
  'react': ['react', 'react.js', 'reactjs', 'react native'],
  'vue': ['vue', 'vue.js', 'vuejs', 'nuxt', 'nuxt.js'],
  'angular': ['angular', 'angularjs', 'angular 2+'],
  'next.js': ['next.js', 'nextjs', 'next js'],
  'node.js': ['node.js', 'nodejs', 'node', 'express', 'express.js', 'fastify', 'nestjs'],
  'spring': ['spring', 'spring boot', 'spring framework', 'spring mvc'],
  '.net': ['.net', 'dotnet', 'asp.net', '.net core', 'c# .net', '.net framework'],
  'django': ['django', 'django rest framework', 'drf'],
  'fastapi': ['fastapi', 'fast api'],

  // APIs
  'rest api': ['rest api', 'restful api', 'rest', 'restful', 'http api', 'web services', 'api development', 'api design'],
  'graphql': ['graphql', 'graph ql', 'apollo'],
  'grpc': ['grpc', 'g rpc', 'protocol buffers', 'protobuf'],
  'api': ['api', 'apis', 'api integration', 'api testing', 'postman', 'insomnia', 'swagger', 'openapi'],
  'postman': ['postman', 'api testing'],

  // Testing
  'unit testing': ['unit testing', 'unit tests', 'jest', 'mocha', 'junit', 'pytest', 'rspec', 'nunit', 'xunit'],
  'selenium': ['selenium', 'selenium webdriver', 'selenium grid'],
  'playwright': ['playwright', 'microsoft playwright'],
  'cypress': ['cypress', 'cypress.io'],
  'qa automation': ['qa automation', 'test automation', 'automated testing', 'automation testing', 'regression automation'],
  'manual testing': ['manual testing', 'functional testing', 'exploratory testing', 'test execution'],
  'test cases': ['test cases', 'test scripts', 'test scenarios', 'test plans', 'test documentation'],

  // Methods
  'agile': ['agile', 'scrum', 'kanban', 'agile methodology', 'sprint', 'sprints', 'agile ceremonies'],
  'scrum': ['scrum', 'agile', 'sprint planning', 'retrospective', 'daily standup', 'scrum master'],
  'kanban': ['kanban'],

  // Data / Analytics
  'power bi': ['power bi', 'microsoft power bi', 'powerbi'],
  'tableau': ['tableau', 'tableau desktop', 'tableau server'],
  'data analysis': ['data analysis', 'data analytics', 'analysis', 'analytical', 'data interpretation'],
  'data visualization': ['data visualization', 'data visualisation', 'charts', 'dashboards', 'reporting', 'power bi', 'tableau'],
  'reporting': ['reporting', 'reports', 'business reporting', 'operational reporting'],
  'dashboards': ['dashboards', 'dashboarding', 'dashboard development', 'kpi dashboards'],
  'etl': ['etl', 'data pipelines', 'data integration', 'data ingestion', 'extract transform load'],
  'dbt': ['dbt', 'data build tool'],
  'snowflake': ['snowflake', 'snowflake data warehouse'],
  'spark': ['spark', 'apache spark', 'pyspark', 'databricks'],
  'kafka': ['kafka', 'apache kafka', 'event streaming', 'message queue', 'rabbitmq', 'sqs'],
  'google analytics': ['google analytics', 'ga4', 'google tag manager', 'gtm'],

  // Product / Design / PM
  'figma': ['figma', 'figma design', 'figma prototyping'],
  'product roadmap': ['product roadmap', 'roadmap', 'product planning', 'feature planning'],
  'user stories': ['user stories', 'user story', 'acceptance criteria', 'epics', 'backlog refinement'],
  'a/b testing': ['a/b testing', 'ab testing', 'experimentation', 'multivariate testing', 'split testing'],
  'ux research': ['ux research', 'user research', 'usability testing', 'user interviews', 'personas'],
  'pmp': ['pmp', 'project management professional', 'project manager certified'],
  'prince2': ['prince2', 'prince 2', 'prince2 practitioner', 'prince2 foundation'],
  'ms project': ['ms project', 'microsoft project', 'project planning', 'gantt', 'gantt chart'],
  'risk management': ['risk management', 'risk register', 'raid log', 'risk mitigation', 'risk assessment'],
  'stakeholder management': ['stakeholder management', 'stakeholder engagement', 'stakeholder communication', 'executive communication'],

  // Finance / ERP
  'sap': ['sap', 'sap erp', 'sap hana', 's/4hana', 'sap s4', 'sap fi', 'sap co', 'sap mm', 'sap sd'],
  'accounts payable': ['accounts payable', 'ap', 'invoice processing', 'purchase ledger'],
  'accounts receivable': ['accounts receivable', 'ar', 'credit control', 'sales ledger'],
  'order to cash': ['order to cash', 'otc', 'o2c'],
  'invoice processing': ['invoice processing', 'invoices', 'invoice management', 'accounts payable', 'billing'],
  'reconciliation': ['reconciliation', 'reconciliations', 'bank reconciliation', 'ledger reconciliation'],
  'compliance': ['compliance', 'regulatory compliance', 'gdpr', 'sox', 'financial compliance', 'audit', 'auditing'],
  'forecasting': ['forecasting', 'financial forecasting', 'budgeting', 'variance analysis', 'fp&a', 'financial planning'],

  // HR
  'workday': ['workday', 'workday hcm'],
  'hris': ['hris', 'hr system', 'hr platform', 'human resources information system'],
  'recruitment': ['recruitment', 'recruiting', 'talent acquisition', 'talent sourcing', 'hiring'],
  'onboarding': ['onboarding', 'employee onboarding', 'new starter', 'induction'],
  'payroll': ['payroll', 'payroll processing', 'payroll management'],
  'employee relations': ['employee relations', 'er', 'grievance', 'disciplinary', 'employment law'],
  'sourcing': ['sourcing', 'talent sourcing', 'candidate sourcing', 'boolean search', 'linkedin sourcing'],
  'interview coordination': ['interview coordination', 'interview scheduling', 'recruiting coordination', 'assessment coordination'],

  // Sales / Marketing
  'seo': ['seo', 'search engine optimisation', 'search engine optimization', 'organic search'],
  'lead generation': ['lead generation', 'prospecting', 'outbound', 'cold outreach', 'pipeline generation'],
  'campaign management': ['campaign management', 'campaigns', 'marketing campaigns', 'email campaigns'],
  'email marketing': ['email marketing', 'email campaigns', 'mailchimp', 'klaviyo', 'sendgrid', 'drip campaigns'],
  'pipeline management': ['pipeline management', 'sales pipeline', 'deal management', 'opportunity management'],
  'account management': ['account management', 'key account management', 'kam', 'client management', 'client relationship'],

  // Logistics / Supply Chain
  'supply chain': ['supply chain', 'supply chain management'],
  'logistics': ['logistics', 'logistics management', 'transportation', 'freight', 'shipping'],
  'inventory management': ['inventory management', 'inventory', 'stock management', 'stock control', 'warehouse management system', 'wms'],
  'procurement': ['procurement', 'purchasing', 'sourcing', 'strategic sourcing', 'category management'],
  'vendor management': ['vendor management', 'supplier management', 'supplier relations', 'third party management'],
  'order management': ['order management', 'order processing', 'order fulfilment', 'order fulfillment'],
  'warehouse': ['warehouse', 'warehousing', 'pick and pack', 'goods in', 'dispatch'],

  // Mobile
  'ios': ['ios', 'iphone', 'ipad', 'apple ios', 'swiftui', 'xcode', 'app store'],
  'android': ['android', 'android development', 'google play', 'android studio'],
  'react native': ['react native', 'cross-platform mobile', 'expo', 'react-native'],
  'flutter': ['flutter', 'dart', 'flutter sdk'],
  'testflight': ['testflight', 'test flight', 'ios testing', 'beta testing'],

  // Healthcare / Legal / Education
  'ehr': ['ehr', 'emr', 'electronic health records', 'electronic medical records', 'patient records', 'clinical records'],
  'epic': ['epic', 'epic systems', 'epic emr', 'epic ehr'],
  'cerner': ['cerner', 'cerner millennium', 'oracle health'],
  'hipaa': ['hipaa', 'health insurance portability', 'patient data', 'phi', 'protected health information'],
  'nhs': ['nhs', 'national health service', 'nhs digital', 'nhs trust'],
  'clinical documentation': ['clinical documentation', 'medical documentation', 'patient notes', 'clinical notes'],
  'contract management': ['contract management', 'contract review', 'contract drafting', 'legal contracts'],
  'legal research': ['legal research', 'case research', 'westlaw', 'lexisnexis', 'legal databases'],
  'case management': ['case management', 'legal case management', 'matter management'],
  'gdpr': ['gdpr', 'data protection', 'dpa', 'data privacy', 'privacy law', 'ico', 'data protection act'],
  'lms': ['lms', 'learning management system', 'moodle', 'canvas', 'blackboard', 'google classroom', 'e-learning platform'],
  'curriculum': ['curriculum', 'curriculum design', 'curriculum development', 'lesson planning', 'scheme of work'],
  'safeguarding': ['safeguarding', 'child protection', 'prevent', 'safer recruitment', 'dbs'],
  'send': ['send', 'special educational needs', 'sen', 'learning support', 'inclusion'],
};

const IMPORTANT_TERMS: string[] = [
  'Active Directory', 'Microsoft 365', 'Office 365', 'Microsoft Office', 'MS Office',
  'Excel', 'Word', 'PowerPoint', 'Outlook', 'Microsoft Teams', 'Teams', 'Exchange',
  'Confluence', 'SharePoint', 'Windows Server', 'Windows 10', 'Windows 11', 'Linux',
  'SQL Server', 'Microsoft SQL Server', 'SQL', 'MySQL', 'PostgreSQL', 'MongoDB',
  'Redis', 'Elasticsearch', 'Azure', 'AWS', 'GCP', 'VMware', 'Hyper-V',
  'Virtualization', 'ITIL', 'Incident Management', 'Problem Management',
  'Change Management', 'Service Desk', 'Help Desk', 'Technical Support',
  'Customer Support', 'Customer Service', 'End User Support', 'End-User Support',
  'Application Support', 'Troubleshooting', 'Hardware Troubleshooting',
  'Software Troubleshooting', 'Account Management', 'Access Management',
  'Authentication', 'MFA', 'Permissions', 'SSO', 'RBAC', 'IAM', 'Zero Trust',
  'SLA', 'Jira', 'ServiceNow', 'Zendesk', 'Salesforce', 'Citrix', 'VPN',
  'Remote Desktop', 'Monitoring Tools', 'System Logs', 'PowerShell', 'Bash',
  'Python', 'JavaScript', 'TypeScript', 'Java', 'C#', 'C++', 'Go', 'Golang',
  'Rust', 'Ruby', 'PHP', 'Swift', 'Kotlin', 'React', 'Vue', 'Angular', 'Next.js',
  'Node.js', 'Spring Boot', '.NET', 'Django', 'FastAPI', 'REST API', 'GraphQL',
  'gRPC', 'API', 'Postman', 'Git', 'GitHub', 'GitLab', 'Docker', 'Kubernetes',
  'Terraform', 'Ansible', 'CI/CD', 'GitHub Actions', 'ArgoCD', 'Prometheus',
  'Grafana', 'Datadog', 'Splunk', 'Unit Testing', 'Selenium', 'Playwright',
  'Cypress', 'QA Automation', 'Test Cases', 'Manual Testing', 'Agile', 'Scrum',
  'Kanban', 'Power BI', 'Tableau', 'Data Analysis', 'Reporting', 'Dashboards',
  'ETL', 'Data Visualization', 'dbt', 'Snowflake', 'Apache Spark', 'Kafka',
  'Google Analytics', 'Figma', 'Product Roadmap', 'User Stories', 'A/B Testing',
  'UX Research', 'PMP', 'PRINCE2', 'MS Project', 'Risk Management',
  'Stakeholder Management', 'SOC', 'SIEM', 'Penetration Testing',
  'Vulnerability Management', 'ISO 27001', 'NIST', 'Firewalls',
  'Endpoint Security', 'iOS', 'Android', 'React Native', 'Flutter', 'TestFlight',
  'SAP', 'Accounts Payable', 'Accounts Receivable', 'Order to Cash',
  'Invoice Processing', 'Reconciliation', 'Compliance', 'Forecasting',
  'Recruitment', 'Onboarding', 'HRIS', 'Workday', 'Payroll',
  'Employee Relations', 'Sourcing', 'Interview Coordination', 'CRM', 'HubSpot',
  'SEO', 'Lead Generation', 'Campaign Management', 'Email Marketing',
  'Pipeline Management', 'Supply Chain', 'Logistics', 'Inventory Management',
  'Order Management', 'Procurement', 'Warehouse', 'Vendor Management', 'EHR',
  'EMR', 'Epic', 'Cerner', 'HIPAA', 'NHS', 'Clinical Documentation',
  'Contract Management', 'Legal Research', 'Case Management', 'GDPR', 'LMS',
  'Curriculum', 'Safeguarding', 'SEND', 'Documentation', 'Escalation',
  'Communication', 'Problem Solving',
];

const DEPARTMENT_TERMS: Record<string, string[]> = {
  it_support: [
    'Active Directory', 'Microsoft 365', 'Microsoft Office', 'Windows Server',
    'Windows 10', 'Windows 11', 'ServiceNow', 'Jira', 'Zendesk', 'VPN', 'Citrix',
    'SLA', 'Incident Management', 'Problem Management', 'Troubleshooting',
    'Remote Desktop', 'Hardware Troubleshooting', 'Software Troubleshooting',
    'Application Support', 'Access Management', 'Authentication', 'MFA',
    'Permissions', 'System Logs', 'Monitoring Tools', 'PowerShell',
    'End User Support', 'ITIL',
  ],
  software_engineering: [
    'JavaScript', 'TypeScript', 'Python', 'Java', 'C#', 'Go', 'Rust',
    'React', 'Vue', 'Angular', 'Node.js', 'Spring Boot', '.NET', 'Django',
    'REST API', 'GraphQL', 'API', 'Git', 'GitHub', 'Docker', 'Kubernetes',
    'CI/CD', 'Unit Testing', 'SQL', 'PostgreSQL', 'MongoDB', 'Agile', 'Scrum',
  ],
  devops: [
    'Docker', 'Kubernetes', 'Terraform', 'Ansible', 'CI/CD', 'GitHub Actions',
    'GitLab CI', 'ArgoCD', 'Prometheus', 'Grafana', 'Datadog', 'Splunk',
    'AWS', 'Azure', 'GCP', 'Linux', 'Bash', 'Python', 'Git',
    'Infrastructure as Code', 'Monitoring Tools', 'Observability',
  ],
  security: [
    'SOC', 'SIEM', 'Splunk', 'Penetration Testing', 'Vulnerability Management',
    'ISO 27001', 'NIST', 'Firewalls', 'Endpoint Security', 'Zero Trust',
    'IAM', 'MFA', 'Incident Management', 'Risk Management', 'GDPR',
  ],
  data_analytics: [
    'SQL', 'Excel', 'Power BI', 'Tableau', 'Python', 'Data Analysis',
    'Reporting', 'Dashboards', 'ETL', 'Data Visualization', 'dbt',
    'Snowflake', 'Google Analytics', 'Apache Spark', 'Kafka',
  ],
  product: [
    'Product Roadmap', 'User Stories', 'Figma', 'A/B Testing', 'UX Research',
    'Agile', 'Scrum', 'Jira', 'Confluence', 'Stakeholder Management',
    'OKR', 'KPI', 'Data Analysis', 'SQL',
  ],
  project_management: [
    'PMP', 'PRINCE2', 'MS Project', 'Risk Management', 'Stakeholder Management',
    'Agile', 'Scrum', 'Kanban', 'Change Management', 'Budget Management',
    'Resource Planning', 'Jira', 'Confluence',
  ],
  architecture: [
    'Solution Architecture', 'Microservices', 'Event-Driven', 'AWS', 'Azure',
    'GCP', 'Docker', 'Kubernetes', 'Terraform', 'API Design', 'REST API',
    'GraphQL', 'Domain-Driven Design', 'CI/CD', 'Cloud Architecture',
  ],
  mobile: [
    'iOS', 'Android', 'Swift', 'Kotlin', 'React Native', 'Flutter',
    'TestFlight', 'REST API', 'Git', 'Agile', 'Unit Testing',
  ],
  qa_testing: [
    'Selenium', 'Playwright', 'Cypress', 'QA Automation', 'Test Cases',
    'Manual Testing', 'Unit Testing', 'API Testing', 'Postman', 'Jira',
    'Agile', 'Regression Testing',
  ],
  customer_service: [
    'Customer Support', 'Customer Service', 'Zendesk', 'Salesforce', 'CRM',
    'Email Support', 'Chat Support', 'Complaint Handling', 'SLA', 'Escalation',
    'Microsoft Office', 'Excel',
  ],
  finance_operations: [
    'Accounts Payable', 'Accounts Receivable', 'Order to Cash', 'Invoice Processing',
    'SAP', 'Excel', 'Reconciliation', 'Reporting', 'Compliance', 'Forecasting',
  ],
  hr_recruitment: [
    'Recruitment', 'Onboarding', 'HRIS', 'Workday', 'Payroll',
    'Employee Relations', 'Sourcing', 'Interview Coordination',
  ],
  sales_marketing: [
    'CRM', 'Salesforce', 'HubSpot', 'Lead Generation', 'Campaign Management',
    'SEO', 'Google Analytics', 'Email Marketing', 'Pipeline Management',
    'Account Management',
  ],
  logistics_supply_chain: [
    'Supply Chain', 'Logistics', 'SAP', 'Inventory Management', 'Order Management',
    'Procurement', 'Warehouse', 'Forecasting', 'Vendor Management',
  ],
  healthcare: [
    'EHR', 'EMR', 'Epic', 'Cerner', 'HIPAA', 'NHS', 'Clinical Documentation',
    'Patient Records', 'Medical Terminology', 'Safeguarding',
  ],
  legal: [
    'Contract Management', 'Legal Research', 'Case Management', 'GDPR',
    'Westlaw', 'LexisNexis', 'Compliance', 'Data Protection', 'Employment Law',
  ],
  education: [
    'LMS', 'Curriculum', 'Safeguarding', 'SEND', 'DBS', 'Lesson Planning',
    'Assessment', 'Student Support', 'Microsoft Office', 'Google Workspace',
  ],
  general: [
    'Microsoft Office', 'Excel', 'Communication', 'Reporting',
    'Documentation', 'Stakeholder Management', 'Problem Solving',
  ],
};

const LEARNABLE_SKILLS = new Set([
  'azure', 'aws', 'gcp', 'vmware', 'hyper-v', 'virtualization', 'terraform',
  'ansible', 'argocd', 'prometheus', 'grafana', 'monitoring tools',
  'system logs', 'datadog', 'splunk', 'powershell', 'bash', 'sql server',
  'sql', 'postgresql', 'mongodb', 'redis', 'elasticsearch', 'docker',
  'kubernetes', 'power bi', 'tableau', 'google analytics', 'dbt',
  'snowflake', 'sap', 'salesforce', 'hubspot', 'workday', 'selenium',
  'playwright', 'cypress', 'siem', 'soc', 'figma', 'ms project', 'epic',
  'cerner', 'lms',
]);

const DEPT_MIN_HITS = 2;

const DEPT_SPECIFICITY_ORDER: string[] = [
  'healthcare', 'legal', 'education', 'security', 'devops', 'architecture',
  'mobile', 'qa_testing', 'product', 'project_management', 'it_support',
  'data_analytics', 'finance_operations', 'hr_recruitment',
  'logistics_supply_chain', 'customer_service', 'sales_marketing',
  'software_engineering', 'general',
];

const DEPT_SIGNALS: Record<string, string[]> = {
  it_support: [
    'service desk', 'help desk', 'it support', 'technical support',
    'application support', 'end user support', 'active directory', 'servicenow',
    'windows server', 'itil', 'deskside', 'first line', 'second line',
    'l1 support', 'l2 support',
  ],
  software_engineering: [
    'software engineer', 'software developer', 'frontend', 'backend',
    'full stack', 'fullstack', 'full-stack', 'web developer', 'react',
    'node.js', 'typescript', 'javascript', 'microservices',
  ],
  devops: [
    'devops', 'site reliability', 'sre', 'infrastructure engineer',
    'platform engineer', 'cloud engineer', 'terraform', 'kubernetes',
    'ci/cd', 'helm', 'gitops',
  ],
  security: [
    'security analyst', 'cybersecurity', 'information security', 'soc analyst',
    'penetration tester', 'pen test', 'siem', 'vulnerability', 'iso 27001',
    'nist', 'threat', 'red team', 'blue team',
  ],
  data_analytics: [
    'data analyst', 'business analyst', 'bi analyst', 'power bi', 'tableau',
    'data analysis', 'analytics', 'reporting analyst', 'data engineer',
    'sql analyst',
  ],
  product: [
    'product manager', 'product owner', 'product lead', 'product roadmap',
    'go-to-market', 'user stories', 'okr', 'product strategy',
    'product development',
  ],
  project_management: [
    'project manager', 'programme manager', 'pmo', 'project delivery',
    'prince2', 'pmp', 'project coordinator', 'project lead', 'project planning',
  ],
  architecture: [
    'solution architect', 'enterprise architect', 'cloud architect',
    'technical architect', 'systems architect', 'domain-driven',
    'solution design',
  ],
  mobile: [
    'ios developer', 'android developer', 'mobile developer', 'react native',
    'flutter developer', 'swift', 'kotlin', 'mobile engineer',
  ],
  qa_testing: [
    'qa engineer', 'quality assurance', 'test engineer', 'automation engineer',
    'sdet', 'tester', 'selenium', 'cypress', 'playwright', 'test automation',
  ],
  customer_service: [
    'customer service', 'customer support', 'contact center', 'call center',
    'client support', 'complaint', 'customer success', 'customer experience',
  ],
  finance_operations: [
    'finance', 'invoice', 'accounts payable', 'accounts receivable',
    'order to cash', 'reconciliation', 'accounting', 'financial analyst',
    'fp&a', 'controller',
  ],
  hr_recruitment: [
    'recruitment', 'recruiter', 'hr', 'human resources', 'onboarding',
    'payroll', 'workday', 'talent acquisition', 'people partner', 'hrbp',
  ],
  sales_marketing: [
    'sales', 'marketing', 'campaign', 'lead generation', 'seo', 'hubspot',
    'account executive', 'business development', 'demand generation',
  ],
  logistics_supply_chain: [
    'logistics', 'supply chain', 'procurement', 'warehouse', 'inventory',
    'vendor management', 'freight', 'distribution',
  ],
  healthcare: [
    'nhs', 'hospital', 'clinical', 'patient', 'healthcare', 'medical',
    'nursing', 'ehr', 'emr', 'epic', 'cerner', 'hipaa', 'gp', 'pharmacy',
  ],
  legal: [
    'solicitor', 'barrister', 'paralegal', 'legal counsel', 'in-house legal',
    'contract', 'litigation', 'westlaw', 'lexisnexis', 'gdpr',
    'compliance officer',
  ],
  education: [
    'teacher', 'lecturer', 'tutor', 'school', 'college', 'university',
    'safeguarding', 'lms', 'curriculum', 'send', 'pedagogy', 'dbs',
  ],
};

// ============================================================
// MAIN EXPORTED FUNCTIONS
// ============================================================
export function buildDeterministicAtsReport(
  cv: StructuredCV,
  jd: StructuredJD,
  rawCvText: string,
  rawJobDescription: string,
): AtsEvidenceReport {
  const cvCorpus = normalizeText(buildCvCorpus(cv, rawCvText));
  const requirements = buildRequirementList(jd, rawJobDescription);

  const evidence = requirements.map((requirement) =>
    classifyRequirement(requirement.keyword, requirement.priority, cvCorpus),
  );

  const matched = evidence.filter((item) => item.status === 'matched').map((item) => item.keyword);
  const partial = evidence.filter((item) => item.status === 'partial').map((item) => item.keyword);
  const missing = evidence.filter((item) => item.status === 'missing').map((item) => item.keyword);

  const weightedTotal = evidence.reduce((sum, item) => sum + priorityWeight(item.priority), 0) || 1;
  const weightedCovered = evidence.reduce((sum, item) => {
    if (item.status === 'matched') return sum + priorityWeight(item.priority);
    if (item.status === 'partial') return sum + priorityWeight(item.priority) * 0.5;
    return sum;
  }, 0);

  const keywordCoverageScore = clamp(Math.round((weightedCovered / weightedTotal) * 100));

  const requiredEvidence = evidence.filter((item) => item.priority !== 'nice_to_have');
  const requiredMissing = requiredEvidence.filter((item) => item.status === 'missing');
  const requiredPartial = requiredEvidence.filter((item) => item.status === 'partial');

  const criticalMissingSkills = dedupeStrings(requiredMissing.map((item) => item.keyword)).slice(0, 10);

  const niceToHaveMissingSkills = dedupeStrings(
    evidence
      .filter((item) => item.priority === 'nice_to_have' && item.status === 'missing')
      .map((item) => item.keyword),
  ).slice(0, 10);

  const learnableMissingSkills = dedupeStrings(
    [...criticalMissingSkills, ...niceToHaveMissingSkills]
      .filter((skill) => LEARNABLE_SKILLS.has(canonicalKey(skill))),
  ).slice(0, 10);

  return {
    matched_keywords: dedupeStrings(matched),
    partial_keywords: dedupeStrings(partial),
    missing_keywords: dedupeStrings(missing),
    critical_missing_skills: criticalMissingSkills,
    learnable_missing_skills: learnableMissingSkills,
    nice_to_have_missing_skills: niceToHaveMissingSkills,
    strongest_transferable_skills: buildTransferableSkills(cv, cvCorpus, evidence),
    strengths: buildStrengths(matched, partial, cv),
    gaps: buildGaps(requiredMissing, requiredPartial),
    ai_recommendations: buildRecommendations(criticalMissingSkills, partial, jd),
    cv_improvement_actions: buildImprovementActions(criticalMissingSkills, partial),
    ats_match_score: keywordCoverageScore,
    skill_gap_score: clamp(
      100 - Math.round((requiredMissing.length / Math.max(requiredEvidence.length, 1)) * 100),
    ),
    keyword_coverage_score: keywordCoverageScore,
    evidence,
  };
}

export function mergeAtsEvidenceIntoAnalysis(
  analysis: AnalysisResult,
  report: AtsEvidenceReport,
): AnalysisResult {
  const mergedMatched = dedupeStrings([
    ...(analysis.matched_keywords ?? []),
    ...report.matched_keywords,
  ]);

  const mergedPartial = dedupeStrings([
    ...(analysis.partial_keywords ?? []),
    ...report.partial_keywords,
  ]).filter((keyword) => !containsKeyword(mergedMatched, keyword));

  const mergedMissing = dedupeStrings([
    ...(analysis.missing_keywords ?? []),
    ...report.missing_keywords,
  ]).filter(
    (keyword) =>
      !containsKeyword(mergedMatched, keyword) &&
      !containsKeyword(mergedPartial, keyword),
  );

  const atsScore = blendAts(analysis.ats_match_score, report.ats_match_score);
  const skillGapScore = blendSkillGap(analysis.skill_gap_score, report.skill_gap_score);
  const overall = blendOverall(analysis.overall_job_fit_score, atsScore);

  return {
    ...analysis,
    matched_keywords: mergedMatched,
    partial_keywords: mergedPartial,
    missing_keywords: mergedMissing,

    critical_missing_skills: dedupeStrings([
      ...(analysis.critical_missing_skills ?? []),
      ...report.critical_missing_skills,
    ]).filter((keyword) => !containsKeyword(mergedMatched, keyword)),

    learnable_missing_skills: dedupeStrings([
      ...(analysis.learnable_missing_skills ?? []),
      ...report.learnable_missing_skills,
    ]),

    nice_to_have_missing_skills: dedupeStrings([
      ...(analysis.nice_to_have_missing_skills ?? []),
      ...report.nice_to_have_missing_skills,
    ]).filter((keyword) => !containsKeyword(mergedMatched, keyword)),

    strongest_transferable_skills: mergeTransferables(
      analysis.strongest_transferable_skills,
      report.strongest_transferable_skills,
    ),

    strengths: dedupeStrings([
      ...normalizeFeedbackItems(analysis.strengths),
      ...report.strengths,
    ]),

    gaps: dedupeStrings([
      ...normalizeFeedbackItems(analysis.gaps),
      ...report.gaps,
    ]),

    ai_recommendations: dedupeStrings([
      ...(analysis.ai_recommendations ?? []),
      ...report.ai_recommendations,
    ]),

    cv_improvement_actions: dedupeStrings([
      ...(analysis.cv_improvement_actions ?? []),
      ...report.cv_improvement_actions,
    ]),

    ats_match_score: atsScore,
    skill_gap_score: skillGapScore,
    overall_job_fit_score: overall,
    transferability_score: analysis.transferability_score ?? report.keyword_coverage_score,

    score_breakdown: {
      ...(analysis.score_breakdown ?? {}),
      keywords: report.keyword_coverage_score,
      ats: atsScore,
      skills: skillGapScore,
    },
  };
}

// ============================================================
// BLENDING
// ============================================================
function blendAts(ai: unknown, deterministic: number): number {
  return blendScore(ai, deterministic, 0.65); // AI 65%, deterministic 35%
}

function blendSkillGap(ai: unknown, deterministic: number): number {
  return blendScore(ai, deterministic, 0.65); // AI 65%, deterministic 35%
}

function blendOverall(ai: unknown, atsScore: number): number {
  return blendScore(ai, atsScore, 0.80); // AI fit 80%, ATS match 20%
}

function blendScore(aiScore: unknown, deterministicScore: number, aiWeight: number): number {
  const ai =
    typeof aiScore === 'number' && Number.isFinite(aiScore)
      ? aiScore
      : deterministicScore;

  return clamp(Math.round(ai * aiWeight + deterministicScore * (1 - aiWeight)));
}

// ============================================================
// REQUIREMENTS
// ============================================================
function buildRequirementList(
  jd: StructuredJD,
  rawJobDescription: string,
): Array<{ keyword: string; priority: AtsRequirementPriority }> {
  const items: Array<{ keyword: string; priority: AtsRequirementPriority }> = [];

  const addMany = (values: unknown, priority: AtsRequirementPriority) => {
    if (!Array.isArray(values)) return;

    for (const value of values) {
      const keyword = cleanKeyword(String(value ?? ''));
      if (keyword) items.push({ keyword, priority });
    }
  };

  // Structured JD fields
  addMany(jd.must_have_keywords, 'critical');
  addMany(jd.required_skills, 'required');
  addMany(jd.nice_to_have_skills, 'nice_to_have');

  // Defensive support for alternate parser fields
  const jdRecord = jd as unknown as Record<string, unknown>;
  addMany(jdRecord.must_haves, 'critical');
  addMany(jdRecord.must_have_skills, 'critical');
  addMany(jdRecord.required_keywords, 'required');
  addMany(jdRecord.skills, 'required');
  addMany(jdRecord.technical_skills, 'required');
  addMany(jdRecord.tools, 'required');
  addMany(jdRecord.technologies, 'required');
  addMany(jdRecord.platforms, 'required');
  addMany(jdRecord.systems, 'required');
  addMany(jdRecord.certifications, 'required');
  addMany(jdRecord.nice_to_haves, 'nice_to_have');
  addMany(jdRecord.preferred_skills, 'nice_to_have');
  addMany(jdRecord.additional_advantages, 'nice_to_have');

  // Department-aware extraction
  const department = detectDepartment(jd, rawJobDescription);
  const departmentTerms = DEPARTMENT_TERMS[department] ?? DEPARTMENT_TERMS.general;

  for (const term of departmentTerms) {
    if (hasPhrase(normalizeText(rawJobDescription), normalizeText(term))) {
      items.push({
        keyword: term,
        priority: inferPriorityForKeyword(term, rawJobDescription),
      });
    }
  }

  // Dynamic raw-JD extraction
  for (const term of extractDynamicTerms(rawJobDescription)) {
    items.push({
      keyword: term,
      priority: inferPriorityForKeyword(term, rawJobDescription),
    });
  }

  // Known-term fallback
  for (const term of extractImportantTerms(rawJobDescription)) {
    items.push({
      keyword: term,
      priority: inferPriorityForKeyword(term, rawJobDescription),
    });
  }

  // Last-resort fallback if parser and dictionaries produced too little
  if (items.length < 5) {
    for (const term of extractFallbackTerms(rawJobDescription)) {
      items.push({
        keyword: term,
        priority: inferPriorityForKeyword(term, rawJobDescription),
      });
    }
  }

  const seen = new Map<string, { keyword: string; priority: AtsRequirementPriority }>();

  for (const item of items) {
    const clean = cleanKeyword(item.keyword);
    if (!clean || clean.length < 2 || clean.length > 80) continue;

    const key = canonicalKey(clean);
    const existing = seen.get(key);

    if (!existing || priorityWeight(item.priority) > priorityWeight(existing.priority)) {
      seen.set(key, { keyword: clean, priority: item.priority });
    }
  }

  return Array.from(seen.values())
    .sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority))
    .slice(0, 80);
}

function detectDepartment(jd: StructuredJD, rawJobDescription: string): string {
  const text = normalizeText([
    jd.role_category ?? '',
    jd.job_title ?? '',
    jd.domain ?? '',
    rawJobDescription,
  ].join(' '));

  const scores: Record<string, number> = {};

  for (const [dept, signals] of Object.entries(DEPT_SIGNALS)) {
    const hits = signals.filter((signal) => hasPhrase(text, signal)).length;
    if (hits > 0) scores[dept] = hits;
  }

  if (Object.keys(scores).length === 0) return 'general';

  const maxScore = Math.max(...Object.values(scores));
  if (maxScore < DEPT_MIN_HITS) return 'general';

  const topDepts = Object.entries(scores)
    .filter(([, score]) => score === maxScore)
    .map(([dept]) => dept);

  for (const dept of DEPT_SPECIFICITY_ORDER) {
    if (topDepts.includes(dept)) return dept;
  }

  return topDepts[0] ?? 'general';
}

// ============================================================
// DYNAMIC TERM EXTRACTION — fixed
// ============================================================
function extractDynamicTerms(text: string): string[] {
  const cleaned = String(text ?? '')
    .replace(/\r/g, '\n')
    .replace(/[•●▪–—]/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const candidates = new Set<string>();

  const patterns: RegExp[] = [
    // Requirement phrases: "must have X", "essential X", etc.
    /(?:must have|required|mandatory|essential|minimum requirements?|proven experience with|strong knowledge of|you need|you must)\s+([^.;\n]{3,80})/gi,

    // Experience / knowledge phrases
    /(?:experience (?:with|in|of)|knowledge of|familiarity with|hands[-\s]?on experience (?:with|in)|understanding of|exposure to)\s+([^.;\n]{3,80})/gi,

    // Responsibility phrases
    /(?:responsible for|you will|your role involves?|tasks? (?:include|involves?))\s+([^.;\n]{3,80})/gi,

    // Nice-to-have phrases
    /(?:nice to have|preferred|advantage|would be (?:an advantage|beneficial)|bonus|plus)\s+([^.;\n]{3,80})/gi,

    // Tool / tech stack colons: "Tools: X, Y, Z"
    /(?:tools?|technologies|tech stack|systems?|platforms?|environment|stack)\s*:\s*([^.\n]{3,120})/gi,

    // "N+ years of X" patterns
    /\d+\+?\s*years?\s+(?:of\s+)?([a-zA-Z][a-zA-Z0-9\s.+#\-\/]{2,40})/gi,

    // Parenthetical lists: "(e.g. X, Y, Z)"
    /\((?:e\.g\.?|for example|such as|including)\s+([^)]{3,100})\)/gi,

    // Colon-delimited skill lists after a newline
    /\n[^\n:]{3,40}:\s+([^\n]{5,120})/g,

    // Bullet-verb phrases: "- Develop X", "• Build Y"
    /(?:^|\n)\s*(?:[\-*•]|\d+\.)\s+(?:[A-Z][a-z]+\s+){0,2}([A-Z][a-zA-Z\s.+#\-\/]{3,60})/gm,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(cleaned)) !== null) {
      const phrase = match[1] ?? '';

      phrase
        // Do NOT split on "/" because it breaks CI/CD.
        .split(/,|\(|\)|\band\b|\bor\b/i)
        .map(cleanKeyword)
        .map(removeRequirementNoise)
        .filter(isUsefulCandidate)
        .forEach((value) => candidates.add(value));
    }
  }

  return Array.from(candidates);
}

function extractImportantTerms(text: string): string[] {
  const normalized = normalizeText(text);
  return IMPORTANT_TERMS.filter((term) =>
    hasPhrase(normalized, normalizeText(term)),
  );
}

function extractFallbackTerms(text: string): string[] {
  const normalized = normalizeText(text);

  const fallbackTerms = [
    ...IMPORTANT_TERMS,
    ...Object.keys(SYNONYMS),
    'documentation',
    'escalation',
    'stakeholder management',
    'communication',
    'problem solving',
    'analytical skills',
    'ticketing system',
    'account access',
    'email support',
    'chat support',
    'phone support',
    'reports',
    'process improvement',
  ];

  return dedupeStrings(
    fallbackTerms.filter((term) => hasPhrase(normalized, normalizeText(term))),
  );
}

// ============================================================
// CLASSIFICATION
// ============================================================
function classifyRequirement(
  keyword: string,
  priority: AtsRequirementPriority,
  cvCorpus: string,
): AtsKeywordEvidence {
  const canonical = canonicalKey(keyword);
  const variants = getVariants(keyword);

  for (const variant of variants) {
    if (hasPhrase(cvCorpus, variant)) {
      return {
        keyword,
        canonical,
        priority,
        status: 'matched',
        matched_as: variant,
        evidence: [variant],
        reason: 'Exact or accepted synonym found in the CV.',
      };
    }
  }

  const tokens = meaningfulTokens(keyword);
  const matchedTokens = tokens.filter((token) => hasPhrase(cvCorpus, token));

  if (tokens.length > 1 && matchedTokens.length > 0) {
    return {
      keyword,
      canonical,
      priority,
      status: 'partial',
      matched_as: matchedTokens.join(', '),
      evidence: matchedTokens,
      reason: 'Part of the requirement appears in the CV, but the exact ATS phrase is missing.',
    };
  }

  const broadPartial = findBroadPartial(keyword, cvCorpus);

  if (broadPartial) {
    return {
      keyword,
      canonical,
      priority,
      status: 'partial',
      matched_as: broadPartial,
      evidence: [broadPartial],
      reason: 'Related experience appears in the CV, but the exact keyword should be added if truthful.',
    };
  }

  return {
    keyword,
    canonical,
    priority,
    status: 'missing',
    matched_as: null,
    evidence: [],
    reason: 'No exact or related evidence found in the CV.',
  };
}

function findBroadPartial(keyword: string, cvCorpus: string): string | null {
  const canonical = canonicalKey(keyword);

  // IT / Infra
  if (canonical.includes('windows server') && hasPhrase(cvCorpus, 'windows')) return 'Windows (server context implied)';
  if (canonical.includes('sql server') && hasPhrase(cvCorpus, 'sql')) return 'SQL (SQL Server implied)';
  if (canonical.includes('virtual') && (hasPhrase(cvCorpus, 'vm') || hasPhrase(cvCorpus, 'server'))) return 'VM/server exposure';
  if (canonical.includes('monitor') && (hasPhrase(cvCorpus, 'logs') || hasPhrase(cvCorpus, 'incident'))) return 'logs/incident awareness';
  if (canonical.includes('itil') && (hasPhrase(cvCorpus, 'incident') || hasPhrase(cvCorpus, 'sla'))) return 'incident/SLA process';
  if (canonical.includes('application') && (hasPhrase(cvCorpus, 'software') || hasPhrase(cvCorpus, 'technical support'))) return 'software support';
  if (canonical.includes('customer') && (hasPhrase(cvCorpus, 'support') || hasPhrase(cvCorpus, 'service'))) return 'customer support/service';
  if (canonical.includes('report') && (hasPhrase(cvCorpus, 'excel') || hasPhrase(cvCorpus, 'data'))) return 'reporting/data work';
  if (canonical.includes('crm') && (hasPhrase(cvCorpus, 'salesforce') || hasPhrase(cvCorpus, 'hubspot'))) return 'CRM platform exposure';

  // DevOps / Cloud
  if (canonical.includes('terraform') && hasPhrase(cvCorpus, 'infrastructure')) return 'infrastructure work (Terraform implied)';
  if (canonical.includes('kubernetes') && hasPhrase(cvCorpus, 'docker')) return 'container experience (K8s adjacent)';
  if (canonical.includes('ci') && (hasPhrase(cvCorpus, 'git') || hasPhrase(cvCorpus, 'pipeline'))) return 'pipeline/VCS experience';

  // Security
  if (canonical.includes('siem') && (hasPhrase(cvCorpus, 'logs') || hasPhrase(cvCorpus, 'incident'))) return 'log/incident exposure';
  if (canonical.includes('penetration') && hasPhrase(cvCorpus, 'security')) return 'security background';
  if (canonical.includes('vulnerability') && hasPhrase(cvCorpus, 'patching')) return 'patching experience';

  // Data
  if (canonical.includes('power bi') && (hasPhrase(cvCorpus, 'excel') || hasPhrase(cvCorpus, 'data'))) return 'data/Excel experience';
  if (canonical.includes('etl') && (hasPhrase(cvCorpus, 'sql') || hasPhrase(cvCorpus, 'data'))) return 'SQL/data pipeline exposure';
  if (canonical.includes('snowflake') && hasPhrase(cvCorpus, 'data warehouse')) return 'data warehouse experience';

  // Healthcare
  if (canonical.includes('ehr') && hasPhrase(cvCorpus, 'patient')) return 'patient record exposure';
  if (canonical.includes('epic') && hasPhrase(cvCorpus, 'clinical')) return 'clinical systems exposure';

  // Legal
  if (canonical.includes('contract') && hasPhrase(cvCorpus, 'legal')) return 'legal background';
  if (canonical.includes('gdpr') && hasPhrase(cvCorpus, 'compliance')) return 'compliance exposure';

  return null;
}

// ============================================================
// CV CORPUS / OUTPUT HELPERS
// ============================================================
function buildCvCorpus(cv: StructuredCV, rawCvText: string): string {
  const experienceText = (cv.locked.experience ?? [])
    .map((role) =>
      [
        role.title,
        role.company,
        ...(role.raw_bullets ?? []),
        ...(role.technologies ?? []),
      ].join(' '),
    )
    .join(' ');

  return [
    rawCvText,
    cv.locked.contact?.location ?? '',
    experienceText,
    ...(cv.locked_skills.technical ?? []),
    ...(cv.locked_skills.tools ?? []),
    ...(cv.locked_skills.soft ?? []),
    ...(cv.locked_skills.languages ?? []),
    ...(cv.locked.education ?? []).map((item) => `${item.degree} ${item.institution ?? ''}`),
    ...(cv.locked.certifications ?? []).map((item) => `${item.name} ${item.issuer ?? ''}`),
  ].join(' ');
}

function buildTransferableSkills(
  cv: StructuredCV,
  cvCorpus: string,
  evidence: AtsKeywordEvidence[],
): Array<{ skill: string; reason: string }> {
  const directlyMatched = evidence.filter((item) => item.status === 'matched').slice(0, 8);

  const titleCorpus = normalizeText(
    (cv.locked.experience ?? [])
      .map((role) => role.title ?? '')
      .join(' '),
  );

  const transferables = directlyMatched.map((item) => ({
    skill: item.keyword,
    reason: `${item.keyword} is covered in your CV and maps directly to the job description.`,
  }));

  const generic: Array<{ skill: string; reason: string }> = [];

  if (
    hasPhrase(titleCorpus, 'technical support') ||
    hasPhrase(titleCorpus, 'support specialist') ||
    hasPhrase(titleCorpus, 'support engineer') ||
    hasPhrase(cvCorpus, 'technical support') ||
    hasPhrase(cvCorpus, 'troubleshooting')
  ) {
    generic.push({
      skill: 'Technical troubleshooting',
      reason: 'Your CV shows support/troubleshooting experience that transfers to most IT support and application support roles.',
    });
  }

  if (hasAny(cvCorpus, ['ticket', 'jira', 'servicenow', 'zendesk'])) {
    generic.push({
      skill: 'Ticket ownership and documentation',
      reason: 'Your CV references ticketing or support workflows, supporting incident handling and documentation requirements.',
    });
  }

  if (hasAny(cvCorpus, ['customer', 'client', 'user support'])) {
    generic.push({
      skill: 'User and stakeholder communication',
      reason: 'Your CV shows customer or user-facing experience, which transfers to support, operations, and service roles.',
    });
  }

  if (hasAny(cvCorpus, ['ci/cd', 'pipeline', 'github actions', 'gitlab ci'])) {
    generic.push({
      skill: 'CI/CD and pipeline ownership',
      reason: 'Your CV shows pipeline experience, which transfers to DevOps, platform, and engineering roles.',
    });
  }

  if (hasAny(cvCorpus, ['data analysis', 'sql', 'reporting', 'excel'])) {
    generic.push({
      skill: 'Data and reporting skills',
      reason: 'Your CV shows data or reporting experience, transferable across analytics, finance, and operations roles.',
    });
  }

  return dedupeTransferables([...transferables, ...generic]).slice(0, 8);
}

function buildStrengths(matched: string[], partial: string[], cv: StructuredCV): string[] {
  const strengths: string[] = [];

  if (matched.length > 0) {
    strengths.push(`Direct keyword coverage: ${matched.slice(0, 5).join(', ')}.`);
  }

  if (partial.length > 0) {
    strengths.push(`Partial coverage exists for ${partial.slice(0, 4).join(', ')} — wording should be strengthened.`);
  }

  if (cv.locked.has_sections.experience && cv.locked.experience.length > 0) {
    strengths.push('CV includes a standard experience section, which aids ATS parsing.');
  }

  if (cv.locked.has_sections.skills) {
    strengths.push('CV includes a skills section, which improves keyword matching.');
  }

  return strengths.slice(0, 8);
}

function buildGaps(
  requiredMissing: AtsKeywordEvidence[],
  requiredPartial: AtsKeywordEvidence[],
): string[] {
  const gaps: string[] = [];

  if (requiredMissing.length > 0) {
    gaps.push(`Missing required ATS keywords: ${requiredMissing.map((item) => item.keyword).slice(0, 6).join(', ')}.`);
  }

  if (requiredPartial.length > 0) {
    gaps.push(`Partial keyword coverage needs stronger wording: ${requiredPartial.map((item) => item.keyword).slice(0, 6).join(', ')}.`);
  }

  if (!gaps.length) {
    gaps.push('No major required keyword gaps detected by the deterministic ATS layer.');
  }

  return gaps;
}

function buildRecommendations(
  criticalMissing: string[],
  partial: string[],
  jd: StructuredJD,
): string[] {
  const recommendations: string[] = [];

  if (criticalMissing.length > 0) {
    recommendations.push(`Before applying, add truthful evidence for: ${criticalMissing.slice(0, 5).join(', ')}.`);
  }

  if (partial.length > 0) {
    recommendations.push(`Convert partial matches to ATS-friendly wording using exact JD terms: ${partial.slice(0, 5).join(', ')}.`);
  }

  if (jd.job_title && jd.job_title !== 'Unknown Role') {
    recommendations.push(`Tailor the professional summary toward ${jd.job_title} so the target role is clear in the first 3 lines.`);
  }

  recommendations.push('Keep the CV in a single-column ATS-safe format; export DOCX first when the employer allows it.');

  return recommendations.slice(0, 8);
}

function buildImprovementActions(criticalMissing: string[], partial: string[]): string[] {
  const actions: string[] = [];

  if (criticalMissing.length > 0) {
    actions.push(`Add a Skills subsection for: ${criticalMissing.slice(0, 6).join(', ')} — only where true.`);
  }

  if (partial.length > 0) {
    actions.push(`Rewrite 2–3 bullets to include exact JD language for: ${partial.slice(0, 5).join(', ')}.`);
  }

  actions.push('Add measurable outcomes: ticket volume, SLA achievement, resolution time, supported user count, revenue impact, report volume, or process improvement.');

  return actions;
}

// ============================================================
// PRIORITY / INFERENCE
// ============================================================
function inferPriorityForKeyword(
  keyword: string,
  rawJobDescription: string,
): AtsRequirementPriority {
  const text = normalizeText(rawJobDescription);
  const key = normalizeText(keyword);
  const escapedKey = escapeRegex(key);

  const criticalPattern = new RegExp(
    `(must have|required|mandatory|essential|minimum requirements?|proven experience with|strong knowledge of|you need|you must)[^.\\n]{0,160}${escapedKey}`,
    'i',
  );

  if (criticalPattern.test(text)) return 'critical';

  const nicePattern = new RegExp(
    `(nice to have|preferred|advantage|additional advantage|bonus|plus|beneficial)[^.\\n]{0,160}${escapedKey}`,
    'i',
  );

  if (nicePattern.test(text)) return 'nice_to_have';

  return 'required';
}

function priorityWeight(priority: AtsRequirementPriority): number {
  if (priority === 'critical') return 3;
  if (priority === 'required') return 2;
  return 1;
}

// ============================================================
// NORMALISATION / MATCHING
// ============================================================
function canonicalKey(value: string): string {
  const normalized = normalizeText(value)
    .replace(/\breact\.?js\b/g, 'react')
    .replace(/\bnode\.?js\b/g, 'node.js')
    .replace(/\bvue\.?js\b/g, 'vue')
    .replace(/\bnext\.?js\b/g, 'next.js')
    .replace(/\boffice 365\b/g, 'microsoft 365')
    .replace(/\bo365\b/g, 'microsoft 365')
    .replace(/\bm365\b/g, 'microsoft 365')
    .replace(/\bms office\b/g, 'microsoft office')
    .replace(/\bms sql\b/g, 'sql server')
    .replace(/\bmssql\b/g, 'sql server')
    .replace(/\bhyper v\b/g, 'hyper-v')
    .replace(/\bservice now\b/g, 'servicenow')
    .replace(/\bcsharp\b/g, 'c#')
    .replace(/\bc sharp\b/g, 'c#')
    .replace(/\bdotnet\b/g, '.net')
    .replace(/\basp\.net\b/g, '.net')
    .replace(/\bts\b(?=\s|$)/g, 'typescript')
    .replace(/\bgolang\b/g, 'go')
    .replace(/\bgithub\b/g, 'git')
    .replace(/\bgitlab\b/g, 'git')
    .replace(/\bbitbucket\b/g, 'git')
    .replace(/\s+/g, ' ')
    .trim();

  for (const [key, values] of Object.entries(SYNONYMS)) {
    if (key === normalized || values.map(normalizeText).includes(normalized)) {
      return key;
    }
  }

  return normalized;
}

function getVariants(keyword: string): string[] {
  const canonical = canonicalKey(keyword);
  const variants = new Set<string>([keyword, canonical]);

  for (const [key, values] of Object.entries(SYNONYMS)) {
    if (key === canonical || values.some((value) => canonicalKey(value) === canonical)) {
      variants.add(key);
      values.forEach((value) => variants.add(value));
    }
  }

  return Array.from(variants).map(normalizeText).filter(Boolean);
}

function hasPhrase(corpus: string, phrase: string): boolean {
  const normalizedPhrase = normalizeText(phrase);
  if (!normalizedPhrase) return false;

  const escaped = escapeRegex(normalizedPhrase);
  const regex = new RegExp(`(^|[^a-z0-9.#-])${escaped}($|[^a-z0-9.#-])`, 'i');

  return regex.test(corpus);
}

function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => hasPhrase(text, term));
}

function normalizeText(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9.#\-\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanKeyword(value: string): string {
  return String(value ?? '')
    .replace(/[•*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function removeRequirementNoise(value: string): string {
  return cleanKeyword(value)
    .replace(/^(a|an|the)\s+/i, '')
    .replace(/^(basic|good|strong|solid|excellent)\s+/i, '')
    .replace(/^(knowledge|experience|familiarity|understanding|ability)\s+(of|with|to)\s+/i, '')
    .replace(/^(working|hands[-\s]?on)\s+experience\s+(with|in)\s+/i, '')
    .replace(/\s+(is required|is preferred|would be beneficial|required|preferred)$/i, '')
    .trim();
}

function isUsefulCandidate(value: string): boolean {
  const clean = cleanKeyword(value);
  if (!clean) return false;
  if (clean.length < 2 || clean.length > 60) return false;

  const normalized = normalizeText(clean);
  if (STOP_WORDS.has(normalized)) return false;

  const words = normalized.split(/\s+/);
  if (words.length > 6) return false;

  return true;
}

function meaningfulTokens(keyword: string): string[] {
  return normalizeText(keyword)
    .split(/[^a-z0-9+#.\-\/]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

const STOP_WORDS = new Set([
  'and',
  'the',
  'for',
  'with',
  'you',
  'your',
  'our',
  'are',
  'will',
  'use',
  'using',
  'basic',
  'good',
  'strong',
  'knowledge',
  'experience',
  'familiarity',
  'understanding',
  'ability',
  'skills',
  'skill',
  'tools',
  'systems',
  'platforms',
  'environment',
  'responsible',
  'including',
  'related',
  'similar',
  'solid',
  'excellent',
  'working',
  'hands',
]);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================
// MISC HELPERS
// ============================================================
function normalizeFeedbackItems(items: unknown): string[] {
  const values = Array.isArray(items) ? items : [];

  return values
    .map((item) => {
      if (typeof item === 'string') return item;

      if (item && typeof item === 'object') {
        const record = item as {
          title?: unknown;
          detail?: unknown;
          reason?: unknown;
          skill?: unknown;
        };

        const parts = [record.title, record.detail ?? record.reason ?? record.skill]
          .filter((part) => typeof part === 'string' && part.trim().length > 0)
          .map(String);

        return parts.join(': ');
      }

      return '';
    })
    .filter((value) => value.trim().length > 0);
}

function normalizeTransferables(items: unknown): Array<{ skill: string; reason: string }> {
  const values = Array.isArray(items) ? items : [];

  return values
    .map((item) => {
      if (typeof item === 'string') {
        const skill = item.trim();
        if (!skill) return null;

        return {
          skill,
          reason: 'Relevant transferable skill detected from the CV.',
        };
      }

      if (item && typeof item === 'object') {
        const record = item as {
          skill?: unknown;
          title?: unknown;
          reason?: unknown;
          detail?: unknown;
        };

        const skill = String(record.skill ?? record.title ?? '').trim();
        if (!skill) return null;

        return {
          skill,
          reason: String(
            record.reason ??
              record.detail ??
              'Relevant transferable skill detected from the CV.',
          ),
        };
      }

      return null;
    })
    .filter((item): item is { skill: string; reason: string } => item !== null);
}

function mergeTransferables(
  aiTransferables: unknown,
  deterministicTransferables: Array<{ skill: string; reason: string }>,
): Array<{ skill: string; reason: string }> {
  const aiValues = normalizeTransferables(aiTransferables);
  return dedupeTransferables([...aiValues, ...deterministicTransferables]).slice(0, 10);
}

function dedupeTransferables(
  values: Array<{ skill: string; reason: string }>,
): Array<{ skill: string; reason: string }> {
  const seen = new Set<string>();
  const output: Array<{ skill: string; reason: string }> = [];

  for (const item of values) {
    const key = canonicalKey(item.skill);
    if (seen.has(key)) continue;

    seen.add(key);
    output.push(item);
  }

  return output;
}

function dedupeStrings(values: string[]): string[] {
  return deduplicateKeywords(values.map((value) => String(value ?? '')));
}

function containsKeyword(list: string[], keyword: string): boolean {
  const key = canonicalKey(keyword);
  return list.some((item) => canonicalKey(item) === key);
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}
