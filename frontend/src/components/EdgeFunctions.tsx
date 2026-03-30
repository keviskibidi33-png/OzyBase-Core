import React, { useState, useEffect } from 'react';
import {
    Zap,
    Terminal,
    Play,
    Plus,
    Search,
    MoreVertical,
    ExternalLink,
    Code,
    Cpu,
    Globe,
    X
} from 'lucide-react';
import { BrandedToast } from './OverlayPrimitives';
import { fetchWithAuth } from '../utils/api';

interface EdgeFunctionRecord {
    id: string;
    name: string;
    script: string;
    url?: string;
}

type EdgeFunctionDraft = {
    id?: string;
    name: string;
    script: string;
    url?: string;
};

const DEFAULT_FUNCTION_SCRIPT = '// Write your JS here\nreturn { message: "Hello from OzyBase!" };';

const isEdgeFunctionRecord = (value: unknown): value is EdgeFunctionRecord => (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { id?: unknown }).id === 'string' &&
    typeof (value as { name?: unknown }).name === 'string'
);

const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    return 'Unknown error';
};

const EdgeFunctions: React.FC = () => {
    const [functions, setFunctions] = useState<EdgeFunctionRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [currentFn, setCurrentFn] = useState<EdgeFunctionDraft>({ name: '', script: DEFAULT_FUNCTION_SCRIPT });
    const [invokeOutput, setInvokeOutput] = useState<{ name: string; result: string; isError: boolean } | null>(null);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

    useEffect(() => {
        fetchFunctions();
    }, []);

    const fetchFunctions = async () => {
        setLoading(true);
        try {
            const res = await fetchWithAuth('/api/functions');
            const data: unknown = await res.json();
            if (Array.isArray(data)) setFunctions(data.filter(isEdgeFunctionRecord));
        } catch (error) {
            console.error('Failed to fetch functions:', error);
        } finally {
            setLoading(false);
        }
    };

    const saveFunction = async () => {
        try {
            const res = await fetchWithAuth('/api/functions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(currentFn)
            });
            if (res.ok) {
                setShowModal(false);
                await fetchFunctions();
                setToast({ message: currentFn.id ? 'Function updated' : 'Function deployed', type: 'success' });
            } else {
                setToast({ message: 'Failed to save function', type: 'error' });
            }
        } catch (error) {
            console.error('Save failed:', error);
            setToast({ message: 'Save failed', type: 'error' });
        }
    };

    const invokeFunction = async (name: string) => {
        try {
            const res = await fetch(`/api/functions/${name}/invoke`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ test: true })
            });
            const data = await res.json();
            setInvokeOutput({
                name,
                result: JSON.stringify(data.result ?? data, null, 2),
                isError: !res.ok,
            });
        } catch (error: unknown) {
            setInvokeOutput({
                name,
                result: getErrorMessage(error),
                isError: true,
            });
        }
    };

    return (
        <div className="flex flex-col h-full bg-[#171717] animate-in fade-in duration-500 overflow-hidden">
            {/* Header Area */}
            <div className="px-8 py-8 border-b border-[#2e2e2e] bg-[#1a1a1a]">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center border border-primary/20">
                            <Zap className="text-primary" size={24} />
                        </div>
                        <div>
                            <h1 className="text-2xl font-black text-white uppercase tracking-tighter italic">Edge Functions</h1>
                            <p className="text-zinc-500 text-sm font-medium uppercase tracking-widest flex items-center gap-2">
                                <Cpu size={14} className="text-primary" />
                                JavaScript Runtime Engine
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button className="flex items-center gap-2 bg-[#2e2e2e] hover:bg-[#3e3e3e] text-zinc-300 px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-widest transition-all">
                            <Terminal size={14} />
                            CLI Docs
                        </button>
                        <button
                            onClick={() => {
                                setCurrentFn({ name: '', script: DEFAULT_FUNCTION_SCRIPT });
                                setShowModal(true);
                            }}
                            className="flex items-center gap-2 bg-primary text-black px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-widest hover:bg-[#E6E600] transition-all shadow-[0_0_20px_rgba(254,254,0,0.1)]"
                        >
                            <Plus size={14} strokeWidth={3} />
                            New Function
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {[
                        { title: 'Active Nodes', value: functions.length.toString(), icon: Zap, color: 'text-primary' },
                        { title: 'Engine Protocol', value: 'Goja/V8', icon: Cpu, color: 'text-zinc-400' },
                        { title: 'Global Sync', value: 'Enabled', icon: Globe, color: 'text-zinc-400' },
                    ].map((card: any, i: any) => (
                        <div key={i} className="bg-[#111111] border border-[#2e2e2e] rounded-2xl p-4 flex items-center gap-4">
                            <div className={`p-3 rounded-xl bg-zinc-900 border border-zinc-800 ${card.color}`}>
                                <card.icon size={20} />
                            </div>
                            <div>
                                <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">{card.title}</p>
                                <p className="text-xl font-black text-white italic truncate">{card.value}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* List Content */}
            <div className="p-8 flex-1 overflow-auto custom-scrollbar">
                <div className="bg-[#111111] border border-[#2e2e2e] rounded-2xl overflow-hidden shadow-2xl">
                    <div className="px-6 py-4 border-b border-[#2e2e2e] bg-[#1a1a1a] flex items-center justify-between">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={14} />
                            <input
                                type="text"
                                placeholder="Search functions..."
                                className="bg-[#0c0c0c] border border-[#2e2e2e] rounded-lg pl-9 pr-4 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-primary/50 w-64 transition-all"
                            />
                        </div>
                        <button onClick={fetchFunctions} className="text-[10px] font-black uppercase text-zinc-500 hover:text-primary">Refresh</button>
                    </div>

                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-[#0c0c0c] text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-600 border-b border-[#2e2e2e]">
                                <th className="px-6 py-4">Function</th>
                                <th className="px-6 py-4">Status</th>
                                <th className="px-6 py-4">Endpoint</th>
                                <th className="px-6 py-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#2e2e2e]/50">
                            {loading ? (
                                <tr><td colSpan={4} className="px-6 py-20 text-center text-zinc-600 font-black uppercase tracking-widest text-[10px]">Syncing with Edge Nodes...</td></tr>
                            ) : functions.length === 0 ? (
                                <tr><td colSpan={4} className="px-6 py-20 text-center text-zinc-600 font-black uppercase tracking-widest text-[10px]">No functions deployed to the edge</td></tr>
                            ) : (
                                functions.map((fn: any) => (
                                    <tr key={fn.id} className="hover:bg-zinc-900/40 transition-colors group">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-500 group-hover:text-primary transition-colors">
                                                    <Code size={16} />
                                                </div>
                                                <span className="text-sm font-bold text-zinc-200">{fn.name}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" />
                                                <span className="text-[10px] font-black uppercase tracking-widest text-green-500/80">Active</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="bg-[#0c0c0c] border border-zinc-900 px-3 py-1 rounded-full text-[10px] font-mono text-zinc-500 flex items-center gap-2 w-fit">
                                                {fn.url}
                                                <ExternalLink size={10} className="text-zinc-700 hover:text-primary cursor-pointer transition-colors" />
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => invokeFunction(fn.name)}
                                                    aria-label={`Invoke ${fn.name}`}
                                                    className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20 hover:bg-primary hover:text-black transition-all"
                                                >
                                                    <Play size={14} fill="currentColor" />
                                                </button>
                                                <button
                                                    onClick={() => { setCurrentFn(fn); setShowModal(true); }}
                                                    aria-label={`Edit ${fn.name}`}
                                                    className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-white transition-all"
                                                >
                                                    <MoreVertical size={14} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
                    <div className="absolute inset-0 ozy-overlay-backdrop backdrop-blur-md" onClick={() => setShowModal(false)} />
                    <div className="ozy-dialog-panel flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden">
                        <div className="px-8 py-6 border-b border-[#2e2e2e] flex items-center justify-between bg-[#1a1a1a]">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-primary/10 rounded-2xl border border-primary/20">
                                    <Zap className="text-primary" size={24} />
                                </div>
                                <div>
                                    <h3 className="text-xl font-black text-white uppercase tracking-tighter italic">
                                        {currentFn.id ? 'Configure Node' : 'Initialize Node'}
                                    </h3>
                                    <p className="text-[9px] text-zinc-500 font-black uppercase tracking-[0.2em]">Edge Computing Protocol v2.0</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <button onClick={() => setShowModal(false)} className="text-[10px] font-black text-zinc-500 hover:text-white uppercase tracking-widest">Cancel</button>
                                <button
                                    onClick={saveFunction}
                                    className="bg-primary text-black px-8 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:shadow-[0_0_30px_rgba(254,254,0,0.2)] hover:scale-[1.02] transition-all"
                                >
                                    Deploy to Edge
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 flex flex-col p-10 gap-8 overflow-auto custom-scrollbar bg-[#111111]/50">
                            <div className="space-y-3">
                                <label className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em] ml-2">Node Identifier</label>
                                <div className="relative group">
                                    <Terminal className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-700 group-focus-within:text-primary transition-colors" size={16} />
                                    <input
                                        type="text"
                                        value={currentFn.name}
                                        onChange={(e: any) => setCurrentFn({ ...currentFn, name: e.target.value })}
                                        placeholder="e.g. process-payments"
                                        className="w-full bg-[#0c0c0c] border border-zinc-800 rounded-2xl pl-12 pr-6 py-4 text-xs font-bold text-zinc-200 focus:outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/10 transition-all font-mono uppercase tracking-widest"
                                    />
                                </div>
                            </div>

                            <div className="flex-1 flex flex-col space-y-3 min-h-[400px]">
                                <div className="flex items-center justify-between ml-2">
                                    <label className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em]">Runtime Script (JS/ES6)</label>
                                    <div className="flex gap-4">
                                        <span className="text-[9px] font-bold text-zinc-700">Goja 1.0</span>
                                        <span className="text-[9px] font-bold text-zinc-700">Async Ready</span>
                                    </div>
                                </div>
                                <div className="flex-1 relative group">
                                    <textarea
                                        value={currentFn.script}
                                        onChange={(e: any) => setCurrentFn({ ...currentFn, script: e.target.value })}
                                        className="w-full h-full bg-[#0c0c0c] border border-zinc-800 rounded-3xl p-8 text-xs text-zinc-400 font-mono focus:outline-none focus:border-primary/30 transition-all resize-none shadow-inner leading-relaxed"
                                        placeholder="// Your edge logic starts here..."
                                    />
                                    <div className="absolute top-4 right-4 p-2 bg-zinc-900/80 rounded-lg border border-white/5 opacity-40 group-focus-within:opacity-100 transition-opacity">
                                        <Code size={14} className="text-primary" />
                                    </div>
                                </div>
                                <div className="flex items-center gap-4 p-4 bg-primary/5 rounded-2xl border border-primary/10 shadow-lg">
                                    <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
                                        <Zap size={14} className="text-primary" />
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-zinc-300 font-black uppercase tracking-widest">Global Context Injected</p>
                                        <p className="text-[9px] text-zinc-500 font-medium">
                                            Access <span className="text-primary/80 font-mono">body</span>, <span className="text-primary/80 font-mono">ozy.query(sql, ...args)</span>, and <span className="text-primary/80 font-mono">console.log</span>
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {invokeOutput && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
                    <div className="absolute inset-0 ozy-overlay-backdrop backdrop-blur-md" onClick={() => setInvokeOutput(null)} />
                    <div className="ozy-dialog-panel relative w-full max-w-3xl overflow-hidden">
                        <div className="flex items-center justify-between border-b border-[#2e2e2e] bg-[#171717] px-6 py-4">
                            <div>
                                <h3 className="text-sm font-black uppercase tracking-widest text-white">
                                    {invokeOutput.isError ? 'Invocation Failed' : 'Invocation Result'}
                                </h3>
                                <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-zinc-500">
                                    Function: {invokeOutput.name}
                                </p>
                            </div>
                            <button onClick={() => setInvokeOutput(null)} className="text-zinc-500 transition-colors hover:text-white">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="p-6">
                            <pre className={`max-h-[60vh] overflow-auto rounded-2xl border p-4 text-xs leading-relaxed custom-scrollbar ${invokeOutput.isError ? 'border-red-500/20 bg-red-500/6 text-red-300' : 'border-zinc-800 bg-[#0c0c0c] text-zinc-300'}`}>
                                {invokeOutput.result}
                            </pre>
                        </div>
                    </div>
                </div>
            )}

            {toast ? (
                <BrandedToast
                    tone={toast.type === 'success' ? 'success' : 'error'}
                    message={toast.message}
                    onClose={() => setToast(null)}
                />
            ) : null}
        </div>
    );
};

export default EdgeFunctions;
