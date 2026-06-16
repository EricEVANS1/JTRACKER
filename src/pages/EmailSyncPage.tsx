import React, { useEffect, useRef, useState } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import {
PublicClientApplication,
type Configuration,
} from '@azure/msal-browser';

import {
AlertTriangle,
CheckCircle2,
Clock,
Eye,
Link2,
LogOut,
Mail,
MailCheck,
SearchCheck,
ShieldCheck,
Sparkles,
X,
} from 'lucide-react';

import { detectEmailStatus } from '../utils/emailStatusDetector';
import { extractApplicationDataFromEmail } from '../utils/emailApplicationExtractor';
import { findBestApplicationMatch } from '../utils/emailMatcher';
import { filterEmail } from '../utils/emailFilter';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useGmailToken } from '../hooks/useGmailToken';

type EmailProvider = 'gmail' | 'outlook' | 'manual';

type EmailActionType = 'IGNORE' | 'REVIEW' | 'LINK_EXISTING' | 'CREATE_APPLICATION';

type OutcomeReason =
| 'rejected_before_interview'
| 'rejected_after_assessment'
| 'rejected_after_interview'
| 'offer_received'
| 'offer_declined'
| 'offer_accepted'
| 'withdrawn'
| 'ghosted'
| 'no_response'
| null;

interface CompanyJoin {
name: string;
}

interface RawApplicationOption {
id: string;
role_title: string;
status: string;
reached_interview?: boolean | null;
rejected_after_interview?: boolean | null;
final_response_pending?: boolean | null;
interview_count?: number | null;
response_received_at?: string | null;
assessment_received_at?: string | null;
interview_started_at?: string | null;
final_interview_started_at?: string | null;
offer_received_at?: string | null;
rejected_at?: string | null;
companies?: CompanyJoin | CompanyJoin[] | null;
}

interface ApplicationOption {
id: string;
role_title: string;
status: string;
reached_interview?: boolean | null;
rejected_after_interview?: boolean | null;
final_response_pending?: boolean | null;
interview_count?: number | null;
response_received_at?: string | null;
assessment_received_at?: string | null;
interview_started_at?: string | null;
final_interview_started_at?: string | null;
offer_received_at?: string | null;
rejected_at?: string | null;
companies: CompanyJoin | null;
}

interface EmailAutomationSettings {
gmail_sync_enabled: boolean;
gmail_max_emails_per_sync: number;
gmail_recruitment_only: boolean;
ai_email_analysis_enabled: boolean;
ai_confidence_threshold: number;
}

interface EmailMessage {
id: string;
provider: EmailProvider;
subject: string;
sender: string;
date: string;
snippet: string;
receivedAtMs: number;
detection: ReturnType<typeof detectEmailStatus>;
extractedApplication: ReturnType<typeof extractApplicationDataFromEmail>;
matchedApplication: ReturnType<typeof findBestApplicationMatch>;
filterResult: ReturnType<typeof filterEmail>;
}

interface EmailAction {
action: EmailActionType;
label: string;
reason: string;
tone: 'danger' | 'warning' | 'success' | 'neutral';
}

const msalConfig: Configuration = {
auth: {
clientId: import.meta.env.VITE_AZURE_CLIENT_ID as string,
authority: 'https://login.microsoftonline.com/common',
redirectUri: window.location.origin,
},
cache: {
cacheLocation: 'sessionStorage',
},
};

const msalInstance = new PublicClientApplication(msalConfig);
const OUTLOOK_SCOPES = ['Mail.Read'];

const DEFAULT_EMAIL_SETTINGS: EmailAutomationSettings = {
gmail_sync_enabled: true,
gmail_max_emails_per_sync: 50,
gmail_recruitment_only: true,
ai_email_analysis_enabled: true,
ai_confidence_threshold: 90,
};

const MIN_EMAILS_PER_SYNC = 5;
const MAX_EMAILS_PER_SYNC = 100;
const MIN_AUTO_REJECTION_MATCH_SCORE = 85;

const inputCls =
'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent transition';

const categoryStyles: Record<string, string> = {
Rejection: 'bg-red-100 text-red-700',
Offer: 'bg-green-100 text-green-700',
'Formal Offer': 'bg-green-100 text-green-700',
'Pre-offer / Documents': 'bg-emerald-100 text-emerald-700',
Interview: 'bg-amber-100 text-amber-700',
'Final Interview': 'bg-purple-100 text-purple-700',
Assessment: 'bg-violet-100 text-violet-700',
'Application Submitted': 'bg-blue-100 text-blue-700',
'Application Received': 'bg-cyan-100 text-cyan-700',
'Under Review': 'bg-indigo-100 text-indigo-700',
'New Opportunity': 'bg-orange-100 text-orange-700',
'Possible Recruitment': 'bg-slate-100 text-slate-700',
'Non-Recruitment': 'bg-zinc-100 text-zinc-700',
Unknown: 'bg-slate-100 text-slate-700',
};

const firstOrNull = <T,>(value: T | T[] | null | undefined): T | null => {
if (Array.isArray(value)) return value[0] ?? null;
return value ?? null;
};

const clampNumber = (value: number, min: number, max: number) => {
if (Number.isNaN(value)) return min;
return Math.min(Math.max(value, min), max);
};

const formatStatus = (status: string) =>
status.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());

const decodeBase64Url = (value: string) => {
try {
const base64 = value.replace(/-/g, '+').replace(/_/g, '/');


return decodeURIComponent(
  atob(base64)
    .split('')
    .map((char) => `%${`00${char.charCodeAt(0).toString(16)}`.slice(-2)}`)
    .join(''),
);


} catch {
return '';
}
};

const stripHtml = (value: string) =>
value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const extractPlainTextFromPayload = (payload: any): string => {
if (!payload) return '';

if (payload.mimeType === 'text/plain' && payload.body?.data) {
return decodeBase64Url(payload.body.data);
}

if (payload.mimeType === 'text/html' && payload.body?.data) {
return stripHtml(decodeBase64Url(payload.body.data));
}

if (Array.isArray(payload.parts)) {
return payload.parts
.map((part: any) => extractPlainTextFromPayload(part))
.filter(Boolean)
.join(' ')
.replace(/\s+/g, ' ')
.trim();
}

return '';
};

const getSafeStatus = (status: string) =>
['unknown', 'opportunity', 'pre_offer'].includes(status) ? 'applied' : status;

const canUpdateApplicationStatus = (status: string) =>
!['unknown', 'opportunity', 'pre_offer'].includes(status);

const getLifecycleUpdate = (status: string, app?: ApplicationOption | null) => {
const now = new Date().toISOString();

const update: Record<string, string | boolean | number | OutcomeReason | null> = {
status,
last_status_changed_at: now,
status_updated_at: now,
};

if (status === 'confirmation_received') {
update.response_received_at = now;
}

if (status === 'assessment') {
update.response_received_at = now;
update.assessment_received_at = now;
update.final_response_pending = false;
}

if (status === 'interview') {
update.response_received_at = now;
update.interview_started_at = now;
update.reached_interview = true;
update.final_response_pending = true;
update.rejected_after_interview = false;
update.interview_count = Math.max(app?.interview_count || 0, 1);
}

if (status === 'final_interview') {
update.response_received_at = now;
update.interview_started_at = now;
update.final_interview_started_at = now;
update.reached_interview = true;
update.final_response_pending = true;
update.rejected_after_interview = false;
update.interview_count = Math.max(app?.interview_count || 0, 1);
}

if (status === 'offer') {
update.response_received_at = now;
update.offer_received_at = now;
update.final_response_pending = false;
update.outcome_reason = 'offer_received';


if (
  app?.status === 'interview' ||
  app?.status === 'final_interview' ||
  app?.reached_interview
) {
  update.reached_interview = true;
  update.interview_count = Math.max(app?.interview_count || 0, 1);
}


}

if (status === 'rejected') {
const hadInterview =
app?.reached_interview ||
app?.status === 'interview' ||
app?.status === 'final_interview' ||
app?.status === 'offer' ||
Boolean(app?.interview_started_at) ||
Boolean(app?.final_interview_started_at);


update.response_received_at = now;
update.rejected_at = now;
update.archived = true;
update.archived_at = now;
update.final_response_pending = false;

if (hadInterview) {
  update.reached_interview = true;
  update.rejected_after_interview = true;
  update.interview_count = Math.max(app?.interview_count || 0, 1);
  update.outcome_reason = 'rejected_after_interview';
} else if (app?.status === 'assessment' || Boolean(app?.assessment_received_at)) {
  update.rejected_after_interview = false;
  update.outcome_reason = 'rejected_after_assessment';
} else {
  update.rejected_after_interview = false;
  update.outcome_reason = 'rejected_before_interview';
}


}

if (status === 'withdrawn') {
update.withdrawn_at = now;
update.final_response_pending = false;
update.outcome_reason = 'withdrawn';
}

if (status === 'ghosted') {
update.response_received_at = now;
update.ghosted_at = now;
update.final_response_pending = false;
update.outcome_reason = 'ghosted';
}

return update;
};

