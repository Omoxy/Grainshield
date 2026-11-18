/**
 * API client for GrainShield frontend.
 *
 * Server-side: proxyToService() reads the JWT from the httpOnly cookie
 * and forwards it to the appropriate backend microservice.
 *
 * Client-side: fetcher() is used by SWR hooks to call Next.js API routes.
 */

/** Service URL mapping — reads from env with localhost fallbacks for local dev. */
const SERVICE_URLS: Record<string, string> = {
  farmer: process.env.FARMER_SERVICE_URL ?? "http://localhost:8080",
  policy: process.env.POLICY_SERVICE_URL ?? "http://localhost:8081",
  risk: process.env.RISK_SERVICE_URL ?? "http://localhost:8084",
  notification: process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:8086",
};

/** Cookie name matching middleware.ts and auth API routes. */
const TOKEN_COOKIE = "gs_token";

/** API error with status code for structured error handling. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Server-side proxy: forwards a request to a backend microservice.
 * Used inside Next.js API route handlers (app/api/...).
 *
 * Reads the JWT from the gs_token cookie and sets it as a Bearer token.
 */
export async function proxyToService(
  service: string,
  path: string,
  request: Request,
): Promise<Response> {
  const baseUrl = SERVICE_URLS[service];
  if (!baseUrl) {
    return Response.json({ error: "unknown service" }, { status: 500 });
  }

  // Extract JWT from cookie
  const cookieHeader = request.headers.get("cookie") ?? "";
  const tokenMatch = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${TOKEN_COOKIE}=([^;]+)`),
  );
  const token = tokenMatch?.[1];

  if (!token) {
    return Response.json({ error: "not authenticated" }, { status: 401 });
  }

  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  try {
    const upstream = await fetch(url, {
      method: request.method,
      headers,
      body: request.method !== "GET" ? await request.text() : undefined,
    });

    const data = await upstream.text();
    return new Response(data, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return Response.json(
      { error: "service unavailable" },
      { status: 502 },
    );
  }
}

/**
 * Client-side SWR fetcher.
 * Calls Next.js API routes (which proxy to backend services).
 * Always sends credentials so the httpOnly cookie is included.
 */
export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "request failed" }));
    throw new ApiError(body.error ?? "request failed", res.status);
  }

  return res.json();
}

/**
 * Client-side POST/PUT/DELETE caller for mutation endpoints.
 */
export async function mutationFetcher<T>(
  url: string,
  method: "POST" | "PUT" | "DELETE" = "POST",
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "request failed" }));
    throw new ApiError(data.error ?? "request failed", res.status);
  }

  return res.json();
}

/**
 * Server-side helper: extract the user's sub (ID) from the JWT cookie.
 * Decodes payload without verifying — backend does full verification.
 */
export function extractSubFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const tokenMatch = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${TOKEN_COOKIE}=([^;]+)`),
  );
  const token = tokenMatch?.[1];
  if (!token) return null;

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(payload);
    const parsed = JSON.parse(decoded);
    return parsed.sub ?? null;
  } catch {
    return null;
  }
}

/**
 * Server-side helper: extract roles from the JWT cookie.
 */
export function extractRolesFromRequest(request: Request): string[] {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const tokenMatch = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${TOKEN_COOKIE}=([^;]+)`),
  );
  const token = tokenMatch?.[1];
  if (!token) return [];

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return [];
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(payload);
    const parsed = JSON.parse(decoded);
    return Array.isArray(parsed.roles) ? parsed.roles : [];
  } catch {
    return [];
  }
}
