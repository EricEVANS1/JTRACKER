// Light / dark theme. The preference (light, dark or follow the system) is
// kept on this device; index.html applies it before the app loads so the
// page never flashes the wrong theme.

import { useSyncExternalStore } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

// The key the first theme toggle used, so a choice already made is kept.
export const THEME_STORAGE_KEY = 'jtracker-theme';

// Browser toolbar colour per theme (matches the page background).
const THEME_COLORS: Record<ResolvedTheme, string> = { light: '#f8fafc', dark: '#141c31' };

const isPreference = (value: unknown): value is ThemePreference =>
  value === 'light' || value === 'dark' || value === 'system';

export const readThemePreference = (): ThemePreference => {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isPreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
};

const systemPrefersDark = () => {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
};

export const resolveTheme = (preference: ThemePreference, prefersDark = systemPrefersDark()): ResolvedTheme =>
  preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference;

export const applyTheme = (preference: ThemePreference) => {
  const resolved = resolveTheme(preference);
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[resolved]);
  return resolved;
};

// ── Store ──────────────────────────────────────────────────────────────────

const listeners = new Set<() => void>();
let preference: ThemePreference = typeof window === 'undefined' ? 'system' : readThemePreference();
let resolved: ResolvedTheme = typeof window === 'undefined' ? 'light' : resolveTheme(preference);
let snapshot = { preference, resolved };

const publish = () => {
  resolved = applyTheme(preference);
  snapshot = { preference, resolved };
  listeners.forEach((listener) => listener());
};

export const setThemePreference = (next: ThemePreference) => {
  preference = next;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Not saved; the choice lasts for this page.
  }
  publish();
};

// Follows the system setting while the preference is "system", and changes
// made in another tab.
export const startThemeSync = () => {
  publish();
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  const onSystemChange = () => {
    if (preference === 'system') publish();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) {
      preference = readThemePreference();
      publish();
    }
  };
  media?.addEventListener?.('change', onSystemChange);
  window.addEventListener('storage', onStorage);
  return () => {
    media?.removeEventListener?.('change', onSystemChange);
    window.removeEventListener('storage', onStorage);
  };
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useTheme = () => {
  const current = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
  return { ...current, setPreference: setThemePreference };
};
