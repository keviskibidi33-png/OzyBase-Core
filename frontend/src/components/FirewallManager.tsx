import React, { useEffect, useState } from 'react';
import { AlertTriangle, Plus, Search, ShieldBan, ShieldCheck, Trash2 } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import ConfirmModal from './ConfirmModal';
import { BrandedToast } from './OverlayPrimitives';

interface FirewallRule {
    id: string;
    ip_address: string;
    rule_type: 'BLOCK' | 'ALLOW' | string;
    reason?: string;
    expires_at?: string | null;
}

interface NewFirewallRule {
    ip_address: string;
    rule_type: 'BLOCK' | 'ALLOW';
    reason: string;
    duration_hours: number;
}

const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return 'Unknown error';
};

const FirewallManager = () => {
    const [rules, setRules] = useState<FirewallRule[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [newRule, setNewRule] = useState<NewFirewallRule>({
        ip_address: '',
        rule_type: 'BLOCK',
        reason: '',
        duration_hours: 0
    });
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

    useEffect(() => {
        fetchRules();
    }, []);

    const fetchRules = async () => {
        setLoading(true);
        try {
            const res = await fetchWithAuth('/api/security/firewall');
            if (!res.ok) {
                throw new Error('Failed to fetch firewall rules');
            }
            const data: unknown = await res.json();
            if (Array.isArray(data)) setRules(data as FirewallRule[]);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async () => {
        try {
            await fetchWithAuth('/api/security/firewall', {
                method: 'POST',
                body: JSON.stringify(newRule)
            });
            setShowModal(false);
            fetchRules();
            setNewRule({ ip_address: '', rule_type: 'BLOCK', reason: '', duration_hours: 0 });
            setToast({ message: 'Firewall rule deployed', type: 'success' });
        } catch (error) {
            setToast({ message: getErrorMessage(error), type: 'error' });
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await fetchWithAuth(`/api/security/firewall/${id}`, { method: 'DELETE' });
            fetchRules();
            setToast({ message: 'Firewall rule released', type: 'success' });
        } catch (error) {
            setToast({ message: getErrorMessage(error), type: 'error' });
        }
    };

    return (
        <div className="flex flex-col h-full bg-[#171717] animate-in fade-in duration-500 overflow-hidden">
            {/* Header */}
            <div className="px-8 py-10 border-b border-[#2e2e2e] bg-[#1a1a1a]">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-6">
                        <div className="w-14 h-14 bg-red-500/10 rounded-2xl flex items-center justify-center border border-red-500/20">
                            <ShieldBan className="text-red-500" size={28} />
                        </div>
                        <div>
                            <h1 className="text-3xl font-black text-white uppercase tracking-tighter italic">Firewall</h1>
                            <p className="text-zinc-500 text-[10px] font-black uppercase tracking-[0.2em] mt-1 flex items-center gap-2">
                                <ShieldCheck size={12} className="text-primary" />
                                Active Protection System
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => setShowModal(true)}
                        className="flex items-center gap-2 bg-zinc-100 text-black px-6 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-white transition-all"
                    >
                        <Plus size={16} strokeWidth={3} />
                        Add Rule
                    </button>
                </div>
            </div>

            {/* List */}
            <div className="p-8 flex-1 overflow-y-auto custom-scrollbar">
                {loading ? (
                    <div className="text-center text-zinc-500 text-xs py-20">Scanning rules...</div>
                ) : rules.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-zinc-900 rounded-3xl gap-4 bg-zinc-900/10">
                        <ShieldCheck size={48} className="text-zinc-800" />
                        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600">Firewall is Clean</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4">
                        {rules.map((rule: any) => (
                            <div key={rule.id} className="bg-[#111111] border border-[#2e2e2e] rounded-2xl p-6 flex items-center justify-between group hover:border-[#3e3e3e] transition-all">
                                <div className="flex items-center gap-6">
                                    <div className={`p-4 rounded-xl border ${rule.rule_type === 'BLOCK' ? 'bg-red-500/10 border-red-500/20 text-red-500' : 'bg-green-500/10 border-green-500/20 text-green-500'}`}>
                                        {rule.rule_type === 'BLOCK' ? <ShieldBan size={20} /> : <ShieldCheck size={20} />}
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-3 mb-1">
                                            <h3 className="text-white font-mono text-sm tracking-wide">{rule.ip_address}</h3>
                                            <span className={`text-[8px] font-black px-2 py-0.5 rounded-full border text-black uppercase ${rule.rule_type === 'BLOCK' ? 'bg-red-500 border-red-400' : 'bg-green-500 border-green-400'}`}>
                                                {rule.rule_type}
                                            </span>
                                        </div>
                                        <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                                            {rule.reason || 'No reason provided'}
                                            {rule.expires_at && (
                                                <span className="text-zinc-600">- Expires: {new Date(rule.expires_at).toLocaleDateString()}</span>
                                            )}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setPendingDeleteId(rule.id)}
                                    className="p-3 text-zinc-600 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
                    <div className="absolute inset-0 ozy-overlay-backdrop backdrop-blur-md" onClick={() => setShowModal(false)} />
                    <div className="ozy-dialog-panel w-full max-w-lg overflow-hidden">
                        <div className="px-8 py-6 border-b border-[#2e2e2e] bg-[#1a1a1a] flex justify-between items-center">
                            <h3 className="text-lg font-black text-white uppercase tracking-tighter italic">Add Firewall Rule</h3>
                            <button onClick={() => setShowModal(false)}><Plus className="rotate-45 text-zinc-500 hover:text-white" /></button>
                        </div>
                        <div className="p-8 space-y-6">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">IP Address</label>
                                <input
                                    type="text"
                                    placeholder="192.168.1.1"
                                    className="w-full bg-[#0c0c0c] border border-zinc-800 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-white/20 font-mono"
                                    value={newRule.ip_address}
                                    onChange={(e: any) => setNewRule({ ...newRule, ip_address: e.target.value })}
                                />
                            </div>
                            <div className="row flex gap-4">
                                <div className="space-y-2 flex-1">
                                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Action</label>
                                    <select
                                        className="w-full bg-[#0c0c0c] border border-zinc-800 rounded-xl px-4 py-3 text-xs text-zinc-300 focus:outline-none focus:border-white/20"
                                        value={newRule.rule_type}
                                        onChange={(e: any) => setNewRule({ ...newRule, rule_type: e.target.value as NewFirewallRule['rule_type'] })}
                                    >
                                        <option value="BLOCK">BLOCK (Blacklist)</option>
                                        <option value="ALLOW">ALLOW (Whitelist)</option>
                                    </select>
                                </div>
                                <div className="space-y-2 flex-1">
                                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Duration (Hours)</label>
                                    <input
                                        type="number"
                                        placeholder="0 (Permanent)"
                                        className="w-full bg-[#0c0c0c] border border-zinc-800 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-white/20"
                                        value={newRule.duration_hours}
                                        onChange={(e: any) => setNewRule({ ...newRule, duration_hours: Number.parseInt(e.target.value, 10) || 0 })}
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Reason</label>
                                <input
                                    type="text"
                                    placeholder="Suspicious activity detected..."
                                    className="w-full bg-[#0c0c0c] border border-zinc-800 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-white/20"
                                    value={newRule.reason}
                                    onChange={(e: any) => setNewRule({ ...newRule, reason: e.target.value })}
                                />
                            </div>
                            <button
                                onClick={handleCreate}
                                className="w-full bg-white text-black py-4 rounded-xl font-black text-xs uppercase tracking-[0.2em] hover:scale-[1.02] transition-all mt-4"
                            >
                                Deploy Rule
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmModal
                isOpen={!!pendingDeleteId}
                onClose={() => setPendingDeleteId(null)}
                onConfirm={() => pendingDeleteId ? handleDelete(pendingDeleteId) : undefined}
                title="Release Firewall Rule"
                message="Traffic from this IP will be allowed again once the rule is removed."
                confirmText="Release Rule"
                type="danger"
            />

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

export default FirewallManager;
