import React, { useState, useEffect } from 'react';
import {
    ShieldCheck,
    AlertTriangle,
    Zap,
    CheckCircle2,
    Info,
    RefreshCw,
    Play,
    Terminal,
    Cpu,
    Lock,
    Database,
    X
} from 'lucide-react';
import AutoFixModal from './AutoFixModal';
import { fetchWithAuth } from '../utils/api';

type IssueType = 'security' | 'performance' | string;
type ToastType = 'success' | 'error' | 'warning';

interface HealthIssueResponse {
    type: IssueType;
    title: string;
    description: string;
}

interface AdvisorIssue {
    id: number;
    type: IssueType;
    typeLabel: string;
    severity: 'Critical' | 'Warning';
    title: string;
    desc: string;
    status: 'Error' | 'Warning';
}

interface AdvisorStats {
    tableCount: number;
    functionCount: number;
    schemaCount: number;
}

interface ToastState {
    message: string;
    type: ToastType;
}

const isHealthIssueResponse = (value: unknown): value is HealthIssueResponse => (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string' &&
    typeof (value as { title?: unknown }).title === 'string' &&
    typeof (value as { description?: unknown }).description === 'string'
);

const getErrorMessage = (error: unknown, fallback: string): string => {
    if (error instanceof Error) return error.message;
    return fallback;
};

