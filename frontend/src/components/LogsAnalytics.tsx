import React, { useState, useEffect, useRef } from 'react';
import {
    Terminal, Search, Play, History, Activity, BarChart,
    Filter, ArrowRight, Clock, Globe, RefreshCw, Zap, Shield, Bell, X
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

const LogsAnalytics = ({ view = 'explorer' }: any) => {
    const [trafficStats, setTrafficStats] = useState<any[]>([]);
    const [geoStats, setGeoStats] = useState<any[]>([]);
    const [logs, setLogs] = useState<any[]>([]);
    const [alerts, setAlerts] = useState<any[]>([]);
    const [isLivePaused, setIsLivePaused] = useState(false);
    const [pollingInterval, setPollingInterval] = useState(5000);
    const [logLimit, setLogLimit] = useState(50);
    const [statusFilter, setStatusFilter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [lastClearedTime, setLastClearedTime] = useState(() => Number(localStorage.getItem('ozy_logs_clear_time')) || 0);
    const [lastSyncTime, setLastSyncTime] = useState<any>(null);
    const [selectedLog, setSelectedLog] = useState<any>(null);
    const generationRef = useRef(0);
    const skipNextFetchRef = useRef(false); // Only skip ONE cycle after clear
    const latestServerTimeRef = useRef(0);

    const fetchAnalytics = React.useCallback(async () => {
        try {
            const [trafficRes, geoRes] = await Promise.all([
                fetchWithAuth('/api/analytics/traffic'),
                fetchWithAuth('/api/analytics/geo')
            ]);
            if (trafficRes.ok) {
                const trafficData = await trafficRes.json();
                setTrafficStats(trafficData);
            }
            if (geoRes.ok) {
                const geoData = await geoRes.json();
                setGeoStats(geoData);
            }
        } catch (e) { console.error(e); }
    }, []);

    const fetchLogs = React.useCallback(async () => {
        const currentGen = generationRef.current;
        try {
            const params = new URLSearchParams();
            params.append('limit', String(view === 'explorer' ? logLimit : 100));
            if (statusFilter !== 'all') {
                params.append('status', statusFilter);
            }
            // Both Explorer and Live Tail use in-memory buffer for real-time updates
            // DB audit logs exclude polling endpoints, so DB-only would appear "stuck"
            params.append('source', 'memory');
            
            const res = await fetchWithAuth(`/api/project/logs?${params.toString()}`);
            if (res.ok) {
                const result = await res.json();
                const { logs: logData, server_time } = result;

                // ðŸŒ Sync server time
                if (server_time) {
                    const sTime = new Date(server_time).getTime();
                    latestServerTimeRef.current = sTime;
                    setLastSyncTime(sTime);
                }
                
                // ðŸ›‘ CRITICAL: Check generation AGAIN after the network delay!
                if (currentGen !== generationRef.current) {
                    console.debug(`ðŸ•’ [Logs Stale] Ignoring stale data from generation ${currentGen}`);
                    return;
                }

                // ðŸ§¹ Filter at fetch time: never let cleared logs enter state
                const clearTime = Number(localStorage.getItem('ozy_logs_clear_time')) || 0;
                if (clearTime > 0) {
                    const filtered = logData.filter((log: any) => {
                        if (!log.timestamp) return true;
                        return new Date(log.timestamp).getTime() > clearTime;
                    });
                    setLogs(filtered);
                } else {
                    setLogs(logData);
                }
            }
        } catch (e) { console.error(e); }
    }, [view, logLimit, statusFilter]);

    const fetchAlerts = React.useCallback(async () => {
        try {
            const res = await fetchWithAuth('/api/project/security/alerts');
            if (res.ok) {
                const data = await res.json();
                setAlerts(data);
            }
        } catch (e) { console.error(e); }
    }, []);

    const handleExport = async () => {
        try {
            const res = await fetchWithAuth('/api/project/logs/export');
            if (res.ok) {
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `ozybase_logs_${new Date().toISOString().split('T')[0]}.csv`;
                document.body.appendChild(a);
                a.click();
                a.remove();
            }
        } catch (e) { console.error("Export failed", e); }
    };

    // ðŸ”„ Reliable polling with setInterval (never breaks, unlike recursive setTimeout)
    useEffect(() => {
        let intervalId;
        let isMounted = true;

        const doFetch = async () => {
            if (!isMounted || isLivePaused) return;
            try {
                if (view === 'explorer' || view === 'metrics') await fetchAnalytics();
                if (view === 'live' || view === 'explorer' || view === 'metrics') await fetchLogs();
                if (view === 'alerts') await fetchAlerts();
            } catch (e) { console.error(e); }
        };

        // Initial fetch (skip one cycle after clear)
        if (skipNextFetchRef.current) {
            skipNextFetchRef.current = false;
        } else {
            doFetch();
        }

        // Start reliable interval-based polling
        intervalId = setInterval(doFetch, pollingInterval);

        return () => {
            isMounted = false;
            clearInterval(intervalId);
        };
    }, [view, isLivePaused, pollingInterval, lastClearedTime, fetchAnalytics, fetchLogs, fetchAlerts]);


    const renderLiveTail = () => (
        <div className="flex flex-col h-full animate-in fade-in duration-500">
            <div className="flex items-center justify-between mb-4 px-2">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 px-3 py-1 bg-yellow-500/10 border border-yellow-500/20 rounded-full">
                        <div className={`w-2 h-2 rounded-full bg-yellow-400 ${!isLivePaused && 'animate-pulse'}`} />
                        <span className="text-[10px] font-black text-yellow-500 uppercase tracking-widest">Live Streaming</span>
                    </div>
                    <span className="text-[10px] text-zinc-600 font-mono italic">Polling every {pollingInterval/1000}s</span>
                </div>
                <div className="flex items-center gap-2">
                    <button 
                        onClick={() => {
                            // ðŸ Reset generation to ignore stale in-flight fetches
                            generationRef.current += 1;
                            
                            // ðŸŒ AUTHORITATIVE: Use server-relative time for clearing
                            const referenceTime = latestServerTimeRef.current;
                            if (!referenceTime) {
                                console.warn("âš ï¸ [Clear Guard] Waiting for server sync before clearing...");
                                return;
                            }
                            const latestTimestamp = referenceTime; 
                            
                            console.log(`ðŸ§¹ [Clear Console] Gen: ${generationRef.current} | Threshold: ${new Date(latestTimestamp).toISOString()}`);
                            localStorage.setItem('ozy_logs_clear_time', latestTimestamp.toString());
                            setLastClearedTime(latestTimestamp);
                            setLogs([]);
                            skipNextFetchRef.current = true;
                        }}
                        className="flex items-center gap-2 px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-zinc-800 text-zinc-400 hover:text-white transition-all border border-transparent hover:border-zinc-700"
                    >
                        <RefreshCw size={12} />
                        Clear Console
                    </button>
                    {lastClearedTime > 0 && (
                        <button 
                            onClick={() => {
                                localStorage.removeItem('ozy_logs_clear_time');
                                setLastClearedTime(0);
                                // Immediate re-fetch (no skip)
                                console.log("ðŸ”„ [Reset Filters] All history restored.");
                            }}
                            className="bg-zinc-800 text-zinc-400 hover:text-emerald-500 p-1.5 rounded-xl transition-all border border-transparent hover:border-emerald-500/20"
                            title="Restore all logs"
                        >
                            <X size={14} />
                        </button>
                    )}
                    <div className="flex bg-zinc-900 border border-[#2e2e2e] rounded-xl p-1 gap-1">
                        {/* Status Filter for Live Stream */}
                        <select 
                            value={statusFilter}
                            onChange={(e: any) => setStatusFilter(e.target.value)}
                            className="bg-black border border-[#2e2e2e] text-[9px] font-black text-zinc-400 uppercase tracking-tighter px-2 py-1 rounded-lg outline-none focus:border-indigo-500/50 transition-all cursor-pointer"
                        >
                            <option value="all">ANY</option>
                            <option value="success">OK</option>
                            <option value="error">ERR</option>
                        </select>
                        <div className="w-[1px] h-4 bg-[#2e2e2e] my-auto mx-1" />
                        {[5000, 10000, 30000, 60000].map((int: any) => (
                            <button
                                key={int}
                                onClick={() => setPollingInterval(int)}
                                className={`px-2 py-1 rounded-lg text-[9px] font-black tracking-tighter transition-all ${pollingInterval === int ? 'bg-indigo-500 text-black' : 'text-zinc-500 hover:text-zinc-300'}`}
                            >
                                {int/1000}s
                            </button>
                        ))}
                    </div>
                    <button 
                        onClick={() => setIsLivePaused(!isLivePaused)}
                        className={`flex items-center gap-2 px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${isLivePaused ? 'bg-emerald-500 text-black' : 'bg-zinc-800 text-zinc-400 hover:text-white'}`}
                    >
                        {isLivePaused ? <Play size={12} fill="currentColor" /> : <Clock size={12} />}
                        {isLivePaused ? 'Resume Stream' : 'Pause Stream'}
                    </button>
                </div>
            </div>
            <div className="flex-1 bg-black border border-[#2e2e2e] rounded-3xl overflow-hidden font-mono text-[11px] flex flex-col">
                <div className="bg-[#1a1a1a] px-4 py-2 border-b border-[#2e2e2e] flex items-center justify-between text-zinc-500 text-[9px] font-black uppercase tracking-widest">
                    <div className="flex items-center gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full bg-emerald-500 ${!isLivePaused && 'animate-ping'}`} />
                        <span>OzyBase System Output</span>
                    </div>
                    <div className="flex items-center gap-4">
                        <span className="text-zinc-600 italic">Last Sync: {lastSyncTime ? new Date(lastSyncTime).toLocaleTimeString() : 'Connecting...'}</span>
                        <span>{new Date().toISOString()}</span>
                    </div>
                </div>
                <div className="flex-1 overflow-auto p-4 space-y-1 custom-scrollbar">
                    {logs.filter((log: any) => {
                        if (searchQuery && !log.path?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
                        return true;
                    }).map((log: any) => (
                        <div 
                            key={log.id} 
                            onClick={() => setSelectedLog(log)}
                            className="flex gap-4 group hover:bg-zinc-900/50 -mx-4 px-4 py-0.5 cursor-pointer"
                        >
                            <span className="text-zinc-600 shrink-0">[{log.time}]</span>
                            <span className={`shrink-0 font-bold ${log.method === 'GET' ? 'text-blue-400' : 'text-purple-400'}`}>{log.method}</span>
                            <span className="text-zinc-300 truncate">{log.path}</span>
                            <span className={`shrink-0 ${log.status >= 400 ? 'text-red-500' : 'text-emerald-500'}`}>{log.status}</span>
                            <span className="ml-auto text-zinc-700 italic opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">{log.latency} â€¢ {log.ip || 'local'}</span>
                        </div>
                    ))}
                    {(() => {
                        if (logs.length === 0 && !isLivePaused) {
                            return (
                                <div className="text-zinc-700 italic py-20 text-center uppercase tracking-tighter animate-pulse">
                                    {lastClearedTime > 0 ? "All previous logs cleared. Watching for new events..." : "Waiting for traffic..."}
                                </div>
                            );
                        }
                        return null;
                    })()}
                </div>
            </div>
        </div>
    );

    const renderAlerts = () => (
        <div className="space-y-6 animate-in slide-in-from-right-4 duration-500">
            <div className="p-8 bg-red-500/5 border border-red-500/20 rounded-3xl">
                <div className="flex items-center gap-4 mb-2">
                    <Shield className="text-red-500" size={32} />
                    <h2 className="text-2xl font-black text-white uppercase tracking-tighter italic">Security <span className="text-red-500">Board</span></h2>
                </div>
                <p className="text-zinc-500 text-xs">Real-time detection of policy violations, brute-force attempts, and unauthorized access.</p>
            </div>
            
            <div className="bg-[#0c0c0c] border border-[#2e2e2e] rounded-3xl overflow-hidden">
                <table className="w-full text-left">
                    <thead>
                        <tr className="bg-[#111111] text-[9px] font-black uppercase tracking-widest text-zinc-600 border-b border-[#2e2e2e]">
                            <th className="px-6 py-4">Time</th>
                            <th className="px-6 py-4">Severity</th>
                            <th className="px-6 py-4">Type</th>
                            <th className="px-6 py-4">Message</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#2e2e2e]/30 font-mono text-[10px]">
                        {alerts.map((alert: any) => (
                            <tr key={alert.id} className="hover:bg-red-500/5 transition-colors">
                                <td className="px-6 py-4 text-zinc-500">{alert.time}</td>
                                <td className="px-6 py-4">
                                    <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${alert.severity === 'high' ? 'bg-red-500 text-black shadow-[0_0_10px_rgba(239,68,68,0.3)]' : 'bg-orange-500/20 text-orange-500'}`}>
                                        {alert.severity}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-zinc-300 font-bold">{alert.type}</td>
                                <td className="px-6 py-4 text-zinc-400">{alert.message}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {alerts.length === 0 && <div className="p-20 text-center text-zinc-600 uppercase text-[10px] font-black tracking-widest italic">No security alerts detected. System is secure.</div>}
            </div>
        </div>
    );

    useEffect(() => {
        if (lastSyncTime) {
            const browserTime = Date.now();
            const drift = Math.abs(browserTime - lastSyncTime);
            if (drift > 10000) {
                console.warn(`ðŸ•’ [Clock Drift] Browser and Server clocks are desynced by ${Math.round(drift/1000)}s! This might cause "Clear Console" to behave unexpectedly if not using server-relative thresholds.`);
            }
        }
    }, [lastSyncTime]);

    const renderExplorer = () => (
        <div className="animate-in slide-in-from-bottom-2 duration-500">
            {renderLogsTable()}
        </div>
    );

    const renderMetrics = () => {
        const maxTraffic = Math.max(...trafficStats.map((s: any) => s.requests), 1);
        return (
            <div className="space-y-8 animate-in zoom-in-95 duration-500">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 p-8 bg-[#0a0a0a] border border-[#2e2e2e] rounded-3xl group hover:border-indigo-500/50 transition-all shadow-2xl">
                        <div className="flex items-center justify-between mb-8">
                            <div>
                                <h3 className="text-lg font-black text-white flex items-center gap-2 uppercase tracking-tighter italic">
                                    <BarChart size={20} className="text-indigo-400" /> Traffic Volume
                                </h3>
                                <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mt-1">Request distribution across the last 24 hours</p>
                            </div>
                            <div className="px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded-full">
                                <span className="text-[10px] font-black text-indigo-400 uppercase">Real-time</span>
                            </div>
                        </div>
                        <div className="h-64 flex items-end gap-1.5 w-full">
                            {trafficStats.map((stat: any, i: any) => (
                                <div 
                                    key={i} 
                                    title={`${stat.requests} reqs (${stat.errors} errs) | ${Math.round(stat.avg_latency)}ms`}
                                    className="flex-1 bg-zinc-900 rounded-t-lg transition-all cursor-crosshair group/bar relative border border-zinc-800/50 hover:border-indigo-500/50" 
                                    style={{ height: `${Math.max((stat.requests / maxTraffic) * 100, 5)}%` }} 
                                >
                                    {/* Success Bar */}
                                    <div 
                                        className="absolute bottom-0 left-0 right-0 bg-indigo-500/40 group-hover/bar:bg-indigo-500 transition-all rounded-t-md"
                                        style={{ height: `${((stat.requests - stat.errors) / stat.requests) * 100}%` }}
                                    />
                                    {/* Error Bar */}
                                    <div 
                                        className="absolute top-0 left-0 right-0 bg-red-500/60 group-hover/bar:bg-red-500 transition-all rounded-t-md"
                                        style={{ height: `${(stat.errors / stat.requests) * 100}%` }}
                                    />
                                    
                                    <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-black border border-zinc-800 text-white text-[9px] font-black px-2 py-1 rounded-lg opacity-0 group-hover/bar:opacity-100 transition-all shadow-xl pointer-events-none whitespace-nowrap z-10">
                                        <div className="text-indigo-400">{stat.requests} REQUESTS</div>
                                        {stat.errors > 0 && <div className="text-red-500">{stat.errors} ERRORS</div>}
                                        <div className="text-zinc-500 mt-1 pt-1 border-t border-zinc-800">{Math.round(stat.avg_latency)}ms avg</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="p-8 bg-[#0a0a0a] border border-[#2e2e2e] rounded-3xl shadow-2xl flex flex-col">
                        <h3 className="text-lg font-black text-white flex items-center gap-2 mb-8 uppercase tracking-tighter italic">
                            <Shield size={20} className="text-red-400" /> Status Health
                        </h3>
                        <div className="flex-1 flex flex-col justify-center items-center space-y-6">
                            <div className="relative w-32 h-32 flex items-center justify-center">
                                <svg className="w-full h-full -rotate-90">
                                    <circle cx="64" cy="64" r="58" fill="none" stroke="#18181b" strokeWidth="12" />
                                    {(() => {
                                        const totalReqs = trafficStats.reduce((acc: any, s: any) => acc + s.requests, 0);
                                        const totalErrs = trafficStats.reduce((acc: any, s: any) => acc + s.errors, 0);
                                        const errorRate = totalReqs > 0 ? (totalErrs / totalReqs) : 0;
                                        const circumference = 2 * Math.PI * 58;
                                        return (
                                            <>
                                                <circle 
                                                    cx="64" cy="64" r="58" fill="none" stroke="#10b981" strokeWidth="12" 
                                                    strokeDasharray={circumference}
                                                    strokeDashoffset={circumference * errorRate}
                                                />
                                                <circle 
                                                    cx="64" cy="64" r="58" fill="none" stroke="#ef4444" strokeWidth="12" 
                                                    strokeDasharray={circumference}
                                                    strokeDashoffset={circumference * (1 - errorRate)}
                                                    transform="rotate(360, 64, 64)"
                                                />
                                            </>
                                        );
                                    })()}
                                </svg>
                                <div className="absolute flex flex-col items-center">
                                    <span className="text-xl font-black text-white leading-none">
                                        {(() => {
                                            const totalReqs = trafficStats.reduce((acc: any, s: any) => acc + s.requests, 0);
                                            const totalErrs = trafficStats.reduce((acc: any, s: any) => acc + s.errors, 0);
                                            return totalReqs > 0 ? Math.round(((totalReqs - totalErrs) / totalReqs) * 100) : 100;
                                        })()}%
                                    </span>
                                    <span className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mt-1">Success</span>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4 w-full">
                                <div className="p-3 bg-emerald-500/5 rounded-2xl border border-emerald-500/10">
                                    <div className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">Total OK</div>
                                    <div className="text-lg font-black text-emerald-500 leading-none">
                                        {trafficStats.reduce((acc: any, s: any) => acc + (s.requests - s.errors), 0)}
                                    </div>
                                </div>
                                <div className="p-3 bg-red-500/5 rounded-2xl border border-red-500/10">
                                    <div className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">Total Err</div>
                                    <div className="text-lg font-black text-red-500 leading-none">
                                        {trafficStats.reduce((acc: any, s: any) => acc + s.errors, 0)}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="p-8 bg-[#0a0a0a] border border-[#2e2e2e] rounded-3xl shadow-2xl">
                        <h3 className="text-lg font-black text-white flex items-center gap-2 mb-8 uppercase tracking-tighter italic">
                            <Globe size={20} className="text-emerald-400" /> Geography
                        </h3>
                        <div className="space-y-6">
                            {geoStats.map((geo: any, i: any) => (
                                <div key={i} className="space-y-2">
                                    <div className="flex justify-between text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                                        <span className="flex items-center gap-2">
                                            {geo.country && <img src={`https://flagcdn.com/16x12/${(countryCodeMap[geo.country] || 'un')}.png`} className="w-4 h-3 opacity-80" alt="" />}
                                            {geo.country || 'Unknown'}
                                        </span>
                                        <span className="text-emerald-400">{geo.count} hit{geo.count !== 1 && 's'}</span>
                                    </div>
                                    <div className="h-2 bg-zinc-900 rounded-full overflow-hidden border border-zinc-800/50">
                                        <div className="h-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)] transition-all duration-1000" style={{ width: `${(geo.count / (geoStats[0]?.count || 1)) * 100}%` }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                        {geoStats.length === 0 && <div className="py-20 text-center text-zinc-700 text-[10px] font-black uppercase italic">No regional data available.</div>}
                    </div>
                </div>
            </div>
        );
    };

    const renderLogsTable = () => (
        <div className="bg-[#0c0c0c] border border-[#2e2e2e] rounded-3xl overflow-hidden shadow-2xl">
            <div className="h-14 border-b border-[#2e2e2e] bg-[#1a1a1a] flex items-center px-8 justify-between">
                <div className="flex items-center gap-3">
                    <Terminal size={14} className="text-indigo-400" />
                    <span className="text-[10px] font-black text-white uppercase tracking-[0.2em]">Audit & Traffic History</span>
                </div>
                <div className="flex items-center gap-3">
                    <button 
                        onClick={() => {
                            // ðŸ Reset generation to ignore stale in-flight fetches
                            generationRef.current += 1;

                            // ðŸŒ AUTHORITATIVE: Use server-relative time for clearing
                            const referenceTime = latestServerTimeRef.current;
                            if (!referenceTime) {
                                console.warn("âš ï¸ [Clear Guard] Waiting for server sync before clearing...");
                                return;
                            }
                            const latestTimestamp = referenceTime; 
                            
                            console.log(`ðŸ§¹ [Clear Explorer] Gen: ${generationRef.current} | Threshold: ${new Date(latestTimestamp).toISOString()}`);
                            localStorage.setItem('ozy_logs_clear_time', latestTimestamp.toString());
                            setLastClearedTime(latestTimestamp);
                            setLogs([]);
                            skipNextFetchRef.current = true;
                        }}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest bg-[#0c0c0c] text-zinc-500 hover:text-white transition-all border border-[#2e2e2e] hover:border-zinc-700"
                    >
                        <RefreshCw size={11} />
                        Clear Explorer
                    </button>
                    {lastClearedTime > 0 && (
                        <button 
                            onClick={() => {
                                localStorage.removeItem('ozy_logs_clear_time');
                                setLastClearedTime(0);
                                console.log("ðŸ”„ [Reset Explorer] All history restored.");
                            }}
                            className="bg-[#0c0c0c] text-zinc-500 hover:text-emerald-500 p-1.5 rounded-xl transition-all border border-[#2e2e2e] hover:border-emerald-500/20"
                            title="Restore all logs"
                        >
                            <X size={12} />
                        </button>
                    )}
                    {/* Polling Speed */}
                    <div className="flex bg-[#0c0c0c] border border-[#2e2e2e] rounded-xl p-0.5 gap-0.5">
                        {[5000, 10000, 30000, 60000].map((int: any) => (
                            <button
                                key={int}
                                onClick={() => setPollingInterval(int)}
                                className={`px-2 py-1 rounded-lg text-[9px] font-black tracking-tighter transition-all ${pollingInterval === int ? 'bg-indigo-500 text-black' : 'text-zinc-500 hover:text-zinc-300'}`}
                            >
                                {int/1000}s
                            </button>
                        ))}
                    </div>

                    {/* Status Filter */}
                    <select 
                        value={statusFilter}
                        onChange={(e: any) => setStatusFilter(e.target.value)}
                        className="bg-[#0c0c0c] border border-[#2e2e2e] text-[10px] font-black text-zinc-400 uppercase tracking-widest px-3 py-1.5 rounded-xl outline-none focus:border-indigo-500/50 transition-all cursor-pointer"
                    >
                        <option value="all">All Status</option>
                        <option value="success">Success (2xx)</option>
                        <option value="error">Errors (4xx+)</option>
                    </select>

                    {/* Log Limit */}
                    <select 
                        value={logLimit}
                        onChange={(e: any) => setLogLimit(Number(e.target.value))}
                        className="bg-[#0c0c0c] border border-[#2e2e2e] text-[10px] font-black text-zinc-400 uppercase tracking-widest px-3 py-1.5 rounded-xl outline-none focus:border-indigo-500/50 transition-all cursor-pointer"
                    >
                        <option value={10}>10 Logs</option>
                        <option value={50}>50 Logs</option>
                        <option value={100}>100 Logs</option>
                        <option value={500}>500 Logs</option>
                    </select>

                    <div className="w-[1px] h-6 bg-[#2e2e2e] mx-1" />

                    <div className="flex items-center gap-2 px-3 py-1.5 bg-black/40 border border-[#2e2e2e] rounded-xl">
                        <Search size={12} className="text-zinc-600" />
                        <input type="text" placeholder="Search paths..." value={searchQuery} onChange={(e: any) => setSearchQuery(e.target.value)} className="bg-transparent border-none text-[10px] text-zinc-400 focus:outline-none w-40 font-bold uppercase tracking-widest placeholder:text-zinc-700" />
                    </div>

                    <button 
                        onClick={handleExport}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-black transition-all border border-emerald-500/20 shadow-lg shadow-emerald-500/5"
                    >
                        <Zap size={11} />
                        Export CSV
                    </button>
                </div>
            </div>
            <table className="w-full text-left">
                <thead>
                    <tr className="bg-[#111111] text-[9px] font-black uppercase text-zinc-600 border-b border-[#2e2e2e]">
                        <th className="px-8 py-5">Timestamp</th>
                        <th className="px-8 py-5">Operation</th>
                        <th className="px-8 py-5 text-center">Protocol</th>
                        <th className="px-8 py-5">Resource Path</th>
                        <th className="px-8 py-5 text-center">Status</th>
                        <th className="px-8 py-5">Origin</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-[#2e2e2e]/30 font-mono text-[10px]">
                    {logs.filter((log: any) => {
                        if (searchQuery && !log.path?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
                        return true;
                    }).map((log: any) => (
                        <tr 
                            key={log.id} 
                            onClick={() => setSelectedLog(log)}
                            className="hover:bg-indigo-500/5 transition-colors group cursor-pointer"
                        >
                            <td className="px-8 py-4 text-zinc-500 select-none whitespace-nowrap italic">{log.time}</td>
                            <td className="px-8 py-4">
                                <span className={`px-2 py-0.5 rounded text-[9px] font-black italic ${log.method === 'GET' ? 'text-blue-400 bg-blue-400/10' : 'text-purple-400 bg-purple-400/10'}`}>{log.method}</span>
                            </td>
                            <td className="px-8 py-4 text-center text-zinc-700 font-bold tracking-widest">HTTP/1.1</td>
                            <td className="px-8 py-4 text-zinc-300 truncate max-w-[300px] font-bold">{log.path}</td>
                            <td className="px-8 py-4 text-center">
                                <span className={`min-w-[40px] inline-block font-black ${log.status >= 400 ? 'text-red-500' : 'text-emerald-500'}`}>{log.status}</span>
                            </td>
                            <td className="px-8 py-4 text-zinc-400 flex items-center gap-3">
                                {log.country && <img src={`https://flagcdn.com/16x12/${log.country === 'Unknown' ? 'un' : (countryCodeMap[log.country] || 'un')}.png`} className="w-4 h-3 rounded-sm opacity-80 shadow-sm" alt="" onError={(e: any) => { e.currentTarget.style.display = 'none'; }} />}
                                <span className="font-bold tracking-tight">{log.country || 'Localhost'}</span>
                                <span className="text-[9px] text-zinc-700 italic ml-auto opacity-0 group-hover:opacity-100 transition-opacity">{log.ip}</span>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {logs.length === 0 && (
                <div className="py-40 text-center space-y-4">
                    <div className="w-12 h-12 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-center mx-auto text-zinc-700">
                        <History size={24} />
                    </div>
                    <p className="text-[10px] font-black text-zinc-700 uppercase tracking-widest italic">
                        {lastClearedTime > 0 ? "All previous logs cleared." : "No entry logs detected yet."}
                    </p>
                </div>
            )}
        </div>
    );

    return (
        <div className="flex flex-col h-full bg-[#111111] animate-in fade-in duration-700 overflow-hidden font-sans">
            <div className="px-10 py-10 border-b border-[#2e2e2e] bg-[#1a1a1a]">
                <div className="flex items-center gap-6">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center border shadow-2xl transition-all duration-500 ${
                        view === 'alerts' ? 'bg-red-500/10 border-red-500/20 text-red-500 shadow-red-500/10' :
                        view === 'metrics' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500 shadow-emerald-500/10' :
                        'bg-indigo-500/10 border-indigo-500/20 text-indigo-400 shadow-indigo-500/10'
                    }`}>
                        {view === 'alerts' && <Shield className="animate-pulse" size={28} />}
                        {view === 'live' && <Activity className="animate-bounce" size={28} />}
                        {view === 'metrics' && <BarChart size={28} />}
                        {view === 'explorer' && <Search size={28} />}
                    </div>
                    <div>
                        <h1 className="text-3xl font-black text-white uppercase tracking-tighter italic leading-none">
                            {view === 'explorer' && "Log Explorer"}
                            {view === 'live' && "Live Tail Stream"}
                            {view === 'alerts' && "Security Alerts"}
                            {view === 'metrics' && "Traffic Analysis"}
                        </h1>
                        <p className="text-zinc-500 text-[10px] font-black uppercase tracking-[0.3em] mt-2 leading-none flex items-center gap-2">
                            <Zap size={10} className="text-indigo-500" /> System Observability & Diagnostics
                        </p>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-auto custom-scrollbar p-10">
                {view === 'explorer' && renderExplorer()}
                {view === 'live' && renderLiveTail()}
                {view === 'alerts' && renderAlerts()}
                {view === 'metrics' && renderMetrics()}
            </div>

            {selectedLog && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="w-full max-w-2xl bg-[#0c0c0c] border border-[2e2e2e] rounded-[32px] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">
                        <div className="px-8 py-6 border-b border-[#2e2e2e] flex items-center justify-between bg-[#111111]">
                            <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${selectedLog.status >= 400 ? 'bg-red-500/10 text-red-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                                    <Shield size={20} />
                                </div>
                                <div>
                                    <h2 className="text-sm font-black text-white uppercase tracking-widest leading-none">Log Details</h2>
                                    <p className="text-[9px] text-zinc-600 uppercase font-bold mt-1 tracking-widest">{selectedLog.id}</p>
                                </div>
                            </div>
                            <button onClick={() => setSelectedLog(null)} className="p-2 hover:bg-zinc-800 rounded-xl transition-all">
                                <X size={20} className="text-zinc-500" />
                            </button>
                        </div>
                        <div className="p-8 space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <DetailItem label="Method" value={selectedLog.method} highlight={selectedLog.method === 'GET' ? 'text-blue-400' : 'text-purple-400'} />
                                <DetailItem label="Status" value={selectedLog.status} highlight={selectedLog.status >= 400 ? 'text-red-500' : 'text-emerald-500'} />
                                <DetailItem label="Time" value={new Date(selectedLog.timestamp).toLocaleString()} />
                                <DetailItem label="Latency" value={selectedLog.latency} />
                                <DetailItem label="IP Address" value={selectedLog.ip || 'Localhost'} />
                                <DetailItem label="Location" value={`${selectedLog.city || 'Unknown City'}, ${selectedLog.country || 'Unknown Country'}`} />
                            </div>
                            <div className="space-y-2">
                                <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Resource Path</p>
                                <div className="p-4 bg-black border border-[#2e2e2e] rounded-2xl font-mono text-xs text-indigo-400 break-all">
                                    {selectedLog.path}
                                </div>
                            </div>
                            {selectedLog.user_agent && (
                                <div className="space-y-2">
                                    <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">User Agent</p>
                                    <div className="p-4 bg-black border border-[#2e2e2e] rounded-2xl font-mono text-[10px] text-zinc-500">
                                        {selectedLog.user_agent}
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="px-8 py-6 bg-[#111111] border-t border-[#2e2e2e] flex justify-end">
                            <button onClick={() => setSelectedLog(null)} className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all">Close</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

interface DetailItemProps {
    label: string;
    value: any;
    highlight?: string;
}

const DetailItem: React.FC<DetailItemProps> = ({ label, value, highlight }: any) => (
    <div className="space-y-1">
        <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">{label}</p>
        <p className={`text-xs font-bold ${highlight || 'text-zinc-300'}`}>{value || 'N/A'}</p>
    </div>
);

export default LogsAnalytics;

const countryCodeMap: Record<string, string> = {
    "United States": "us", "Canada": "ca", "United Kingdom": "gb", "Germany": "de",
    "France": "fr", "Japan": "jp", "Brazil": "br", "India": "in"
};

