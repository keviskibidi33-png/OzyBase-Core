import React, { useEffect, useMemo, useState } from 'react';
import {
    Activity,
    BadgeCheck,
    Eye,
    Loader2,
    MoreVertical,
    Settings,
    Shield,
    User,
    UserPlus,
    Users,
    X,
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import ConfirmModal from './ConfirmModal';
import { BrandedToast } from './OverlayPrimitives';

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

interface AuthManagerProps {
    view?: string;
    onViewSelect?: (view: string) => void;
}

const EMPTY_USER_FORM = {
    email: '',
    password: '',
    role: 'user',
};

const AuthManager: React.FC<AuthManagerProps> = ({ view = 'users', onViewSelect }) => {
    const [users, setUsers] = useState<AuthUser[]>([]);
    const [sessions, setSessions] = useState<AuthSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'users' | 'sessions'>(view === 'sessions' ? 'sessions' : 'users');
    const [showCreateUser, setShowCreateUser] = useState(false);
    const [newUser, setNewUser] = useState(EMPTY_USER_FORM);
    const [selectedUser, setSelectedUser] = useState<AuthUser | null>(null);
    const [openMenuUserId, setOpenMenuUserId] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);

    useEffect(() => {
        setActiveTab(view === 'sessions' ? 'sessions' : 'users');
    }, [view]);

    useEffect(() => {
        if (activeTab === 'users') {
            void fetchUsers();
            return;
        }
        void fetchSessions();
    }, [activeTab]);

    const stats = useMemo(() => ({
        total: users.length,
        authorized: users.filter((user) => user.is_verified).length,
        admins: users.filter((user) => user.role === 'admin').length,
        status: 'Operational',
    }), [users]);

    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        setToast({ message, type });
        window.setTimeout(() => setToast(null), 2500);
    };

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const res = await fetchWithAuth('/api/auth/users?limit=1000');
            const payload = await res.json();
            const nextUsers = Array.isArray(payload?.data) ? payload.data : [];
            setUsers(nextUsers);
        } catch (error) {
            console.error('Failed to fetch users:', error);
            setUsers([]);
        } finally {
            setLoading(false);
        }
    };

    const fetchSessions = async () => {
        setLoading(true);
        try {
            const res = await fetchWithAuth('/api/auth/sessions');
            const payload = await res.json();
            setSessions(Array.isArray(payload) ? payload : []);
        } catch (error) {
            console.error('Failed to fetch sessions:', error);
            setSessions([]);
        } finally {
            setLoading(false);
        }
    };

    const handleRoleChange = async (userId: string, role: string) => {
        try {
            const res = await fetchWithAuth(`/api/auth/users/${userId}/role`, {
                method: 'PATCH',
                body: JSON.stringify({ role }),
            });
            if (!res.ok) {
                const error = await res.json();
                showToast(error.error || 'Failed to update role', 'error');
                return;
            }
            setUsers((current) => current.map((user) => (
                user.id === userId ? { ...user, role } : user
            )));
            showToast('User role updated');
        } catch (error) {
            console.error('Failed to update role:', error);
            showToast('Network error while updating role', 'error');
        }
    };

    const handleCreateUser = async (event: React.FormEvent) => {
        event.preventDefault();
        setSubmitting(true);
        try {
            const res = await fetchWithAuth('/api/auth/signup', {
                method: 'POST',
                body: JSON.stringify({
                    email: newUser.email,
                    password: newUser.password,
                }),
            });

            const payload = await res.json();
            if (!res.ok) {
                showToast(payload.error || 'Failed to create user', 'error');
                return;
            }

            if (newUser.role !== 'user') {
                await fetchWithAuth(`/api/auth/users/${payload.id}/role`, {
                    method: 'PATCH',
                    body: JSON.stringify({ role: newUser.role }),
                });
            }

            setShowCreateUser(false);
            setNewUser(EMPTY_USER_FORM);
            await fetchUsers();
            showToast('User created');
        } catch (error) {
            console.error('Failed to create user:', error);
            showToast('Network error while creating user', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    const handleRevokeSession = async (sessionId: string) => {
        try {
            const res = await fetchWithAuth(`/api/auth/sessions/${sessionId}`, { method: 'DELETE' });
            if (!res.ok) {
                showToast('Failed to revoke session', 'error');
                return;
            }
            await fetchSessions();
            showToast('Session revoked');
        } catch (error) {
            console.error('Failed to revoke session:', error);
            showToast('Network error while revoking session', 'error');
        }
    };

    return (
        <div className="flex flex-col h-full bg-[#171717] animate-in fade-in duration-500 overflow-hidden relative">
            <div className="px-8 py-10 border-b border-[#2e2e2e] bg-[#1a1a1a]">
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-6">
                        <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center border border-primary/20">
                            <Users className="text-primary" size={28} />
                        </div>
                        <div>
                            <h1 className="text-3xl font-black text-white uppercase tracking-tighter italic">Authentication</h1>
                            <p className="text-zinc-500 text-sm font-medium uppercase tracking-[0.2em] text-[10px] mt-1">
                                Secure identity access management
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => onViewSelect?.('policies')}
                            className="flex items-center gap-2 bg-[#2e2e2e] hover:bg-[#3e3e3e] text-zinc-300 px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all"
                        >
                            <Settings size={14} />
                            Permissions
                        </button>
                        <button
                            onClick={() => setShowCreateUser(true)}
                            className="flex items-center gap-2 bg-primary text-black px-6 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-[#E6E600] active:scale-95 transition-all shadow-[0_0_25px_rgba(254,254,0,0.15)]"
                        >
                            <UserPlus size={16} strokeWidth={3} />
                            Add User
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {[
                        { label: 'Total Users', value: stats.total, icon: Users, color: 'text-primary' },
                        { label: 'Authorized', value: stats.authorized, icon: BadgeCheck, color: 'text-green-500' },
                        { label: 'System Admin', value: stats.admins, icon: Shield, color: 'text-blue-500' },
                        { label: 'Platform Status', value: stats.status, icon: Activity, color: 'text-primary' },
                    ].map((item) => (
                        <div key={item.label} className="bg-[#111111] border border-[#2e2e2e] rounded-2xl p-4 flex items-center justify-between group">
                            <div>
                                <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-1">{item.label}</p>
                                <p className="text-lg font-black text-white italic tracking-tighter">{item.value}</p>
                            </div>
                            <item.icon size={20} className={`${item.color} opacity-40 group-hover:opacity-100 transition-opacity`} />
                        </div>
                    ))}
                </div>
            </div>

            <div className="p-8 flex-1 overflow-auto custom-scrollbar">
                <div className="bg-[#111111] border border-[#2e2e2e] rounded-3xl overflow-hidden shadow-2xl">
                    <div className="px-6 py-4 border-b border-[#2e2e2e] bg-[#1a1a1a] flex items-center justify-between">
                        <div className="flex gap-6">
                            <button
                                onClick={() => setActiveTab('users')}
                                className={`text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'users' ? 'text-primary' : 'text-zinc-600 hover:text-zinc-400'}`}
                            >
                                User Accounts
                            </button>
                            <button
                                onClick={() => setActiveTab('sessions')}
                                className={`text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'sessions' ? 'text-primary' : 'text-zinc-600 hover:text-zinc-400'}`}
                            >
                                Active Sessions
                            </button>
                        </div>
                        <button
                            onClick={activeTab === 'users' ? () => void fetchUsers() : () => void fetchSessions()}
                            className="text-[10px] font-black uppercase text-zinc-500 hover:text-primary transition-colors"
                        >
                            Refresh Data
                        </button>
                    </div>

                    {activeTab === 'users' ? (
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
                                                <Loader2 className="animate-spin text-primary" size={28} />
                                                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600">Synchronizing Identity Vault...</p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : users.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="px-8 py-20 text-center">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600">No users found</p>
                                        </td>
                                    </tr>
                                ) : (
                                    users.map((user) => (
                                        <tr key={user.id} className="hover:bg-zinc-900/40 transition-colors group">
                                            <td className="px-8 py-5">
                                                <div className="flex items-center gap-4">
                                                    <div className="w-10 h-10 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-600 group-hover:text-primary transition-colors">
                                                        <User size={18} />
                                                    </div>
                                                    <div>
                                                        <h3 className="text-sm font-bold text-zinc-100 tracking-tight">{user.email}</h3>
                                                        <p className="text-[10px] font-mono text-zinc-600 tracking-widest leading-none mt-1">{user.id}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-8 py-5">
                                                <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border ${user.is_verified ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-zinc-800 text-zinc-500 border-zinc-700'}`}>
                                                    {user.is_verified ? 'Verified' : 'Pending'}
                                                </span>
                                            </td>
                                            <td className="px-8 py-5">
                                                <select
                                                    value={user.role}
                                                    onChange={(event) => void handleRoleChange(user.id, event.target.value)}
                                                    className="bg-zinc-900 border border-zinc-800 text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg text-zinc-400 focus:outline-none focus:border-primary/50 transition-colors"
                                                >
                                                    <option value="user">User</option>
                                                    <option value="admin">Admin</option>
                                                    <option value="manager">Manager</option>
                                                    <option value="editor">Editor</option>
                                                </select>
                                            </td>
                                            <td className="px-8 py-5 text-xs font-black text-zinc-600 uppercase tracking-tight">
                                                {user.created_at ? new Date(user.created_at).toLocaleDateString() : 'Unknown'}
                                            </td>
                                            <td className="px-8 py-5 text-right">
                                                <div className="relative inline-flex">
                                                    <button
                                                        onClick={() => setOpenMenuUserId((current) => current === user.id ? null : user.id)}
                                                        className="p-2 text-zinc-700 hover:text-zinc-200 transition-colors"
                                                    >
                                                        <MoreVertical size={16} />
                                                    </button>
                                                    {openMenuUserId === user.id && (
                                                        <div className="absolute right-0 top-10 z-20 w-48 p-2 ozy-floating-panel">
                                                            <button
                                                                onClick={() => {
                                                                    setSelectedUser(user);
                                                                    setOpenMenuUserId(null);
                                                                }}
                                                                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs text-zinc-400 hover:text-white hover:bg-zinc-900 transition-all"
                                                            >
                                                                <Eye size={14} />
                                                                View Detail
                                                            </button>
                                                            <button
                                                                onClick={() => {
                                                                    void handleRoleChange(user.id, user.role === 'admin' ? 'user' : 'admin');
                                                                    setOpenMenuUserId(null);
                                                                }}
                                                                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs text-zinc-400 hover:text-white hover:bg-zinc-900 transition-all"
                                                            >
                                                                <Shield size={14} />
                                                                {user.role === 'admin' ? 'Demote to User' : 'Promote to Admin'}
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
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
                                    <tr><td colSpan={5} className="px-8 py-10 text-center"><Loader2 className="animate-spin text-primary mx-auto" /></td></tr>
                                ) : sessions.length === 0 ? (
                                    <tr><td colSpan={5} className="px-8 py-10 text-center text-zinc-600 uppercase text-[10px] font-black">No secondary sessions found</td></tr>
                                ) : (
                                    sessions.map((session) => (
                                        <tr key={session.id} className="hover:bg-zinc-900/40 transition-colors group">
                                            <td className="px-8 py-5">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded bg-zinc-900 flex items-center justify-center text-zinc-600">
                                                        <Activity size={14} />
                                                    </div>
                                                    <span className="text-xs font-bold text-zinc-200 tracking-tighter truncate max-w-[180px]">{session.id}</span>
                                                </div>
                                            </td>
                                            <td className="px-8 py-5 text-[10px] font-bold text-zinc-500 uppercase truncate max-w-[200px]">
                                                {session.user_agent || 'Generic Agent / OzyBase CLI'}
                                            </td>
                                            <td className="px-8 py-5 font-mono text-xs text-zinc-500">
                                                {session.ip_address || 'Unknown'}
                                            </td>
                                            <td className="px-8 py-5 text-[10px] font-black text-zinc-600 uppercase">
                                                {session.last_used_at ? new Date(session.last_used_at).toLocaleString() : 'Unknown'}
                                            </td>
                                            <td className="px-8 py-5 text-right">
                                                <button
                                                    onClick={() => setPendingSessionId(session.id)}
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

            {showCreateUser && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-6">
                    <div className="absolute inset-0 ozy-overlay-backdrop backdrop-blur-md" onClick={() => setShowCreateUser(false)} />
                    <form onSubmit={handleCreateUser} className="ozy-dialog-panel relative w-full max-w-lg overflow-hidden">
                        <div className="px-8 py-6 border-b border-[#2e2e2e] bg-[#171717] flex items-center justify-between">
                            <div>
                                <h2 className="text-xl font-black text-white uppercase tracking-tight">Create User</h2>
                                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mt-1">Provision a new authenticated user account</p>
                            </div>
                            <button type="button" onClick={() => setShowCreateUser(false)} className="text-zinc-500 hover:text-white transition-colors">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="p-8 space-y-5">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Email</label>
                                <input
                                    required
                                    type="email"
                                    value={newUser.email}
                                    onChange={(event) => setNewUser((current) => ({ ...current, email: event.target.value }))}
                                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary/50"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Temporary Password</label>
                                <input
                                    required
                                    minLength={8}
                                    type="password"
                                    value={newUser.password}
                                    onChange={(event) => setNewUser((current) => ({ ...current, password: event.target.value }))}
                                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary/50"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Role</label>
                                <select
                                    value={newUser.role}
                                    onChange={(event) => setNewUser((current) => ({ ...current, role: event.target.value }))}
                                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary/50"
                                >
                                    <option value="user">User</option>
                                    <option value="admin">Admin</option>
                                    <option value="manager">Manager</option>
                                    <option value="editor">Editor</option>
                                </select>
                            </div>
                        </div>
                        <div className="px-8 py-5 border-t border-[#2e2e2e] bg-[#171717] flex justify-end gap-3">
                            <button type="button" onClick={() => setShowCreateUser(false)} className="px-5 py-2.5 text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white transition-colors">
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={submitting}
                                className="px-6 py-2.5 bg-primary text-black rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-60 flex items-center gap-2"
                            >
                                {submitting ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                                {submitting ? 'Creating' : 'Create User'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {selectedUser && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-6">
                    <div className="absolute inset-0 ozy-overlay-backdrop backdrop-blur-md" onClick={() => setSelectedUser(null)} />
                    <div className="ozy-dialog-panel relative w-full max-w-md overflow-hidden">
                        <div className="px-8 py-6 border-b border-[#2e2e2e] bg-[#171717] flex items-center justify-between">
                            <h2 className="text-xl font-black text-white uppercase tracking-tight">User Detail</h2>
                            <button onClick={() => setSelectedUser(null)} className="text-zinc-500 hover:text-white transition-colors">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="p-8 space-y-4 text-sm">
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Email</p>
                                <p className="text-white mt-1">{selectedUser.email}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Role</p>
                                <p className="text-white mt-1">{selectedUser.role}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">User ID</p>
                                <code className="text-zinc-300 break-all">{selectedUser.id}</code>
                            </div>
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Created At</p>
                                <p className="text-white mt-1">{selectedUser.created_at ? new Date(selectedUser.created_at).toLocaleString() : 'Unknown'}</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmModal
                isOpen={!!pendingSessionId}
                onClose={() => setPendingSessionId(null)}
                onConfirm={() => pendingSessionId ? handleRevokeSession(pendingSessionId) : undefined}
                title="Terminate Session"
                message="This token will be revoked immediately and the client will need to authenticate again."
                confirmText="Revoke Session"
                type="danger"
            />

            {toast ? (
                <BrandedToast
                    tone={toast.type === 'error' ? 'error' : 'success'}
                    message={toast.message}
                    onClose={() => setToast(null)}
                />
            ) : null}
        </div>
    );
};

export default AuthManager;
