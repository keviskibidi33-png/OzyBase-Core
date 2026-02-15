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
    User
} from 'lucide-react';

const AuthManager = () => {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        total: 0,
        authorized: 0,
        oauth: 0,
        rate: '99.9%'
    });

    useEffect(() => {
        fetchUsers();
    }, []);

    const handleRoleChange = async (userId, newRole) => {
        try {
            const token = localStorage.getItem('ozy_token');
            const res = await fetch(`/api/auth/users/${userId}/role`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ role: newRole })
            });
            if (res.ok) {
                fetchUsers();
            } else {
                const data = await res.json();
                alert(data.error || 'Failed to update role');
            }
        } catch (error) {
            console.error('Role update failed:', error);
        }
    };

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('ozy_token');
            const res = await fetch('/api/tables/users?limit=1000', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            const result = await res.json();
            const usersList = result.data || [];

            setUsers(usersList);
            setStats(prev => ({
                ...prev,
                total: result.total || usersList.length,
                authorized: usersList.filter(u => u.is_verified).length
            }));
        } catch (error) {
            console.error('Failed to fetch users:', error);
        } finally {
            setLoading(false);
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
                        { label: 'System Admin', val: users.filter(u => u.role === 'admin' || u.email?.includes('ozybase.local')).length, icon: Shield, color: 'text-blue-500' },
                        { label: 'Platform Status', val: 'Operational', icon: Activity, color: 'text-primary' }
                    ].map((s, i) => (
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
                        <div className="flex gap-4">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={14} />
                                <input
                                    type="text"
                                    placeholder="Find user by email or ID..."
                                    className="bg-[#0c0c0c] border border-[#2e2e2e] rounded-xl pl-9 pr-6 py-2 text-xs text-zinc-300 focus:outline-none focus:border-primary/50 w-80 transition-all font-mono"
                                />
                            </div>
                        </div>
                        <button
                            onClick={fetchUsers}
                            className="text-[10px] font-black uppercase text-zinc-500 hover:text-primary transition-colors"
                        >
                            Refresh Data
                        </button>
                    </div>

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
                                    <td colSpan="5" className="px-8 py-20 text-center">
                                        <div className="flex flex-col items-center gap-4">
                                            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600">Synchronizing Identity Vault...</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : users.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="px-8 py-20 text-center">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600">No users found in database</p>
                                    </td>
                                </tr>
                            ) : (
                                users.map((u) => (
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
                                                onChange={(e) => handleRoleChange(u.id, e.target.value)}
                                                className="bg-zinc-900 border border-zinc-800 text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg text-zinc-400 focus:outline-none focus:border-primary/50 transition-colors"
                                            >
                                                <option value="user">User</option>
                                                <option value="admin">Admin</option>
                                                <option value="manager">Manager</option>
                                                <option value="editor">Editor</option>
                                            </select>
                                        </td>
                                        <td className="px-8 py-5 text-xs font-black text-zinc-600 uppercase tracking-tight">
                                            {new Date(u.created_at).toLocaleDateString()}
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
                </div>
            </div>
        </div>
    );
};

export default AuthManager;