const Advisors: React.FC = () => {
    const [issues, setIssues] = useState<AdvisorIssue[]>([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<AdvisorStats>({
        tableCount: 0,
        functionCount: 0,
        schemaCount: 0
    });

    const [isAutoFixModalOpen, setIsAutoFixModalOpen] = useState(false);
    const [selectedFixIssue, setSelectedFixIssue] = useState<AdvisorIssue | null>(null);

    useEffect(() => {
        fetchHealth();
        fetchStats();
    }, []);

    const fetchHealth = async () => {
        setLoading(true);
        try {
            const res = await fetchWithAuth('/api/project/health');
            const data: unknown = await res.json();
            if (Array.isArray(data)) {
                const parsed = data
                    .filter(isHealthIssueResponse)
                    .map((item: any, index: any): AdvisorIssue => ({
                    id: index,
                    type: item.type, // 'security' or 'performance'
                    typeLabel: item.type === 'security' ? 'Security' : 'Performance',
                    severity: item.type === 'security' ? 'Critical' : 'Warning',
                    title: item.title,
                    desc: item.description,
                    status: item.type === 'security' ? 'Error' : 'Warning'
                    }));
                setIssues(parsed);
            }
        } catch (error) {
            console.error('Failed to fetch health issues:', error);
        } finally {
            setLoading(false);
        }
    };

    const [fixingId, setFixingId] = useState<number | null>(null);
    const [toast, setToast] = useState<ToastState | null>(null);

    const showToast = (message: string, type: ToastType = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 5000);
    };

    const handleApplyFix = async (issue: { id?: number; type?: string; title?: string }) => {
        const issueId = typeof issue.id === 'number' ? issue.id : null;
        setFixingId(issueId);
        try {
            const res = await fetchWithAuth('/api/project/health/fix', {
                method: 'POST',
                body: JSON.stringify({
                    type: issue.type,
                    issue: issue.title
                })
            });
            if (res.ok) {
                showToast(`Successfully applied fix for: ${issue.title ?? 'selected issue'}`, 'success');
                await fetchHealth(); // Refresh issues after fix
            } else {
                const errData: unknown = await res.json();
                const message = (
                    typeof errData === 'object' &&
                    errData !== null &&
                    'error' in errData &&
                    typeof (errData as { error?: unknown }).error === 'string'
                ) ? (errData as { error: string }).error : 'Failed to apply fix';
                showToast(message, 'error');
            }
        } catch (error) {
            console.error("Fix failed", error);
            showToast('Network error or server unavailable', 'error');
        } finally {
            setFixingId(null);
        }
    };

    const fetchStats = async () => {
        try {
            const res = await fetchWithAuth('/api/project/info');
            const data: unknown = await res.json();
            const payload = (typeof data === 'object' && data !== null) ? data as Record<string, unknown> : {};
            setStats({
                tableCount: typeof payload.table_count === 'number' ? payload.table_count : 0,
                functionCount: typeof payload.function_count === 'number' ? payload.function_count : 0,
                schemaCount: typeof payload.schema_count === 'number' ? payload.schema_count : 0
            });
        } catch (error) {
            console.error('Failed to fetch project info:', error);
        }
    };

    return (
        <div className="flex flex-col h-full bg-[#171717] animate-in fade-in duration-500 overflow-y-auto custom-scrollbar relative">
            {/* Supabase-style Toast Notification */}
            {toast && (
                <div className={`fixed top-6 right-6 z-[300] min-w-[320px] max-w-[400px] p-4 rounded-2xl shadow-2xl border animate-in slide-in-from-right duration-500 flex items-start gap-4 backdrop-blur-md ${toast.type === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-500 ring-1 ring-green-500/20' :
                        toast.type === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-500 ring-1 ring-red-500/20' :
                            'bg-amber-500/10 border-amber-500/20 text-amber-500 ring-1 ring-amber-500/20'
                    }`}>
                    <div className="mt-0.5">
                        {toast.type === 'success' && <CheckCircle2 size={18} className="animate-bounce" />}
                        {toast.type === 'error' && <AlertTriangle size={18} />}
                        {toast.type === 'warning' && <Info size={18} />}
                    </div>
                    <div className="flex-1">
                        <p className="text-[10px] font-black uppercase tracking-widest leading-tight">{toast.type}</p>
                        <p className="text-[11px] font-medium mt-1 text-white/90 leading-relaxed">{toast.message}</p>
                    </div>
                    <button onClick={() => setToast(null)} className="opacity-40 hover:opacity-100 transition-opacity mt-0.5">
                        <X size={14} />
                    </button>
                    <div className={`absolute bottom-0 left-0 h-0.5 bg-current opacity-30 animate-shrink-width`} style={{ animationDuration: '5s', animationFillMode: 'forwards' }} />
                </div>
            )}

            {/* Header */}
            <div className="px-8 py-8 border-b border-[#2e2e2e] bg-[#1a1a1a]">
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center border border-primary/20">
                            <ShieldCheck className="text-primary" size={24} />
                        </div>
                        <div>
                            <h1 className="text-2xl font-black text-white uppercase tracking-tighter italic">Advisors</h1>
                            <p className="text-zinc-500 text-sm font-medium uppercase tracking-widest text-[10px]">Security, Performance & Best Practices</p>
                        </div>
                    </div>
                    <button
                        onClick={() => { fetchHealth(); fetchStats(); }}
                        className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 text-zinc-400 px-4 py-2 rounded-lg font-black text-xs uppercase tracking-widest hover:text-primary hover:border-primary/30 transition-all"
                    >
                        <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                        Re-scan Database
                    </button>
                </div>

                {/* Score Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {[
                        { title: 'Security Score', value: issues.filter((i: any) => i.type === 'security').length > 0 ? '70/100' : '100/100', status: issues.filter((i: any) => i.type === 'security').length > 0 ? 'Action Needed' : 'Healthy', color: 'text-green-500' },
                        { title: 'Optimization', value: stats.tableCount > 0 ? 'B+' : 'A', status: 'Ready', color: 'text-primary' },
                        { title: 'Data Integrity', value: 'Grade A', status: 'Strict', color: 'text-blue-500' }
                    ].map((card: any, i: any) => (
                        <div key={i} className="bg-[#111111] border border-[#2e2e2e] rounded-2xl p-6 relative overflow-hidden group">
                            <div className="relative z-10">
                                <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest mb-1">{card.title}</p>
                                <h3 className={`text-2xl font-black ${card.color} tracking-tighter italic`}>{card.value}</h3>
                                <div className="mt-3 flex items-center gap-2">
                                    <div className={`w-1 h-1 rounded-full ${card.color.replace('text', 'bg')}`} />
                                    <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">{card.status}</span>
                                </div>
                            </div>
                            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                                <CheckCircle2 size={64} />
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Issues Explorer */}
            <div className="p-8">
                <div className="space-y-4">
                    <div className="flex items-center justify-between mb-6">
                        <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-white underline decoration-primary underline-offset-8">Real Advisory Issues ({issues.length})</h4>
                    </div>

                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-20 opacity-30 gap-4">
                            <RefreshCw className="animate-spin" size={32} />
                            <span className="text-[10px] uppercase font-black tracking-widest">Scanning OzyBase Infrastructure...</span>
                        </div>
                    ) : issues.length === 0 ? (
                        <div className="bg-[#111111] border border-green-500/20 rounded-2xl p-8 text-center">
                            <CheckCircle2 size={48} className="text-green-500 mx-auto mb-4 opacity-50" />
                            <h3 className="text-white font-bold uppercase italic tracking-tighter">Everything looks good!</h3>
                            <p className="text-zinc-500 text-xs mt-2 uppercase tracking-widest">No critical vulnerabilities detected in your current configuration.</p>
                        </div>
                    ) : (
                        issues.map((issue: any) => (
                            <div key={issue.id} className="bg-[#111111] border border-[#2e2e2e] rounded-2xl overflow-hidden shadow-xl group hover:border-zinc-700 transition-all">
                                <div className="flex items-stretch">
                                    <div className={`w-1.5 ${issue.status === 'Error' ? 'bg-red-500 shadow-[2px_0_15px_rgba(239,68,68,0.4)]' :
                                        issue.status === 'Warning' ? 'bg-primary shadow-[2px_0_15px_rgba(254,254,0,0.4)]' :
                                            'bg-blue-500'
                                        }`} />
                                    <div className="flex-1 p-6 flex items-start justify-between gap-6">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-3 mb-2">
                                                <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${issue.type === 'security' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                                                    issue.type === 'performance' ? 'bg-primary/10 text-primary border border-primary/20' :
                                                        'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                                    }`}>
                                                    {issue.typeLabel}
                                                </span>
                                                <h3 className="text-sm font-bold text-zinc-100 uppercase tracking-tight">{issue.title}</h3>
                                            </div>
                                            <p className="text-xs text-zinc-500 font-medium leading-relaxed max-w-2xl">
                                                {issue.desc}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <button
                                                onClick={() => {
                                                    setSelectedFixIssue(issue);
                                                    setIsAutoFixModalOpen(true);
                                                }}
                                                disabled={fixingId !== null}
                                                className="px-4 py-2 bg-zinc-100 text-black border border-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-primary hover:border-primary transition-all flex items-center gap-2 disabled:opacity-50"
                                            >
                                                {fixingId === issue.id ? <RefreshCw size={12} className="animate-spin" /> : <Zap size={12} fill="currentColor" />}
                                                {fixingId === issue.id ? 'Fixing...' : 'Auto-Fix'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Database Operations stats */}
                <div className="mt-12 grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {[
                        { title: 'Total Tables', value: stats.tableCount, icon: Database },
                        { title: 'Global Functions', value: stats.functionCount, icon: Zap },
                        { title: 'Schemas Detected', value: stats.schemaCount, icon: Terminal }
                    ].map((item: any, i: any) => (
                        <div key={i} className="bg-[#111111] border border-[#2e2e2e] rounded-2xl p-5 flex items-center justify-between group">
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-600 group-hover:text-primary transition-colors">
                                    <item.icon size={20} />
                                </div>
                                <div>
                                    <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-[0.1em]">{item.title}</p>
                                    <p className="text-lg font-black text-white italic tracking-tighter">{item.value}</p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <AutoFixModal
                isOpen={isAutoFixModalOpen}
                issue={selectedFixIssue}
                onClose={() => setIsAutoFixModalOpen(false)}
                onConfirm={handleApplyFix}
            />
        </div>
    );
};

export default Advisors;
