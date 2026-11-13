import { isValidTimeZone, utcToZonedDateTime } from './interviewSchedule';

const decodeText = (value: string) =>
  value.replace(/\\([nN,;\\])/g, (_, char: string) => /[nN]/.test(char) ? '\n' : char);

export function parseInterviewInvite(contents: string) {
  // Calendar producers fold long property lines at a newline plus whitespace.
  const calendar = contents.replace(/^\uFEFF/, '').replace(/\r?\n[ \t]/g, '');
  const events = [...calendar.matchAll(/^BEGIN:VEVENT\r?\n([\s\S]*?)^END:VEVENT\r?$/gim)];
  if (!/^BEGIN:VCALENDAR\r?$/im.test(calendar) || events.length !== 1) {
    throw new Error('Choose a calendar invite containing one event.');
  }
  const event = events[0][1].replace(/^BEGIN:VALARM\r?\n[\s\S]*?^END:VALARM\r?$/gim, '');
  if (/^METHOD:CANCEL\s*$/im.test(calendar) || /^STATUS:CANCELLED\s*$/im.test(event) || /^RRULE[;:]/im.test(event)) {
    throw new Error('Choose a single scheduled interview. Cancelled and recurring invites cannot be imported.');
  }

  const start = event.match(/^DTSTART((?:;[^:\r\n]*)?):(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})\d{2}(Z)?\r?$/im);
  if (!start) throw new Error('This invite does not contain a timed start.');
  const [, parameters, year, month, day, hour, minute, utc] = start;
  const date = `${year}-${month}-${day}`;
  const time = `${hour}:${minute}`;
  const timeZone = utc ? 'UTC' : parameters.match(/(?:^|;)TZID=(?:"([^"]+)"|([^;]+))/i)?.slice(1).find(Boolean);
  const instant = new Date(`${date}T${time}:00Z`);
  if (!Number.isFinite(instant.valueOf()) || instant.toISOString().slice(0, 16) !== `${date}T${time}`) {
    throw new Error('The invite contains an invalid start date or time.');
  }
  if (!isValidTimeZone(timeZone)) {
    throw new Error('This invite does not specify a supported time zone. Ask for an invite with a time zone or UTC start.');
  }

  const field = (name: string) =>
    decodeText(event.match(new RegExp(`^${name}(?:;[^:\\r\\n]*)?:([^\\r\\n]*)`, 'im'))?.[1] ?? '').trim();
  const location = field('LOCATION');
  const url = field('URL');
  return {
    ...(utc ? utcToZonedDateTime(instant.toISOString(), timeZone) : { date, time }),
    timeZone,
    stage: field('SUMMARY'),
    notes: [location && `Location: ${location}`, url && `Meeting link: ${url}`, field('DESCRIPTION')]
      .filter(Boolean).join('\n\n'),
  };
}
