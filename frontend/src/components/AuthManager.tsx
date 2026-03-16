import React, { useState, useEffect } from 'react';
import {
    Users,
    UserPlus,
    AtSign,
    ShieldCheck,
    Key,
    MoreVertical,
    Settings,
    Lock,
    Search,
    Shield,
    BadgeCheck,
    Mail,
    Activity,
    User,
    Search as SearchIcon
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

interface AuthUser {
    id: string;
    email: string;
    role: string;
    is_verified: boolean;
    created_at?: string;
}

interface AuthSession {
    id: string;
    user_agent?: string;
    ip_address?: string;
    last_used_at?: string;
}

interface AuthUsersResponse {
    data?: AuthUser[];
    total?: number;
}

interface HealthResponse {
    status?: string;
}

interface AuthStats {
    total: number;
    authorized: number;
    oauth: number;
    rate: string;
}

type AuthManagerView = 'users' | 'sessions';

interface AuthManagerProps {
    view?: string;
}

const normalizeView = (value?: string): AuthManagerView => (
    value === 'sessions' ? 'sessions' : 'users'
);

const isAuthUser = (value: unknown): value is AuthUser => (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { id?: unknown }).id === 'string' &&
    typeof (value as { email?: unknown }).email === 'string'
);

const isAuthSession = (value: unknown): value is AuthSession => (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { id?: unknown }).id === 'string'
);

const formatDate = (value?: string): string => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString();
};

const formatDateTime = (value?: string): string => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString();
};

