import { useCallback, useEffect, useState } from 'react';

const SESSION_KEY = 'jtracker_gmail_token';
const EXPIRY_KEY = 'jtracker_gmail_token_expiry';

// Google OAuth implicit tokens last 1 hour; we treat anything within
// 5 minutes of expiry as already expired to avoid mid-sync failures.
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

interface StoredToken {
  token: string;
  expiresAt: number; // unix ms
}

function readFromStorage(): StoredToken | null {
  try {
    const token = sessionStorage.getItem(SESSION_KEY);
    const expiry = sessionStorage.getItem(EXPIRY_KEY);
    if (!token || !expiry) return null;
    return { token, expiresAt: Number(expiry) };
  } catch {
    return null;
  }
}

function writeToStorage(token: string, expiresAt: number) {
  try {
    sessionStorage.setItem(SESSION_KEY, token);
    sessionStorage.setItem(EXPIRY_KEY, String(expiresAt));
  } catch {
    // sessionStorage unavailable (private browsing, storage full) — graceful no-op
  }
}

function clearStorage() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(EXPIRY_KEY);
  } catch {
    // no-op
  }
}

function isTokenValid(stored: StoredToken | null): boolean {
  if (!stored) return false;
  return Date.now() < stored.expiresAt - EXPIRY_BUFFER_MS;
}

export interface UseGmailTokenReturn {
  /** The raw access token, or empty string if not connected / expired. */
  gmailToken: string;
  /** True when we have a token and it hasn't expired yet. */
  gmailConnected: boolean;
  /** How many minutes remain before the token expires (0 if not connected). */
  minutesRemaining: number;
  /** Call this with the token returned by useGoogleLogin's onSuccess. */
  saveToken: (token: string) => void;
  /** Clears the token from state and sessionStorage (e.g. on explicit disconnect or 401). */
  clearToken: () => void;
}

export function useGmailToken(): UseGmailTokenReturn {
  const [stored, setStored] = useState<StoredToken | null>(() => {
    const s = readFromStorage();
    return isTokenValid(s) ? s : null;
  });

  // Re-check validity every minute so the UI updates without a page refresh.
  useEffect(() => {
    const interval = setInterval(() => {
      setStored((prev) => {
        if (!prev || !isTokenValid(prev)) {
          clearStorage();
          return null;
        }
        return prev;
      });
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  const saveToken = useCallback((token: string) => {
    const expiresAt = Date.now() + TOKEN_TTL_MS;
    writeToStorage(token, expiresAt);
    setStored({ token, expiresAt });
  }, []);

  const clearToken = useCallback(() => {
    clearStorage();
    setStored(null);
  }, []);

  const gmailConnected = isTokenValid(stored);
  const gmailToken = gmailConnected ? (stored?.token ?? '') : '';
  const minutesRemaining = gmailConnected
    ? Math.max(0, Math.floor(((stored?.expiresAt ?? 0) - Date.now()) / 60_000))
    : 0;

  return { gmailToken, gmailConnected, minutesRemaining, saveToken, clearToken };
}