import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Shield, Globe, MapPin, AlertTriangle, CheckCircle,
    TrendingUp, ShieldAlert, Activity, RefreshCw,
    ShieldCheck, Lock, Unlock, Zap, MoreHorizontal,
    UserX, ServerCrash
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

const SecurityDashboard = () => {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const fetchData = useCallback(async (isAutoRefresh = false) => {
        if (!isAutoRefresh) setRefreshing(true);
        try {
            const res = await fetchWithAuth('/api/project/security/stats');
            if (res.ok) {
                const data = await res.json();
                setStats(data);
            }
        } catch (error) {
            console.error("Failed to fetch security stats", error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
        const interval = setInterval(() => fetchData(true), 30000); // 30s refresh
        return () => clearInterval(interval);
    }, [fetchData]);

    const statsGrid = useMemo(() => [
        { label: 'Total Checks', value: stats?.total_checks || 0, icon: Activity, color: 'text-blue-500', bg: 'bg-blue-500/10' },
        { label: 'Blocked Threats', value: stats?.blocked_requests || 0, icon: ShieldAlert, color: 'text-red-500', bg: 'bg-red-500/10' },
        { label: 'Health Score', value: '98%', icon: ShieldCheck, color: 'text-green-500', bg: 'bg-green-500/10' },
        { label: 'Last Breach', value: stats?.last_breach_at ? new Date(stats.last_breach_at).toLocaleTimeString() : 'Never', icon: Zap, color: 'text-amber-500', bg: 'bg-amber-500/10' },
    ], [stats]);

    if (loading) return (
        <div className="flex flex-col items-center justify-center h-full gap-4 text-zinc-500">
            <div className="relative">
                <Shield size={48} className="text-primary/20" />
                <Activity size={24} className="text-primary animate-pulse absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
            </div>
            <span className="text-[10px] font-black uppercase tracking-[0.3em] animate-pulse">Scanning Security Perimeter...</span>
        </div>
    );

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500 pb-20">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="relative">
                        <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" />
                        <div className="relative p-3 bg-zinc-900 border border-primary/20 rounded-2xl">
                            <ShieldAlert className="text-primary" size={32} />
                        </div>
                    </div>
                    <div>
                        <h1 className="text-4xl font-black text-white uppercase tracking-tighter italic leading-none">Global Security</h1>
                        <p className="text-zinc-500 text-[10px] font-black uppercase tracking-[0.2em] mt-2 flex items-center gap-2">
                            <Activity size={12} className="text-green-500" />
                            Perimeter Monitoring Active
                        </p>
                    </div>
                </div>
                <button
                    onClick={() => fetchData()}
                    className={`p-3 bg-zinc-900 border border-[#2e2e2e] rounded-xl hover:border-primary/50 transition-all ${refreshing ? 'animate-spin' : ''}`}
                >
                    <RefreshCw size={18} className="text-zinc-400" />
                </button>
            </div>

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {statsGrid.map((s, i) => (
                    <div key={i} className="p-6 bg-[#111111] border border-[#2e2e2e] rounded-3xl group hover:border-primary/20 transition-all relative overflow-hidden">
                        <div className={`absolute -right-4 -top-4 w-24 h-24 blur-3xl opacity-20 ${s.bg}`} />
                        <div className="relative flex items-center justify-between mb-4">
                            <div className={`p-2 rounded-xl border border-white/5 ${s.bg}`}>
                                <s.icon className={s.color} size={20} />
                            </div>
                            <TrendingUp size={14} className="text-zinc-700" />
                        </div>
                        <div className="relative">
                            <div className="text-2xl font-black text-white italic tracking-tighter">{s.value}</div>
                            <div className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mt-1">{s.label}</div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Traffic Source Map View - Simplified */}
                <div className="lg:col-span-2 p-8 bg-[#111111] border border-[#2e2e2e] rounded-[2.5rem] relative overflow-hidden">
                    <div className="flex items-center justify-between mb-8">
                        <div>
                            <h2 className="text-xl font-black text-white uppercase tracking-tight italic">Threat Distribution</h2>
                            <p className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest mt-1">Geographic source of security events</p>
                        </div>
                        <Globe size={24} className="text-zinc-800" />
                    </div>

                    <div className="space-y-4">
                        {stats.top_countries?.length > 0 ? (
                            stats.top_countries.map((g, i) => (
                                <div key={i} className="group cursor-default">
                                    <div className="flex items-center justify-between text-xs mb-2 px-2">
                                        <div className="flex items-center gap-3">
                                            <div className="w-1.5 h-1.5 rounded-full bg-primary ring-4 ring-primary/10" />
                                            <span className="font-black text-zinc-300 uppercase tracking-tighter">{g.country}</span>
                                        </div>
                                        <span className="font-mono text-zinc-500">{g.count} events</span>
                                    </div>
                                    <div className="h-1.5 w-full bg-zinc-900 rounded-full overflow-hidden border border-white/5">
                                        <div
                                            className="h-full bg-gradient-to-r from-primary/40 to-primary group-hover:from-primary group-hover:to-white transition-all duration-1000"
                                            style={{ width: `${(g.count / stats.total_checks) * 1000}%` }} // Scale it up for visibility
                                        />
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="py-20 flex flex-col items-center justify-center border-2 border-dashed border-zinc-800 rounded-3xl text-zinc-700 gap-3">
                                <Globe size={32} strokeWidth={1} />
                                <span className="text-[10px] font-black uppercase tracking-widest">No global data collected yet</span>
                            </div>
                        )}
                    </div>

                    {/* Breach Alerts Feed */}
                    <div className="mt-12">
                        <div className="flex items-center justify-between mb-4 px-2">
                            <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Latest Breach Alerts</h3>
                        </div>
                        <div className="grid gap-2">
                            <div className="p-4 bg-red-500/5 border border-red-500/10 rounded-2xl flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="p-2 bg-red-500/20 rounded-lg text-red-500"><UserX size={16} /></div>
                                    <div>
                                        <p className="text-xs font-bold text-white">Unauthorized Access Attempt</p>
                                        <p className="text-[9px] text-zinc-600 uppercase font-bold tracking-widest">Geo-Fencing Breach: 185.20.12.3 (Russia)</p>
                                    </div>
                                </div>
                                <span className="text-[10px] font-mono text-zinc-600">2m ago</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Sidebar Stats */}
                <div className="space-y-8">
                    {/* Top Offenders (IPs) */}
                    <div className="p-8 bg-[#111111] border border-[#2e2e2e] rounded-[2.5rem]">
                        <div className="flex items-center gap-3 mb-8">
                            <div className="p-2 bg-amber-500/10 rounded-xl text-amber-500"><Lock size={18} /></div>
                            <h2 className="text-lg font-black text-white uppercase tracking-tight italic">Top Offenders</h2>
                        </div>
                        <div className="space-y-2">
                            {stats.top_ips?.map((ip, i) => (
                                <div key={i} className="p-3 bg-zinc-900/50 border border-zinc-800 rounded-xl flex items-center justify-between hover:border-zinc-700 transition-colors">
                                    <div className="flex items-center gap-3">
                                        <span className="text-[10px] font-black text-zinc-700">#0{i + 1}</span>
                                        <span className="text-xs font-mono text-zinc-300">{ip.ip}</span>
                                    </div>
                                    <span className="bg-zinc-800 px-2 py-0.5 rounded text-[9px] font-black text-zinc-500">{ip.count}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* RBAC Quick View */}
                    <div className="p-8 bg-primary/5 border border-primary/10 rounded-[2.5rem] relative overflow-hidden group hover:bg-primary/[0.07] transition-all">
                        <div className="absolute -left-4 -bottom-4 w-32 h-32 bg-primary blur-3xl opacity-10" />
                        <div className="flex items-center gap-3 mb-6 relative">
                            <Unlock className="text-primary" size={20} strokeWidth={2.5} />
                            <h2 className="text-lg font-black text-white uppercase tracking-tight italic">RBAC Guard</h2>
                        </div>
                        <div className="space-y-4 relative">
                            <div className="flex items-center justify-between pb-3 border-b border-primary/10">
                                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Authenticated Users</span>
                                <span className="text-xs font-black text-primary italic">Enabled</span>
                            </div>
                            <div className="flex items-center justify-between pb-3 border-b border-primary/10">
                                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Anonymous Access</span>
                                <span className="text-xs font-black text-red-500 italic">Restricted</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Admin Overrides</span>
                                <span className="text-xs font-black text-primary italic">Active</span>
                            </div>
                        </div>
                        <button className="w-full mt-8 py-3 bg-primary text-black text-[10px] font-black uppercase tracking-[0.2em] rounded-2xl hover:scale-[1.02] transition-all shadow-[0_0_20px_rgba(254,254,0,0.1)]">
                            Manage Roles
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SecurityDashboard;
