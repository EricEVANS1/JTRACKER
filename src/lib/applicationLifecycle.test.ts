import { describe, expect, it } from 'vitest';

import {
  buildOfferDecision,
  buildStatusUpdate,
  getDaysToResponse,
  getDaysWithoutReply,
  getFollowUpBucket,
  getFurthestActiveStatus,
  getResponseDate,
  getUpcomingInterviewDate,
  hasReachedInterview,
  hasReachedOffer,
  hasReachedStage,
  hasResponse,
  isActive,
  isAwaitingFinalResponse,
  isOfferAwaitingDecision,
  type LifecycleRecord,
} from './applicationLifecycle';

const NOW = '2026-10-17T10:00:00.000Z';
const EARLIER = '2026-10-01T10:00:00.000Z';

const app = (overrides: Partial<LifecycleRecord>): LifecycleRecord => ({
  status: 'applied',
  archived: false,
  date_applied: '2026-09-20T10:00:00.000Z',
  ...overrides,
});

describe('responses', () => {
  it('does not count ghosted or withdrawn as replies', () => {
    expect(hasResponse(app({ status: 'ghosted' }))).toBe(false);
    expect(hasResponse(app({ status: 'withdrawn' }))).toBe(false);
  });

  it('ignores the automatic response stamp written when ghosting', () => {
    const ghosted = app({ status: 'ghosted', ghosted_at: EARLIER, response_received_at: EARLIER });

    expect(getResponseDate(ghosted)).toBeNull();
    expect(hasResponse(ghosted)).toBe(false);
  });

  it('keeps a genuine reply that came before ghosting', () => {
    const ghosted = app({
      status: 'ghosted',
      response_received_at: '2026-09-25T10:00:00.000Z',
      ghosted_at: EARLIER,
    });

    expect(hasResponse(ghosted)).toBe(true);
    expect(getDaysToResponse(ghosted)).toBe(5);
  });

  it('uses the earliest reply evidence for time to response', () => {
    const interviewed = app({
      status: 'interview',
      response_received_at: EARLIER,
      assessment_received_at: '2026-09-27T10:00:00.000Z',
    });

    expect(getDaysToResponse(interviewed)).toBe(7);
  });

  it('keeps stages nested: offer implies interview implies response', () => {
    const directOffer = app({ status: 'withdrawn', offer_received_at: EARLIER });

    expect(hasReachedOffer(directOffer)).toBe(true);
    expect(hasReachedInterview(directOffer)).toBe(true);
    expect(hasResponse(directOffer)).toBe(true);
  });
});

describe('activity', () => {
  it('treats archived and closed applications as inactive', () => {
    expect(isActive(app({ status: 'applied' }))).toBe(true);
    expect(isActive(app({ status: 'wishlist' }))).toBe(true);
    expect(isActive(app({ status: 'applied', archived: true }))).toBe(false);
    expect(isActive(app({ status: 'ghosted' }))).toBe(false);
    expect(isActive(app({ status: 'offer' }))).toBe(false);
  });

  it('only counts interview stages as awaiting a final response', () => {
    expect(isAwaitingFinalResponse(app({ status: 'interview', final_response_pending: true }))).toBe(true);
    expect(isAwaitingFinalResponse(app({ status: 'final_interview', final_response_pending: null }))).toBe(true);
    // A stale flag left on an earlier stage is ignored.
    expect(isAwaitingFinalResponse(app({ status: 'applied', final_response_pending: true }))).toBe(false);
    expect(isAwaitingFinalResponse(app({ status: 'interview', final_response_pending: false }))).toBe(false);
    expect(isAwaitingFinalResponse(app({ status: 'interview', archived: true }))).toBe(false);
  });
});

describe('getDaysWithoutReply', () => {
  const now = new Date('2026-10-17T10:00:00.000Z');

  it('counts days since applying while still waiting on a real reply', () => {
    expect(getDaysWithoutReply(app({ status: 'applied', date_applied: EARLIER }), now)).toBe(16);
    // An automated confirmation isn't a reply.
    expect(getDaysWithoutReply(app({ status: 'confirmation_received', date_applied: EARLIER }), now)).toBe(16);
  });

  it('is null once there is a reply or the application is closed', () => {
    expect(getDaysWithoutReply(app({ status: 'applied', response_received_at: EARLIER }), now)).toBeNull();
    expect(getDaysWithoutReply(app({ status: 'assessment' }), now)).toBeNull();
    expect(getDaysWithoutReply(app({ status: 'ghosted' }), now)).toBeNull();
    expect(getDaysWithoutReply(app({ status: 'applied', archived: true }), now)).toBeNull();
  });
});

