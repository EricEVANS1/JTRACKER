// Builds the dashboard's Gmail Sync summary from what the Email Sync page
// actually stores: one email_sync_sessions row per sync run, one email_events
// row per email you handled, ignored_email_events for dismissed emails, and an
// application_events "email_import" row for each application created from mail.

export interface SyncSessionRecord {
  id: string;
  status: string | null;
  scanned_count: number | null;
  accepted_count: number | null;
  review_count: number | null;
  rejected_count: number | null;
  processing_time_ms: number | null;
  error_message: string | null;
  created_at: string;
}

export interface EmailEventRecord {
  id: string;
  application_id: string | null;
  detected_status: string | null;
}

export interface LastRunBreakdown {
  scanned: number;
  // Already handled in an earlier sync (or dismissed), so skipped this time.
  alreadyProcessed: number;
  // Matched to an application or ready to create one, including rejections
  // that were applied automatically.
  actionable: number;
  needsReview: number;
  // Not recruitment-related, filtered out by the email filter.
  filteredOut: number;
}

export interface GmailSyncSummary {
  lastAttempt: SyncSessionRecord | null;
  lastSuccess: SyncSessionRecord | null;
  // Set when the most recent attempt failed.
  lastFailure: SyncSessionRecord | null;
  lastRun: LastRunBreakdown | null;
  emailsProcessed: number;
  emailsNotLinked: number;
  applicationsUpdated: number;
  newApplications: number;
  existingApplicationsUpdated: number;
  detected: {
    interviews: number;
    assessments: number;
    offers: number;
    rejections: number;
  };
  dismissed: number;
}

const count = (value: number | null | undefined) => Math.max(0, value || 0);

export const getLastRunBreakdown = (session: SyncSessionRecord): LastRunBreakdown => {
  const scanned = count(session.scanned_count);
  const actionable = count(session.accepted_count);
  const needsReview = count(session.review_count);
  const filteredOut = count(session.rejected_count);

  return {
    scanned,
    // Every scanned email lands in exactly one bucket, so the rest were skipped
    // as already processed.
    alreadyProcessed: Math.max(0, scanned - actionable - needsReview - filteredOut),
    actionable,
    needsReview,
    filteredOut,
  };
};

export const buildGmailSyncSummary = ({
  sessions,
  emailEvents,
  importedApplicationIds,
  dismissedCount,
}: {
  // Gmail sessions, any order.
  sessions: SyncSessionRecord[];
  // Gmail email_events rows.
  emailEvents: EmailEventRecord[];
  // Applications created from Gmail emails.
  importedApplicationIds: (string | null)[];
  dismissedCount: number;
}): GmailSyncSummary => {
  const ordered = [...sessions].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  const lastAttempt = ordered[0] || null;
  const lastSuccess = ordered.find((session) => session.status === 'completed') || null;

  const linked = emailEvents.filter((event) => event.application_id);
  const updated = new Set(linked.map((event) => event.application_id as string));
  const created = new Set(importedApplicationIds.filter((id): id is string => Boolean(id)));
  const createdAndLinked = [...updated].filter((id) => created.has(id)).length;

  const detectedCount = (statuses: string[]) =>
    emailEvents.filter((event) => statuses.includes(event.detected_status || '')).length;

  return {
    lastAttempt,
    lastSuccess,
    lastFailure: lastAttempt?.status === 'failed' ? lastAttempt : null,
    lastRun: lastSuccess ? getLastRunBreakdown(lastSuccess) : null,
    emailsProcessed: emailEvents.length,
    emailsNotLinked: emailEvents.length - linked.length,
    applicationsUpdated: updated.size,
    newApplications: createdAndLinked,
    existingApplicationsUpdated: updated.size - createdAndLinked,
    detected: {
      interviews: detectedCount(['interview', 'final_interview']),
      assessments: detectedCount(['assessment']),
      offers: detectedCount(['offer']),
      rejections: detectedCount(['rejected']),
    },
    dismissed: dismissedCount,
  };
};