const getEmailAction = (
email: EmailMessage,
settings: EmailAutomationSettings,
): EmailAction => {
const decision = email.filterResult.decision;
const extraction = email.extractedApplication;
const match = email.matchedApplication;

if (!settings.gmail_sync_enabled) {
return {
action: 'REVIEW',
label: 'Sync Disabled',
reason: 'Email sync is disabled in Settings. Enable it before automation can process emails.',
tone: 'neutral',
};
}

if (!settings.ai_email_analysis_enabled) {
return {
action: 'REVIEW',
label: 'AI Analysis Disabled',
reason: 'AI email analysis is disabled in Settings. This email must be reviewed manually.',
tone: 'warning',
};
}

if (settings.gmail_recruitment_only && decision === 'REJECTED') {
return {
action: 'IGNORE',
label: 'Ignored',
reason: email.filterResult.reason,
tone: 'danger',
};
}

if (!settings.gmail_recruitment_only && decision === 'REJECTED') {
return {
action: 'REVIEW',
label: 'Review',
reason: `Recruitment-only mode is off, so this skipped email is being sent to review. Filter reason: ${email.filterResult.reason}`,
tone: 'warning',
};
}

if (match?.shouldAutoLink) {
return {
action: 'LINK_EXISTING',
label: 'Safe to Link',
reason: `Strong existing application match: ${match.score}%.`,
tone: 'success',
};
}

if (
email.detection.status === 'rejected' ||
email.detection.category === 'Rejection'
) {
return {
action: 'REVIEW',
label: 'Review Rejection',
reason: 'This looks like a rejection email, but no safe existing application match was found. Review it and link it to the correct application manually.',
tone: 'warning',
};
}


if (
extraction.companyConfidence >= 80 &&
extraction.roleConfidence >= 80 &&
extraction.confidence >= 80 &&
decision === 'ACCEPTED'
) {
return {
action: 'CREATE_APPLICATION',
label: 'Safe to Create',
reason: 'Company and role were confidently extracted.',
tone: 'success',
};
}

return {
action: 'REVIEW',
label: 'Needs Review',
reason: 'Company or role extraction is not strong enough for automation.',
tone: 'warning',
};
};

const mergeUniqueMessages = (prev: EmailMessage[], next: EmailMessage[]) => {
const seen = new Set(prev.map((msg) => `${msg.provider}:${msg.id}`));

return [
...prev,
...next.filter((msg) => !seen.has(`${msg.provider}:${msg.id}`)),
];
};

const buildGmailQuery = (recruitmentOnly: boolean) => {
const query = [
'newer_than:365d',
'(application OR interview OR recruiter OR recruitment OR hiring OR assessment OR offer OR rejected OR "thank you for applying" OR "your application" OR "next steps" OR unfortunately)',
];

if (recruitmentOnly) {
query.push('-category:promotions');
}

return query.join(' ');
};


const buildOutlookSearchUrl = (maxResults: number) => {
const query =
'application OR interview OR offer OR recruiter OR recruitment OR hiring OR assessment OR rejected OR "thank you for applying" OR "your application" OR "next steps"';

return (
'https://graph.microsoft.com/v1.0/me/messages' +
`?$search=${encodeURIComponent(`"${query}"`)}` +
`&$top=${maxResults}` +
'&$select=id,subject,from,receivedDateTime,bodyPreview,body'
);
};

const buildOutlookFallbackUrl = (maxResults: number) => {
const filter = [
'application',
'interview',
'offer',
'recruiter',
'assessment',
'rejected',
'hiring',
]
.map((keyword) => `contains(subject,'${keyword}')`)
.join(' or ');

return (
'https://graph.microsoft.com/v1.0/me/messages' +
`?$filter=${encodeURIComponent(filter)}` +
`&$top=${maxResults}` +
'&$select=id,subject,from,receivedDateTime,bodyPreview,body'
);
};

