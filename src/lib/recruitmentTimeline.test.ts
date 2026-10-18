import { describe, expect, it } from 'vitest';

import {
  buildRecruitmentTimeline,
  daysBetweenKeys,
  findSuggestion,
  formatDays,
  totalDuration,
  type TimelineEventRecord,
} from './recruitmentTimeline';
import type { InterviewRecord } from './interviewSchedule';

const ZONE = 'Europe/Warsaw';
const NOW = Date.parse('2026-10-20T12:00:00Z');

const event = (title: string, event_date: string, extra: Partial<TimelineEventRecord> = {}): TimelineEventRecord => ({
  id: title,
  event_type: 'application_update',
  title,
  description: '',
  event_date,
  ...extra,
});

const interview = (date: string | null, stage = 'Technical interview', extra: Partial<InterviewRecord> = {}): InterviewRecord => ({
  id: `${stage}-${date}`,
  application_id: 'a1',
  interview_stage: stage,
  interview_date: date,
  notes: null,
  ...extra,
});

describe('buildRecruitmentTimeline', () => {
  it('shows recorded dates in stage order with the days between them', () => {
    const milestones = buildRecruitmentTimeline(
      {
        status: 'offer',
        date_applied: '2026-09-01',
        response_received_at: '2026-09-04T09:00:00Z',
        assessment_received_at: '2026-09-08T09:00:00Z',
        interview_started_at: '2026-09-15T09:00:00Z',
        final_interview_started_at: '2026-09-22T09:00:00Z',
        offer_received_at: '2026-09-29T09:00:00Z',
      },
      { viewerZone: ZONE, now: NOW },
    );

    expect(milestones.map((m) => [m.key, m.state, m.daysSincePrevious])).toEqual([
      ['applied', 'recorded', null],
      ['response', 'recorded', 3],
      ['assessment', 'recorded', 4],
      ['interview', 'recorded', 7],
      ['final_interview', 'recorded', 7],
      ['offer', 'recorded', 7],
    ]);
    expect(totalDuration(milestones)).toEqual({ from: 'Applied', to: 'Offer received', days: 28 });
  });

  it('marks reached stages without a date as missing, and skipped ones as not reached, without inventing dates', () => {
    const milestones = buildRecruitmentTimeline(
      { status: 'interview', date_applied: '2026-10-01', reached_interview: true },
      { viewerZone: ZONE, now: NOW },
    );
    const byKey = Object.fromEntries(milestones.map((m) => [m.key, m]));

    expect(byKey.applied.state).toBe('recorded');
    expect(byKey.response).toMatchObject({ state: 'missing', date: null }); // an interview implies a reply
    expect(byKey.assessment).toMatchObject({ state: 'not_reached', date: null });
    expect(byKey.interview).toMatchObject({ state: 'missing', date: null });
    expect(byKey.final_interview.state).toBe('not_reached');
    expect(milestones.at(-1)).toMatchObject({ label: 'Decision', state: 'pending' });
    expect(milestones.every((m) => m.state === 'recorded' || m.date === null)).toBe(true);
  });

  it('flags a date earlier than the stage before it, and leaves it out of the gaps', () => {
    const milestones = buildRecruitmentTimeline(
      { status: 'interview', date_applied: '2026-10-10', interview_started_at: '2026-10-05T09:00:00Z' },
      { viewerZone: ZONE, now: NOW },
    );
    const interviewMilestone = milestones.find((m) => m.key === 'interview')!;
    expect(interviewMilestone.outOfOrder).toBe(true);
    expect(interviewMilestone.daysSincePrevious).toBeNull();
    expect(totalDuration(milestones)).toBeNull();
  });

  it('uses the viewer’s calendar day for gaps (late-evening UTC times)', () => {
    // 22:30 UTC on 3 Sep is 00:30 on 4 Sep in Warsaw.
    const milestones = buildRecruitmentTimeline(
      { status: 'confirmation_received', date_applied: '2026-09-01', response_received_at: '2026-09-03T22:30:00Z' },
      { viewerZone: ZONE, now: NOW },
    );
    expect(milestones.find((m) => m.key === 'response')).toMatchObject({ dayKey: '2026-09-04', daysSincePrevious: 3 });
  });

  it('shows the recorded outcome, and an old ghosting stamp is not a reply', () => {
    const ghosted = buildRecruitmentTimeline(
      { status: 'ghosted', date_applied: '2026-09-01', ghosted_at: '2026-09-20T09:00:00Z', response_received_at: '2026-09-20T09:00:00Z' },
      { viewerZone: ZONE, now: NOW },
    );
    expect(ghosted.map((m) => m.key)).toEqual(['applied', 'response', 'assessment', 'interview', 'final_interview', 'ghosted']);
    expect(ghosted.find((m) => m.key === 'response')!.state).not.toBe('recorded');

    const wishlist = buildRecruitmentTimeline({ status: 'wishlist' }, { viewerZone: ZONE, now: NOW });
    expect(wishlist.find((m) => m.key === 'applied')!.state).toBe('not_reached');
    expect(wishlist.some((m) => m.label === 'Decision')).toBe(false);
  });
});

describe('findSuggestion', () => {
  it('offers the earliest status change or logged activity, never a made-up date', () => {
    const events = [
      event('Status changed to Assessment', '2026-10-08T10:00:00Z'),
      event('Status changed to Assessment', '2026-10-06T10:00:00Z'),
      event('Take-home task received', '2026-10-05T10:00:00Z', { event_type: 'assessment' }),
      event('Interview prep updated', '2026-10-01T10:00:00Z', { event_type: 'interview_prep_updated' }),
      event('Application created', '2026-09-30T08:00:00Z', { event_type: 'created', description: 'Application added with status Applied.' }),
    ];
    expect(findSuggestion('assessment', events, [], NOW)).toEqual({ date: '2026-10-05T10:00:00Z', source: 'Take-home task received' });
    expect(findSuggestion('applied', events, [], NOW)).toEqual({ date: '2026-09-30T08:00:00Z', source: 'Added to JTracker as Applied' });
    expect(findSuggestion('interview', events, [], NOW)).toBeNull(); // prep notes aren't an interview
    expect(findSuggestion('response', events, [], NOW)).toBeNull();
    // Kanban logs a generic title with the move in the description.
    const kanban = event('Pipeline status updated', '2026-10-07T10:00:00Z', { description: 'Moved from assessment to interview.' });
    expect(findSuggestion('interview', [kanban], [], NOW)).toEqual({ date: '2026-10-07T10:00:00Z', source: 'Status changed to Interview' });
  });

  it('uses past, non-cancelled interview records for interview stages', () => {
    const interviews = [
      interview('2026-10-25T09:00:00Z'), // future
      interview('2026-10-12T09:00:00Z', 'HR interview', { status: 'cancelled' }),
      interview('2026-10-14T09:00:00Z', 'Technical interview'),
      interview('2026-10-18T09:00:00Z', 'Final interview'),
    ];
    expect(findSuggestion('interview', [], interviews, NOW)).toEqual({
      date: '2026-10-14T09:00:00Z',
      source: 'Interview record: Technical interview',
    });
    expect(findSuggestion('final_interview', [], interviews, NOW)?.date).toBe('2026-10-18T09:00:00Z');
  });
});

describe('helpers', () => {
  it('counts calendar days and words them', () => {
    expect(daysBetweenKeys('2026-10-24', '2026-10-26')).toBe(2); // across the DST change
    expect(daysBetweenKeys('2026-12-31', '2027-01-01')).toBe(1);
    expect([0, 1, 5].map(formatDays)).toEqual(['same day', '1 day', '5 days']);
  });
});
