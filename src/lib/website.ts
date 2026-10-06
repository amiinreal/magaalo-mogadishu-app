import { ATLAS_WEBSITE } from '../config';
import { supabase } from './supabase';

export class WebsiteError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/**
 * Calls the Magaalo Atlas website API. Signed-in requests send the Supabase access token as
 * `Authorization: Bearer …`, which the website verifies server-side (see the Atlas docs/mobile.md).
 */
export async function website<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${ATLAS_WEBSITE}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new WebsiteError(json?.error || `The Magaalo service returned ${response.status}.`, response.status);
    return json as T;
  } finally {
    clearTimeout(timer);
  }
}

/** True when the website build is older and doesn't have this endpoint yet. */
export const notDeployed = (error: unknown) => error instanceof WebsiteError && (error.status === 404 || error.status === 405);
