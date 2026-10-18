import { describe, expect, it } from 'vitest';

import {
  addDays,
  addMonths,
  dayKeyInZone,
  findDuplicateInterview,
  groupByDay,
  interviewStatus,
  monthGrid,
  needsOutcome,
  pickPrepInterview,
  toDateTimeLocalValue,
  startOfWeek,
  utcToZonedDateTime,
  weekDays,
  zonedDateTimeToUtc,
  type InterviewRecord,
} from './interviewSchedule';

const interview = (overrides: Partial<InterviewRecord>): InterviewRecord => ({
  id: 'i1',
  application_id: 'a1',
  interview_stage: 'HR interview',
  interview_date: '2026-10-20T08:00:00.000Z',
  notes: null,
  ...overrides,
});

describe('zonedDateTimeToUtc / utcToZonedDateTime', () => {
  it('converts wall-clock time in a zone to the exact moment and back', () => {
    expect(zonedDateTimeToUtc('2026-10-20', '10:00', 'Europe/Warsaw').toISOString()).toBe('2026-10-20T08:00:00.000Z'); // CEST
    expect(zonedDateTimeToUtc('2026-11-20', '10:00', 'Europe/Warsaw').toISOString()).toBe('2026-11-20T09:00:00.000Z'); // CET
    expect(zonedDateTimeToUtc('2026-10-20', '09:30', 'America/New_York').toISOString()).toBe('2026-10-20T13:30:00.000Z');
    expect(zonedDateTimeToUtc('2026-10-20', '09:30', 'Asia/Kolkata').toISOString()).toBe('2026-10-20T04:00:00.000Z');
    expect(utcToZonedDateTime('2026-10-20T13:30:00.000Z', 'America/New_York')).toEqual({ date: '2026-10-20', time: '09:30' });
  });

  it('handles daylight-saving changes', () => {
    // Spring forward in Warsaw: 02:00 → 03:00 on 29 March 2026; 02:30 doesn't exist.
    expect(zonedDateTimeToUtc('2026-03-29', '02:30', 'Europe/Warsaw').toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(utcToZonedDateTime('2026-03-29T01:30:00.000Z', 'Europe/Warsaw')).toEqual({ date: '2026-03-29', time: '03:30' });
    // Fall back on 25 October 2026: 02:30 happens twice; the first one is used.
    expect(zonedDateTimeToUtc('2026-10-25', '02:30', 'Europe/Warsaw').toISOString()).toBe('2026-10-25T00:30:00.000Z');
    // Either side of the change.
    expect(zonedDateTimeToUtc('2026-10-24', '09:00', 'Europe/Warsaw').toISOString()).toBe('2026-10-24T07:00:00.000Z');
    expect(zonedDateTimeToUtc('2026-10-26', '09:00', 'Europe/Warsaw').toISOString()).toBe('2026-10-26T08:00:00.000Z');
  });

  it('rejects bad input', () => {
    expect(() => zonedDateTimeToUtc('', '10:00', 'Europe/Warsaw')).toThrow();
    expect(() => zonedDateTimeToUtc('2026-10-20', '10:00', 'Mars/Olympus')).toThrow();
  });
});

describe('day boundaries', () => {
  it("places an interview on the viewer's day, not the interviewer's", () => {
    const lateInNewYork = zonedDateTimeToUtc('2026-10-20', '23:30', 'America/New_York').toISOString();
    expect(dayKeyInZone(lateInNewYork, 'America/New_York')).toBe('2026-10-20');
    expect(dayKeyInZone(lateInNewYork, 'Europe/Warsaw')).toBe('2026-10-21');
    expect(dayKeyInZone('2026-10-20T23:30:00.000Z', 'UTC')).toBe('2026-10-20');
  });

  it('groups by viewer day, earliest first', () => {
    const days = groupByDay(
      [
        interview({ id: 'late', interview_date: '2026-10-20T20:00:00.000Z' }),
        interview({ id: 'early', interview_date: '2026-10-20T07:00:00.000Z' }),
        interview({ id: 'after-midnight-warsaw', interview_date: '2026-10-20T22:30:00.000Z' }),
        interview({ id: 'unscheduled', interview_date: null }),
      ],
      'Europe/Warsaw',
    );
    expect(days.get('2026-10-20')?.map((i) => i.id)).toEqual(['early', 'late']);
    expect(days.get('2026-10-21')?.map((i) => i.id)).toEqual(['after-midnight-warsaw']);
    expect([...days.keys()]).toHaveLength(2);
  });
});

describe('calendar days', () => {
  it('steps days and months across DST and year ends', () => {
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-01');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-01');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-01');
  });

  it('builds Monday-first weeks and whole-week month grids', () => {
    expect(startOfWeek('2026-10-18')).toBe('2026-10-12'); // a Sunday
    expect(weekDays('2026-10-21')).toEqual([
      '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25',
    ]);
    const october = monthGrid('2026-10-18');
    expect(october[0]).toBe('2026-09-28');
    expect(october.at(-1)).toBe('2026-11-01');
    expect(october.length % 7).toBe(0);
    expect(monthGrid('2027-02-10')).toHaveLength(28); // Feb 2027: 1st is a Monday, 28 days
  });
});

