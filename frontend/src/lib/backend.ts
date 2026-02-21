const ABSOLUTE_HTTP_URL = /^https?:\/\//i;
const ABSOLUTE_WS_URL = /^wss?:\/\//i;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function withLeadingSlash(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

const configuredBackendUrl = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.trim();
const normalizedBackendUrl = configuredBackendUrl
  ? trimTrailingSlash(configuredBackendUrl)
  : "";

const configuredWsUrl = (import.meta.env.VITE_WS_URL as string | undefined)?.trim();
const normalizedWsUrl = configuredWsUrl ? trimTrailingSlash(configuredWsUrl) : "";

function toWsOrigin(httpUrl: string): string {
  const parsed = new URL(httpUrl);
  const protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${parsed.host}`;
}

export function apiUrl(path: string): string {
  if (ABSOLUTE_HTTP_URL.test(path)) {
    return path;
  }

  const normalizedPath = withLeadingSlash(path);
  if (!normalizedBackendUrl) {
    return normalizedPath;
  }

  return `${normalizedBackendUrl}${normalizedPath}`;
}

export function backendWsUrl(path: string): string {
  if (ABSOLUTE_WS_URL.test(path)) {
    return path;
  }

  const normalizedPath = withLeadingSlash(path);

  if (normalizedWsUrl) {
    return `${normalizedWsUrl}${normalizedPath}`;
  }

  if (normalizedBackendUrl && ABSOLUTE_HTTP_URL.test(normalizedBackendUrl)) {
    return `${toWsOrigin(normalizedBackendUrl)}${normalizedPath}`;
  }

  if (typeof window === "undefined") {
    return normalizedPath;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${normalizedPath}`;
}