describe('follow-up buckets', () => {
  const now = new Date(2026, 9, 17, 15, 0);
  const on = (dayOffset: number) => new Date(2026, 9, 17 + dayOffset, 9, 0).toISOString();

  it('splits by day relative to today with a 7-day upcoming window', () => {
    expect(getFollowUpBucket(app({ follow_up_date: on(-1) }), now)).toBe('overdue');
    expect(getFollowUpBucket(app({ follow_up_date: on(0) }), now)).toBe('today');
    expect(getFollowUpBucket(app({ follow_up_date: on(1) }), now)).toBe('upcoming');
    expect(getFollowUpBucket(app({ follow_up_date: on(7) }), now)).toBe('upcoming');
    expect(getFollowUpBucket(app({ follow_up_date: on(8) }), now)).toBe('later');
  });

  it('ignores closed, archived and undated applications', () => {
    expect(getFollowUpBucket(app({ status: 'ghosted', follow_up_date: on(-1) }), now)).toBeNull();
    expect(getFollowUpBucket(app({ archived: true, follow_up_date: on(-1) }), now)).toBeNull();
    expect(getFollowUpBucket(app({ follow_up_date: null }), now)).toBeNull();
    expect(getFollowUpBucket(app({ follow_up_date: 'not a date' }), now)).toBeNull();
  });
});

describe('buildStatusUpdate', () => {
  it('always archives rejected applications', () => {
    const update = buildStatusUpdate('rejected', app({ status: 'applied' }), NOW);

    expect(update).toMatchObject({
      status: 'rejected',
      archived: true,
      archived_at: NOW,
      rejected_at: NOW,
      response_received_at: NOW,
      outcome_reason: 'rejected_before_interview',
      final_response_pending: false,
    });
  });

  it('records rejection after interview', () => {
    const update = buildStatusUpdate(
      'rejected',
      app({ status: 'interview', interview_started_at: EARLIER, interview_count: 2 }),
      NOW
    );

    expect(update).toMatchObject({
      rejected_after_interview: true,
      outcome_reason: 'rejected_after_interview',
      interview_count: 2,
    });
  });

  it('does not stamp a response when ghosting', () => {
    const update = buildStatusUpdate('ghosted', app({ status: 'applied' }), NOW);

    expect(update.ghosted_at).toBe(NOW);
    expect(update).not.toHaveProperty('response_received_at');
    expect(update.archived).toBeUndefined();
  });

  it('keeps the first date a stage was reached', () => {
    const update = buildStatusUpdate(
      'final_interview',
      app({ status: 'interview', response_received_at: EARLIER, interview_started_at: EARLIER }),
      NOW
    );

    expect(update).not.toHaveProperty('response_received_at');
    expect(update).not.toHaveProperty('interview_started_at');
    expect(update.final_interview_started_at).toBe(NOW);
    expect(update.final_response_pending).toBe(true);
  });

  it('clears the awaiting flag when moving back before interview', () => {
    const update = buildStatusUpdate(
      'applied',
      app({ status: 'interview', final_response_pending: true }),
      NOW
    );

    expect(update.final_response_pending).toBe(false);
  });

  it('undoes a previous close when moving back into the pipeline', () => {
    const update = buildStatusUpdate(
      'interview',
      app({
        status: 'rejected',
        archived: true,
        rejected_at: EARLIER,
        outcome_reason: 'rejected_after_interview',
        rejected_after_interview: true,
        interview_started_at: EARLIER,
        response_received_at: EARLIER,
      }),
      NOW
    );

    expect(update).toMatchObject({
      archived: false,
      archived_at: null,
      rejected_at: null,
      outcome_reason: null,
      rejected_after_interview: false,
    });
  });

  it('drops an automatic ghosting stamp when the application is revived', () => {
    const revived = buildStatusUpdate(
      'applied',
      app({ status: 'ghosted', ghosted_at: EARLIER, response_received_at: EARLIER }),
      NOW
    );

    expect(revived.ghosted_at).toBeNull();
    expect(revived.response_received_at).toBeNull();

    const replied = buildStatusUpdate(
      'confirmation_received',
      app({ status: 'ghosted', ghosted_at: EARLIER, response_received_at: EARLIER }),
      NOW
    );

    expect(replied.response_received_at).toBe(NOW);
  });

  it('builds a full payload for a new application', () => {
    expect(buildStatusUpdate('interview', null, NOW)).toMatchObject({
      status: 'interview',
      response_received_at: NOW,
      interview_started_at: NOW,
      reached_interview: true,
      interview_count: 1,
      final_response_pending: true,
    });
  });
});