describe('interview records', () => {
  it('treats missing or unknown status as scheduled', () => {
    expect(interviewStatus({ status: undefined })).toBe('scheduled');
    expect(interviewStatus({ status: 'odd' })).toBe('scheduled');
    expect(interviewStatus({ status: 'cancelled' })).toBe('cancelled');
  });

  it('flags past scheduled interviews as needing an outcome', () => {
    const now = Date.parse('2026-10-21T00:00:00Z');
    expect(needsOutcome(interview({}), now)).toBe(true);
    expect(needsOutcome(interview({ status: 'completed' }), now)).toBe(false);
    expect(needsOutcome(interview({ interview_date: '2026-10-22T08:00:00Z' }), now)).toBe(false);
  });

  it('finds a duplicate for the same application and moment, ignoring cancelled ones', () => {
    const existing = [interview({ id: 'x' }), interview({ id: 'y', interview_date: '2026-10-21T08:00:00Z', status: 'cancelled' })];
    expect(findDuplicateInterview(existing, { application_id: 'a1', interview_date: '2026-10-20T08:00:00.000Z' })?.id).toBe('x');
    expect(findDuplicateInterview(existing, { id: 'x', application_id: 'a1', interview_date: '2026-10-20T08:00:00Z' })).toBeNull();
    expect(findDuplicateInterview(existing, { application_id: 'a1', interview_date: '2026-10-21T08:00:00Z' })).toBeNull();
    expect(findDuplicateInterview(existing, { application_id: 'a2', interview_date: '2026-10-20T08:00:00Z' })).toBeNull();
  });
});

describe('application page helpers', () => {
  it('picks the next scheduled interview for the preparation notes', () => {
    const now = Date.parse('2026-10-21T00:00:00Z');
    const past = interview({ id: 'past', interview_date: '2026-10-20T08:00:00Z' });
    const cancelled = interview({ id: 'cancelled', interview_date: '2026-10-22T08:00:00Z', status: 'cancelled' });
    const next = interview({ id: 'next', interview_date: '2026-10-23T08:00:00Z' });
    expect(pickPrepInterview([next, cancelled, past], now)?.id).toBe('next');
    expect(pickPrepInterview([past, cancelled], now)?.id).toBe('cancelled'); // most recent
    expect(pickPrepInterview([interview({ id: 'undated', interview_date: null })], now)?.id).toBe('undated');
    expect(pickPrepInterview([], now)).toBeNull();
  });

  it('fills datetime-local inputs with local time, not UTC', () => {
    expect(toDateTimeLocalValue('2026-10-20T08:00:00.000Z', 'Europe/Warsaw')).toBe('2026-10-20T10:00');
    expect(toDateTimeLocalValue('2026-10-20T23:30:00.000Z', 'Asia/Tokyo')).toBe('2026-10-21T08:30');
    expect(toDateTimeLocalValue(null)).toBe('');
  });
});
