// ============================================================
// role-families.ts
// Hardcoded relevance rule tables — the "Role Relevance Gate"
//
// PURPOSE: before any keyword reaches the evidence engine, decide
// whether it's even plausible for this role family. This is what
// stops "TypeScript" matching on a customer service JD — not
// because TypeScript is "unsupported", but because it's IRRELEVANT
// to that role family regardless of evidence.
//
// This table needs manual upkeep as new role families emerge, but
// it never needs vendor-specific entries (no "Lenel", no "Genetec").
// Vendor-specific safety is handled generically by the evidence gate
// in keyword-decision.ts, not here.
// ============================================================

export type RoleFamily =
  | 'customer_service'
  | 'technical_support'
  | 'operations'
  | 'qa'
  | 'software'
  | 'data'
  | 'cyber'
  | 'business'
  | 'sales'
  | 'general';

export interface RoleFamilyProfile {
  family: RoleFamily;
  // Patterns matched against job_title + role_category + first 500 chars of JD
  // to detect this family. First match wins (ordered by specificity).
  detectPatterns: RegExp[];
  // Keyword categories that are HIGH relevance for this family —
  // if a JD keyword matches one of these patterns, it's worth keeping
  // even with weak evidence (gets "suggest_to_user" instead of "ignore")
  highRelevancePatterns: RegExp[];
  // Keyword categories that are NEVER relevant for this family —
  // matched keywords in this list get action: 'ignore' regardless of evidence
  irrelevantPatterns: RegExp[];
}

// ============================================================
// ROLE FAMILY PROFILES
// ============================================================
export const ROLE_FAMILY_PROFILES: RoleFamilyProfile[] = [
  {
    family: 'customer_service',
    detectPatterns: [
      /customer service/i, /customer support/i, /client service/i,
      /client support/i, /customer care/i, /customer experience/i,
      /support specialist/i, /support representative/i, /service officer/i,
    ],
    highRelevancePatterns: [
      /customer (service|support|care|experience|communication)/i,
      /\b(phone|chat|email) support\b/i, /multi-?channel support/i,
      /ticket(ing)?/i, /crm/i, /complaint/i, /escalat/i,
      /documentation/i, /follow-?up/i, /problem solving/i,
      /communication/i, /\benglish\b/i, /\bgerman\b/i, /\bfrench\b/i,
      /\bspanish\b/i, /team collaboration/i, /satisfaction/i,
      /retention/i, /upsell/i, /cross-?sell/i,
    ],
    irrelevantPatterns: [
      /\btypescript\b/i, /\bjavascript\b/i, /\breact\b/i, /\bnode\.?js\b/i,
      /\brest api\b/i, /\bgit(hub)?\b/i, /\bdocker\b/i, /\bkubernetes\b/i,
      /\bsql server\b/i, /\bpython\b/i, /\bactive directory\b/i,
      /\bci\/cd\b/i, /\bpowershell\b/i, /\bbash\b/i, /\blinux server\b/i,
      /\bunit test/i, /\bcode review/i, /\bapi development\b/i,
    ],
  },
  {
    family: 'technical_support',
    detectPatterns: [
      /technical support/i, /it support/i, /help desk/i, /service desk/i,
      /support engineer/i, /desktop support/i, /application support/i,
    ],
    highRelevancePatterns: [
      /troubleshoot/i, /incident/i, /ticket/i, /sla/i, /escalat/i,
      /active directory/i, /microsoft 365|office 365/i, /windows/i,
      /networking|tcp\/ip|dns|dhcp|vpn/i, /remote (desktop|support)/i,
      /hardware|software (support|installation)/i, /root cause/i,
      /monitoring/i, /documentation|knowledge base|runbook/i,
      /customer (service|communication)/i,
    ],
    irrelevantPatterns: [
      /\breact\b/i, /\bnode\.?js\b/i, /\btypescript\b/i,
      /\bunit test(ing)?\b/i, /\bci\/cd pipeline\b/i,
      /\bproduct management\b/i, /\bsales target\b/i,
    ],
  },
  {
    family: 'operations',
    detectPatterns: [
      /operations engineer/i, /operations analyst/i, /\bops\b/i,
      /infrastructure engineer/i, /systems administrator/i, /sysadmin/i,
      /site reliability/i, /\bsre\b/i, /network engineer/i,
    ],
    highRelevancePatterns: [
      /linux|windows server/i, /bash|powershell|shell scripting/i,
      /docker|kubernetes|containeris/i, /ansible|terraform|puppet|chef/i,
      /ci\/cd|jenkins|gitlab ci/i, /monitoring|observability|prometheus|grafana/i,
      /aws|azure|gcp|cloud/i, /networking|dns|load balanc/i,
      /incident response|on-?call/i, /automation/i,
    ],
    irrelevantPatterns: [
      /\bcustomer service\b/i, /\bsales target\b/i, /\bupsell\b/i,
      /\bproduct design\b/i, /\bgraphic design\b/i,
    ],
  },
  {
    family: 'qa',
    detectPatterns: [
      /qa (engineer|tester|analyst)/i, /quality assurance/i,
      /test engineer/i, /\bsdet\b/i, /software tester/i,
    ],
    highRelevancePatterns: [
      /test (case|plan|automation|script)/i, /selenium|cypress|playwright/i,
      /regression|smoke test|uat/i, /bug tracking|jira|defect/i,
      /manual testing|exploratory testing/i, /api testing|postman/i,
      /ci\/cd/i, /test coverage/i,
    ],
    irrelevantPatterns: [
      /\bcustomer service\b/i, /\bsales\b/i, /\bnetworking\b/i,
      /\bactive directory\b/i,
    ],
  },
  {
    family: 'software',
    detectPatterns: [
      /software engineer/i, /software developer/i, /frontend/i,
      /backend/i, /full.?stack/i, /web developer/i, /mobile developer/i,
      /application developer/i,
    ],
    highRelevancePatterns: [
      /javascript|typescript|python|java|c#|c\+\+|go|rust|php/i,
      /react|vue|angular|node\.?js|express|django|spring/i,
      /rest api|graphql|microservices/i, /git|github|gitlab/i,
      /ci\/cd|docker|kubernetes/i, /sql|database|orm/i,
      /unit test|integration test|tdd/i, /code review|agile|scrum/i,
    ],
    irrelevantPatterns: [
      /\bcustomer service\b/i, /\bsales target\b/i, /\bupsell\b/i,
      /\bphone support\b/i, /\bcash handling\b/i,
    ],
  },
  {
    family: 'data',
    detectPatterns: [
      /data analyst/i, /data scientist/i, /data engineer/i,
      /business intelligence/i, /\bbi\b/i, /analytics/i,
    ],
    highRelevancePatterns: [
      /sql|python|r\b/i, /power bi|tableau|looker/i,
      /excel|spreadsheet/i, /etl|data pipeline/i, /statistics|machine learning/i,
      /data visualisation|dashboard/i, /reporting/i,
    ],
    irrelevantPatterns: [
      /\bcustomer service\b/i, /\bnetworking\b/i, /\bactive directory\b/i,
      /\bhardware support\b/i,
    ],
  },
  {
    family: 'cyber',
    detectPatterns: [
      /security analyst/i, /cyber ?security/i, /\bsoc\b/i,
      /penetration tester/i, /security engineer/i,
    ],
    highRelevancePatterns: [
      /siem|firewall|ids|ips/i, /vulnerability|penetration test/i,
      /incident response/i, /compliance|gdpr|iso ?27001/i,
      /threat (detection|intelligence)/i, /encryption/i,
    ],
    irrelevantPatterns: [
      /\bcustomer service\b/i, /\bsales target\b/i,
    ],
  },
  {
    family: 'sales',
    detectPatterns: [
      /sales (executive|representative|manager|associate)/i,
      /account manager/i, /business development/i,
    ],
    highRelevancePatterns: [
      /sales target|quota/i, /lead generation/i, /crm|salesforce|hubspot/i,
      /negotiation/i, /client relationship/i, /pipeline management/i,
      /cold calling|prospecting/i, /closing deals/i,
    ],
    irrelevantPatterns: [
      /\btypescript\b/i, /\bnode\.?js\b/i, /\bactive directory\b/i,
      /\bnetworking\b/i, /\bdocker\b/i,
    ],
  },
  {
    family: 'business',
    detectPatterns: [
      /business analyst/i, /project manager/i, /product manager/i,
      /program manager/i, /business operations/i,
    ],
    highRelevancePatterns: [
      /stakeholder management/i, /requirements gathering/i,
      /agile|scrum|kanban/i, /roadmap/i, /process improvement/i,
      /jira|confluence/i, /budget|forecasting/i,
    ],
    irrelevantPatterns: [
      /\bhardware support\b/i, /\bphone support\b/i,
    ],
  },
];

