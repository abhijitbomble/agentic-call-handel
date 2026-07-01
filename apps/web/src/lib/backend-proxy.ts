import { cookies } from "next/headers";

const API_BASE_URL =
  process.env.API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://127.0.0.1:8020";

const DEMO_USERNAME = process.env.VOICEOPS_DEMO_USERNAME ?? "supervisor";
const DEMO_PASSWORD = process.env.VOICEOPS_DEMO_PASSWORD ?? "voiceops123";
const ALLOW_DEMO_FALLBACK = process.env.VOICEOPS_ALLOW_DEMO_FALLBACK === "true";

export class MissingSessionError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "MissingSessionError";
  }
}

export class BackendRequestError extends Error {
  status: number;
  payload: unknown;

  constructor(status: number, payload: unknown) {
    super(`Backend request failed with ${status}`);
    this.name = "BackendRequestError";
    this.status = status;
    this.payload = payload;
  }
}

async function getDemoToken(): Promise<string> {
  const loginResponse = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: DEMO_USERNAME, password: DEMO_PASSWORD }),
    cache: "no-store",
  });
  if (!loginResponse.ok) throw new Error("Backend authentication failed");
  const payload = (await loginResponse.json()) as { access_token: string };
  return payload.access_token;
}

function extractTokenFromCookies(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)voiceops_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function readTokenFromRequestContext(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    return cookieStore.get("voiceops_token")?.value ?? null;
  } catch {
    return null;
  }
}

async function resolveToken(cookieHeader?: string | null): Promise<string> {
  const cookieToken = extractTokenFromCookies(cookieHeader ?? null);
  if (cookieToken) return cookieToken;

  const requestToken = await readTokenFromRequestContext();
  if (requestToken) return requestToken;

  if (ALLOW_DEMO_FALLBACK) {
    return getDemoToken();
  }

  throw new MissingSessionError();
}

export async function backendRequest<T>(
  path: string,
  init?: RequestInit,
  cookieHeader?: string | null,
): Promise<T> {
  const token = await resolveToken(cookieHeader);

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : await response.text().catch(() => null);
    throw new BackendRequestError(response.status, payload);
  }

  return (await response.json()) as T;
}