describe('offers', () => {
  it('awaits a decision until accepted or declined', () => {
    expect(isOfferAwaitingDecision(app({ status: 'offer', outcome_reason: 'offer_received' }))).toBe(true);
    expect(isOfferAwaitingDecision(app({ status: 'offer', outcome_reason: null }))).toBe(true);
    expect(isOfferAwaitingDecision(app({ status: 'offer', outcome_reason: 'offer_accepted' }))).toBe(false);
    expect(isOfferAwaitingDecision(app({ status: 'offer', outcome_reason: 'offer_declined' }))).toBe(false);
    expect(isOfferAwaitingDecision(app({ status: 'offer', archived: true }))).toBe(false);
    expect(isOfferAwaitingDecision(app({ status: 'interview' }))).toBe(false);
  });

  it('records the decision', () => {
    expect(buildOfferDecision('accepted', NOW).outcome_reason).toBe('offer_accepted');
    expect(buildOfferDecision('declined', NOW).outcome_reason).toBe('offer_declined');
  });
});

describe('getUpcomingInterviewDate', () => {
  const now = new Date(2026, 9, 17, 15, 0);
  const on = (dayOffset: number) => new Date(2026, 9, 17 + dayOffset, 10, 0).toISOString();

  it('returns the earliest interview from today through the next 7 days', () => {
    const interviewing = app({
      status: 'interview',
      interview_notes: [{ interview_date: on(5) }, { interview_date: on(2) }, { interview_date: on(-1) }],
    } as Partial<LifecycleRecord>);

    expect(getUpcomingInterviewDate(interviewing, now)).toBe(on(2));
    expect(getUpcomingInterviewDate(app({ status: 'interview', interview_notes: { interview_date: on(0) } } as Partial<LifecycleRecord>), now)).toBe(on(0));
    expect(getUpcomingInterviewDate(app({ status: 'interview', interview_notes: [{ interview_date: on(8) }] } as Partial<LifecycleRecord>), now)).toBeNull();
  });

  it('ignores closed applications and missing dates', () => {
    expect(getUpcomingInterviewDate(app({ status: 'rejected', interview_notes: [{ interview_date: on(1) }] } as Partial<LifecycleRecord>), now)).toBeNull();
    expect(getUpcomingInterviewDate(app({ status: 'interview', interview_notes: [{ interview_date: null }] } as Partial<LifecycleRecord>), now)).toBeNull();
    expect(getUpcomingInterviewDate(app({ status: 'interview' }), now)).toBeNull();
  });
});

describe('hasReachedStage', () => {
  it('counts the furthest stage regardless of the current status', () => {
    const rejectedAfterFinal = app({
      status: 'rejected',
      response_received_at: EARLIER,
      interview_started_at: EARLIER,
      final_interview_started_at: EARLIER,
    });

    expect(hasReachedStage(rejectedAfterFinal, 'applied')).toBe(true);
    expect(hasReachedStage(rejectedAfterFinal, 'responded')).toBe(true);
    expect(hasReachedStage(rejectedAfterFinal, 'interview')).toBe(true);
    expect(hasReachedStage(rejectedAfterFinal, 'final_interview')).toBe(true);
    expect(hasReachedStage(rejectedAfterFinal, 'offer')).toBe(false);
    expect(hasReachedStage(app({ status: 'wishlist' }), 'applied')).toBe(false);
  });
});

describe('getFurthestActiveStatus', () => {
  it('restores to the furthest stage reached', () => {
    expect(getFurthestActiveStatus(app({ status: 'rejected', final_interview_started_at: EARLIER }))).toBe('final_interview');
    expect(getFurthestActiveStatus(app({ status: 'rejected', rejected_after_interview: true }))).toBe('interview');
    expect(getFurthestActiveStatus(app({ status: 'rejected', assessment_received_at: EARLIER }))).toBe('assessment');
    expect(getFurthestActiveStatus(app({ status: 'rejected', response_received_at: EARLIER }))).toBe('confirmation_received');
    expect(getFurthestActiveStatus(app({ status: 'archived' }))).toBe('applied');
    // The response stamp written by the rejection itself doesn't count.
    expect(getFurthestActiveStatus(app({ status: 'rejected', rejected_at: EARLIER, response_received_at: EARLIER }))).toBe('applied');
  });
});
