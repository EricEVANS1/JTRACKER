import type { CaptureResult, PostHog } from 'posthog-js';

const key = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN;
const host = import.meta.env.VITE_POSTHOG_HOST || 'https://eu.i.posthog.com';
const preferenceKey = 'jtracker:web-analytics';
export const analyticsConfigured = Boolean(key) && import.meta.env.PROD;
let client: PostHog | undefined;
let starting: Promise<void> | undefined;

const pages = new Set([
  '/', '/auth', '/dashboard', '/applications', '/cv-manager', '/companies', '/analytics',
  '/settings', '/notifications', '/shared', '/follow-ups', '/interviews', '/offers',
  '/offers/new', '/archived', '/archived-applications', '/recruiters', '/kanban', '/email-sync',
  '/job-automation', '/resume-builder', '/resume-builder/editor', '/resume-builder/flow',
  '/resume-builder/start', '/resume-builder/history', '/shared-with-me', '/email-events',
]);

export function pageGroup(path: string) {
  const clean = path.replace(/\/+$/, '') || '/';
  if (pages.has(clean)) return clean;
  for (const group of ['/applications', '/share', '/offers', '/recruiters', '/resume-builder/saved', '/resume-builder']) {
    if (clean.startsWith(group + '/')) return group + '/:id';
  }
  return '/other';
}

export function preference(): string | null {
  try { return localStorage.getItem(preferenceKey); } catch { return null; }
}

export function setPreference(value: 'allow' | 'decline') {
  try { localStorage.setItem(preferenceKey, value); } catch { return; }
  window.dispatchEvent(new Event('analytics-preference'));
  if (value === 'decline' && client) {
    client.opt_out_capturing();
    client.reset(true);
  }
}

const allowed = new Set([
  'token', 'distinct_id', '$device_id', '$session_id', '$window_id', '$lib', '$lib_version',
  '$browser', '$browser_version', '$os', '$device_type', '$screen_width', '$screen_height',
  '$viewport_width', '$viewport_height', '$timezone', '$timezone_offset', '$event_type',
  '$process_person_profile', '$pageview_id', '$prev_pageview_id', '$prev_pageview_duration',
  '$is_identified',
]);

export function cleanEvent(event: CaptureResult): CaptureResult | null {
  if (!['$pageview', '$pageleave', '$autocapture', 'application_record_created'].includes(event.event)) return null;
  const properties = Object.fromEntries(Object.entries(event.properties).filter(([k]) => allowed.has(k)));
  const url = new URL(String(event.properties.$current_url || location.href), location.origin);
  properties.$pathname = pageGroup(url.pathname);
  properties.$current_url = location.origin + properties.$pathname;
  properties.$host = location.host;
  if (typeof event.properties.$prev_pageview_pathname === 'string') {
    properties.$prev_pageview_pathname = pageGroup(event.properties.$prev_pageview_pathname);
  }
  if (typeof event.properties.$prev_pageview_max_scroll_percentage === 'number') {
    properties.$prev_pageview_max_scroll_percentage = event.properties.$prev_pageview_max_scroll_percentage;
  }
  const referrer = event.properties.$referring_domain;
  if (typeof referrer === 'string' && /^[a-z0-9.-]+$/i.test(referrer)) properties.$referring_domain = referrer;
  return { uuid: event.uuid, event: event.event, timestamp: event.timestamp, properties };
}

export function startAnalytics() {
  if (!analyticsConfigured || preference() !== 'allow') return;
  if (client) {
    if (client.has_opted_out_capturing()) {
      client.opt_in_capturing();
      client.capture('$pageview');
    }
    return;
  }
  starting ??= import('posthog-js').then(({ default: sdk }) => {
    if (preference() !== 'allow') return;
    client = sdk.init(key, {
      api_host: host, person_profiles: 'never', respect_dnt: true,
      capture_pageview: 'history_change', capture_pageleave: true,
      autocapture: { dom_event_allowlist: ['click'], capture_copied_text: false },
      mask_all_text: true, mask_all_element_attributes: true,
      disable_session_recording: true, disable_surveys: true, advanced_disable_flags: true,
      disable_external_dependency_loading: true, capture_performance: false,
      capture_exceptions: false, capture_dead_clicks: false, before_send: event => preference() === 'allow' ? cleanEvent(event) : null,
    });
    if (client?.has_opted_out_capturing()) {
      client.opt_in_capturing();
      client.capture('$pageview');
    }
  }).catch(() => { /* A blocked analytics script must not interrupt JTracker. */ })
    .finally(() => { starting = undefined; });
}

export function recordApplicationCreated() {
  if (preference() === 'allow') client?.capture('application_record_created');
}