const AuthManager: React.FC<AuthManagerProps> = ({ view: initialView }) => {
    const [users, setUsers] = useState<AuthUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<AuthStats>({
        total: 0,
        authorized: 0,
        oauth: 0,
        rate: '99.9%'
    });
    const [view, setView] = useState<AuthManagerView>(normalizeView(initialView));
    const [sessions, setSessions] = useState<AuthSession[]>([]);
    const [platformStatus, setPlatformStatus] = useState('Checking');

    useEffect(() => {
        setView(normalizeView(initialView));
    }, [initialView]);

    useEffect(() => {
        if (view === 'users') void fetchUsers();
        else if (view === 'sessions') void fetchSessions();
    }, [view]);

    useEffect(() => {
        void fetchPlatformStatus();
    }, []);

    const handleRoleChange = async (userId: string, newRole: string) => {
        try {
            const res = await fetchWithAuth(`/api/auth/users/${userId}/role`, {
                method: 'PATCH',
                body: JSON.stringify({ role: newRole })
            });
            if (res.ok) {
                fetchUsers();
            } else {
                const data: unknown = await res.json();
                const message = (
                    typeof data === 'object' &&
                    data !== null &&
                    'error' in data &&
                    typeof (data as { error?: unknown }).error === 'string'
                ) ? (data as { error: string }).error : 'Failed to update role';
                alert(message);
            }
        } catch (error) {
            console.error('Role update failed:', error);
        }
    };

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const res = await fetchWithAuth('/api/auth/users?limit=1000');
            const result: unknown = await res.json();
            const payload = (typeof result === 'object' && result !== null ? result : {}) as AuthUsersResponse;
            const usersList = Array.isArray(payload.data) ? payload.data.filter(isAuthUser) : [];

            setUsers(usersList);
            setStats((prev: any) => ({
                ...prev,
                total: typeof payload.total === 'number' ? payload.total : usersList.length,
                authorized: usersList.filter((u: any) => u.is_verified).length
            }));
        } catch (error) {
            console.error('Failed to fetch users:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchSessions = async () => {
        setLoading(true);
        try {
            const res = await fetchWithAuth('/api/auth/sessions'); // Assuming my backend implementation endpoint
            const data: unknown = await res.json();
            const sessionsList = Array.isArray(data) ? data.filter(isAuthSession) : [];
            setSessions(sessionsList);
        } catch (error) {
            console.error('Failed to fetch sessions:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchPlatformStatus = async () => {
        try {
            const res = await fetch('/api/health');
            const payload: unknown = await res.json();
            const data = (typeof payload === 'object' && payload !== null ? payload : {}) as HealthResponse;
            if (typeof data.status === 'string') {
                setPlatformStatus(data.status === 'ok' ? 'Operational' : 'Degraded');
            } else {
                setPlatformStatus('Unavailable');
            }
        } catch (error) {
            console.error('Failed to fetch platform status:', error);
            setPlatformStatus('Unavailable');
        }
    };

    const handleRevokeSession = async (sessionId: string) => {
        if (!confirm("Are you sure you want to terminate this session?")) return;
        try {
            const res = await fetchWithAuth(`/api/auth/sessions/${sessionId}`, { method: 'DELETE' });
            if (res.ok) {
                fetchSessions();
            }
        } catch (error) {
            console.error('Revoke failed:', error);
        }
    };

    return (
        <div className="flex flex-col h-full bg-[#171717] animate-in fade-in duration-500 overflow-hidden">
            {/* Header */}
            <div className="px-8 py-10 border-b border-[#2e2e2e] bg-[#1a1a1a]">
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-6">
                        <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center border border-primary/20">
                            <Users className="text-primary" size={28} />
                        </div>
                        <div>
                            <h1 className="text-3xl font-black text-white uppercase tracking-tighter italic">Authentication</h1>
                            <p className="text-zinc-500 text-sm font-medium uppercase tracking-[0.2em] text-[10px] mt-1 flex items-center gap-2">
                                <Lock size={12} className="text-green-500" />
                                Secure Identity Access Management (SIAM)
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button className="flex items-center gap-2 bg-[#2e2e2e] hover:bg-[#3e3e3e] text-zinc-300 px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all">
                            <Settings size={14} />
                            Policies
                        </button>
                        <button className="flex items-center gap-2 bg-primary text-black px-6 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-[#E6E600] active:scale-95 transition-all shadow-[0_0_25px_rgba(254,254,0,0.15)]">
                            <UserPlus size={16} strokeWidth={3} />
                            Add User
                        </button>
                    </div>
                </div>

                {/* Subnav / Stats */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {[
                        { label: 'Total Users', val: stats.total, icon: Users, color: 'text-primary' },
                        { label: 'Authorized', val: stats.authorized, icon: BadgeCheck, color: 'text-green-500' },
                        { label: 'System Admin', val: users.filter((u: any) => u.role === 'admin').length, icon: Shield, color: 'text-blue-500' },
                        { label: 'Platform Status', val: platformStatus, icon: Activity, color: platformStatus === 'Operational' ? 'text-primary' : 'text-amber-500' }
                    ].map((s: any, i: any) => (
                        <div key={i} className="bg-[#111111] border border-[#2e2e2e] rounded-2xl p-4 flex items-center justify-between group">
                            <div>
                                <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-1">{s.label}</p>
                                <p className="text-lg font-black text-white italic tracking-tighter">{s.val}</p>
                            </div>
                            <s.icon size={20} className={`${s.color} opacity-40 group-hover:opacity-100 transition-opacity`} />
                        </div>
                    ))}
                </div>
            </div>

            {/* List */}
            <div className="p-8 flex-1 overflow-auto custom-scrollbar">
                <div className="bg-[#111111] border border-[#2e2e2e] rounded-3xl overflow-hidden shadow-2xl">
                    <div className="px-6 py-4 border-b border-[#2e2e2e] bg-[#1a1a1a] flex items-center justify-between">
                        <div className="flex gap-6">
                            <button
                                onClick={() => setView('users')}
                                className={`text-[10px] font-black uppercase tracking-widest transition-all ${view === 'users' ? 'text-primary' : 'text-zinc-600 hover:text-zinc-400'}`}
                            >
                                User Accounts
                            </button>
                            <button
                                onClick={() => setView('sessions')}
                                className={`text-[10px] font-black uppercase tracking-widest transition-all ${view === 'sessions' ? 'text-primary' : 'text-zinc-600 hover:text-zinc-400'}`}
                            >
                                Active Sessions
                            </button>
                        </div>
                        <button
                            onClick={view === 'users' ? fetchUsers : fetchSessions}
                            className="text-[10px] font-black uppercase text-zinc-500 hover:text-primary transition-colors"
                        >
                            Refresh Data
                        </button>
                    </div>

                    {view === 'users' ? (
                        <table className="w-full text-left">
                        <thead>
                            <tr className="bg-[#0c0c0c] text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600 border-b border-[#2e2e2e]">
                                <th className="px-8 py-5">Identities</th>
                                <th className="px-8 py-5">Verification</th>
                                <th className="px-8 py-5">Role</th>
                                <th className="px-8 py-5">Joined</th>
                                <th className="px-8 py-5 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#2e2e2e]/50 text-zinc-400">
                            {loading ? (
                                <tr>
                                    <td colSpan={5} className="px-8 py-20 text-center">
                                        <div className="flex flex-col items-center gap-4">
                                            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600">Synchronizing Identity Vault...</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : users.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-8 py-20 text-center">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600">No users found in database</p>
                                    </td>
                                </tr>
                            ) : (
                                users.map((u: any) => (
                                    <tr key={u.id} className="hover:bg-zinc-900/40 transition-colors group">
                                        <td className="px-8 py-5">
                                            <div className="flex items-center gap-4">
                                                <div className="w-10 h-10 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-600 group-hover:text-primary transition-colors">
                                                    <User size={18} />
                                                </div>
                                                <div>
                                                    <h3 className="text-sm font-bold text-zinc-100 uppercase tracking-tight">{u.email}</h3>
                                                    <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest leading-none mt-1">{u.id}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-8 py-5">
                                            <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border ${u.is_verified ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-zinc-800 text-zinc-500 border-zinc-700'}`}>
                                                {u.is_verified ? 'Verified' : 'Pending'}
                                            </span>
                                        </td>
                                        <td className="px-8 py-5">
                                            <select
                                                value={u.role}
                                                onChange={(e: any) => handleRoleChange(u.id, e.target.value)}
                                                className="bg-zinc-900 border border-zinc-800 text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg text-zinc-400 focus:outline-none focus:border-primary/50 transition-colors"
                                            >
                                                <option value="user">User</option>
                                                <option value="admin">Admin</option>
                                                <option value="manager">Manager</option>
                                                <option value="editor">Editor</option>
                                            </select>
                                        </td>
                                        <td className="px-8 py-5 text-xs font-black text-zinc-600 uppercase tracking-tight">
                                            {formatDate(u.created_at)}
                                        </td>
                                        <td className="px-8 py-5 text-right">
                                            <button className="p-2 text-zinc-700 hover:text-zinc-200 transition-colors">
                                                <MoreVertical size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                    ) : (
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-[#0c0c0c] text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600 border-b border-[#2e2e2e]">
                                <th className="px-8 py-5">Session Info</th>
                                <th className="px-8 py-5">Device / OS</th>
                                <th className="px-8 py-5">IP Address</th>
                                <th className="px-8 py-5">Last Active</th>
                                <th className="px-8 py-5 text-right">Protection</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#2e2e2e]/50 text-zinc-400">
                            {loading ? (
                                <tr><td colSpan={5} className="px-8 py-10 text-center animate-pulse">Syncing sessions...</td></tr>
                            ) : sessions.length === 0 ? (
                                <tr><td colSpan={5} className="px-8 py-10 text-center text-zinc-600 uppercase text-[10px] font-black">No secondary sessions found</td></tr>
                            ) : (
                                sessions.map((s: any) => (
                                    <tr key={s.id} className="hover:bg-zinc-900/40 transition-colors group">
                                        <td className="px-8 py-5">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded bg-zinc-900 flex items-center justify-center text-zinc-600">
                                                    <Activity size={14} />
                                                </div>
                                                <span className="text-xs font-bold text-zinc-200 uppercase tracking-tighter truncate max-w-[120px]">{s.id}</span>
                                            </div>
                                        </td>
                                        <td className="px-8 py-5 text-[10px] font-bold text-zinc-500 uppercase truncate max-w-[200px]">
                                            {s.user_agent || "Generic Agent / OzyBase CLI"}
                                        </td>
                                        <td className="px-8 py-5 font-mono text-xs text-zinc-500">
                                            {s.ip_address}
                                        </td>
                                        <td className="px-8 py-5 text-[10px] font-black text-zinc-600 uppercase">
                                            {formatDateTime(s.last_used_at)}
                                        </td>
                                        <td className="px-8 py-5 text-right">
                                            <button 
                                                onClick={() => handleRevokeSession(s.id)}
                                                className="px-3 py-1.5 bg-red-500/10 border border-red-500/20 text-red-500 text-[9px] font-black uppercase rounded hover:bg-red-500/20 transition-all opacity-0 group-hover:opacity-100"
                                            >
                                                Revoke
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AuthManager;
