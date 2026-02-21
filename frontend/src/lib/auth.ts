/**
 * Auth utilities for sending Clerk session tokens with API requests.
 */

import { backendWsUrl } from "./backend";

let getTokenFn: (() => Promise<string | null>) | null = null;

/**
 * Register the Clerk `getToken` function so API helpers can use it.
 * Call this once from a component that has access to `useAuth()`.
 */
export function registerGetToken(fn: () => Promise<string | null>) {
    getTokenFn = fn;
}

/**
 * Build an Authorization header using the current Clerk session token.
 * Returns an empty object if no token is available (e.g. unauthenticated).
 */
export async function authHeaders(): Promise<Record<string, string>> {
    if (!getTokenFn) return {};
    const token = await getTokenFn();
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
}

/**
 * Fetch wrapper that automatically injects Clerk Authorization headers.
 */
export async function authFetch(
    input: RequestInfo | URL,
    init: RequestInit = {}
): Promise<Response> {
    const merged = new Headers(init.headers || {});
    const auth = await authHeaders();
    for (const [key, value] of Object.entries(auth)) {
        merged.set(key, value);
    }

    return fetch(input, {
        ...init,
        headers: merged,
    });
}

/**
 * Build a full WebSocket URL with the Clerk session token as a query param.
 * Falls back to the bare URL if no token is available.
 */
export async function authenticatedWsUrl(path: string): Promise<string> {
    const base = backendWsUrl(path);

    if (!getTokenFn) return base;
    const token = await getTokenFn();
    if (!token) return base;
    return `${base}${base.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
}
