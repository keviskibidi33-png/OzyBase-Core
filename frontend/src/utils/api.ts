export type AuthFetchOptions = RequestInit & {
    headers?: HeadersInit;
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
let csrfTokenCache: string | null = null;
let csrfTokenPromise: Promise<string | null> | null = null;

const clearAuthStorage = () => {
    localStorage.removeItem('ozy_token');
    localStorage.removeItem('ozy_api_key');
    localStorage.removeItem('ozy_user');
    localStorage.removeItem('ozy_workspace_id');
    localStorage.removeItem('ozy_auth_mode');
};

const isSameOriginRequest = (url: string): boolean => {
    try {
        const target = new URL(url, window.location.origin);
        return target.origin === window.location.origin;
    } catch {
        return false;
    }
};

const looksLikeCSRFFailure = async (res: Response): Promise<boolean> => {
    try {
        const payload = await res.clone().json() as { error?: unknown; message?: unknown };
        const message = String(payload.error ?? payload.message ?? '').toLowerCase();
        return message.includes('csrf');
    } catch {
        return false;
    }
};

const resolveCSRFToken = async (forceRefresh = false): Promise<string | null> => {
    if (!forceRefresh && csrfTokenCache) {
        return csrfTokenCache;
    }
    if (!forceRefresh && csrfTokenPromise) {
        return csrfTokenPromise;
    }

    csrfTokenPromise = fetch('/api/auth/csrf', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
    })
        .then(async (res) => {
            if (!res.ok) {
                return null;
            }
            const data = await res.json() as { csrf_token?: unknown };
            const token = typeof data.csrf_token === 'string' ? data.csrf_token.trim() : '';
            csrfTokenCache = token || null;
            return csrfTokenCache;
        })
        .catch(() => null)
        .finally(() => {
            csrfTokenPromise = null;
        });

    return csrfTokenPromise;
};

const fetchWithAuthInternal = async (url: string, options: AuthFetchOptions = {}, retryingCSRF = false): Promise<Response> => {
    const token = localStorage.getItem('ozy_token')?.trim();
    const apiKey = localStorage.getItem('ozy_api_key')?.trim();
    const workspaceId = localStorage.getItem('ozy_workspace_id')?.trim();
    const method = (options.method || 'GET').toUpperCase();
    const sameOrigin = isSameOriginRequest(url);

    const headers = new Headers(options.headers ?? {});
    const hasBody = options.body !== undefined && options.body !== null;
    const isFormDataBody = typeof FormData !== 'undefined' && options.body instanceof FormData;
    if (hasBody && !isFormDataBody && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }
    if (sameOrigin && token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
    } else if (sameOrigin && apiKey && !headers.has('apikey') && !headers.has('X-Ozy-Key')) {
        headers.set('apikey', apiKey);
    }
    if (sameOrigin && workspaceId && !headers.has('X-Workspace-Id')) {
        headers.set('X-Workspace-Id', workspaceId);
    }

    const authenticatedRequest = headers.has('Authorization') || headers.has('apikey') || headers.has('X-Ozy-Key');
    const needsCSRF = sameOrigin && !SAFE_METHODS.has(method) && !authenticatedRequest && !headers.has('X-CSRF-Token');
    if (needsCSRF) {
        const csrfToken = await resolveCSRFToken(retryingCSRF);
        if (csrfToken) {
            headers.set('X-CSRF-Token', csrfToken);
        }
    }

    const res = await fetch(url, {
        credentials: sameOrigin ? 'same-origin' : options.credentials,
        ...options,
        headers,
    });

    if (res.status === 403 && needsCSRF && !retryingCSRF && await looksLikeCSRFFailure(res)) {
        csrfTokenCache = null;
        return fetchWithAuthInternal(url, options, true);
    }

    if (res.status === 401 && authenticatedRequest) {
        clearAuthStorage();
        window.location.reload();
        throw new Error('Unauthorized');
    }

    return res;
};

export const fetchWithAuth = async (url: string, options: AuthFetchOptions = {}): Promise<Response> => (
    fetchWithAuthInternal(url, options)
);
