import React, { useState, useEffect } from 'react';
import {
    Webhook,
    Plus,
    Trash2,
    Globe,
    Shield,
    Activity,
    ExternalLink,
    Zap,
    CheckCircle2,
    XCircle
} from 'lucide-react';
import ConfirmModal from './ConfirmModal';
import { BrandedToast } from './OverlayPrimitives';

interface WebhookRecord {
    id: string;
    url: string;
    events: string;
    is_active?: boolean;
}

interface NewWebhookInput {
    url: string;
    events: string;
}

const WebhooksManager = () => {
    const [webhooks, setWebhooks] = useState<WebhookRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [newWebhook, setNewWebhook] = useState<NewWebhookInput>({ url: '', events: '*' });
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

    useEffect(() => {
        fetchWebhooks();
    }, []);

    const fetchWebhooks = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('ozy_token');
            const res = await fetch('/api/webhooks', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data: unknown = await res.json();
            if (Array.isArray(data)) setWebhooks(data as WebhookRecord[]);
        } catch (error) {
            console.error('Failed to fetch webhooks:', error);
        } finally {
            setLoading(false);
        }
    };

    const createWebhook = async () => {
        try {
            const token = localStorage.getItem('ozy_token');
            const res = await fetch('/api/webhooks', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(newWebhook)
            });
            if (res.ok) {
                setShowModal(false);
                setToast({ message: 'Webhook created', type: 'success' });
                fetchWebhooks();
            }
        } catch (error) {
            console.error('Failed to create webhook:', error);
            setToast({ message: 'Failed to create webhook', type: 'error' });
        }
    };

    const deleteWebhook = async (id: string) => {
        try {
            const token = localStorage.getItem('ozy_token');
            const res = await fetch(`/api/webhooks/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                setToast({ message: 'Webhook deleted', type: 'success' });
                fetchWebhooks();
            }
        } catch (error) {
            console.error('Failed to delete webhook:', error);
            setToast({ message: 'Failed to delete webhook', type: 'error' });
        }
    };

    return (
        <div className="flex flex-col h-full bg-[#171717] animate-in fade-in duration-500 overflow-hidden">
            {/* Header */}
            <div className="px-8 py-10 border-b border-[#2e2e2e] bg-[#1a1a1a]">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-6">
                        <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center border border-primary/20">
                            <Webhook className="text-primary" size={28} />
                        </div>
                        <div>
                            <h1 className="text-3xl font-black text-white uppercase tracking-tighter italic">Webhooks</h1>
                            <p className="text-zinc-500 text-[10px] font-black uppercase tracking-[0.2em] mt-1 flex items-center gap-2">
                                <Activity size={12} className="text-primary" />
                                Outbound Event Pipeline
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => setShowModal(true)}
                        className="flex items-center gap-2 bg-primary text-black px-6 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-[#E6E600] transition-all shadow-[0_0_25px_rgba(254,254,0,0.15)]"
                    >
                        <Plus size={16} strokeWidth={3} />
                        Add Webhook
                    </button>
                </div>
            </div>

            {/* List */}
            <div className="p-8 flex-1 overflow-y-auto custom-scrollbar">
                {loading ? (
                    <div className="flex flex-col items-center justify-center h-64 gap-4">
                        <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600">Syncing Webhook Nodes...</p>
                    </div>
                ) : webhooks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-zinc-900 rounded-3xl gap-4 bg-zinc-900/10">
                        <Globe size={48} className="text-zinc-800" />
                        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600">No webhooks registered</p>
                        <button onClick={() => setShowModal(true)} className="text-primary text-[10px] font-black uppercase hover:underline">Initialize first node</button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4">
                        {webhooks.map((w: any) => (
                            <div key={w.id} className="bg-[#111111] border border-[#2e2e2e] rounded-2xl p-6 hover:border-primary/20 transition-all flex items-center justify-between group">
                                <div className="flex items-center gap-6">
                                    <div className={`p-4 rounded-xl bg-zinc-900 border border-zinc-800 ${w.is_active ? 'text-green-500' : 'text-zinc-600'}`}>
                                        <Zap size={20} />
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-3 mb-1">
                                            <h3 className="text-white font-bold text-sm tracking-wide">{w.url}</h3>
                                            <span className="text-[8px] font-black px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-500 uppercase">
                                                Active
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">
                                                Events: <span className="text-zinc-400">{w.events}</span>
                                            </p>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button className="p-2 text-zinc-600 hover:text-white"><ExternalLink size={16} /></button>
                                    <button onClick={() => setPendingDeleteId(w.id)} className="p-2 text-zinc-600 hover:text-red-500"><Trash2 size={16} /></button>
                                </div>
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
                        <div className="px-8 py-6 border-b border-[#2e2e2e] flex items-center justify-between bg-[#1a1a1a]">
                            <div className="flex items-center gap-4">
                                <div className="p-2 bg-primary/10 rounded-xl">
                                    <Webhook className="text-primary" size={20} />
                                </div>
                                <h3 className="text-lg font-black text-white uppercase tracking-tighter italic">Register Webhook</h3>
                            </div>
                            <button onClick={() => setShowModal(false)} className="text-zinc-500 hover:text-white"><Plus className="rotate-45" size={20} /></button>
                        </div>
                        <div className="p-8 space-y-6">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Endpoint URL</label>
                                <input
                                    type="text"
                                    value={newWebhook.url}
                                    onChange={(e: any) => setNewWebhook({ ...newWebhook, url: e.target.value })}
                                    className="w-full bg-[#0c0c0c] border border-zinc-800 rounded-xl px-4 py-3 text-xs text-zinc-200 focus:outline-none focus:border-primary/50"
                                    placeholder="https://your-api.com/webhook"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Event Trigger</label>
                                <select
                                    value={newWebhook.events}
                                    onChange={(e: any) => setNewWebhook({ ...newWebhook, events: e.target.value })}
                                    className="w-full bg-[#0c0c0c] border border-zinc-800 rounded-xl px-4 py-3 text-xs text-zinc-200 focus:outline-none focus:border-primary/50 appearance-none"
                                >
                                    <option value="*">All Events (*)</option>
                                    <option value="records:create">Record Created</option>
                                    <option value="records:update">Record Updated</option>
                                    <option value="records:delete">Record Deleted</option>
                                </select>
                            </div>
                            <button
                                onClick={createWebhook}
                                className="w-full bg-primary text-black py-4 rounded-xl font-black text-xs uppercase tracking-[0.2em] hover:scale-[1.02] transition-all mt-4"
                            >
                                Deploy Webhook Node
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmModal
                isOpen={!!pendingDeleteId}
                onClose={() => setPendingDeleteId(null)}
                onConfirm={() => pendingDeleteId ? deleteWebhook(pendingDeleteId) : undefined}
                title="Delete Webhook"
                message="Outbound deliveries to this endpoint will stop immediately."
                confirmText="Delete Webhook"
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

export default WebhooksManager;
