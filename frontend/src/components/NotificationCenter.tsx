import React from 'react';
import { Bell, Shield, AlertTriangle, CheckCircle2, X, Zap } from 'lucide-react';

interface NotificationIssue {
    type?: string;
    title?: string;
    description?: string;
    canAutoFix?: boolean;
    fixable?: boolean;
    reviewable?: boolean;
    review_key?: string;
    action_view?: string;
    action_label?: string;
    count?: number;
    [key: string]: unknown;
}

interface NotificationCenterProps {
    isOpen: boolean;
    onClose: () => void;
    issues: NotificationIssue[];
    onIssueAction: (issue: NotificationIssue) => void;
    onReviewIssue: (issue: NotificationIssue) => void;
    onViewLogs: () => void;
}

const NotificationCenter = ({ isOpen, onClose, issues, onIssueAction, onReviewIssue, onViewLogs }: NotificationCenterProps) => {
    return (
        <div
            className={`absolute right-0 top-full z-[100] mt-3 w-[420px] max-w-[calc(100vw-1.5rem)] overflow-hidden origin-top-right transition-all duration-200 ozy-floating-panel ${
                isOpen
                    ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto'
                    : 'opacity-0 -translate-y-2 scale-95 pointer-events-none'
            }`}
            aria-hidden={!isOpen}
        >
            <div className="px-6 py-4 border-b border-[#2e2e2e] flex items-center justify-between bg-[#111111]">
                <div className="flex items-center gap-2">
                    <Bell size={16} className="text-primary" />
                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-white">Project Notifications</h3>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-[9px] font-black text-zinc-600 bg-zinc-900 px-2 py-0.5 rounded-full border border-zinc-800">
                        {issues.length} ALERTS
                    </span>
                    <button onClick={onClose} className="text-zinc-600 hover:text-white transition-colors">
                        <X size={16} />
                    </button>
                </div>
            </div>

            <div className="max-h-[70vh] overflow-y-auto custom-scrollbar bg-[#0c0c0c]/50">
                {issues.length === 0 ? (
                    <div className="p-12 text-center">
                        <CheckCircle2 size={32} className="text-green-500/30 mx-auto mb-4" />
                        <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">No alerts detected</p>
                        <p className="text-[9px] text-zinc-700 mt-1 uppercase">Everything is looking sharp!</p>
                    </div>
                ) : (
                    <div className="divide-y divide-[#2e2e2e]/50">
                        {issues.map((issue: any, idx: any) => {
                            const isFixable = issue.fixable ?? issue.canAutoFix ?? false;
                            const isReviewable = issue.reviewable === true;
                            const actionLabel = String(issue.action_label || 'Review in Advisors');

                            return (
                                <div
                                    key={idx}
                                    onClick={() => onIssueAction(issue)}
                                    className={`p-5 hover:bg-zinc-900/60 transition-all group cursor-pointer border-l-2 ${isFixable ? 'border-transparent hover:border-primary' : 'border-transparent hover:border-zinc-700'}`}
                                >
                                    <div className="flex items-start gap-5">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-lg ${issue.type === 'security' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                                            }`}>
                                            {issue.type === 'security' ? <Shield size={20} /> : <AlertTriangle size={20} />}
                                        </div>
                                        <div className="space-y-1.5 flex-1 min-w-0">
                                            <div className="flex items-center justify-between gap-4">
                                                <div className="flex min-w-0 items-center gap-2">
                                                    <p className="text-xs font-black text-zinc-200 uppercase tracking-tight group-hover:text-white transition-colors leading-tight truncate">
                                                        {issue.title ?? 'Untitled issue'}
                                                    </p>
                                                    {typeof issue.count === 'number' && issue.count > 1 ? (
                                                        <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-zinc-400">
                                                            {issue.count} events
                                                        </span>
                                                    ) : null}
                                                </div>
                                                <span className="text-[8px] font-bold text-zinc-700 whitespace-nowrap">JUST NOW</span>
                                            </div>
                                            <p className="text-[10px] text-zinc-500 leading-relaxed font-medium">
                                                {issue.description ?? 'No details available.'}
                                            </p>
                                            <div className="mt-3 flex flex-wrap items-center gap-3">
                                                <span className={`text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-widest ${issue.type === 'security' ? 'bg-red-500/20 text-red-500' : 'bg-amber-500/20 text-amber-500'
                                                    }`}>
                                                    {issue.type}
                                                </span>
                                                {isFixable ? (
                                                    <span className="flex items-center gap-1.5 rounded border border-primary/20 bg-primary/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-primary transition-all transform translate-x-2 opacity-0 group-hover:translate-x-0 group-hover:opacity-100">
                                                        <Zap size={10} fill="currentColor" />
                                                        Auto-Fix Now
                                                    </span>
                                                ) : (
                                                    <>
                                                        <button
                                                            type="button"
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                onIssueAction(issue);
                                                            }}
                                                            className="rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-zinc-300 transition-colors hover:border-primary/30 hover:text-primary"
                                                        >
                                                            {actionLabel}
                                                        </button>
                                                        {isReviewable ? (
                                                            <button
                                                                type="button"
                                                                onClick={(event) => {
                                                                    event.stopPropagation();
                                                                    onReviewIssue(issue);
                                                                }}
                                                                className="rounded border border-zinc-800 bg-[#111111] px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-zinc-500 transition-colors hover:border-emerald-500/30 hover:text-emerald-300"
                                                            >
                                                                Mark reviewed
                                                            </button>
                                                        ) : null}
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="p-3 bg-[#0c0c0c] border-t border-[#2e2e2e] text-center">
                <button
                    onClick={onViewLogs}
                    className="text-[9px] font-black text-zinc-600 hover:text-primary uppercase tracking-widest transition-colors w-full py-2"
                >
                    View System Logs & Advisors
                </button>
            </div>
        </div>
    );
};

export default NotificationCenter;
