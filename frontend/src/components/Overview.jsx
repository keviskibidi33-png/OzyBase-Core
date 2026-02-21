import React, { useState, useEffect, useCallback, useMemo, useId } from 'react';
import {
    Database,
    Activity,
    ShieldCheck,
    Lock,
    Cpu,
    Server,
    ExternalLink,
    ChevronDown,
    Shield,
    FolderOpen,
    MousePointer2
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

const DEFAULT_POINTS = 12;

const normalizeSeries = (data, fallbackSize = DEFAULT_POINTS) => {
    if (!Array.isArray(data) || data.length === 0) {
        return new Array(fallbackSize).fill(0);
    }
    return data.map((v) => Number(v) || 0);
};

const formatMetricValue = (value) => {
    const num = Number(value) || 0;
    return new Intl.NumberFormat('en-US').format(num);
};

const formatCompactMetric = (value) => {
    const num = Number(value) || 0;
    if (num < 1000) return `${Math.round(num * 10) / 10}`;
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(num);
};

const formatRangeLabels = (minutes) => {
    const safeMinutes = Math.max(1, Number(minutes) || 60);
    const end = new Date();
    const start = new Date(end.getTime() - safeMinutes * 60 * 1000);
    const dateFormat = { hour: '2-digit', minute: '2-digit', hour12: false };
    return {
        start: start.toLocaleTimeString('en-US', dateFormat),
        end: end.toLocaleTimeString('en-US', dateFormat)
    };
};

const formatBytes = (bytesValue) => {
    const bytes = Number(bytesValue);
    if (!Number.isFinite(bytes) || bytes < 0) return null;
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let idx = -1;
    while (value >= 1024 && idx < units.length - 1) {
        value /= 1024;
        idx += 1;
    }
    return `${value.toFixed(value < 10 ? 1 : 0)} ${units[idx]}`;
};

const getLatestNumericSample = (series) => {
    if (!Array.isArray(series) || series.length === 0) return null;
    const last = Number(series[series.length - 1]);
    return Number.isFinite(last) ? last : null;
};

// --- Mini Charts Components ---
const BarChart = ({ data = [], color, suffix = 'requests', maxOverride, timeRange = 60 }) => {
    const [hoveredIndex, setHoveredIndex] = useState(null);

    // Scale data to fit 0-100% height
    const chartData = normalizeSeries(data);
    const maxVal = maxOverride || Math.max(...chartData, 10);
    const labels = formatRangeLabels(timeRange);

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
                <span>{labels.start}</span>
                <span>{labels.end}</span>
            </div>
        </div>
    );
};

