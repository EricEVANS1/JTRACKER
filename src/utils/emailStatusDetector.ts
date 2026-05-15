import type { ApplicationStatus } from '../types/application';

export interface DetectedEmailStatus {
  status: ApplicationStatus | 'unknown' | 'opportunity' | 'pre_offer';
  category: string;
  confidence: number;
  reason: string;
  signals: string[];
}

type StatusRule = {
  status: DetectedEmailStatus['status'];
  category: string;
  confidence: number;
  reason: string;
  requiredAny: string[];
  contextAny?: string[];
  blockIfAny?: string[];
};

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const findSignals = (content: string, keywords: string[]) =>
  keywords.filter((keyword) => content.includes(keyword));

const hasAny = (content: string, keywords: string[]) =>
  keywords.some((keyword) => content.includes(keyword));

const nonRecruitmentBlocks = [
  'youtube premium',
  'subscription',
  'newsletter',
  'course',
  'tutorial',
  'webinar',
  'discount',
  'promo code',
  'limited time offer',
  'order confirmation',
  'receipt',
  'invoice',
  'billing',
  'freecodecamp',
  'watch now',
  'new video',
];

const recruitmentContext = [
  'application',
  'candidate',
  'role',
  'position',
  'job',
  'recruitment',
  'recruiter',
  'hiring',
  'talent acquisition',
  'interview',
  'assessment',
  'screening',
  'cv',
  'resume',
];

const rules: StatusRule[] = [
  {
    status: 'rejected',
    category: 'Rejection',
    confidence: 94,
    reason: 'Detected strong rejection language from a recruitment context.',
    requiredAny: [
      'not moving forward',
      'will not be moving forward',
      'we will not be moving forward',
      'we have decided not to move forward',
      'we decided not to move forward',
      'we regret to inform you',
      'unfortunately we will not',
      'unfortunately, we will not',
      'not selected',
      'not be selected',
      'other candidates',
      'pursue other candidates',
      'position has been filled',
      'role has been filled',
      'application was unsuccessful',
      'application has been unsuccessful',
    ],
    contextAny: recruitmentContext,
  },
  {
    status: 'offer',
    category: 'Offer',
    confidence: 93,
    reason: 'Detected strong job offer language.',
    requiredAny: [
      'pleased to offer you',
      'pleased to extend an offer',
      'formal offer',
      'offer letter',
      'employment offer',
      'job offer',
      'we would like to offer you',
      'we are excited to offer',
      'your offer package',
    ],
    contextAny: [
      'position',
      'role',
      'job',
      'employment',
      'start date',
      'compensation',
      'salary',
      'contract',
    ],
    blockIfAny: [
      'limited time offer',
      'special offer',
      'premium offer',
      'discount offer',
      'subscription offer',
    ],
  },
  {
    status: 'pre_offer',
    category: 'Pre-offer / Documents',
    confidence: 88,
    reason: 'Detected pre-offer or onboarding document request language.',
    requiredAny: [
      'documents needed',
      'provide your pesel',
      'copy of your residence card',
      'copy of your decision',
      'copy of your diploma',
      'prepare your contract',
      'prepare your first contract',
      'generate the written offer',
      'confirm our working conditions',
      'background check',
      'right to work',
    ],
    contextAny: [
      'offer',
      'employment',
      'contract',
      'hiring',
      'onboarding',
      'candidate',
      'start date',
    ],
  },
  {
    status: 'final_interview',
    category: 'Final Interview',
    confidence: 91,
    reason: 'Detected final interview scheduling language.',
    requiredAny: [
      'final interview',
      'final stage interview',
      'final round interview',
      'last interview stage',
      'meet the hiring manager',
      'meet with the hiring manager',
    ],
    contextAny: recruitmentContext,
  },
  {
    status: 'interview',
    category: 'Interview',
    confidence: 89,
    reason: 'Detected interview scheduling language.',
    requiredAny: [
      'interview invitation',
      'invited to interview',
      'schedule an interview',
      'schedule your interview',
      'phone interview',
      'technical interview',
      'hr interview',
      'video interview',
      'interview availability',
      'available for an interview',
      'book your interview',
      'select a time for your interview',
      'schedule a call with',
      'meet with our team',
      'meet the team',
      'google meet',
      'microsoft teams',
      'zoom interview',
    ],
    contextAny: recruitmentContext,
  },
  {
    status: 'assessment',
    category: 'Assessment',
    confidence: 87,
    reason: 'Detected assessment or test invitation language.',
    requiredAny: [
      'online assessment',
      'technical assessment',
      'coding challenge',
      'coding test',
      'technical test',
      'take-home assignment',
      'test assignment',
      'hackerrank',
      'testgorilla',
      'codility',
      'technical evaluation',
      'complete the assessment',
      'complete your assessment',
      'assessment invitation',
    ],
    contextAny: recruitmentContext,
  },
  {
    status: 'confirmation_received',
    category: 'Application Submitted',
    confidence: 84,
    reason: 'Detected application submission confirmation.',
    requiredAny: [
      'thank you for applying',
      'thanks for applying',
      'thank you for submitting your application',
      'application submitted',
      'application has been submitted',
      'successfully submitted',
      'your application is complete',
      'your application was submitted',
    ],
  },
  {
    status: 'confirmation_received',
    category: 'Application Received',
    confidence: 82,
    reason: 'Detected application received confirmation.',
    requiredAny: [
      'application received',
      'we received your application',
      'we have received your application',
      'your application has been received',
      'thanks for your application',
      'thank you for your interest in',
      'thank you for taking the time to apply',
    ],
  },
  {
    status: 'confirmation_received',
    category: 'Under Review',
    confidence: 78,
    reason: 'Detected application review language.',
    requiredAny: [
      'your application is under review',
      'currently under review',
      'currently reviewing your application',
      'we are reviewing your application',
      'resume will be reviewed',
      'cv will be reviewed',
      'recruiter will review',
      'our team will review',
    ],
  },
  {
    status: 'opportunity',
    category: 'New Opportunity',
    confidence: 70,
    reason: 'Detected possible recruiter outreach or job opportunity.',
    requiredAny: [
      'job opportunity',
      'career opportunity',
      'interesting opportunity',
      'we are hiring',
      'i am hiring',
      'looking for candidates',
      'would you be interested',
      'are you interested in',
      'your profile looks interesting',
      'came across your profile',
      'recruiting for',
    ],
    contextAny: [
      'role',
      'position',
      'job',
      'developer',
      'engineer',
      'analyst',
      'candidate',
      'recruiter',
      'hiring',
    ],
  },
];

