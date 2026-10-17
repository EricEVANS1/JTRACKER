import { describe, expect, it } from 'vitest';

import {
  buildTimeline,
  groupTimelineByDay,
  parseStatusChange,
  toTimelineEvent,
  type ActivityEventRecord,
} from './activityTimeline';

const application = { id: 'app-1', role_title: 'Data Analyst', companies: { name: 'Acme' } };

let seq = 0;
const event = (overrides: Partial<ActivityEventRecord>): ActivityEventRecord => ({
  id: `e${(seq += 1)}`,
  title: null,
  description: null,
  event_type: null,
  event_date: '2026-10-17T10:00:00.000Z',
  application_id: 'app-1',
  applications: application,
  ...overrides,
});

describe('toTimelineEvent', () => {
  it('describes status changes logged by each page the same way', () => {
    // Applications page
    const fromApplications = toTimelineEvent(event({
      event_type: 'application_update',
      title: 'Status changed to Interview',
      description: 'Application moved from Applied to Interview.',
    }));
    // Application details page
    const fromDetails = toTimelineEvent(event({
      event_type: 'status_changed',
      title: 'Status changed to Interview',
      description: 'Status changed from Applied to Interview.',
    }));
    // Kanban
    const fromKanban = toTimelineEvent(event({
      event_type: 'kanban_status_changed',
      title: 'Pipeline status updated',
      description: 'Moved from applied to interview.',
    }));

    for (const item of [fromApplications, fromDetails, fromKanban]) {
      expect(item).toMatchObject({ kind: 'interview', title: 'Moved to Interview', detail: 'Applied → Interview' });
    }
  });

  it('names offers, rejections and closes', () => {
    expect(toTimelineEvent(event({ event_type: 'status_changed', title: 'Status changed to Offer', description: 'Status changed from Final Interview to Offer.' })))
      .toMatchObject({ kind: 'offer', title: 'Offer received', detail: 'Final interview → Offer' });
    expect(toTimelineEvent(event({ event_type: 'kanban_status_changed', description: 'Moved from assessment to rejected.' })))
      .toMatchObject({ kind: 'rejection', title: 'Rejection received' });
    expect(toTimelineEvent(event({ event_type: 'email_auto_rejection', title: 'Rejection detected automatically', description: 'From hr@acme.com' })))
      .toMatchObject({ kind: 'rejection', title: 'Rejection received', detail: 'From hr@acme.com' });
    expect(toTimelineEvent(event({ event_type: 'status_changed', title: 'Application marked as ghosted' })))
      .toMatchObject({ kind: 'closed', title: 'Marked as ghosted' });
    expect(toTimelineEvent(event({ event_type: 'application_update', title: 'Offer accepted' })))
      .toMatchObject({ kind: 'offer', title: 'Offer accepted' });
    expect(toTimelineEvent(event({ event_type: 'application_update', title: 'Declined after interview' })))
      .toMatchObject({ kind: 'rejection', title: 'Rejected after interview' });
  });

  it('describes new applications by their starting status', () => {
    expect(toTimelineEvent(event({ event_type: 'created', title: 'Application created', description: 'Application added with status Applied.' })))
      .toMatchObject({ kind: 'added', title: 'Application submitted', detail: null });
    expect(toTimelineEvent(event({ event_type: 'created', description: 'Application added with status Wishlist.' })).title)
      .toBe('Added to wishlist');
    expect(toTimelineEvent(event({ event_type: 'job_automation', title: 'Application created from Job Automation', description: 'Matched 82%' })))
      .toMatchObject({ kind: 'added', title: 'Application created from Job Automation', detail: 'Matched 82%' });
  });

  it('covers follow-ups and manual activities', () => {
    expect(toTimelineEvent(event({ event_type: 'follow_up_completed', title: 'Follow-up completed', description: 'Follow-up completed for Data Analyst.' })))
      .toMatchObject({ kind: 'follow_up', title: 'Follow-up completed', detail: null });
    expect(toTimelineEvent(event({ event_type: 'notification_completed' })).title).toBe('Follow-up completed');
    expect(toTimelineEvent(event({ event_type: 'interview', title: 'Panel interview booked', description: 'Thursday 10:00' })))
      .toMatchObject({ kind: 'interview', title: 'Panel interview booked', detail: 'Thursday 10:00' });
  });

  it('links only to applications that still exist', () => {
    expect(toTimelineEvent(event({ title: 'x' }))).toMatchObject({ applicationId: 'app-1', roleTitle: 'Data Analyst', companyName: 'Acme' });
    expect(toTimelineEvent(event({ title: 'x', applications: null }))).toMatchObject({ applicationId: null, applicationDeleted: true });
    expect(toTimelineEvent(event({ title: 'x', application_id: null, applications: null })).applicationDeleted).toBe(false);
    expect(toTimelineEvent(event({ title: 'x', applications: [{ ...application, companies: [{ name: 'Acme' }] }] })).companyName).toBe('Acme');
  });
});

describe('parseStatusChange', () => {
  it('ignores text that is not a known status', () => {
    expect(parseStatusChange('Status changed to Something', '')).toBeNull();
    expect(parseStatusChange('Notes', 'Moved from London to Berlin.')).toBeNull();
  });
});

describe('buildTimeline', () => {
  it('drops repeats of the same event within 10 minutes and sorts newest first', () => {
    const move = { event_type: 'status_changed', title: 'Status changed to Interview', description: 'Status changed from Applied to Interview.' };
    const timeline = buildTimeline([
      event({ ...move, event_date: '2026-10-17T10:00:00.000Z' }),
      event({ ...move, event_date: '2026-10-17T10:04:00.000Z' }),
      // Same move logged by Kanban: still a duplicate.
      event({ event_type: 'kanban_status_changed', description: 'Moved from applied to interview.', event_date: '2026-10-17T10:02:00.000Z' }),
      // Same move much later counts again.
      event({ ...move, event_date: '2026-10-17T12:00:00.000Z' }),
      // Same move on another application is separate.
      event({ ...move, event_date: '2026-10-17T10:01:00.000Z', application_id: 'app-2', applications: { ...application, id: 'app-2' } }),
      event({ title: 'bad', event_date: 'not a date' }),
    ]);

    expect(timeline.map((item) => [item.applicationId, item.date])).toEqual([
      ['app-1', '2026-10-17T12:00:00.000Z'],
      ['app-1', '2026-10-17T10:04:00.000Z'],
      ['app-2', '2026-10-17T10:01:00.000Z'],
    ]);
  });
});

describe('groupTimelineByDay', () => {
  it('labels today, yesterday and older days', () => {
    const now = new Date(2026, 9, 17, 18, 0);
    const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 0).toISOString();
    const days = groupTimelineByDay(
      buildTimeline([
        event({ title: 'a', event_date: at(17, 9) }),
        event({ title: 'b', event_date: at(17, 8) }),
        event({ title: 'c', event_date: at(16, 9) }),
        event({ title: 'd', event_date: at(13, 9) }),
      ]),
      now
    );

    expect(days.map((day) => [day.label, day.events.length])).toEqual([
      ['Today', 2],
      ['Yesterday', 1],
      [new Date(2026, 9, 13).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }), 1],
    ]);
  });
});