export const EmailSyncPage: React.FC = () => {
const { user } = useAuth();
const { gmailToken, gmailConnected, minutesRemaining, saveToken, clearToken } =
useGmailToken();

const [outlookToken, setOutlookToken] = useState<string | null>(null);
const [outlookConnected, setOutlookConnected] = useState(false);

const [emailSettings, setEmailSettings] =
useState<EmailAutomationSettings>(DEFAULT_EMAIL_SETTINGS);
const [settingsLoading, setSettingsLoading] = useState(true);

const [safeMessages, setSafeMessages] = useState<EmailMessage[]>([]);
const [reviewMessages, setReviewMessages] = useState<EmailMessage[]>([]);
const [ignoredMessages, setIgnoredMessages] = useState<EmailMessage[]>([]);
const [applications, setApplications] = useState<ApplicationOption[]>([]);

const [syncingGmail, setSyncingGmail] = useState(false);
const [syncingOutlook, setSyncingOutlook] = useState(false);
const [processingEmailId, setProcessingEmailId] = useState('');
const [manualApplicationSelections, setManualApplicationSelections] = useState<Record<string, string>>({});


const [subject, setSubject] = useState('');
const [snippet, setSnippet] = useState('');
const [result, setResult] = useState<ReturnType<typeof detectEmailStatus> | null>(null);
const [selectedApplicationId, setSelectedApplicationId] = useState('');
const [saving, setSaving] = useState(false);

const [message, setMessage] = useState('');
const [error, setError] = useState('');

const msalReady = useRef(false);

const maxEmailsPerSync = clampNumber(
Number(emailSettings.gmail_max_emails_per_sync || DEFAULT_EMAIL_SETTINGS.gmail_max_emails_per_sync),
MIN_EMAILS_PER_SYNC,
MAX_EMAILS_PER_SYNC,
);

const autoUpdateConfidenceThreshold = clampNumber(
Number(emailSettings.ai_confidence_threshold || DEFAULT_EMAIL_SETTINGS.ai_confidence_threshold),
50,
99,
);

const emailSyncDisabled = !emailSettings.gmail_sync_enabled || settingsLoading;
const anyProviderSyncing = syncingGmail || syncingOutlook;

useEffect(() => {
if (msalReady.current) return;


msalReady.current = true;

msalInstance
  .initialize()
  .then(async () => {
    const accounts = msalInstance.getAllAccounts();

    if (!accounts.length) return;

    try {
      const tokenResult = await msalInstance.acquireTokenSilent({
        scopes: OUTLOOK_SCOPES,
        account: accounts[0],
      });

      setOutlookToken(tokenResult.accessToken);
      setOutlookConnected(true);
    } catch {
      // User can reconnect manually.
    }
  })
  .catch(() => {
    // User can reconnect manually.
  });


}, []);

const fetchEmailSettings = async () => {
if (!user) return;


setSettingsLoading(true);

const { data, error: settingsError } = await supabase
  .from('user_settings')
  .select(
    'gmail_sync_enabled, gmail_max_emails_per_sync, gmail_recruitment_only, ai_email_analysis_enabled, ai_confidence_threshold',
  )
  .eq('user_id', user.id)
  .maybeSingle();

if (settingsError) {
  setError(settingsError.message);
  setEmailSettings(DEFAULT_EMAIL_SETTINGS);
} else {
  setEmailSettings({
    ...DEFAULT_EMAIL_SETTINGS,
    ...(data || {}),
  });
}

setSettingsLoading(false);


};

useEffect(() => {
fetchEmailSettings();
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [user?.id]);

const loginGmail = useGoogleLogin({
scope: 'https://www.googleapis.com/auth/gmail.readonly',
prompt: 'consent',
onSuccess: (tokenResponse) => {
saveToken(tokenResponse.access_token);
setMessage('Gmail connected successfully with Gmail read permission.');
setError('');
},
onError: () => {
setError('Failed to connect Gmail.');
},
});


const connectOutlook = async () => {
setError('');
setMessage('');

try {
await msalInstance.initialize();


const tokenResult = await msalInstance.acquireTokenPopup({
  scopes: OUTLOOK_SCOPES,
  prompt: 'select_account',
});

setOutlookToken(tokenResult.accessToken);
setOutlookConnected(true);
setMessage('Outlook connected successfully.');


} catch (err) {
const message =
err instanceof Error
? err.message
: 'Failed to connect Outlook.';


if (message.includes('timed_out')) {
  setError(
    'Outlook sign-in timed out. Allow pop-ups for this site, complete the Microsoft login prompt, then try again.',
  );
  return;
}

setError(message);

}
};


const disconnectOutlook = async () => {
setOutlookToken(null);
setOutlookConnected(false);

try {
const accounts = msalInstance.getAllAccounts();


if (accounts.length > 0) {
  await msalInstance.logoutPopup({
    account: accounts[0],
  });
}

setMessage('Outlook disconnected.');


} catch {
setMessage('Outlook disconnected locally.');
}
};


const fetchApplications = async () => {
if (!user) return;


const { data, error: fetchError } = await supabase
  .from('applications')
  .select(`
    id,
    role_title,
    status,
    reached_interview,
    rejected_after_interview,
    final_response_pending,
    interview_count,
    response_received_at,
    assessment_received_at,
    interview_started_at,
    final_interview_started_at,
    offer_received_at,
    rejected_at,
    companies (
      name
    )
  `)
  .eq('user_id', user.id)
  .or('archived.is.false,archived.is.null')
  .neq('status', 'archived')
  .order('created_at', { ascending: false });

if (fetchError) {
  setError(fetchError.message);
  return;
}

setApplications(
  ((data || []) as RawApplicationOption[]).map((app) => ({
    ...app,
    companies: firstOrNull(app.companies),
  })),
);


};

useEffect(() => {
fetchApplications();
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [user?.id]);

const parseEmailPayload = ({
id,
provider,
subject: emailSubject,
sender,
date,
body,
receivedAtMs,
}: {
id: string;
provider: EmailProvider;
subject: string;
sender: string;
date: string;
body: string;
receivedAtMs: number;
}): EmailMessage => {
const emailSnippet = body.slice(0, 1200);
const detection = detectEmailStatus(emailSubject, emailSnippet);


const filterResult = filterEmail({
  messageId: id,
  sender,
  subject: emailSubject,
  snippet: emailSnippet,
  receivedAt: receivedAtMs,
  confidence: detection.confidence,
});

const extractedApplication = extractApplicationDataFromEmail(
  emailSubject,
  emailSnippet,
  sender,
);

const matchedApplication = findBestApplicationMatch(
  extractedApplication.companyName,
  extractedApplication.roleTitle,
  applications,
);

return {
  id,
  provider,
  subject: emailSubject,
  sender,
  date,
  snippet: emailSnippet,
  receivedAtMs,
  detection,
  extractedApplication,
  matchedApplication,
  filterResult,
};


};

const saveEmailEvent = async (email: EmailMessage, applicationId: string | null) => {
if (!user) return;


const { error: insertError } = await supabase.from('email_events').insert({
  user_id: user.id,
  application_id: applicationId,
  provider: email.provider,
  provider_message_id: email.id,
  sender: email.sender,
  subject: email.subject,
  snippet: email.snippet,
  detected_status: email.detection.status,
  received_at: new Date(email.receivedAtMs).toISOString(),
});

if (insertError) throw new Error(insertError.message);


};

const persistIgnoreEmail = async (email: EmailMessage, reason: string) => {
if (!user) return;


const { error: insertError } = await supabase.from('ignored_email_events').insert({
  user_id: user.id,
  provider: email.provider,
  provider_message_id: email.id,
  subject: email.subject,
  sender: email.sender,
  reason,
});

if (insertError) throw new Error(insertError.message);


};

const isHighConfidenceRejectionAutomationCandidate = (email: EmailMessage) => {
return (
emailSettings.gmail_sync_enabled &&
emailSettings.ai_email_analysis_enabled &&
email.detection.status === 'rejected' &&
email.detection.confidence >= autoUpdateConfidenceThreshold &&
email.filterResult.decision === 'ACCEPTED' &&
Boolean(email.matchedApplication?.shouldAutoLink) &&
Number(email.matchedApplication?.score || 0) >= MIN_AUTO_REJECTION_MATCH_SCORE
);
};

const autoRejectMatchedApplication = async (email: EmailMessage) => {
if (!user || !email.matchedApplication?.applicationId) return false;


const applicationId = email.matchedApplication.applicationId;
const matchedApp = applications.find((app) => app.id === applicationId);

const { error: updateError } = await supabase
  .from('applications')
  .update(getLifecycleUpdate('rejected', matchedApp))
  .eq('id', applicationId)
  .eq('user_id', user.id);

if (updateError) throw new Error(updateError.message);

await saveEmailEvent(email, applicationId);

const { error: eventError } = await supabase.from('application_events').insert({
  user_id: user.id,
  application_id: applicationId,
  event_type: 'email_auto_rejection',
  title: 'Rejection detected automatically',
  description: `Email Sync detected a high-confidence rejection from ${email.sender}. Subject: ${email.subject}`,
  event_date: new Date().toISOString(),
});

if (eventError) throw new Error(eventError.message);

setApplications((prev) => prev.filter((app) => app.id !== applicationId));

return true;


};

const processAutomaticRejections = async (messages: EmailMessage[]) => {
const autoRejectedIds = new Set<string>();
let autoRejectedCount = 0;


if (!emailSettings.ai_email_analysis_enabled) {
  return {
    autoRejectedIds,
    autoRejectedCount,
  };
}

for (const email of messages) {
  if (!isHighConfidenceRejectionAutomationCandidate(email)) continue;

  try {
    const updated = await autoRejectMatchedApplication(email);

    if (updated) {
      autoRejectedIds.add(email.id);
      autoRejectedCount += 1;
    }
  } catch (err) {
    console.error('Auto rejection failed:', err);
  }
}

return {
  autoRejectedIds,
  autoRejectedCount,
};


};

const processParsedMessages = async (
parsedMessages: EmailMessage[],
provider: EmailProvider,
syncStartedAt: number,
) => {
if (!user) return;


const ids = parsedMessages.map((msg) => msg.id);

if (ids.length === 0) {
  await supabase.from('email_sync_sessions').insert({
    user_id: user.id,
    provider,
    scanned_count: 0,
    accepted_count: 0,
    review_count: 0,
    rejected_count: 0,
    processing_time_ms: Date.now() - syncStartedAt,
    status: 'completed',
  });

  setMessage(`${provider === 'gmail' ? 'Gmail' : 'Outlook'} scan complete: 0 emails found.`);
  return;
}

const { data: existingEmailEvents } = await supabase
  .from('email_events')
  .select('provider_message_id')
  .eq('user_id', user.id)
  .eq('provider', provider)
  .in('provider_message_id', ids);

const processedIds = new Set(
  (existingEmailEvents || [])
    .map((event) => event.provider_message_id)
    .filter(Boolean),
);

const { data: ignoredEmails } = await supabase
  .from('ignored_email_events')
  .select('provider_message_id')
  .eq('user_id', user.id)
  .eq('provider', provider)
  .in('provider_message_id', ids);

const ignoredIds = new Set(
  (ignoredEmails || []).map((item) => item.provider_message_id).filter(Boolean),
);

const unprocessedMessages = parsedMessages.filter(
  (msg) => !processedIds.has(msg.id) && !ignoredIds.has(msg.id),
);

const { autoRejectedIds, autoRejectedCount } =
  await processAutomaticRejections(unprocessedMessages);

const remainingMessages = unprocessedMessages.filter(
  (msg) => !autoRejectedIds.has(msg.id),
);

const safeAutomationMessages = remainingMessages.filter((email) => {
  const action = getEmailAction(email, emailSettings);

  return action.action === 'LINK_EXISTING' || action.action === 'CREATE_APPLICATION';
});

const needsReviewMessages = remainingMessages.filter(
  (email) => getEmailAction(email, emailSettings).action === 'REVIEW',
);

const ignoredByFilterMessages = remainingMessages.filter(
  (email) => getEmailAction(email, emailSettings).action === 'IGNORE',
);

setSafeMessages((prev) => mergeUniqueMessages(prev, safeAutomationMessages));
setReviewMessages((prev) => mergeUniqueMessages(prev, needsReviewMessages));
setIgnoredMessages((prev) => mergeUniqueMessages(prev, ignoredByFilterMessages));

await supabase.from('email_sync_sessions').insert({
  user_id: user.id,
  provider,
  scanned_count: parsedMessages.length,
  accepted_count: safeAutomationMessages.length + autoRejectedCount,
  review_count: needsReviewMessages.length,
  rejected_count: ignoredByFilterMessages.length,
  processing_time_ms: Date.now() - syncStartedAt,
  status: 'completed',
});

setMessage(
  `${provider === 'gmail' ? 'Gmail' : 'Outlook'} scan complete: ${autoRejectedCount} rejection(s) auto-updated, ${safeAutomationMessages.length} safe, ${needsReviewMessages.length} need review, ${ignoredByFilterMessages.length} ignored. Settings used: ${maxEmailsPerSync} emails, ${autoUpdateConfidenceThreshold}% confidence threshold.`,
);

if (autoRejectedCount > 0) {
  await fetchApplications();
}


};

const validateSyncCanRun = (provider: EmailProvider) => {
if (!user) {
setError('You must be signed in to sync email.');
return false;
}


if (settingsLoading) {
  setError('Email settings are still loading. Try again in a moment.');
  return false;
}

if (!emailSettings.gmail_sync_enabled) {
  setError('Email sync is disabled in Settings. Enable it before running sync.');
  return false;
}

if (provider === 'gmail' && !gmailToken) {
  setError('Please connect Gmail first.');
  return false;
}

if (provider === 'outlook' && !outlookToken) {
  setError('Please connect Outlook first.');
  return false;
}

return true;


};

const syncGmail = async () => {
if (!validateSyncCanRun('gmail')) return;


setSyncingGmail(true);
setError('');
setMessage('');

const syncStartedAt = Date.now();

try {
  const query = buildGmailQuery(emailSettings.gmail_recruitment_only);

  const listResponse = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxEmailsPerSync}`,
    { headers: { Authorization: `Bearer ${gmailToken}` } },
  );

  if (listResponse.status === 401) {
    clearToken();
    throw new Error('Gmail session expired. Please reconnect Gmail.');
  }

  if (!listResponse.ok) {
const text = await listResponse.text().catch(() => '');
throw new Error(`Failed to fetch Gmail message list. ${text}`);
}


  const listData = await listResponse.json();
  const messages = listData.messages || [];

  const fullMessages = await Promise.all(
    messages.map(async (messageItem: { id: string }) => {
      const messageResponse = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageItem.id}?format=full`,
        { headers: { Authorization: `Bearer ${gmailToken}` } },
      );

      if (messageResponse.status === 401) {
        clearToken();
        throw new Error('Gmail session expired. Please reconnect Gmail.');
      }

      if (!messageResponse.ok) {
        throw new Error('Failed to fetch Gmail message details.');
      }

      return messageResponse.json();
    }),
  );

  const parsedMessages = fullMessages.map((gmailMessage) => {
    const headers = gmailMessage.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find((header: { name: string }) => header.name === name)?.value || '';

    const emailSubject = getHeader('Subject');
    const sender = getHeader('From');
    const date = getHeader('Date');
    const fullBody = extractPlainTextFromPayload(gmailMessage.payload);
    const receivedAtMs =
      Number(gmailMessage.internalDate) || Date.parse(date) || Date.now();

    return parseEmailPayload({
      id: gmailMessage.id,
      provider: 'gmail',
      subject: emailSubject,
      sender,
      date,
      body: fullBody || gmailMessage.snippet || '',
      receivedAtMs,
    });
  });

  await processParsedMessages(parsedMessages, 'gmail', syncStartedAt);
} catch (err) {
  const errorMessage = err instanceof Error ? err.message : 'Failed to sync Gmail.';
  setError(errorMessage);

  await supabase.from('email_sync_sessions').insert({
    user_id: user?.id,
    provider: 'gmail',
    status: 'failed',
    error_message: errorMessage,
    processing_time_ms: Date.now() - syncStartedAt,
  });
} finally {
  setSyncingGmail(false);
}


};

