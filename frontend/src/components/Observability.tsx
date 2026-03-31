import React, { useState, useEffect } from 'react';
import {
    Activity,
    AlertTriangle,
    ArrowUpRight,
    Monitor,
    Database,
    ShieldCheck,
    Cpu,
    BellRing
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

const Observability = ({ onViewSelect }: any) => {
    const [info, setInfo] = useState<any>(null);
    const [logs, setLogs] = useState<any[]>([]);
    const [sloStatus, setSloStatus] = useState<any>(null);
    const [alertRouting, setAlertRouting] = useState<any>(null);
    const [storageStatus, setStorageStatus] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchInfo();
        fetchLogs();
        const interval = setInterval(() => {
            fetchInfo();
            fetchLogs();
        }, 5000);
        return () => clearInterval(interval);
    }, []);

    const fetchInfo = async () => {
        try {
            const [infoRes, sloRes, routingRes, storageRes] = await Promise.all([
                fetchWithAuth('/api/project/info'),
                fetchWithAuth('/api/project/observability/slo'),
                fetchWithAuth('/api/project/security/alert-routing'),
                fetchWithAuth('/api/project/observability/storage'),
            ]);

            if (infoRes.ok) {
                const data = await infoRes.json();
                setInfo(data);
            }
            if (sloRes.ok) {
                const data = await sloRes.json();
                setSloStatus(data);
            }
            if (routingRes.ok) {
                const data = await routingRes.json();
                setAlertRouting(data);
            }
            if (storageRes.ok) {
                const data = await storageRes.json();
                setStorageStatus(data);
            }
        } catch (error) {
            console.error('Failed to fetch info:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchLogs = async () => {
        try {
            const res = await fetchWithAuth('/api/project/logs');
            const data = await res.json();
            if (Array.isArray(data)) {
                setLogs(data.slice(0, 4));
            } else if (Array.isArray(data?.logs)) {
                setLogs(data.logs.slice(0, 4));
            }
        } catch (error) {
            console.error('Failed to fetch logs:', error);
        }
    };

    const stats = info ? [
        { title: 'DB Requests', value: info.metrics.db_requests, change: 'Live', up: true, icon: Database },
        { title: 'Auth Events', value: info.metrics.auth_requests, change: 'Live', up: true, icon: ShieldCheck },
        { title: 'Active Connections', value: info.metrics.realtime_requests, change: 'DB', up: true, icon: Activity },
        { title: 'DB Version', value: info.version.split(' ')[0], change: 'Core', up: true, icon: Cpu }
    ] : [];

    const evaluation = sloStatus?.evaluation || alertRouting?.slo || null;
    const rules = Array.isArray(alertRouting?.rules) ? alertRouting.rules : [];
    const routes = Array.isArray(alertRouting?.routes) ? alertRouting.routes : [];
    const warnings = Array.isArray(alertRouting?.warnings) ? alertRouting.warnings : [];
    const storageSummary = storageStatus?.summary || null;
    const storageBuckets = Array.isArray(storageStatus?.buckets) ? storageStatus.buckets : [];
    const storageAlerts = Array.isArray(storageStatus?.alerts) ? storageStatus.alerts : [];
    const storageHistory = Array.isArray(storageStatus?.history) ? storageStatus.history : [];
    const maxStorageHistoryBytes = storageHistory.length > 0
        ? Math.max(...storageHistory.map((point: any) => Number(point.created_bytes || 0)), 1)
        : 1;

    return (
        <div className="flex flex-col h-full bg-[#111111] animate-in fade-in duration-500 overflow-y-auto custom-scrollbar">
            {/* Realtime Stats Header */}
            <div className="p-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {loading ? (
                    [...Array(4)].map((_: any, i: any) => (
                        <div key={i} className="bg-[#171717] border border-[#2e2e2e] rounded-2xl p-6 h-32 animate-pulse" />
                    ))
                ) : stats.map((stat: any, i: any) => (
                    <div key={i} className="bg-[#171717] border border-[#2e2e2e] rounded-2xl p-6 shadow-xl group hover:border-primary/30 transition-all">
                        <div className="flex items-center justify-between mb-4">
                            <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500 group-hover:text-primary transition-colors font-bold">
                                <stat.icon size={20} />
                            </div>
                            <div className={`flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-green-500`}>
                                <ArrowUpRight size={12} />
                                {stat.change}
                            </div>
                        </div>
                        <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest mb-1">{stat.title}</p>
                        <h3 className="text-2xl font-black text-white tracking-tighter italic">{stat.value}</h3>
                    </div>
                ))}
            </div>

            {/* Main Graphs Area */}
            <div className="px-8 pb-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-[#171717] border border-[#2e2e2e] rounded-2xl p-6 h-80 flex flex-col relative overflow-hidden">
                    <div className="flex items-center justify-between mb-8">
                        <div>
                            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-white">Database Load History</h4>
                            <p className="text-[9px] text-zinc-600 uppercase font-black tracking-widest mt-0.5">Real-time throughput metrics (Last 12 mins)</p>
                        </div>
                        <div className="flex gap-2">
                            <div className="bg-[#111111] border border-[#2e2e2e] rounded-lg px-2 py-1 text-[9px] font-bold uppercase text-zinc-500">Live</div>
                        </div>
                    </div>
                    {/* Visualizer with Real Data */}
                    <div className="flex-1 flex items-end gap-2 px-2">
                        {info?.metrics.db_history.map((val: any, i: any) => (
                            <div
                                key={i}
                                style={{ height: `${Math.min(100, (val / (Math.max(...info.metrics.db_history, 1) * 1.2)) * 100)}%` }}
                                className={`flex-1 rounded-t-sm transition-all duration-500 bg-primary/40 hover:bg-primary/80 group relative`}
                            >
                                <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-black border border-[#2e2e2e] rounded px-1.5 py-0.5 text-[8px] text-primary opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-20">
                                    {val} reqs
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-primary/5 to-transparent pointer-events-none" />
                </div>

                <div className="bg-[#171717] border border-[#2e2e2e] rounded-2xl p-6 h-80 flex flex-col">
                    <div className="flex items-center justify-between mb-8">
                        <div>
                            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-white">Storage Pressure</h4>
                            <p className="text-[9px] text-zinc-600 uppercase font-black tracking-widest mt-0.5">Quota, lifecycle and multipart activity</p>
                        </div>
                        <div className="px-2 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-[9px] font-black uppercase tracking-widest text-zinc-400">
                            {storageSummary?.provider || 'local'}
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
                            <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Stored Data</p>
                            <p className="mt-2 text-2xl font-black italic tracking-tighter text-white">{storageSummary?.total_size_human || '0 B'}</p>
                            <p className="mt-1 text-[10px] text-zinc-500">{storageSummary?.object_count || 0} objects across {storageSummary?.bucket_count || 0} buckets</p>
                        </div>
                        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
                            <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Recent 24h</p>
                            <p className="mt-2 text-2xl font-black italic tracking-tighter text-white">{storageSummary?.recent_upload_bytes_24h_human || '0 B'}</p>
                            <p className="mt-1 text-[10px] text-zinc-500">{storageSummary?.recent_uploads_24h || 0} uploads in the last day</p>
                        </div>
                    </div>
                    <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                        <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-widest text-zinc-500">
                            <span>Tracked Quota Usage</span>
                            <span>{storageSummary?.quota_usage_pct?.toFixed?.(2) || '0.00'}%</span>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-900">
                            <div
                                className={`h-full rounded-full ${
                                    (storageSummary?.quota_usage_pct || 0) >= 95 ? 'bg-red-500' :
                                        (storageSummary?.quota_usage_pct || 0) >= 80 ? 'bg-amber-500' :
                                            'bg-primary'
                                }`}
                                style={{ width: `${Math.min(100, Number(storageSummary?.quota_usage_pct || 0))}%` }}
                            />
                        </div>
                        <div className="mt-3 flex items-center justify-between text-[10px] text-zinc-500">
                            <span>{storageSummary?.quota_enabled_buckets || 0} quota-enabled buckets</span>
                            <span>{storageSummary?.total_quota_human || '0 B'} tracked</span>
                        </div>
                    </div>
                    <div className="mt-4 flex-1 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                        <div className="flex items-center justify-between">
                            <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Upload History 24h</p>
                            <p className="text-[9px] font-black uppercase tracking-widest text-zinc-700">Maintenance {storageSummary?.maintenance_interval_minutes || 0}m</p>
                        </div>
                        <div className="mt-4 flex h-24 items-end gap-1">
                            {storageHistory.slice(-12).map((point: any, index: number) => (
                                <div key={index} className="group relative flex-1 rounded-t-sm bg-primary/30">
                                    <div
                                        className="w-full rounded-t-sm bg-primary transition-all"
                                        style={{ height: `${Math.max(6, (Number(point.created_bytes || 0) / maxStorageHistoryBytes) * 100)}%` }}
                                    />
                                    <div className="absolute -top-10 left-1/2 z-10 hidden -translate-x-1/2 rounded-lg border border-zinc-800 bg-black px-2 py-1 text-[8px] font-black uppercase tracking-widest text-zinc-300 group-hover:block">
                                        {point.created_bytes_human}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="mt-4 grid grid-cols-3 gap-2 text-[10px] text-zinc-500">
                            <div className="rounded-xl border border-zinc-800 bg-[#111111] px-3 py-2">
                                <p className="font-black uppercase tracking-widest text-zinc-600">Open Multipart</p>
                                <p className="mt-1 text-sm font-black text-white">{storageSummary?.open_multipart_sessions || 0}</p>
                            </div>
                            <div className="rounded-xl border border-zinc-800 bg-[#111111] px-3 py-2">
                                <p className="font-black uppercase tracking-widest text-zinc-600">Expired Sessions</p>
                                <p className="mt-1 text-sm font-black text-white">{storageSummary?.expired_upload_sessions || 0}</p>
                            </div>
                            <div className="rounded-xl border border-zinc-800 bg-[#111111] px-3 py-2">
                                <p className="font-black uppercase tracking-widest text-zinc-600">Reclaimable</p>
                                <p className="mt-1 text-sm font-black text-white">{storageSummary?.reclaimable_human || '0 B'}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* SLO + Alert Routing */}
            <div className="px-8 pb-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-[#171717] border border-[#2e2e2e] rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-white">Service SLO</h4>
                            <p className="text-[9px] text-zinc-600 uppercase font-black tracking-widest mt-0.5">Availability, error rate, and p95 latency</p>
                        </div>
                        <div className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${
                            evaluation?.status === 'breached' ? 'bg-red-500/10 text-red-500' :
                            evaluation?.status === 'insufficient_data' ? 'bg-amber-500/10 text-amber-500' :
                            'bg-green-500/10 text-green-500'
                        }`}>
                            {evaluation?.status || 'unknown'}
                        </div>
                    </div>
                    <div className="space-y-3">
                        <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-xl flex items-center justify-between">
                            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Availability</span>
                            <span className="text-xs font-black text-white">
                                {evaluation?.availability?.current ?? '--'}% / {evaluation?.availability?.objective ?? '--'}%
                            </span>
                        </div>
                        <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-xl flex items-center justify-between">
                            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Error Rate</span>
                            <span className="text-xs font-black text-white">
                                {evaluation?.error_rate?.current ?? '--'}% / {evaluation?.error_rate?.objective ?? '--'}%
                            </span>
                        </div>
                        <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-xl flex items-center justify-between">
                            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Latency P95</span>
                            <span className="text-xs font-black text-white">
                                {evaluation?.latency_p95?.current ?? '--'}ms / {evaluation?.latency_p95?.objective ?? '--'}ms
                            </span>
                        </div>
                    </div>
                </div>

                <div className="bg-[#171717] border border-[#2e2e2e] rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-white">Alert Routing / On-Call</h4>
                            <p className="text-[9px] text-zinc-600 uppercase font-black tracking-widest mt-0.5">Actionable rules and escalation targets</p>
                        </div>
                        <BellRing size={16} className="text-zinc-500" />
                    </div>

                    <div className="flex items-center gap-2 mb-4">
                        <div className={`w-2 h-2 rounded-full ${alertRouting?.on_call?.enabled ? 'bg-green-500' : 'bg-zinc-700'}`} />
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                            On-call {alertRouting?.on_call?.enabled ? 'enabled' : 'disabled'}
                        </span>
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-700">Routes: {routes.length}</span>
                    </div>

                    <div className="space-y-2">
                        {rules.slice(0, 3).map((rule: any) => (
                            <div key={rule.id} className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-xl flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-[10px] font-black text-white uppercase tracking-widest">{rule.name}</p>
                                    <p className="text-[10px] text-zinc-500 mt-1">{rule.current_value} (target {rule.threshold})</p>
                                </div>
                                <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg ${
                                    rule.breached ? 'bg-red-500/10 text-red-500' : 'bg-zinc-800 text-zinc-500'
                                }`}>
                                    {rule.severity}
                                </span>
                            </div>
                        ))}
                        {rules.length === 0 ? (
                            <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-600">
                                No routing rules loaded
                            </div>
                        ) : null}
                        {warnings.length > 0 ? (
                            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-[10px] text-amber-500 flex items-start gap-2">
                                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                                <span>{warnings[0]}</span>
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>

            <div className="px-8 pb-8 grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div className="bg-[#171717] border border-[#2e2e2e] rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-white">Top Buckets</h4>
                            <p className="text-[9px] text-zinc-600 uppercase font-black tracking-widest mt-0.5">Quota visibility by namespace</p>
                        </div>
                        <span className="text-[9px] font-black uppercase tracking-widest text-zinc-700">{storageBuckets.length} loaded</span>
                    </div>
                    <div className="space-y-3">
                        {storageBuckets.slice(0, 5).map((bucket: any) => (
                            <div key={bucket.name} className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-white">{bucket.name}</p>
                                        <p className="mt-1 text-[10px] text-zinc-500">{bucket.object_count} objects • {bucket.total_size_human}</p>
                                    </div>
                                    <div className={`rounded-lg px-2 py-1 text-[9px] font-black uppercase tracking-widest ${
                                        bucket.usage_ratio_pct >= 95 ? 'bg-red-500/10 text-red-500' :
                                            bucket.usage_ratio_pct >= 80 ? 'bg-amber-500/10 text-amber-500' :
                                                'bg-zinc-800 text-zinc-400'
                                    }`}>
                                        {bucket.max_total_size_bytes > 0 ? `${bucket.usage_ratio_pct.toFixed(2)}%` : 'Open'}
                                    </div>
                                </div>
                                <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#111111]">
                                    <div
                                        className={`h-full rounded-full ${
                                            bucket.usage_ratio_pct >= 95 ? 'bg-red-500' :
                                                bucket.usage_ratio_pct >= 80 ? 'bg-amber-500' :
                                                    'bg-primary'
                                        }`}
                                        style={{ width: `${Math.min(100, Number(bucket.usage_ratio_pct || 0))}%` }}
                                    />
                                </div>
                                <div className="mt-3 flex items-center justify-between text-[10px] text-zinc-500">
                                    <span>Quota {bucket.max_total_size_human}</span>
                                    <span>Lifecycle {bucket.lifecycle_delete_after_days > 0 ? `${bucket.lifecycle_delete_after_days}d` : 'off'}</span>
                                </div>
                            </div>
                        ))}
                        {storageBuckets.length === 0 ? (
                            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 text-[10px] font-black uppercase tracking-widest text-zinc-600">
                                No storage buckets detected yet
                            </div>
                        ) : null}
                    </div>
                </div>

                <div className="bg-[#171717] border border-[#2e2e2e] rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-white">Storage Alerts</h4>
                            <p className="text-[9px] text-zinc-600 uppercase font-black tracking-widest mt-0.5">Actionable signals before storage becomes a support incident</p>
                        </div>
                        <AlertTriangle size={16} className="text-zinc-500" />
                    </div>
                    <div className="space-y-3">
                        {storageAlerts.map((alert: any, index: number) => (
                            <div key={`${alert.scope}-${index}`} className={`rounded-2xl border p-4 ${
                                alert.severity === 'critical' ? 'border-red-500/30 bg-red-500/10' :
                                    alert.severity === 'warning' ? 'border-amber-500/30 bg-amber-500/10' :
                                        'border-zinc-800 bg-zinc-900/50'
                            }`}>
                                <div className="flex items-center justify-between gap-3">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-white">{alert.title}</p>
                                    <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">{alert.scope}</span>
                                </div>
                                <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">{alert.detail}</p>
                            </div>
                        ))}
                        {storageAlerts.length === 0 ? (
                            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 text-[10px] font-black uppercase tracking-widest text-zinc-600">
                                No storage alerts. Buckets, multipart sessions and lifecycle look healthy.
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>

            {/* API Gateway Logs */}
            <div className="px-8 pb-12">
                <div className="bg-[#111111] border border-[#2e2e2e] rounded-2xl overflow-hidden shadow-2xl">
                    <div className="px-6 py-4 border-b border-[#2e2e2e] bg-[#1a1a1a] flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Monitor size={16} className="text-zinc-500" />
                            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-white">Real-time Gateway Logs</h4>
                        </div>
                        <button 
                            onClick={() => onViewSelect('logs')}
                            className="text-[9px] font-black uppercase text-primary tracking-widest hover:underline"
                        >
                            View All Logs
                        </button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <tbody className="divide-y divide-[#2e2e2e]/30">
                                {logs.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="px-6 py-10 text-center text-zinc-600 text-[10px] font-black uppercase tracking-widest">No activity detected yet</td>
                                    </tr>
                                ) : logs.map((log: any) => (
                                    <tr key={log.id} className="hover:bg-zinc-900/50 transition-colors group">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-4">
                                                <span className={`px-2 py-0.5 rounded-[4px] text-[10px] font-black uppercase tracking-widest border ${log.method === 'POST' ? 'bg-blue-500/10 text-blue-500 border-blue-500/20' :
                                                    log.method === 'GET' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                                                        'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'
                                                    }`}>
                                                    {log.method}
                                                </span>
                                                <span className="text-xs font-mono text-zinc-400 group-hover:text-zinc-200 transition-colors uppercase tracking-tight truncate max-w-xs">{log.path}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <div className={`w-1 h-1 rounded-full ${log.status >= 400 ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]' : 'bg-green-500'}`} />
                                                <span className="text-[11px] font-bold text-zinc-500">{log.status}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-[10px] font-bold text-zinc-600 uppercase tracking-widest">
                                            {log.latency}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <span className="text-[10px] font-mono text-zinc-700">{log.time}</span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Observability;
