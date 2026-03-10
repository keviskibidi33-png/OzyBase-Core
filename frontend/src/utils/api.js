export const fetchWithAuth = async (url, options = {}) => {
    const token = localStorage.getItem('ozy_token');

    const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...options.headers,
    };

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
