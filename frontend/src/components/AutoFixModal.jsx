import React, { useState } from 'react';
import { Shield, AlertTriangle, X, Check, Loader2, ArrowRight, RefreshCw, Zap } from 'lucide-react';

const AutoFixModal = ({ isOpen, onClose, issue, onConfirm }) => {
    const [loading, setLoading] = useState(false);

    if (!isOpen || !issue) return null;

    const isRLSIssue = issue.type === 'security' && (issue.title.includes('Row Level Security') || issue.title.includes('RLS policies'));

    const handleConfirm = async () => {
        setLoading(true);
        try {
            await onConfirm(issue);
            onClose();
        } catch (error) {
            console.error("AutoFix failed", error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#000000]/80 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="w-full max-w-xl bg-[#111111] border border-[#2e2e2e] rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
                {/* Header */}
                <div className="px-8 py-6 border-b border-[#2e2e2e] flex items-center justify-between bg-zinc-900/30">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center border border-primary/20">
                            <Shield className="text-primary" size={24} />
                        </div>
                        <div>
                            <h3 className="text-lg font-black text-white uppercase tracking-tighter italic">Security Shield</h3>
                            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest leading-none mt-1">Automated infrastructure hardening</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 text-zinc-600 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-8 space-y-6">
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 text-amber-500">
                            <AlertTriangle size={18} />
                            <span className="text-[11px] font-black uppercase tracking-widest">
                                {issue.type === 'performance' ? 'Optimization Impact Warning' : 'Structural Impact Warning'}
                            </span>
                        </div>

                        <div className="p-6 bg-zinc-900/50 border border-zinc-800 rounded-2xl space-y-4">
                            <p className="text-sm text-zinc-300 leading-relaxed font-medium">
                                You are about to apply a {issue.type} fix to: <br />
                                <span className="text-white font-bold font-mono text-xs">{issue.title}</span>
                            </p>

                            <div className="space-y-3 pt-2">
                                {isRLSIssue && (
                                    <>
                                        <div className="flex gap-3 text-xs">
                                            <div className="mt-1 shrink-0"><Check size={14} className="text-green-500" /></div>
                                            <p className="text-zinc-400">Enables <span className="text-green-500 font-bold">Row Level Security (RLS)</span> and creates the missing operation policies on this table.</p>
                                        </div>
                                        <div className="p-3 bg-black/40 rounded-lg border border-white/5 font-mono text-[9px] text-zinc-500 leading-tight">
                                            <span className="text-primary">ALTER TABLE</span> {issue.title.split('`')[1] || issue.title.split(' ')[1] || 'table'} <span className="text-primary">ENABLE ROW LEVEL SECURITY</span>;<br />
                                            <span className="text-primary">CREATE POLICY</span> ... <span className="text-primary">FOR</span> SELECT | INSERT | UPDATE | DELETE ...
                                        </div>
                                    </>
                                )}

                                {issue.type === 'security' && issue.title.includes('public list rules') && (
                                    <>
                                        <div className="flex gap-3 text-xs">
                                            <div className="mt-1 shrink-0"><Check size={14} className="text-green-500" /></div>
                                            <p className="text-zinc-400">Migrates access rules from <span className="text-amber-500 font-bold">Public</span> to <span className="text-green-500 font-bold">Authenticated</span>.</p>
                                        </div>
                                        <div className="p-3 bg-black/40 rounded-lg border border-white/5 font-mono text-[9px] text-zinc-500 leading-tight">
                                            <span className="text-primary">UPDATE</span> _v_collections <span className="text-primary">SET</span> list_rule = 'auth' <span className="text-primary">WHERE</span> list_rule = 'public';
                                        </div>
                                    </>
                                )}

                                {issue.type === 'performance' && issue.title.includes('missing an index') && (
                                    <>
                                        <div className="flex gap-3 text-xs">
                                            <div className="mt-1 shrink-0"><Check size={14} className="text-green-500" /></div>
                                            <p className="text-zinc-400">Creates a <span className="text-primary font-bold italic">B-Tree Index</span> on the foreign key column.</p>
                                        </div>
                                        <div className="p-3 bg-black/40 rounded-lg border border-white/5 font-mono text-[9px] text-zinc-500 leading-tight">
                                            <span className="text-primary">CREATE INDEX</span> idx_{issue.title.split('`')[3]}_{issue.title.split('`')[1]} <span className="text-primary">ON</span> {issue.title.split('`')[3]} ({issue.title.split('`')[1]});
                                        </div>
                                    </>
                                )}

                                {issue.type === 'performance' && issue.title.includes('sequential scans') && (
                                    <>
                                        <div className="flex gap-3 text-xs">
                                            <div className="mt-1 shrink-0"><Check size={14} className="text-green-500" /></div>
                                            <p className="text-zinc-400">Executes <span className="text-primary font-bold">ANALYZE</span> command database-wide.</p>
                                        </div>
                                        <div className="p-3 bg-black/40 rounded-lg border border-white/5 font-mono text-[9px] text-zinc-500 leading-tight">
                                            <span className="text-primary">ANALYZE</span>;
                                        </div>
                                    </>
                                )}

                                <div className="flex gap-3 text-xs">
                                    <div className="mt-1 shrink-0"><Check size={14} className="text-primary" /></div>
                                    <p className="text-zinc-400 font-medium">Action will be logged in OzyBase Audit System.</p>
                                </div>
                            </div>
                        </div>

                        <p className="text-[10px] text-zinc-500 italic text-center px-4">
                            {issue.type === 'security'
                                ? '"OzyBase will execute SQL commands to alter your database schema and access rules instantly."'
                                : '"OzyBase will run diagnostic and optimization commands on your database engine without downtime."'}
                        </p>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-8 py-6 border-t border-[#2e2e2e] bg-[#0c0c0c] flex items-center justify-end gap-4">
                    <button
                        onClick={onClose}
                        className="px-6 py-2.5 text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white transition-all"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={loading}
                        className="flex items-center gap-2 px-8 py-2.5 bg-primary text-black rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-[0_0_20px_rgba(254,254,0,0.3)] disabled:opacity-50 disabled:scale-100"
                    >
                        {loading ? (
                            <Loader2 size={14} className="animate-spin" />
                        ) : (
                            <>
                                Proceed Anyway
                                <ArrowRight size={14} />
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AutoFixModal;