const syncOutlook = async () => {
if (!validateSyncCanRun('outlook')) return;


setSyncingOutlook(true);
setError('');
setMessage('');

const syncStartedAt = Date.now();

try {
  let response = await fetch(buildOutlookSearchUrl(maxEmailsPerSync), {
    headers: {
      Authorization: `Bearer ${outlookToken}`,
      ConsistencyLevel: 'eventual',
    },
  });

  if (response.status === 401) {
    setOutlookToken(null);
    setOutlookConnected(false);
    throw new Error('Outlook session expired. Please reconnect Outlook.');
  }

  if (!response.ok) {
    response = await fetch(buildOutlookFallbackUrl(maxEmailsPerSync), {
      headers: { Authorization: `Bearer ${outlookToken}` },
    });
  }

  if (response.status === 401) {
    setOutlookToken(null);
    setOutlookConnected(false);
    throw new Error('Outlook session expired. Please reconnect Outlook.');
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Failed to fetch Outlook messages. ${text}`);
  }

  const data = await response.json();
  const rawMessages = data.value || [];

  const parsedMessages = rawMessages
    .sort(
      (a: any, b: any) =>
        new Date(b.receivedDateTime || 0).getTime() -
        new Date(a.receivedDateTime || 0).getTime(),
    )
    .map((messageItem: any) => {
      const emailSubject = messageItem.subject || '';
      const sender = messageItem.from?.emailAddress?.address || '';
      const date = messageItem.receivedDateTime || '';
      const body =
        messageItem.body?.contentType === 'html'
          ? stripHtml(messageItem.body?.content || '')
          : messageItem.body?.content || '';

      return parseEmailPayload({
        id: messageItem.id,
        provider: 'outlook',
        subject: emailSubject,
        sender,
        date,
        body: body || messageItem.bodyPreview || '',
        receivedAtMs: Date.parse(date) || Date.now(),
      });
    });

  await processParsedMessages(parsedMessages, 'outlook', syncStartedAt);
} catch (err) {
  const errorMessage = err instanceof Error ? err.message : 'Failed to sync Outlook.';
  setError(errorMessage);

  await supabase.from('email_sync_sessions').insert({
    user_id: user?.id,
    provider: 'outlook',
    status: 'failed',
    error_message: errorMessage,
    processing_time_ms: Date.now() - syncStartedAt,
  });
} finally {
  setSyncingOutlook(false);
}


};

const updateApplicationFromEmail = async (
applicationId: string,
status: string,
eventTitle: string,
eventDescription: string,
) => {
if (!user) return;


const matchedApp = applications.find((app) => app.id === applicationId);

if (canUpdateApplicationStatus(status) && emailSettings.ai_email_analysis_enabled) {
  const { error: updateError } = await supabase
    .from('applications')
    .update(getLifecycleUpdate(status, matchedApp))
    .eq('id', applicationId)
    .eq('user_id', user.id);

  if (updateError) throw new Error(updateError.message);
}

const { error: eventError } = await supabase.from('application_events').insert({
  user_id: user.id,
  application_id: applicationId,
  event_type: 'email_detected',
  title: eventTitle,
  description: eventDescription,
  event_date: new Date().toISOString(),
});

if (eventError) throw new Error(eventError.message);


};

const markApplicationRejected = async (email: EmailMessage) => {
if (!user || !email.matchedApplication?.applicationId) return;


const applicationId = email.matchedApplication.applicationId;
const matchedApp = applications.find((app) => app.id === applicationId);

const { error: updateError } = await supabase
  .from('applications')
  .update(getLifecycleUpdate('rejected', matchedApp))
  .eq('id', applicationId)
  .eq('user_id', user.id);

if (updateError) throw new Error(updateError.message);

await saveEmailEvent(email, applicationId);

const { error: eventError } = await supabase.from('application_events').insert({
  user_id: user.id,
  application_id: applicationId,
  event_type: 'email_review_rejected',
  title: 'Application marked rejected from email review',
  description: `Reviewed ${email.provider} email from ${email.sender}: ${email.subject}`,
  event_date: new Date().toISOString(),
});

if (eventError) throw new Error(eventError.message);


};

const handleApproveReviewEmail = (email: EmailMessage) => {
setReviewMessages((prev) => prev.filter((item) => item.id !== email.id));
setSafeMessages((prev) => mergeUniqueMessages([email], prev));
setMessage('Email approved and moved to safe queue.');
};

const handleIgnoreEmail = async (email: EmailMessage) => {
if (!user) return;


setProcessingEmailId(email.id);

try {
  await persistIgnoreEmail(email, 'Ignored by user during review');
  setReviewMessages((prev) => prev.filter((item) => item.id !== email.id));
  setIgnoredMessages((prev) => mergeUniqueMessages([email], prev));
  setMessage('Email ignored and will not appear again.');
} catch (err) {
  setError(err instanceof Error ? err.message : 'Failed to ignore email.');
} finally {
  setProcessingEmailId('');
}


};

const handleMarkRejected = async (email: EmailMessage) => {
if (!user || !email.matchedApplication?.applicationId) return;


setProcessingEmailId(email.id);

try {
  await markApplicationRejected(email);
  await persistIgnoreEmail(email, 'User marked matched application as rejected');
  setReviewMessages((prev) => prev.filter((item) => item.id !== email.id));
  setIgnoredMessages((prev) => mergeUniqueMessages([email], prev));
  setMessage(`Marked "${email.matchedApplication.roleTitle}" as rejected.`);
  await fetchApplications();
} catch (err) {
  setError(err instanceof Error ? err.message : 'Failed to mark application as rejected.');
} finally {
  setProcessingEmailId('');
}


};

const handleManualLinkEmailToApplication = async (
email: EmailMessage,
applicationId: string,
markRejected: boolean,
) => {
if (!user || !applicationId) return;

setProcessingEmailId(email.id);
setError('');
setMessage('');

try {
const selectedApplication = applications.find((app) => app.id === applicationId);


await saveEmailEvent(email, applicationId);

if (markRejected) {
  const { error: updateError } = await supabase
    .from('applications')
    .update(getLifecycleUpdate('rejected', selectedApplication))
    .eq('id', applicationId)
    .eq('user_id', user.id);

  if (updateError) throw new Error(updateError.message);

  await supabase.from('application_events').insert({
    user_id: user.id,
    application_id: applicationId,
    event_type: 'email_manual_rejection',
    title: 'Application marked rejected from email',
    description: `Manually linked ${email.provider} email from ${email.sender} and marked the application as rejected. Subject: ${email.subject}`,
    event_date: new Date().toISOString(),
  });

  setMessage(`Linked email and marked "${selectedApplication?.role_title || 'application'}" as rejected.`);
} else {
  await updateApplicationFromEmail(
    applicationId,
    email.detection.status,
    `${email.provider} email manually linked`,
    `Manually linked this ${email.provider} email to the application. Detected status: ${formatStatus(email.detection.status)}.`,
  );

  setMessage(`Linked email to "${selectedApplication?.role_title || 'application'}".`);
}

setReviewMessages((prev) => prev.filter((item) => item.id !== email.id));
setSafeMessages((prev) => prev.filter((item) => item.id !== email.id));
setIgnoredMessages((prev) => prev.filter((item) => item.id !== email.id));

setManualApplicationSelections((prev) => {
  const next = { ...prev };
  delete next[email.id];
  return next;
});

await fetchApplications();


} catch (err) {
setError(err instanceof Error ? err.message : 'Failed to manually link email.');
} finally {
setProcessingEmailId('');
}
};


const handleCreateApplicationFromEmail = async (email: EmailMessage) => {
if (!user) return;


if (getEmailAction(email, emailSettings).action !== 'CREATE_APPLICATION') {
  setError('This email is not safe enough to automatically create an application.');
  return;
}

setProcessingEmailId(email.id);
setError('');
setMessage('');

try {
  const extractedCompany = email.extractedApplication.companyName;
  const extractedRole = email.extractedApplication.roleTitle;

  const existingCompany = await supabase
    .from('companies')
    .select('id')
    .eq('user_id', user.id)
    .ilike('name', extractedCompany)
    .maybeSingle();

  if (existingCompany.error) throw new Error(existingCompany.error.message);

  let companyId: string | null = existingCompany.data?.id || null;

  if (!companyId) {
    const newCompany = await supabase
      .from('companies')
      .insert({ user_id: user.id, name: extractedCompany })
      .select('id')
      .single();

    if (newCompany.error) throw new Error(newCompany.error.message);

    companyId = newCompany.data?.id || null;
  }

  const safeStatus = getSafeStatus(email.detection.status);

  const newApplication = await supabase
    .from('applications')
    .insert({
      user_id: user.id,
      company_id: companyId,
      role_title: extractedRole,
      status: safeStatus,
      source: `${email.provider}_sync`,
      email_used: user.email || null,
      notes: `Created automatically from ${email.provider} sync.\n\nOriginal email subject:\n${email.subject}`,
      ...getLifecycleUpdate(safeStatus, null),
    })
    .select('id')
    .single();

  if (newApplication.error) throw new Error(newApplication.error.message);

  await saveEmailEvent(email, newApplication.data.id);

  await supabase.from('application_events').insert({
    user_id: user.id,
    application_id: newApplication.data.id,
    event_type: 'email_import',
    title: `Application created from ${email.provider}`,
    description: `Created from ${email.provider} email detected as ${email.detection.category}.`,
    event_date: new Date().toISOString(),
  });

  setMessage(`Created application for ${extractedRole}.`);
  setSafeMessages((prev) => prev.filter((msg) => msg.id !== email.id));
  await fetchApplications();
} catch (err) {
  setError(err instanceof Error ? err.message : 'Failed to create application from email.');
} finally {
  setProcessingEmailId('');
}


};

const handleLinkEmailToExistingApplication = async (email: EmailMessage) => {
if (!user || !email.matchedApplication) return;


if (getEmailAction(email, emailSettings).action !== 'LINK_EXISTING') {
  setError('This email is not safe enough for automatic linking. Review it manually first.');
  return;
}

setProcessingEmailId(email.id);
setError('');
setMessage('');

try {
  const applicationId = email.matchedApplication.applicationId;

  await saveEmailEvent(email, applicationId);

  await updateApplicationFromEmail(
    applicationId,
    email.detection.status,
    `${email.provider} email linked: ${email.detection.category}`,
    `JTracker linked a ${email.provider} email to this application. Match score: ${email.matchedApplication.score}%.`,
  );

  setMessage(`Linked ${email.provider} email to ${email.matchedApplication.roleTitle}.`);
  setSafeMessages((prev) => prev.filter((msg) => msg.id !== email.id));
  await fetchApplications();
} catch (err) {
  setError(err instanceof Error ? err.message : 'Failed to link email to existing application.');
} finally {
  setProcessingEmailId('');
}


};

const handleDetectStatus = () => {
setError('');
setMessage('');
setResult(detectEmailStatus(subject, snippet));
};

const handleApplyDetection = async () => {
if (!user || !result || !selectedApplicationId) return;


if (!canUpdateApplicationStatus(result.status)) {
  setError('This detected result cannot update the application status directly.');
  return;
}

setSaving(true);
setError('');
setMessage('');

try {
  const selectedApplication = applications.find(
    (app) => app.id === selectedApplicationId,
  );

  await supabase.from('email_events').insert({
    user_id: user.id,
    application_id: selectedApplicationId,
    provider: 'manual',
    provider_message_id: null,
    sender: 'Manual Email Detector',
    subject: subject || null,
    snippet: snippet || null,
    detected_status: result.status,
    received_at: new Date().toISOString(),
  });

  await updateApplicationFromEmail(
    selectedApplicationId,
    result.status,
    `Email detected: ${result.category}`,
    `JTracker detected "${result.category}" and updated ${
      selectedApplication?.role_title || 'this application'
    } to ${formatStatus(result.status)}.`,
  );

  setMessage('Application updated from email detection.');
  await fetchApplications();
} catch (err) {
  setError(err instanceof Error ? err.message : 'Failed to apply detection.');
}

setSaving(false);


};

return ( <div> <h2 className="text-3xl font-bold mb-2">Email Sync</h2>


  <p className="text-slate-500 mb-8">
    Sync recruitment emails from Gmail and Outlook, safely link them to applications,
    automatically archive high-confidence rejections, and review uncertain emails before updating statuses.
  </p>

  {error && <AlertBox type="error" message={error} onClose={() => setError('')} />}
  {message && <AlertBox type="success" message={message} onClose={() => setMessage('')} />}

  <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 mb-8">
    <div className="flex flex-col lg:flex-row lg:items-center gap-4">
      <div className="flex-1">
        <h3 className="font-semibold text-slate-900">Settings currently controlling this page</h3>

        <p className="text-sm text-slate-500 mt-1">
          These values are loaded from Settings → Email Sync.
        </p>
      </div>

      <button
        type="button"
        onClick={fetchEmailSettings}
        disabled={settingsLoading}
        className="border border-slate-200 text-slate-600 px-4 py-2 rounded-xl text-sm hover:bg-slate-50 disabled:opacity-50"
      >
        {settingsLoading ? 'Loading...' : 'Refresh Settings'}
      </button>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mt-5">
      <SettingsPill
        label="Sync"
        value={emailSettings.gmail_sync_enabled ? 'Enabled' : 'Disabled'}
        tone={emailSettings.gmail_sync_enabled ? 'success' : 'danger'}
      />

      <SettingsPill
        label="Emails per sync"
        value={String(maxEmailsPerSync)}
        tone="neutral"
      />

      <SettingsPill
        label="Recruitment-only"
        value={emailSettings.gmail_recruitment_only ? 'On' : 'Off'}
        tone={emailSettings.gmail_recruitment_only ? 'success' : 'warning'}
      />

      <SettingsPill
        label="AI analysis"
        value={emailSettings.ai_email_analysis_enabled ? 'On' : 'Off'}
        tone={emailSettings.ai_email_analysis_enabled ? 'success' : 'warning'}
      />

      <SettingsPill
        label="Auto threshold"
        value={`${autoUpdateConfidenceThreshold}%`}
        tone="neutral"
      />
    </div>
  </div>

  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-8">
    <ProviderCard
      title="Gmail"
      description="Connect Gmail to process recruitment-related emails only."
      connected={gmailConnected}
      syncing={syncingGmail}
      disabled={emailSyncDisabled || anyProviderSyncing}
      sessionNote={gmailConnected ? `Session active · expires in ${minutesRemaining}m` : undefined}
      onConnect={() => loginGmail()}
      onSync={syncGmail}
      onDisconnect={() => {
clearToken();
setSafeMessages([]);
setReviewMessages([]);
setIgnoredMessages([]);
setError('');
setMessage('Gmail disconnected. Reconnect Gmail and approve Gmail read access.');
}}

       
    />

    <ProviderCard
      title="Outlook"
      description="Connect Outlook or Microsoft 365 to process recruitment-related emails only."
      connected={outlookConnected}
      syncing={syncingOutlook}
      disabled={emailSyncDisabled || anyProviderSyncing}
      onConnect={connectOutlook}
      onSync={syncOutlook}
      onDisconnect={disconnectOutlook}
    />
  </div>

  <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-8">
    <FeatureCard
      icon={<ShieldCheck size={28} />}
      title="Settings-Aware Sync"
      description="Sync respects your saved Email Sync settings."
    />

    <FeatureCard
      icon={<Link2 size={28} />}
      title="Safe Linking"
      description="Only strong existing application matches are auto-linkable."
    />

    <FeatureCard
      icon={<Sparkles size={28} />}
      title="Auto Rejection Updates"
      description="High-confidence rejection emails update and archive matched applications."
    />

    <FeatureCard
      icon={<SearchCheck size={28} />}
      title="Explainable Decisions"
      description="Every email shows why it was accepted, reviewed, ignored, or updated."
    />
  </div>

  {safeMessages.length > 0 && (
    <EmailSection
      title="Safe Automation Queue"
      description="Emails safe enough to link or create automatically."
      tone="accepted"
      emails={safeMessages}
      emailSettings={emailSettings}
      processingEmailId={processingEmailId}
      applications={applications}
      manualApplicationSelections={manualApplicationSelections}
      setManualApplicationSelection={(emailId, applicationId) =>
        setManualApplicationSelections((prev) => ({ ...prev, [emailId]: applicationId }))
      }
      onManualLink={handleManualLinkEmailToApplication}
      mode="safe"
      onApprove={handleApproveReviewEmail}
      onIgnore={handleIgnoreEmail}
      onMarkRejected={handleMarkRejected}
      onCreate={handleCreateApplicationFromEmail}
      onLink={handleLinkEmailToExistingApplication}
    />
  )}

  {reviewMessages.length > 0 && (
    <EmailSection
      title="Needs Review"
      description='Emails with useful signals but not enough certainty. Use "Ignore Email" for noise or "Mark Rejected" only when the matched application should be rejected.'
      tone="review"
      emails={reviewMessages}
      emailSettings={emailSettings}
      processingEmailId={processingEmailId}
      applications={applications}
      manualApplicationSelections={manualApplicationSelections}
      setManualApplicationSelection={(emailId, applicationId) =>
        setManualApplicationSelections((prev) => ({ ...prev, [emailId]: applicationId }))
      }
      onManualLink={handleManualLinkEmailToApplication}
      mode="review"
      onApprove={handleApproveReviewEmail}
      onIgnore={handleIgnoreEmail}
      onMarkRejected={handleMarkRejected}
      onCreate={handleCreateApplicationFromEmail}
      onLink={handleLinkEmailToExistingApplication}
    />
  )}

  {ignoredMessages.length > 0 && (
    <EmailSection
      title="Ignored Emails"
      description="Emails rejected by the intelligence layer or ignored by you."
      tone="ignored"
      emails={ignoredMessages}
      emailSettings={emailSettings}
      processingEmailId={processingEmailId}
      applications={applications}
      manualApplicationSelections={manualApplicationSelections}
      setManualApplicationSelection={(emailId, applicationId) =>
        setManualApplicationSelections((prev) => ({ ...prev, [emailId]: applicationId }))
      }
      onManualLink={handleManualLinkEmailToApplication}
      mode="ignored"
      onApprove={handleApproveReviewEmail}
      onIgnore={handleIgnoreEmail}
      onMarkRejected={handleMarkRejected}
      onCreate={handleCreateApplicationFromEmail}
      onLink={handleLinkEmailToExistingApplication}
    />
  )}

  <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8 max-w-4xl">
    <div className="flex items-center gap-3 mb-4">
      <SearchCheck size={24} className="text-slate-600" />
      <h3 className="text-xl font-semibold">Manual Email Status Detector</h3>
    </div>

    <p className="text-slate-500 mb-6">
      Test the email classification engine manually.
    </p>

    <div className="space-y-4">
      <input
        value={subject}
        onChange={(event) => setSubject(event.target.value)}
        placeholder="Email subject"
        className={inputCls}
      />

      <textarea
        value={snippet}
        onChange={(event) => setSnippet(event.target.value)}
        placeholder="Email snippet/body preview..."
        className={`${inputCls} min-h-32`}
      />

      <button
        onClick={handleDetectStatus}
        className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm"
      >
        Detect Status
      </button>
    </div>

    {result && (
      <div className="mt-6 bg-slate-50 border border-slate-200 rounded-xl p-5">
        <p className="text-sm text-slate-500">Detected Category</p>

        <div className="mt-2">
          <span className={`px-3 py-1 rounded-full text-sm font-semibold ${categoryStyles[result.category] || categoryStyles.Unknown}`}>
            {result.category}
          </span>
        </div>

        <p className="text-sm text-slate-500 mt-4">Database Status</p>
        <p className="text-lg font-semibold mt-1">{formatStatus(result.status)}</p>

        <p className="text-sm text-slate-500 mt-4">Reason</p>
        <p className="text-sm text-slate-700 mt-1">{result.reason}</p>

        <div className="mt-6 border-t border-slate-200 pt-5">
          <h4 className="font-semibold mb-2">Apply Detection to Application</h4>

          <div className="flex flex-col md:flex-row gap-3">
            <select
              value={selectedApplicationId}
              onChange={(event) => setSelectedApplicationId(event.target.value)}
              className={inputCls}
            >
              <option value="">Select application</option>
              {applications.map((app) => (
                <option key={app.id} value={app.id}>
                  {app.companies?.name || 'Unknown'} — {app.role_title} ({app.status})
                </option>
              ))}
            </select>

            <button
              onClick={handleApplyDetection}
              disabled={saving || !selectedApplicationId}
              className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50"
            >
              {saving ? 'Applying...' : 'Apply Update'}
            </button>
          </div>
        </div>
      </div>
    )}
  </div>
</div>


);
};

const AlertBox = ({
type,
message,
onClose,
}: {
type: 'error' | 'success';
message: string;
onClose: () => void;
}) => (

  <div
    className={`rounded-xl p-4 mb-6 flex items-start gap-3 border ${
      type === 'error'
        ? 'bg-red-50 border-red-200 text-red-700'
        : 'bg-emerald-50 border-emerald-200 text-emerald-700'
    }`}
  >
    {type === 'error' ? (
      <AlertTriangle size={16} className="shrink-0 mt-0.5" />
    ) : (
      <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
    )}


<span className="text-sm flex-1">{message}</span>

<button onClick={onClose} className="opacity-70 hover:opacity-100">
  <X size={16} />
</button>


  </div>
);

const SettingsPill = ({
label,
value,
tone,
}: {
label: string;
value: string;
tone: 'success' | 'warning' | 'danger' | 'neutral';
}) => {
const style = {
success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
warning: 'bg-amber-50 text-amber-700 border-amber-200',
danger: 'bg-red-50 text-red-700 border-red-200',
neutral: 'bg-slate-50 text-slate-700 border-slate-200',
}[tone];

return (
<div className={`rounded-xl border px-3 py-3 ${style}`}> <p className="text-[11px] uppercase tracking-wide font-semibold opacity-70">
{label} </p>


  <p className="text-sm font-semibold mt-1">
    {value}
  </p>
</div>


);
};

const ProviderCard = ({
title,
description,
connected,
syncing,
disabled,
sessionNote,
onConnect,
onSync,
onDisconnect,
}: {
title: string;
description: string;
connected: boolean;
syncing: boolean;
disabled: boolean;
sessionNote?: string;
onConnect: () => void;
onSync: () => void;
onDisconnect: () => void;
}) => (

  <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8">
    <div className="flex items-start gap-3 mb-6">
      <Mail size={24} className="text-slate-600 mt-1 shrink-0" />


  <div>
    <h3 className="text-2xl font-bold mb-2">{title} Connection</h3>
    <p className="text-slate-500">{description}</p>

    {sessionNote && (
      <p className="text-xs text-slate-400 mt-2 flex items-center gap-1">
        <Clock size={12} />
        {sessionNote}
      </p>
    )}
  </div>
</div>

<div className="flex flex-col sm:flex-row gap-3">
  {!connected ? (
    <button
      onClick={onConnect}
      className="bg-slate-900 text-white px-5 py-3 rounded-xl flex items-center justify-center gap-3"
    >
      <MailCheck size={20} />
      Connect {title}
    </button>
  ) : (
    <>
      <div className="bg-green-100 text-green-700 px-4 py-3 rounded-xl font-medium text-center">
        {title} Connected
      </div>

      <button
        onClick={onSync}
        disabled={disabled || syncing}
        className="bg-slate-900 text-white px-5 py-3 rounded-xl disabled:opacity-50"
      >
        {syncing ? 'Syncing...' : `Sync ${title} Emails`}
      </button>

      <button
        onClick={onDisconnect}
        className="border border-slate-200 text-slate-500 px-4 py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-slate-50"
      >
        <LogOut size={16} />
        Disconnect
      </button>
    </>
  )}
</div>


  </div>
);

const FeatureCard = ({
icon,
title,
description,
}: {
icon: React.ReactNode;
title: string;
description: string;
}) => (

  <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
    <div className="text-slate-700 mb-4">{icon}</div>
    <h3 className="font-semibold mb-2">{title}</h3>
    <p className="text-sm text-slate-500">{description}</p>
  </div>
);

const EmailSection = ({
title,
description,
tone,
emails,
emailSettings,
processingEmailId,
applications,
manualApplicationSelections,
setManualApplicationSelection,
onManualLink,
mode,
onApprove,
onIgnore,
onMarkRejected,
onCreate,
onLink,
}: {
title: string;
description: string;
tone: 'review' | 'accepted' | 'ignored';
emails: EmailMessage[];
emailSettings: EmailAutomationSettings;
processingEmailId: string;
applications: ApplicationOption[];
manualApplicationSelections: Record<string, string>;
setManualApplicationSelection: (emailId: string, applicationId: string) => void;
onManualLink: (email: EmailMessage, applicationId: string, markRejected: boolean) => void;
mode: 'safe' | 'review' | 'ignored';
onApprove: (email: EmailMessage) => void;
onIgnore: (email: EmailMessage) => void;
onMarkRejected: (email: EmailMessage) => void;
onCreate: (email: EmailMessage) => void;
onLink: (email: EmailMessage) => void;
}) => (

  <div
    className={`border rounded-2xl shadow-sm p-8 mb-8 ${
      tone === 'review'
        ? 'bg-amber-50 border-amber-200'
        : tone === 'ignored'
          ? 'bg-zinc-50 border-zinc-200'
          : 'bg-white border-slate-200'
    }`}
  >
    <div className="flex items-center gap-3 mb-6">
      {tone === 'review' ? (
        <AlertTriangle size={24} className="text-amber-700" />
      ) : tone === 'ignored' ? (
        <Eye size={24} className="text-zinc-700" />
      ) : (
        <SearchCheck size={24} className="text-slate-700" />
      )}


  <div>
    <h3 className="text-xl font-semibold">{title}</h3>
    <p className="text-sm text-slate-500">{description}</p>
  </div>
</div>

<EmailCardList
  emails={emails}
  emailSettings={emailSettings}
  processingEmailId={processingEmailId}
  applications={applications}
  manualApplicationSelections={manualApplicationSelections}
  setManualApplicationSelection={setManualApplicationSelection}
  onManualLink={onManualLink}
  mode={mode}
  onApprove={onApprove}
  onIgnore={onIgnore}
  onMarkRejected={onMarkRejected}
  onCreate={onCreate}
  onLink={onLink}
/>


  </div>
);

const EmailCardList = ({
emails,
emailSettings,
processingEmailId,
applications,
manualApplicationSelections,
setManualApplicationSelection,
onManualLink,
mode,
onApprove,
onIgnore,
onMarkRejected,
onCreate,
onLink,
}: {
emails: EmailMessage[];
emailSettings: EmailAutomationSettings;
processingEmailId: string;
applications: ApplicationOption[];
manualApplicationSelections: Record<string, string>;
setManualApplicationSelection: (emailId: string, applicationId: string) => void;
onManualLink: (email: EmailMessage, applicationId: string, markRejected: boolean) => void;
mode: 'safe' | 'review' | 'ignored';
onApprove: (email: EmailMessage) => void;
onIgnore: (email: EmailMessage) => void;
onMarkRejected: (email: EmailMessage) => void;
onCreate: (email: EmailMessage) => void;
onLink: (email: EmailMessage) => void;
}) => (

  <div className="space-y-4">
    {emails.map((email) => {
      const action = getEmailAction(email, emailSettings);
      const isProcessing = processingEmailId === email.id;


  return (
    <div key={`${email.provider}:${email.id}`} className="bg-white border border-slate-200 rounded-2xl p-5">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-semibold">{email.subject || 'No subject'}</h4>

            <span
              className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                email.provider === 'gmail'
                  ? 'bg-red-100 text-red-700'
                  : email.provider === 'outlook'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-slate-100 text-slate-700'
              }`}
            >
              {email.provider === 'gmail'
                ? 'Gmail'
                : email.provider === 'outlook'
                  ? 'Outlook'
                  : 'Manual'}
            </span>
          </div>

          <p className="text-sm text-slate-500 mt-1">
            From: {email.sender || 'Unknown'}
          </p>
        </div>

        <span className="text-xs text-slate-500">{email.date || 'No date'}</span>
      </div>

      <p className="text-sm text-slate-600 mt-4">
        {email.snippet || 'No snippet available.'}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${categoryStyles[email.detection.category] || categoryStyles.Unknown}`}>
          {email.detection.category}
        </span>

        <span className="bg-slate-100 text-slate-700 px-3 py-1 rounded-full text-xs">
          Status: {formatStatus(email.detection.status)}
        </span>

        <span className="bg-slate-100 text-slate-700 px-3 py-1 rounded-full text-xs">
          Confidence: {email.detection.confidence}%
        </span>

        <span className="bg-slate-100 text-slate-700 px-3 py-1 rounded-full text-xs">
          Job relevance: {email.filterResult.jobRelevanceScore}%
        </span>

        <span className="bg-slate-100 text-slate-700 px-3 py-1 rounded-full text-xs">
          Extraction: {email.extractedApplication.confidence}%
        </span>
      </div>

      <ActionBox action={action} />

      <div className="mt-5 bg-slate-50 border border-slate-200 rounded-xl p-4">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
          Extracted Application
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <MiniInfo
            label="Role"
            value={`${email.extractedApplication.roleTitle} (${email.extractedApplication.roleConfidence}%)`}
          />

          <MiniInfo
            label="Company"
            value={`${email.extractedApplication.companyName} (${email.extractedApplication.companyConfidence}%)`}
          />
        </div>

        <p className="text-xs text-slate-500 mt-3">
          {email.extractedApplication.reason}
        </p>
      </div>

      {email.matchedApplication && (
        <div className="mt-4 bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <p className="text-sm text-emerald-700 font-medium">
            Existing application match found
          </p>

          <p className="font-semibold mt-2">
            {email.matchedApplication.roleTitle}
          </p>

          <p className="text-sm text-slate-600">
            {email.matchedApplication.companyName}
          </p>

          <p className="text-xs text-slate-500 mt-2">
            Match score: {email.matchedApplication.score}% · {email.matchedApplication.strength} · {email.matchedApplication.reason}
          </p>
        </div>
      )}

      {mode === 'review' && applications.length > 0 && (
        <div className="mt-5 bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Manual Link
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_auto] gap-3">
            <select
              value={manualApplicationSelections[email.id] || ''}
              onChange={(event) => setManualApplicationSelection(email.id, event.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="">Select existing application...</option>
              {applications.map((app) => (
                <option key={app.id} value={app.id}>
                  {app.role_title} · {app.companies?.name || 'Unknown company'} · {formatStatus(app.status)}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => onManualLink(email, manualApplicationSelections[email.id] || '', false)}
              disabled={isProcessing || !manualApplicationSelections[email.id]}
              className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50"
            >
              Link Only
            </button>

            <button
              type="button"
              onClick={() => onManualLink(email, manualApplicationSelections[email.id] || '', true)}
              disabled={isProcessing || !manualApplicationSelections[email.id]}
              className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50"
            >
              Link + Reject
            </button>
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-col sm:flex-row gap-3">
        {mode === 'review' && (
          <>
            <button
              onClick={() => onApprove(email)}
              className="bg-amber-600 text-white px-4 py-2 rounded-lg text-sm"
            >
              Approve to Safe Queue
            </button>

            {email.matchedApplication && (
              <button
                onClick={() => onMarkRejected(email)}
                disabled={isProcessing}
                className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50"
              >
                {isProcessing ? 'Updating...' : 'Mark Rejected'}
              </button>
            )}

            <button
              onClick={() => onIgnore(email)}
              disabled={isProcessing}
              className="border border-slate-300 text-slate-600 px-4 py-2 rounded-lg text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              Ignore Email
            </button>
          </>
        )}

        {mode === 'safe' && action.action === 'LINK_EXISTING' && (
          <button
            onClick={() => onLink(email)}
            disabled={isProcessing}
            className="bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {isProcessing ? 'Linking...' : 'Link + Update Application'}
          </button>
        )}

        {mode === 'safe' && action.action === 'CREATE_APPLICATION' && (
          <button
            onClick={() => onCreate(email)}
            disabled={isProcessing}
            className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {isProcessing ? 'Creating...' : 'Create Application'}
          </button>
        )}
      </div>

      <div className="mt-4 text-xs text-slate-400">
        Filter Result: {email.filterResult.reason}
      </div>
    </div>
  );
})}


  </div>
);

const ActionBox = ({ action }: { action: EmailAction }) => {
const style = {
danger: 'bg-red-50 border-red-200 text-red-700',
warning: 'bg-amber-50 border-amber-200 text-amber-700',
success: 'bg-emerald-50 border-emerald-200 text-emerald-700',
neutral: 'bg-slate-50 border-slate-200 text-slate-700',
}[action.tone];

return (
<div className={`mt-4 border rounded-xl p-4 ${style}`}> <p className="text-xs font-semibold uppercase tracking-wide opacity-80">
Recommended Action </p>


  <p className="font-semibold mt-1">{action.label}</p>
  <p className="text-sm mt-1 opacity-90">{action.reason}</p>
</div>


);
};

const MiniInfo = ({ label, value }: { label: string; value: string }) => (

  <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
    <p className="text-xs text-slate-400">{label}</p>
    <p className="text-sm font-medium text-slate-700 truncate">{value}</p>
  </div>
);