export const detectEmailStatus = (
  subject: string,
  snippet: string
): DetectedEmailStatus => {
  const content = normalize(`${subject} ${snippet}`);

  if (!content) {
    return {
      status: 'unknown',
      category: 'Unknown',
      confidence: 0,
      reason: 'No subject or body content available.',
      signals: [],
    };
  }

  const blockedSignals = findSignals(content, nonRecruitmentBlocks);

  if (blockedSignals.length > 0 && !hasAny(content, recruitmentContext)) {
    return {
      status: 'unknown',
      category: 'Non-Recruitment',
      confidence: 0,
      reason: `Blocked non-recruitment content: ${blockedSignals.join(', ')}.`,
      signals: blockedSignals,
    };
  }

  for (const rule of rules) {
    const requiredSignals = findSignals(content, rule.requiredAny);

    if (requiredSignals.length === 0) continue;

    if (rule.blockIfAny && hasAny(content, rule.blockIfAny)) {
      continue;
    }

    const contextSignals = rule.contextAny
      ? findSignals(content, rule.contextAny)
      : [];

    if (rule.contextAny && contextSignals.length === 0) {
      continue;
    }

    const confidenceBoost = Math.min(requiredSignals.length * 2, 6);
    const contextBoost = Math.min(contextSignals.length * 1, 4);

    return {
      status: rule.status,
      category: rule.category,
      confidence: Math.min(99, rule.confidence + confidenceBoost + contextBoost),
      reason: rule.reason,
      signals: [...requiredSignals, ...contextSignals],
    };
  }

  if (hasAny(content, recruitmentContext)) {
    const weakSignals = findSignals(content, recruitmentContext);

    return {
      status: 'unknown',
      category: 'Possible Recruitment',
      confidence: 35,
      reason:
        'Weak recruitment-related words were found, but no reliable status signal was detected.',
      signals: weakSignals,
    };
  }

  return {
    status: 'unknown',
    category: 'Unknown',
    confidence: 0,
    reason: 'No reliable job application status signal detected.',
    signals: [],
  };
};