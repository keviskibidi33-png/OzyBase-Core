import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Database,
    Zap,
    Activity,
    ShieldCheck,
    Lock,
    Cpu,
    Server,
    ExternalLink,
    Search,
    ChevronDown,
    Menu,
    Triangle,
    AlertTriangle,
    Shield,
    FolderOpen,
    MousePointer2,
    Loader2
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

// --- Mini Charts Components ---
const BarChart = ({ data = [], color, suffix = 'requests', maxOverride }) => {
    const [hoveredIndex, setHoveredIndex] = useState(null);

    // Scale data to fit 0-100% height
    const maxVal = maxOverride || Math.max(...(Array.isArray(data) ? data : [0]), 10);
    const chartData = data && data.length > 0 ? data : new Array(12).fill(0);

    return (
        <div className="flex-1 flex flex-col justify-end h-24 gap-1 relative">
            <div className="absolute inset-x-0 bottom-[26px] h-[1px] bg-zinc-800/50" /> {/* Base line */}
            <div className="flex items-end justify-between h-16 gap-1.5 px-1 relative z-10">
                {chartData.map((v, i) => (
                    <div
                        key={i}
                        className={`flex-1 rounded-t-sm transition-all duration-300 relative group cursor-pointer ${color}`}
                        style={{
                            height: `${(v / maxVal) * 100}%`,
                            opacity: hoveredIndex === i ? 1 : 0.4 + (i / 30)
                        }}
                        onMouseEnter={() => setHoveredIndex(i)}
                        onMouseLeave={() => setHoveredIndex(null)}
                    >
                        {/* Tooltip */}
                        {hoveredIndex === i && (
                            <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-zinc-800 border border-[#2e2e2e] text-[9px] font-black py-1 px-2 rounded-lg text-white whitespace-nowrap z-10 shadow-xl pointer-events-none">
                                {typeof v === 'number' ? v.toFixed(1) : v} {suffix}
                            </div>
                        )}
                    </div>
                ))}
            </div>
            <div className="flex justify-between text-[8px] font-black text-zinc-700 uppercase tracking-widest mt-2 px-1">
                <span>10:00 AM</span>
                <span>11:00 AM</span>
            </div>
        </div>
    );
};

const Overview = () => {
    const [projectInfo, setProjectInfo] = useState(null);
    const [healthIssues, setHealthIssues] = useState([]);
    const [loading, setLoading] = useState(true);
    const [issuesTab, setIssuesTab] = useState('security');
    const [timeRange, setTimeRange] = useState(60);
    const [showTimeMenu, setShowTimeMenu] = useState(false);
    const [showStatusMenu, setShowStatusMenu] = useState(false);

    const loadData = useCallback(async () => {
        try {
            // Fetch project info and health issues in parallel
            const [infoRes, healthRes] = await Promise.all([
                fetchWithAuth('/api/project/info'),
                fetchWithAuth('/api/project/health')
            ]);

            if (infoRes.ok) {
                const info = await infoRes.json();
                setProjectInfo(info);
            }

            if (healthRes.ok) {
                const health = await healthRes.json();
                setHealthIssues(Array.isArray(health) ? health : []);
            }
        } catch (err) {
            console.error('Failed to load overview data:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    // Close menus on outside click
    useEffect(() => {
        const handleOutsideClick = () => {
            setShowTimeMenu(false);
            setShowStatusMenu(false);
        };
        if (showTimeMenu || showStatusMenu) {
            window.addEventListener('click', handleOutsideClick);
        }
        return () => window.removeEventListener('click', handleOutsideClick);
    }, [showTimeMenu, showStatusMenu]);

    useEffect(() => {
        loadData();
        const interval = setInterval(loadData, 5000);
        return () => clearInterval(interval);
    }, [loadData]);

    const securityIssues = useMemo(() => healthIssues.filter(i => i.type === 'security').length, [healthIssues]);
    const performanceIssues = useMemo(() => healthIssues.filter(i => i.type === 'performance').length, [healthIssues]);

    const status = useMemo(() => {
        if (securityIssues > 2) return {
            label: 'VULNERABILITY DETECTED',
            color: 'bg-red-500',
            glow: 'shadow-[0_0_12px_rgba(239,68,68,0.8)]',
            desc: 'System integrity compromised. Immediate security reinforcement is strictly required.',
            type: 'vulnerable'
        };
        if (securityIssues > 0) return {
            label: 'CRITICAL ATTENTION',
            color: 'bg-orange-500',
            glow: 'shadow-[0_0_12px_rgba(249,115,22,0.8)]',
            desc: 'Major anomalies detected in access layers. Significant system impact if unaddressed.',
            type: 'grave'
        };
        if (performanceIssues > 0 || (projectInfo?.metrics?.cpu_history?.[projectInfo.metrics.cpu_history.length - 1] > 85)) return {
            label: 'MINOR INSTABILITY',
            color: 'bg-amber-500',
            glow: 'shadow-[0_0_12px_rgba(245,158,11,0.8)]',
            desc: 'Partial subsystem degradation observed. System is monitoring for potential failure points.',
            type: 'fallas'
        };
        return {
            label: 'SYSTEM OPTIMAL',
            color: 'bg-green-500',
            glow: 'shadow-[0_0_12px_rgba(34,197,94,0.8)]',
            desc: 'All core modules are performing within nominal parameters. System environment is stable.',
            type: 'estable'
        };
    }, [securityIssues, performanceIssues, projectInfo]);

    return (
        <div className="flex flex-col h-full bg-[#111111] animate-in fade-in duration-500 overflow-y-auto custom-scrollbar p-10 font-sans">

            {/* Top Bar / Header */}
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                    <h1 className="text-2xl font-black text-white italic tracking-tighter uppercase">
                        {projectInfo?.database || 'ozybase'}
                        <span className="text-[10px] not-italic font-black text-zinc-500 border border-zinc-700 px-1.5 py-0.5 rounded ml-2 align-middle">
                            {projectInfo?.db_size || 'NANO'}
                        </span>
                    </h1>
                </div>
                <div className="flex items-center gap-12">
                    <div className="flex items-center gap-8">
                        <button
                            onClick={() => {}}
                            className="text-center group transition-all"
                        >
                            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest leading-none mb-1 group-hover:text-primary">User Tables</p>
                            <p className="text-xl font-black text-white leading-none group-hover:scale-110 transition-transform">{(projectInfo?.user_table_count !== undefined) ? projectInfo.user_table_count : '...'}</p>
                        </button>
                        <div className="text-center opacity-40">
                            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest leading-none mb-1">System</p>
                            <p className="text-xl font-black text-zinc-500 leading-none">{(projectInfo?.system_table_count !== undefined) ? projectInfo.system_table_count : '...'}</p>
                        </div>
                        <button
                            onClick={() => {}}
                            className="text-center group transition-all"
                        >
                            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest leading-none mb-1 group-hover:text-primary">Functions</p>
                            <p className="text-xl font-black text-white leading-none group-hover:scale-110 transition-transform">{projectInfo?.function_count || 0}</p>
                        </button>
                        <button
                            onClick={() => {}}
                            className="text-center group transition-all"
                        >
                            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest leading-none mb-1 group-hover:text-primary">Schemas</p>
                            <p className="text-xl font-black text-white leading-none group-hover:scale-110 transition-transform">{projectInfo?.schema_count || 0}</p>
                        </button>
                    </div>
                    <div className="relative">
                        <button
                            onClick={(e) => { e.stopPropagation(); setShowStatusMenu(!showStatusMenu); }}
                            className="bg-[#171717] border border-[#2e2e2e] text-zinc-300 px-4 py-1.5 rounded-lg flex items-center gap-3 text-[10px] font-black uppercase tracking-widest hover:border-zinc-500 transition-all shadow-xl group"
                        >
                            <div className={`w-2 h-2 rounded-full ${status.color} ${status.glow} group-hover:scale-125 transition-transform`}></div>
                            Project Status
                            <ChevronDown size={10} className={`transition-transform ${showStatusMenu ? 'rotate-180' : ''}`} />
                        </button>

                        {showStatusMenu && (
                            <div className="absolute right-0 mt-3 w-80 bg-[#1a1a1a] border border-[#2e2e2e] rounded-2xl shadow-[0_25px_50px_-12px_rgba(0,0,0,0.7)] z-[100] p-5 animate-in fade-in slide-in-from-top-2 duration-300 backdrop-blur-xl">
                                <div className="flex items-center gap-4 mb-4 pb-4 border-b border-zinc-800/50">
                                    <div className={`w-3.5 h-3.5 rounded-full ${status.color} ${status.glow}`}></div>
                                    <div>
                                        <h4 className={`text-[11px] font-black uppercase tracking-widest ${status.color.replace('bg-', 'text-')}`}>
                                            {status.label}
                                        </h4>
                                        <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-tight mt-0.5">Instance: {projectInfo?.database || 'ozybase-core'}</p>
                                    </div>
                                </div>

                                <p className="text-[10px] text-zinc-400 leading-relaxed font-medium mb-5 uppercase tracking-wide">
                                    {status.desc}
                                </p>

                                <div className="space-y-3">
                                    <div className="flex justify-between items-center p-2 rounded-lg bg-zinc-900/50 border border-zinc-800/30">
                                        <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Infrastructure</span>
                                        <span className="text-[9px] font-black text-white uppercase tracking-widest">Nominal</span>
                                    </div>
                                    <div className="flex justify-between items-center p-2 rounded-lg bg-zinc-900/50 border border-zinc-800/30">
                                        <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Security Gate</span>
                                        <span className={`text-[9px] font-black uppercase tracking-widest ${securityIssues > 0 ? 'text-orange-500' : 'text-green-500'}`}>
                                            {securityIssues > 0 ? `${securityIssues} Anomalies` : 'Verified'}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center p-2 rounded-lg bg-zinc-900/50 border border-zinc-800/30">
                                        <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Latencies</span>
                                        <span className={`text-[9px] font-black uppercase tracking-widest ${performanceIssues > 0 ? 'text-amber-500' : 'text-green-500'}`}>
                                            {performanceIssues > 0 ? 'Degraded' : 'Optimized'}
                                        </span>
                                    </div>
                                </div>

                                <div className="mt-6 pt-4 border-t border-zinc-800/50 flex justify-center">
                                    <button
                                        onClick={() => setShowStatusMenu(false)}
                                        className="text-[8px] font-black uppercase tracking-[0.2em] text-zinc-600 hover:text-white transition-colors"
                                    >
                                        Dismiss Diagnostics
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="w-full h-[1px] bg-[#2e2e2e] mb-8" />

            {/* Filter */}
            <div className="flex items-center gap-4 mb-8">
                <div className="relative">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowTimeMenu(!showTimeMenu);
                        }}
                        className="flex items-center gap-2 bg-[#171717] border border-[#2e2e2e] px-3 py-1.5 rounded-lg text-xs font-bold text-zinc-300 hover:text-white transition-colors"
                    >
                        Last {timeRange} minutes
                        <ChevronDown size={14} className={`transition-transform ${showTimeMenu ? 'rotate-180' : ''}`} />
                    </button>

                    {showTimeMenu && (
                        <div className="absolute left-0 mt-2 w-48 bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl shadow-2xl z-50 py-2 animate-in fade-in slide-in-from-top-2 duration-200">
                            {[60, 120, 160, 200].map(mins => (
                                <button
                                    key={mins}
                                    onClick={() => {
                                        setTimeRange(mins);
                                        setShowTimeMenu(false);
                                    }}
                                    className={`w-full flex items-center justify-between px-4 py-2.5 text-[10px] font-black uppercase tracking-widest transition-colors
                                        ${timeRange === mins ? 'text-primary bg-primary/5' : 'text-zinc-500 hover:text-white hover:bg-zinc-900'}
                                    `}
                                >
                                    Last {mins} minutes
                                    {timeRange === mins && <div className="w-1 h-1 rounded-full bg-primary" />}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                <span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Statistics for last {timeRange} minutes</span>
            </div>

            {/* Metrics Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
                {/* Database Card */}
                <div className="bg-[#171717] border border-[#2e2e2e] rounded-xl p-5 hover:border-zinc-700 transition-colors">
                    <div className="flex items-center gap-2 mb-4">
                        <Database size={16} className="text-zinc-500" />
                        <span className="text-sm font-bold text-zinc-200">Database</span>
                    </div>
                    <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">REST Requests</p>
                    <p className="text-2xl font-black text-white mb-6">{projectInfo?.metrics?.db_requests || 0}</p>
                    <BarChart
                        data={projectInfo?.metrics?.db_history}
                        color="bg-green-500"
                    />
                </div>

                {/* Auth Card */}
                <div className="bg-[#171717] border border-[#2e2e2e] rounded-xl p-5 hover:border-zinc-700 transition-colors">
                    <div className="flex items-center gap-2 mb-4">
                        <Lock size={16} className="text-zinc-500" />
                        <span className="text-sm font-bold text-zinc-200">Auth</span>
                    </div>
                    <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Auth Requests</p>
                    <p className="text-2xl font-black text-white mb-6">{projectInfo?.metrics?.auth_requests || 0}</p>
                    <BarChart
                        data={projectInfo?.metrics?.auth_history}
                        color="bg-green-500"
                    />
                </div>

                {/* Storage Card */}
                <div className="bg-[#171717] border border-[#2e2e2e] rounded-xl p-5 hover:border-zinc-700 transition-colors">
                    <div className="flex items-center gap-2 mb-4">
                        <FolderOpen size={16} className="text-zinc-500" />
                        <span className="text-sm font-bold text-zinc-200">Storage</span>
                    </div>
                    <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Storage Requests</p>
                    <p className="text-2xl font-black text-white mb-6">{projectInfo?.metrics?.storage_requests || 0}</p>
                    <BarChart
                        data={projectInfo?.metrics?.storage_history}
                        color="bg-green-500"
                    />
                </div>

                {/* Realtime Card */}
                <div className="bg-[#171717] border border-[#2e2e2e] rounded-xl p-5 hover:border-zinc-700 transition-colors">
                    <div className="flex items-center gap-2 mb-4">
                        <MousePointer2 size={16} className="text-zinc-500" />
                        <span className="text-sm font-bold text-zinc-200">Realtime</span>
                    </div>
                    <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Active Connections</p>
                    <p className="text-2xl font-black text-white mb-6">{projectInfo?.metrics?.realtime_requests || 0}</p>
                    <BarChart
                        data={projectInfo?.metrics?.realtime_history}
                        color={projectInfo?.metrics?.realtime_requests > 0 ? "bg-green-500" : "bg-zinc-700"}
                        suffix="backends"
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-12">
                {/* CPU Card */}
                <div className="bg-[#171717] border border-[#2e2e2e] rounded-xl p-5 hover:border-zinc-700 transition-colors">
                    <div className="flex items-center gap-2 mb-4">
                        <Cpu size={16} className="text-primary" />
                        <span className="text-sm font-bold text-zinc-200">CPU Usage</span>
                    </div>
                    <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Total System Load</p>
                    <p className="text-2xl font-black text-white mb-6">
                        {projectInfo?.metrics?.cpu_history?.[projectInfo.metrics.cpu_history.length - 1]?.toFixed(1) || 0}%
                    </p>
                    <BarChart
                        data={projectInfo?.metrics?.cpu_history}
                        color="bg-primary shadow-[0_0_10px_rgba(var(--primary-rgb),0.3)]"
                        suffix="%"
                        maxOverride={100}
                    />
                </div>

                {/* RAM Card */}
                <div className="bg-[#171717] border border-[#2e2e2e] rounded-xl p-5 hover:border-zinc-700 transition-colors">
                    <div className="flex items-center gap-2 mb-4">
                        <Server size={16} className="text-primary" />
                        <span className="text-sm font-bold text-zinc-200">Memory Usage</span>
                    </div>
                    <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Total System RAM</p>
                    <p className="text-2xl font-black text-white mb-6">
                        {projectInfo?.metrics?.ram_history?.[projectInfo.metrics.ram_history.length - 1]?.toFixed(1) || 0}%
                    </p>
                    <BarChart
                        data={projectInfo?.metrics?.ram_history}
                        color="bg-primary shadow-[0_0_10px_rgba(var(--primary-rgb),0.3)]"
                        suffix="%"
                        maxOverride={100}
                    />
                </div>
            </div>

            <h3 className="text-lg font-black text-white mb-6 flex items-center gap-2">
                {healthIssues.length} issues need <span className="text-amber-500">attention</span>
            </h3>

            {/* Bottom Panels Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-8">
                {/* Issues Panel */}
                <div className="bg-[#171717] border border-[#2e2e2e] rounded-xl overflow-hidden flex flex-col h-96">
                    <div className="flex items-center border-b border-[#2e2e2e]">
                        <button
                            onClick={() => setIssuesTab('security')}
                            className={`px-6 py-4 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 border-b-2 transition-colors ${issuesTab === 'security' ? 'text-white border-white' : 'text-zinc-500 border-transparent hover:text-zinc-300'
                                }`}
                        >
                            Security <span className="bg-amber-500/20 text-amber-500 px-1.5 rounded text-[9px]">
                                {healthIssues.filter(i => i.type === 'security').length}
                            </span>
                        </button>
                        <button
                            onClick={() => setIssuesTab('performance')}
                            className={`px-6 py-4 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 border-b-2 transition-colors ${issuesTab === 'performance' ? 'text-white border-white' : 'text-zinc-500 border-transparent hover:text-zinc-300'
                                }`}
                        >
                            Performance <span className="bg-amber-500/20 text-amber-500 px-1.5 rounded text-[9px]">
                                {healthIssues.filter(i => i.type === 'performance').length}
                            </span>
                        </button>
                        <div className="ml-auto mr-4">
                            <ExternalLink size={14} className="text-zinc-600 hover:text-zinc-300 cursor-pointer" />
                        </div>
                    </div>

                    <div className="p-4 flex-1 overflow-y-auto custom-scrollbar">
                        <div className="space-y-2">
                            {healthIssues.filter(i => i.type === issuesTab).length > 0 ? (
                                healthIssues.filter(i => i.type === issuesTab).map((issue, idx) => (
                                    <div key={idx} className="p-3 hover:bg-zinc-900/50 rounded-lg group cursor-pointer transition-colors flex items-start gap-3">
                                        {issue.type === 'security' ? (
                                            <Shield size={16} className="text-zinc-600 mt-0.5" />
                                        ) : (
                                            <Activity size={16} className="text-zinc-600 mt-0.5" />
                                        )}
                                        <div>
                                            <p className="text-xs font-mono text-zinc-300 group-hover:text-primary transition-colors">{issue.title}</p>
                                            <p className="text-[10px] text-zinc-600 mt-1">{issue.description}</p>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full text-zinc-600 mt-12">
                                    <ShieldCheck size={32} className="mb-2 opacity-50" />
                                    <p className="text-xs font-bold uppercase tracking-widest">No {issuesTab} issues detected</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Slow Queries Panel */}
                <div className="bg-[#171717] border border-[#2e2e2e] rounded-xl overflow-hidden flex flex-col h-96">
                    <div className="px-6 py-4 border-b border-[#2e2e2e] flex items-center justify-between">
                        <h4 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Slow Queries</h4>
                        <ExternalLink size={14} className="text-zinc-600 hover:text-zinc-300 cursor-pointer" />
                    </div>

                    <div className="flex-1 overflow-hidden flex flex-col">
                        <div className="grid grid-cols-12 px-6 py-2 border-b border-[#2e2e2e] bg-[#0c0c0c]">
                            <div className="col-span-8 text-[9px] font-black text-zinc-600 uppercase tracking-widest">Query</div>
                            <div className="col-span-2 text-[9px] font-black text-zinc-600 uppercase tracking-widest text-right">Avg Time</div>
                            <div className="col-span-2 text-[9px] font-black text-zinc-600 uppercase tracking-widest text-right">Calls</div>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            {projectInfo?.slow_queries?.length > 0 ? (
                                projectInfo.slow_queries.map((item, i) => (
                                    <div key={i} className="grid grid-cols-12 px-6 py-3 border-b border-[#2e2e2e]/50 hover:bg-zinc-900/40 transition-colors cursor-pointer group">
                                        <div className="col-span-8 text-[10px] font-mono text-zinc-300 truncate pr-4 group-hover:text-primary transition-colors" title={item.query}>
                                            {item.query}
                                        </div>
                                        <div className="col-span-2 text-[10px] font-mono text-zinc-400 text-right">{item.avg_time.toFixed(3)}s</div>
                                        <div className="col-span-2 text-[10px] font-mono text-zinc-400 text-right">{item.calls}</div>
                                    </div>
                                ))
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full text-zinc-600 mt-12">
                                    <Activity size={32} className="mb-2 opacity-50" />
                                    <p className="text-xs font-bold uppercase tracking-widest">No active queries detected</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Overview;
