/**
 * Auth utilities for sending Clerk session tokens with API requests.
 */

import { backendWsUrl } from "./backend";
import { CLERK_ENABLED } from "./clerkConfig";

let getTokenFn: (() => Promise<string | null>) | null = null;
let tokenRegistrationWaiters: Array<() => void> = [];

function resolveTokenRegistrationWaiters() {
    if (tokenRegistrationWaiters.length === 0) return;
    for (const resolve of tokenRegistrationWaiters) {
        resolve();
    }
    tokenRegistrationWaiters = [];
}

async function waitForTokenRegistration(timeoutMs = 4000): Promise<void> {
    if (getTokenFn || typeof window === "undefined") return;

    await Promise.race([
        new Promise<void>((resolve) => {
            tokenRegistrationWaiters.push(resolve);
        }),
        new Promise<void>((resolve) => {
            window.setTimeout(resolve, timeoutMs);
        }),
    ]);
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });
}

async function getAuthToken(options?: {
    requireToken?: boolean;
    timeoutMs?: number;
}): Promise<string | null> {
    const requireToken = options?.requireToken ?? false;
    const timeoutMs = options?.timeoutMs ?? 6000;

    if (!getTokenFn && CLERK_ENABLED) {
        await waitForTokenRegistration(timeoutMs);
    }

    if (!getTokenFn) {
        if (requireToken && CLERK_ENABLED) {
            throw new Error("Authentication is not ready yet.");
        }
        return null;
    }

    const endAt = Date.now() + timeoutMs;
    while (true) {
        const token = await getTokenFn().catch(() => null);
        if (token) return token;
        if (!CLERK_ENABLED || Date.now() >= endAt) break;
        await delay(250);
    }

    if (requireToken && CLERK_ENABLED) {
        throw new Error("Authentication token is not ready yet.");
    }
    return null;
}

/**
 * Register the Clerk `getToken` function so API helpers can use it.
 * Call this once from a component that has access to `useAuth()`.
 */
export function registerGetToken(fn: () => Promise<string | null>) {
    getTokenFn = fn;
    resolveTokenRegistrationWaiters();
}

/**
 * Build an Authorization header using the current Clerk session token.
 * Returns an empty object if no token is available (e.g. unauthenticated).
 */
export async function authHeaders(): Promise<Record<string, string>> {
    const token = await getAuthToken({ requireToken: CLERK_ENABLED });
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
    const token = await getAuthToken({
        requireToken: CLERK_ENABLED,
        timeoutMs: 8000,
    });
    if (!token) return base;
    return `${base}${base.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
}
