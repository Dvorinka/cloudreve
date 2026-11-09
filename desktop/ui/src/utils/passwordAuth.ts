import { fetch } from "./fetch";
import type { ValidationError } from "./siteValidation";

const REQUEST_TIMEOUT_MS = 20000;

export interface PasswordAuthTokens {
  access_token: string;
  refresh_token: string;
  /** Seconds until access token expiry, matching `add_drive`'s config shape. */
  access_token_expires: number;
  /** Seconds until refresh token expiry. */
  refresh_token_expires: number;
}

export interface PasswordAuthResult {
  siteUrl: string;
  tokens: PasswordAuthTokens;
  user_id: string;
  nickname: string;
}

export type PasswordAuthOutcome =
  | { kind: "success"; result: PasswordAuthResult }
  | { kind: "two_factor"; sessionId: string };

interface ApiEnvelope<T> {
  code: number;
  msg?: string;
  data: T;
}

interface ServerToken {
  access_token: string;
  refresh_token: string;
  access_expires: string;
  refresh_expires: string;
}

interface ServerUser {
  id?: string;
  nickname?: string;
}

interface LoginData {
  user?: ServerUser;
  token?: ServerToken;
}

function apiError(message: string): ValidationError {
  return { type: "apiError", params: { message } };
}

function connectionFailed(e: unknown): ValidationError {
  const message = e instanceof Error ? e.message : String(e);
  return { type: "connectionFailed", params: { message } };
}

/** Seconds from now until an RFC3339 timestamp; 0 when unparseable. */
function expiresInSeconds(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return 0;
  return Math.max(0, Math.floor((ms - Date.now()) / 1000));
}

async function postJson<T>(
  siteUrl: string,
  path: string,
  body: unknown
): Promise<{ response: Response; data: ApiEnvelope<T> }> {
  const url = new URL(path, siteUrl);
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    throw connectionFailed(e);
  }

  let data: ApiEnvelope<T>;
  try {
    data = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw apiError(`HTTP ${response.status}: invalid response`);
  }
  return { response, data };
}

function parseLoginData(
  siteUrl: string,
  data: LoginData | string | undefined
): PasswordAuthResult {
  const login = data as LoginData;
  if (!login?.token?.access_token || !login.token.refresh_token) {
    throw apiError("Invalid login response from server");
  }
  return {
    siteUrl,
    tokens: {
      access_token: login.token.access_token,
      refresh_token: login.token.refresh_token,
      access_token_expires: expiresInSeconds(login.token.access_expires),
      refresh_token_expires: expiresInSeconds(login.token.refresh_expires),
    },
    user_id: login.user?.id ?? "",
    nickname: login.user?.nickname ?? "",
  };
}

/**
 * Password login against `POST /api/v4/session/token`.
 * Returns `two_factor` with the session id when the account has 2FA enabled.
 */
export async function passwordLogin(
  siteUrl: string,
  email: string,
  password: string
): Promise<PasswordAuthOutcome> {
  const { response, data } = await postJson<LoginData | string>(
    siteUrl,
    "/api/v4/session/token",
    { email, password }
  );

  if (!response.ok) {
    throw apiError(data?.msg || `HTTP ${response.status}`);
  }
  // 203 = credentials accepted but 2FA required; `data` is the session id.
  if (data.code === 203 && typeof data.data === "string") {
    return { kind: "two_factor", sessionId: data.data };
  }
  if (data.code !== 0) {
    throw apiError(data.msg || "Login failed");
  }
  return { kind: "success", result: parseLoginData(siteUrl, data.data) };
}

/** Complete a pending 2FA login via `POST /api/v4/session/token/2fa`. */
export async function verifyTwoFactor(
  siteUrl: string,
  sessionId: string,
  otp: string
): Promise<PasswordAuthResult> {
  const { response, data } = await postJson<LoginData>(
    siteUrl,
    "/api/v4/session/token/2fa",
    { otp, session_id: sessionId }
  );

  if (!response.ok) {
    throw apiError(data?.msg || `HTTP ${response.status}`);
  }
  if (data.code !== 0) {
    throw apiError(data.msg || "Verification failed");
  }
  return parseLoginData(siteUrl, data.data);
}
