import axios, { type AxiosRequestConfig } from 'axios';

import {
  httpStatusOf,
  sessionProbeOutcomeFromError,
  shouldClearSessionFromProbe,
  type SessionProbeOutcome,
} from '../../auth/services/auth-resilience';

const API_URL = import.meta.env.VITE_API_URL;

if (!API_URL) {
  throw new Error('VITE_API_URL is missing from frontend .env');
}

const TOKEN_KEY = 'token';
const USER_KEY = 'tradex_user';

export const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem(TOKEN_KEY);

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => Promise.reject(error),
);

// ============================================================
// SESSION-INVALIDATION CONFIRMATION (cold-start resilience)
// ============================================================
//
// A single 401 is NO LONGER enough to wipe the stored session: while a
// sleeping backend wakes up, a transient 401 (e.g. the JWKS fetch failing
// once) must not log the user out. Instead ONE deduped confirmation probe
// runs; the session is cleared only when that probe ALSO returns 401.
// - Network error / timeout / 5xx on the probe => session PRESERVED.
// - The probe itself is marked so it can never re-enter this branch
//   (no infinite loop) and it is never retried.
// - Authentication is not bypassed: the original request still rejects with
//   its 401, and an invalid token is still rejected by the probe.
// ============================================================

interface AuthConfirmationMarker {
  _isAuthConfirmation?: boolean;
}

type MarkedRequestConfig = AxiosRequestConfig & AuthConfirmationMarker;

let sessionConfirmation: Promise<SessionProbeOutcome> | null = null;

function clearStoredSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/** Single bounded probe: CONFIRMED-invalid only when the probe 401s. */
async function probeSession(): Promise<SessionProbeOutcome> {
  try {
    await apiClient.get('/auth/me', {
      timeout: 10000,
      _isAuthConfirmation: true,
    } as MarkedRequestConfig);
    return 'VALID'; // token still valid — keep the session
  } catch (error) {
    return sessionProbeOutcomeFromError(error);
  }
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = httpStatusOf(error);
    const config = (error as { config?: MarkedRequestConfig }).config;

    if (status === 401 && !config?._isAuthConfirmation) {
      if (!localStorage.getItem(TOKEN_KEY)) {
        clearStoredSession();
      } else {
        // Deduplicate concurrent 401s into ONE probe (no request storm).
        sessionConfirmation ??= probeSession().finally(() => {
          sessionConfirmation = null;
        });

        if (shouldClearSessionFromProbe(await sessionConfirmation)) {
          clearStoredSession();
        }
      }
    }

    return Promise.reject(error);
  },
);

/**
 * Best-effort warm-up: fires a single /health request so a sleeping backend
 * starts booting while the UI renders. Never blocks, never throws, and has
 * no effect on the auth flow (implemented at zero risk).
 */
export function warmUpBackend(): void {
  void apiClient.get('/health', { timeout: 15000 }).catch(() => undefined);
}

export default apiClient;