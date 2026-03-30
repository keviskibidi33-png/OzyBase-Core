export type AuthFetchOptions = RequestInit & {
    headers?: HeadersInit;
};

export const fetchWithAuth = async (url: string, options: AuthFetchOptions = {}): Promise<Response> => {
    const token = localStorage.getItem('ozy_token');
    const workspaceId = localStorage.getItem('ozy_workspace_id');

    const headers = new Headers(options.headers ?? {});
    const hasBody = options.body !== undefined && options.body !== null;
    const isFormDataBody = typeof FormData !== 'undefined' && options.body instanceof FormData;
    if (hasBody && !isFormDataBody && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }
    if (token) {
        headers.set('Authorization', `Bearer ${token}`);
    }
    if (workspaceId) {
        headers.set('X-Workspace-Id', workspaceId);
    }

    const res = await fetch(url, { ...options, headers });

    if (res.status === 401) {
        // Clear auth on 401 and reload
        localStorage.removeItem('ozy_token');
        localStorage.removeItem('ozy_user');
        localStorage.removeItem('ozy_workspace_id');
        window.location.reload();
        throw new Error('Unauthorized');
    }

    return res;
};