// ============================================================
// DETECT ROLE FAMILY
// First pattern match wins, in array order (most specific first).
// Falls back to 'general' if nothing matches.
// ============================================================
export function detectRoleFamily(
  jobTitle: string,
  roleCategory: string,
  jobDescriptionExcerpt: string,
): RoleFamily {
  const haystack = `${jobTitle} ${roleCategory} ${jobDescriptionExcerpt.slice(0, 800)}`;

  for (const profile of ROLE_FAMILY_PROFILES) {
    if (profile.detectPatterns.some(p => p.test(haystack))) {
      return profile.family;
    }
  }

  return 'general';
}

export function getRoleFamilyProfile(family: RoleFamily): RoleFamilyProfile | null {
  return ROLE_FAMILY_PROFILES.find(p => p.family === family) ?? null;
}

// ============================================================
// RELEVANCE CHECK
// Returns 'irrelevant' | 'high' | 'unknown'
// 'unknown' means the keyword wasn't explicitly classified either way —
// the evidence gate decides its fate (defaults to 'medium' relevance).
// ============================================================
export function checkKeywordRelevance(
  keyword: string,
  family: RoleFamily,
): 'irrelevant' | 'high' | 'unknown' {
  if (family === 'general') return 'unknown';

  const profile = getRoleFamilyProfile(family);
  if (!profile) return 'unknown';

  if (profile.irrelevantPatterns.some(p => p.test(keyword))) return 'irrelevant';
  if (profile.highRelevancePatterns.some(p => p.test(keyword))) return 'high';

  return 'unknown';
}