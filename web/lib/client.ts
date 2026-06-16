'use client';

import { useEffect, useState, useCallback } from 'react';

const STORAGE_KEY = 'dash_auth';

function readStoredToken(): string {
  if (typeof window === 'undefined') return '';
  let raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      localStorage.setItem(STORAGE_KEY, raw);
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }
  return raw || '';
}

export function hasStoredAuth(): boolean {
  return !!readStoredToken();
}

export function getAuthHeader() {
  const raw = readStoredToken();
  if (!raw) return '';
  return `Basic ${raw}`;
}

export function setAuth(user: string, pass: string) {
  localStorage.setItem(STORAGE_KEY, btoa(`${user}:${pass}`));
  sessionStorage.removeItem(STORAGE_KEY);
}

export function clearAuth() {
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
}

export async function verifyStoredAuth(): Promise<boolean> {
  const auth = getAuthHeader();
  if (!auth) return false;
  try {
    const res = await fetch('/api/runtime', { headers: { Authorization: auth } });
    if (!res.ok) {
      clearAuth();
      return false;
    }
    return true;
  } catch {
    return hasStoredAuth();
  }
}

export async function apiFetch(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  const auth = getAuthHeader();
  if (!auth) throw new Error('Unauthorized');
  headers.set('Authorization', auth);

  const res = await fetch(path, { ...options, headers });
  if (res.status === 401) {
    clearAuth();
    throw new Error('Unauthorized');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export function useApiPoll<T>(path: string, intervalMs = 8000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!getAuthHeader()) return;
    try {
      const d = await apiFetch(path);
      setData(d);
      setError(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error';
      if (msg !== 'Unauthorized') setError(msg);
    }
  }, [path]);

  useEffect(() => {
    load();
    const t = setInterval(load, intervalMs);
    return () => clearInterval(t);
  }, [load, intervalMs]);

  return { data, error, reload: load };
}
