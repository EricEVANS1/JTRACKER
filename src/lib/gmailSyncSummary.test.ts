import { describe, expect, it } from 'vitest';

import {
  buildGmailSyncSummary,
  getLastRunBreakdown,
  type SyncSessionRecord,
} from './gmailSyncSummary';

const session = (overrides: Partial<SyncSessionRecord>): SyncSessionRecord => ({
  id: 's',
  status: 'completed',
  scanned_count: 0,
  accepted_count: 0,
  review_count: 0,
  rejected_count: 0,
  processing_time_ms: 1200,
  error_message: null,
  created_at: '2026-10-17T10:00:00.000Z',
  ...overrides,
});

describe('getLastRunBreakdown', () => {
  it('derives emails skipped as already processed from the stored counts', () => {
    expect(getLastRunBreakdown(session({ scanned_count: 50, accepted_count: 4, review_count: 3, rejected_count: 30 }))).toEqual({
      scanned: 50,
      alreadyProcessed: 13,
      actionable: 4,
      needsReview: 3,
      filteredOut: 30,
    });
  });

  it('never goes negative on inconsistent rows', () => {
    expect(getLastRunBreakdown(session({ scanned_count: 2, accepted_count: 5, review_count: null })).alreadyProcessed).toBe(0);
  });
});

describe('buildGmailSyncSummary', () => {
  it('separates the last attempt, last success and a current failure', () => {
    const summary = buildGmailSyncSummary({
      sessions: [
        session({ id: 'ok', created_at: '2026-10-16T10:00:00.000Z', scanned_count: 10, accepted_count: 2 }),
        session({ id: 'failed', status: 'failed', error_message: 'Gmail session expired.', created_at: '2026-10-17T10:00:00.000Z' }),
      ],
      emailEvents: [],
      importedApplicationIds: [],
      dismissedCount: 0,
    });

    expect(summary.lastAttempt?.id).toBe('failed');
    expect(summary.lastFailure?.error_message).toBe('Gmail session expired.');
    expect(summary.lastSuccess?.id).toBe('ok');
    expect(summary.lastRun?.alreadyProcessed).toBe(8);
  });

  it('has no failure once a later sync succeeds', () => {
    const summary = buildGmailSyncSummary({
      sessions: [
        session({ id: 'failed', status: 'failed', created_at: '2026-10-16T10:00:00.000Z' }),
        session({ id: 'ok', created_at: '2026-10-17T10:00:00.000Z' }),
      ],
      emailEvents: [],
      importedApplicationIds: [],
      dismissedCount: 0,
    });

    expect(summary.lastFailure).toBeNull();
    expect(summary.lastSuccess?.id).toBe('ok');
  });

  it('counts emails separately from the unique applications they updated', () => {
    const summary = buildGmailSyncSummary({
      sessions: [],
      emailEvents: [
        { id: '1', application_id: 'a', detected_status: 'confirmation_received' },
        { id: '2', application_id: 'a', detected_status: 'interview' },
        { id: '3', application_id: 'a', detected_status: 'final_interview' },
        { id: '4', application_id: 'b', detected_status: 'rejected' },
        { id: '5', application_id: 'new', detected_status: 'applied' },
        { id: '6', application_id: null, detected_status: 'unknown' },
        { id: '7', application_id: 'c', detected_status: 'assessment' },
        { id: '8', application_id: 'c', detected_status: 'offer' },
      ],
      importedApplicationIds: ['new', null],
      dismissedCount: 3,
    });

    expect(summary).toMatchObject({
      lastSuccess: null,
      lastRun: null,
      emailsProcessed: 8,
      emailsNotLinked: 1,
      applicationsUpdated: 4,
      newApplications: 1,
      existingApplicationsUpdated: 3,
      detected: { interviews: 2, assessments: 1, offers: 1, rejections: 1 },
      dismissed: 3,
    });
  });
});