const MetricSparkline = ({ data = [], tone = 'emerald', suffix = 'events', timeRange = 60 }) => {
    const [hoveredIndex, setHoveredIndex] = useState(null);
    const sparklineId = useId().replace(/:/g, '');
    const safeData = normalizeSeries(data);
    const maxVal = Math.max(...safeData, 0);
    const minVal = Math.min(...safeData, 0);
    const range = Math.max(maxVal - minVal, 1);
    const labels = formatRangeLabels(timeRange);
    const toneMap = {
        emerald: {
            line: '#34d399',
            fill: 'rgba(52, 211, 153, 0.15)',
            dot: 'bg-emerald-400'
        },
        cyan: {
            line: '#22d3ee',
            fill: 'rgba(34, 211, 238, 0.15)',
            dot: 'bg-cyan-400'
        },
        amber: {
            line: '#fbbf24',
            fill: 'rgba(251, 191, 36, 0.15)',
            dot: 'bg-amber-400'
        },
        violet: {
            line: '#a78bfa',
            fill: 'rgba(167, 139, 250, 0.15)',
            dot: 'bg-violet-400'
        }
    };
    const palette = toneMap[tone] || toneMap.emerald;
    const points = safeData.map((value, idx) => {
        const x = safeData.length <= 1 ? 50 : (idx / (safeData.length - 1)) * 100;
        const y = 90 - ((value - minVal) / range) * 70;
        return { idx, x, y, value };
    });
    const pointString = points.map((point) => `${point.x},${point.y}`).join(' ');
    const areaPath = `M 0 100 L ${pointString} L 100 100 Z`;
    const hoveredPoint = hoveredIndex !== null ? points[hoveredIndex] : null;
    const tooltipLeft = hoveredPoint ? Math.min(92, Math.max(8, hoveredPoint.x)) : 50;

    return (
        <div className="mt-4">
            <div className="relative h-24 overflow-visible">
                {hoveredPoint && (
                    <div
                        className="pointer-events-none absolute -top-8 z-30 -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-900/95 px-2 py-1 text-[9px] font-black text-zinc-100 shadow-xl"
                        style={{ left: `${tooltipLeft}%` }}
                    >
                        {Number.isInteger(hoveredPoint.value) ? hoveredPoint.value : hoveredPoint.value.toFixed(1)} {suffix}
                    </div>
                )}
                <div className="relative h-full rounded-xl border border-[#2e2e2e] bg-[#0e0e0e] p-2 overflow-hidden">
                    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
                        <defs>
                            <linearGradient id={`spark-fill-${sparklineId}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={palette.fill} />
                                <stop offset="100%" stopColor="rgba(0,0,0,0)" />
                            </linearGradient>
                        </defs>
                        <path d={areaPath} fill={`url(#spark-fill-${sparklineId})`} />
                        <polyline
                            points={pointString}
                            fill="none"
                            stroke={palette.line}
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                        {points.map((point) => (
                            <circle
                                key={point.idx}
                                cx={point.x}
                                cy={point.y}
                                r={hoveredIndex === point.idx ? 2 : 1.4}
                                fill={palette.line}
                                opacity={hoveredIndex === point.idx ? 1 : 0.55}
                                className="transition-all duration-150"
                            />
                        ))}
                    </svg>
                    <div className="absolute inset-0 flex">
                        {points.map((point) => (
                            <button
                                key={`hover-${point.idx}`}
                                type="button"
                                className="flex-1 h-full opacity-0 cursor-crosshair"
                                onMouseEnter={() => setHoveredIndex(point.idx)}
                                onFocus={() => setHoveredIndex(point.idx)}
                                onMouseLeave={() => setHoveredIndex(null)}
                                onBlur={() => setHoveredIndex(null)}
                                aria-label={`${point.value} ${suffix}`}
                            />
                        ))}
                    </div>
                </div>
            </div>
            <div className="flex justify-between mt-2 text-[8px] font-black text-zinc-700 uppercase tracking-[0.15em]">
                <span>{labels.start}</span>
                <span>{labels.end}</span>
            </div>
        </div>
    );
};

const ModuleCard = ({ icon, title, metricLabel, value, data, tone, signalText, timeRange, metricUnit }) => {
    const safeData = useMemo(() => normalizeSeries(data), [data]);
    const first = safeData[0] || 0;
    const last = safeData[safeData.length - 1] || 0;
    const peak = Math.max(...safeData, 0);
    const average = safeData.reduce((acc, val) => acc + val, 0) / safeData.length;
    const delta = last - first;
    const deltaPct = first > 0 ? (delta / first) * 100 : (last > 0 ? 100 : 0);
    const trendClass = delta > 0 ? 'text-emerald-400' : (delta < 0 ? 'text-amber-400' : 'text-zinc-500');
    const toneMap = {
        emerald: 'text-emerald-300 border-emerald-400/30 bg-emerald-500/10',
        cyan: 'text-cyan-300 border-cyan-400/30 bg-cyan-500/10',
        amber: 'text-amber-300 border-amber-400/30 bg-amber-500/10',
        violet: 'text-violet-300 border-violet-400/30 bg-violet-500/10'
    };
    const toneClass = toneMap[tone] || toneMap.emerald;

    return (
        <div className="rounded-2xl border border-[#2e2e2e] bg-[#131313] p-5 transition-colors duration-200 hover:border-zinc-600">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-[#0f0f0f] border border-zinc-700 flex items-center justify-center">
                        {React.createElement(icon, { size: 15, className: 'text-zinc-300' })}
                    </div>
                    <div>
                        <span className="text-sm font-black text-zinc-100 tracking-tight">{title}</span>
                        <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mt-1">{metricLabel}</p>
                    </div>
                </div>
                <span className={`px-2 py-1 rounded-full border text-[9px] font-black uppercase tracking-widest ${toneClass}`}>
                    {signalText}
                </span>
            </div>

            <p className="text-3xl font-black text-white leading-none">{formatMetricValue(value)}</p>
            <p className={`mt-1 text-[9px] font-black uppercase tracking-widest ${trendClass}`}>
                {delta === 0 ? 'Steady trend' : `${delta > 0 ? '+' : ''}${deltaPct.toFixed(1)}% in selected window`}
            </p>

            <div className="mt-4 grid grid-cols-3 gap-2 text-[9px]">
                <div className="rounded-lg border border-[#2e2e2e] bg-[#101010] px-2 py-1.5">
                    <p className="font-black text-zinc-600 uppercase tracking-widest">Avg</p>
                    <p className="mt-1 font-mono text-zinc-300">{formatCompactMetric(average)}</p>
                </div>
                <div className="rounded-lg border border-[#2e2e2e] bg-[#101010] px-2 py-1.5">
                    <p className="font-black text-zinc-600 uppercase tracking-widest">Peak</p>
                    <p className="mt-1 font-mono text-zinc-300">{formatCompactMetric(peak)}</p>
                </div>
                <div className="rounded-lg border border-[#2e2e2e] bg-[#101010] px-2 py-1.5">
                    <p className="font-black text-zinc-600 uppercase tracking-widest">Now</p>
                    <p className="mt-1 font-mono text-zinc-300">{formatCompactMetric(last)}</p>
                </div>
            </div>
            <p className="mt-2 text-[8px] font-black uppercase tracking-[0.15em] text-zinc-600">
                Avg = mean | Peak = max | Now = latest sample
            </p>

            <MetricSparkline data={safeData} tone={tone} suffix={metricUnit || 'events'} timeRange={timeRange} />
        </div>
    );
};

const Overview = () => {
    const [projectInfo, setProjectInfo] = useState(null);
    const [healthIssues, setHealthIssues] = useState([]);
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
        const boot = setTimeout(() => {
            loadData();
        }, 0);
        const interval = setInterval(loadData, 5000);
        return () => {
            clearTimeout(boot);
            clearInterval(interval);
        };
    }, [loadData]);

    const securityIssues = useMemo(() => healthIssues.filter(i => i.type === 'security').length, [healthIssues]);
    const performanceIssues = useMemo(() => healthIssues.filter(i => i.type === 'performance').length, [healthIssues]);
    const databaseName = useMemo(() => projectInfo?.database || projectInfo?.name || 'ozybase', [projectInfo]);
    const databaseSizeLabel = useMemo(() => {
        const computed = formatBytes(projectInfo?.db_size_bytes);
        if (computed) return computed;
        return projectInfo?.db_size || 'Calculating...';
    }, [projectInfo]);
    const latestCPU = useMemo(() => getLatestNumericSample(projectInfo?.metrics?.cpu_history), [projectInfo]);
    const latestRAM = useMemo(() => getLatestNumericSample(projectInfo?.metrics?.ram_history), [projectInfo]);

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
        if (performanceIssues > 0 || ((latestCPU ?? 0) > 85)) return {
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
    }, [securityIssues, performanceIssues, latestCPU]);

    return (
        <div className="flex flex-col h-full bg-[#111111] animate-in fade-in duration-500 overflow-y-auto custom-scrollbar p-10 font-sans">

            {/* Top Bar / Header */}
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                    <h1 className="text-2xl font-black text-white italic tracking-tighter">
                        {databaseName}
                        <span className="text-[10px] not-italic font-black text-zinc-500 border border-zinc-700 px-1.5 py-0.5 rounded ml-2 align-middle">
                            {databaseSizeLabel}
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

                        <div
                            aria-hidden={!showStatusMenu}
                            className={`absolute right-0 mt-3 w-80 bg-[#1a1a1a] border border-[#2e2e2e] rounded-2xl shadow-[0_25px_50px_-12px_rgba(0,0,0,0.7)] z-[100] p-5 backdrop-blur-xl origin-top-right transform-gpu transition-all ${
                                showStatusMenu
                                    ? 'pointer-events-auto opacity-100 translate-y-0 scale-100 duration-200'
                                    : 'pointer-events-none opacity-0 -translate-y-1.5 scale-95 duration-150'
                            }`}
                        >
                                <div className="flex items-center gap-4 mb-4 pb-4 border-b border-zinc-800/50">
                                    <div className={`w-3.5 h-3.5 rounded-full ${status.color} ${status.glow}`}></div>
                                    <div>
                                        <h4 className={`text-[11px] font-black uppercase tracking-widest ${status.color.replace('bg-', 'text-')}`}>
                                            {status.label}
                                        </h4>
                                        <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-tight mt-0.5">Instance: {databaseName}</p>
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

            <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-black text-zinc-200 uppercase tracking-widest">Module Activity</h2>
                <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Hover charts for exact values</p>
            </div>

            {/* Metrics Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
                <ModuleCard
                    icon={Database}
                    title="Database"
                    metricLabel="REST Requests"
                    value={projectInfo?.metrics?.db_requests || 0}
                    data={projectInfo?.metrics?.db_history}
                    tone="emerald"
                    signalText={(projectInfo?.metrics?.db_requests || 0) > 0 ? 'active' : 'idle'}
                    metricUnit="requests"
                    timeRange={timeRange}
                />
                <ModuleCard
                    icon={Lock}
                    title="Auth"
                    metricLabel="Auth Requests"
                    value={projectInfo?.metrics?.auth_requests || 0}
                    data={projectInfo?.metrics?.auth_history}
                    tone="cyan"
                    signalText={(projectInfo?.metrics?.auth_requests || 0) > 0 ? 'active' : 'quiet'}
                    metricUnit="auth events"
                    timeRange={timeRange}
                />
                <ModuleCard
                    icon={FolderOpen}
                    title="Storage"
                    metricLabel="Storage Requests"
                    value={projectInfo?.metrics?.storage_requests || 0}
                    data={projectInfo?.metrics?.storage_history}
                    tone="amber"
                    signalText={(projectInfo?.metrics?.storage_requests || 0) > 0 ? 'active' : 'cold'}
                    metricUnit="storage ops"
                    timeRange={timeRange}
                />
                <ModuleCard
                    icon={MousePointer2}
                    title="Realtime"
                    metricLabel="Active Connections"
                    value={projectInfo?.metrics?.realtime_requests || 0}
                    data={projectInfo?.metrics?.realtime_history}
                    tone="violet"
                    signalText={(projectInfo?.metrics?.realtime_requests || 0) > 0 ? 'streaming' : 'standby'}
                    metricUnit="connections"
                    timeRange={timeRange}
                />
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
                        {latestCPU !== null ? `${latestCPU.toFixed(1)}%` : 'Collecting...'}
                    </p>
                    <BarChart
                        data={projectInfo?.metrics?.cpu_history}
                        color="bg-primary shadow-[0_0_10px_rgba(var(--primary-rgb),0.3)]"
                        suffix="%"
                        maxOverride={100}
                        timeRange={timeRange}
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
                        {latestRAM !== null ? `${latestRAM.toFixed(1)}%` : 'Collecting...'}
                    </p>
                    <BarChart
                        data={projectInfo?.metrics?.ram_history}
                        color="bg-primary shadow-[0_0_10px_rgba(var(--primary-rgb),0.3)]"
                        suffix="%"
                        maxOverride={100}
                        timeRange={timeRange}
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
