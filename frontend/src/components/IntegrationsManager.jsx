import React, { useState, useEffect } from 'react';
import {
    Webhook, Plus, Trash2, Check, AlertCircle,
    Loader2, Info, Activity, Radio, Play
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

const IntegrationsManager = () => {
    const [integrations, setIntegrations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);
    const [toast, setToast] = useState(null);
    const [newIntegration, setNewIntegration] = useState({
        name: '',
        type: 'slack',
        webhook_url: '',
        config: {}
    });

    useEffect(() => {
        fetchIntegrations();
    }, []);

    const fetchIntegrations = async () => {
        try {
            const res = await fetchWithAuth('/api/project/integrations');
            const data = await res.json();
            setIntegrations(data || []);
        } catch (error) {
            console.error("Failed to fetch integrations", error);
        } finally {
            setLoading(false);
        }
    };

    const handleAdd = async () => {
        if (!newIntegration.name || !newIntegration.webhook_url) {
            setToast({ message: 'Name and Webhook URL are required', type: 'error' });
            return;
        }

        try {
            const res = await fetchWithAuth('/api/project/integrations', {
                method: 'POST',
                body: JSON.stringify(newIntegration)
            });

            if (res.ok) {
                setNewIntegration({ name: '', type: 'slack', webhook_url: '', config: {} });
                setShowAdd(false);
                fetchIntegrations();
                setToast({ message: 'Integration added successfully', type: 'success' });
            } else {
                setToast({ message: 'Failed to add integration', type: 'error' });
            }
        } catch (error) {
            console.error('Failed to add integration', error);
            setToast({ message: 'Network error', type: 'error' });
        } finally {
            setTimeout(() => setToast(null), 3000);
        }
    };

    const handleDelete = async (id) => {
        if (!confirm('Are you sure you want to delete this integration?')) return;

        try {
            const res = await fetchWithAuth(`/api/project/integrations/${id}`, {
                method: 'DELETE'
            });

            if (res.ok) {
                fetchIntegrations();
                setToast({ message: 'Integration deleted', type: 'success' });
            }
        } catch (error) {
            console.error('Failed to delete integration', error);
            setToast({ message: 'Failed to delete', type: 'error' });
        } finally {
            setTimeout(() => setToast(null), 3000);
        }
    };

    const handleTest = async (id) => {
        try {
            const res = await fetchWithAuth(`/api/project/integrations/${id}/test`, {
                method: 'POST'
            });

            if (res.ok) {
                setToast({ message: 'Test alert sent!', type: 'success' });
            } else {
                setToast({ message: 'Failed to send test alert', type: 'error' });
            }
        } catch (error) {
            console.error('Failed to test integration', error);
            setToast({ message: 'Network error', type: 'error' });
        } finally {
            setTimeout(() => setToast(null), 3000);
        }
    }

    if (loading) return (
        <div className="flex flex-col items-center justify-center h-full gap-4 text-zinc-500">
            <Loader2 className="animate-spin text-primary" size={32} />
            <span className="text-[10px] font-black uppercase tracking-widest">Loading Integrations...</span>
        </div>
    );

    return (
        <div className="p-8 max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#2e2e2e] pb-6">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-purple-500/10 rounded-2xl border border-purple-500/20">
                        <Webhook className="text-purple-500" size={24} />
                    </div>
                    <div>
                        <h1 className="text-3xl font-black text-white uppercase tracking-tighter italic">Integrations & SIEM</h1>
                        <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest mt-1">Connect Slack, Discord, and SIEM tools</p>
                    </div>
                </div>
                <button
                    onClick={() => setShowAdd(!showAdd)}
                    className="flex items-center gap-2 px-6 py-3 bg-primary text-black rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all"
                >
                    <Plus size={14} />
                    New Integration
                </button>
            </div>

            {/* Add New Integration Form */}
            {showAdd && (
                <div className="p-8 bg-[#111111] border border-[#2e2e2e] rounded-[2rem] space-y-6 animate-in slide-in-from-top duration-300">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-black text-white uppercase tracking-tight">Configure New Integration</h2>
                        <button onClick={() => setShowAdd(false)} className="text-zinc-500 hover:text-white">✕</button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Provider Type</label>
                            <div className="grid grid-cols-3 gap-3">
                                {['slack', 'discord', 'siem'].map(type => (
                                    <div
                                        key={type}
                                        onClick={() => setNewIntegration({ ...newIntegration, type })}
                                        className={`p-4 rounded-xl border cursor-pointer transition-all flex flex-col items-center gap-2 ${newIntegration.type === type ? 'bg-primary/10 border-primary text-primary' : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:bg-zinc-800'}`}
                                    >
                                        <Webhook size={20} />
                                        <span className="text-[10px] font-black uppercase">{type}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 block">Name</label>
                                <input
                                    type="text"
                                    placeholder="e.g. Critical Alerts Channel"
                                    value={newIntegration.name}
                                    onChange={(e) => setNewIntegration({ ...newIntegration, name: e.target.value })}
                                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary/50 transition-all"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 block">Webhook URL</label>
                                <input
                                    type="url"
                                    placeholder="https://hooks.slack.com/services/..."
                                    value={newIntegration.webhook_url}
                                    onChange={(e) => setNewIntegration({ ...newIntegration, webhook_url: e.target.value })}
                                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary/50 transition-all font-mono"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end pt-4 border-t border-[#2e2e2e]">
                        <button
                            onClick={handleAdd}
                            className="px-8 py-3 bg-white text-black rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-zinc-200 transition-all"
                        >
                            Save Integration
                        </button>
                    </div>
                </div>
            )}

            {/* Integrations List */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {integrations.map((integration) => (
                    <div key={integration.id} className="p-6 bg-[#111111] border border-[#2e2e2e] rounded-[2rem] group hover:border-zinc-700 transition-all">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-xl ${integration.type === 'slack' ? 'bg-[#4A154B]/20 text-[#4A154B]' : integration.type === 'discord' ? 'bg-[#5865F2]/20 text-[#5865F2]' : 'bg-blue-500/20 text-blue-500'}`}>
                                    <Webhook size={18} className={integration.type === 'slack' ? 'text-white' : ''} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-white capitalize">{integration.name}</h3>
                                    <p className="text-[10px] text-zinc-600 font-medium uppercase tracking-wider">{integration.type}</p>
                                </div>
                            </div>
                            <div className={`w-2 h-2 rounded-full ${integration.is_active ? 'bg-green-500' : 'bg-red-500'}`} />
                        </div>

                        <div className="p-3 bg-zinc-900/50 rounded-xl border border-zinc-800 mb-4 overflow-hidden">
                            <p className="text-[10px] text-zinc-500 font-mono truncate">{integration.webhook_url}</p>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => handleTest(integration.id)}
                                className="flex-1 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                            >
                                <Play size={10} /> Test
                            </button>
                            <button
                                onClick={() => handleDelete(integration.id)}
                                className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg transition-all"
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                    </div>
                ))}

                {integrations.length === 0 && !showAdd && (
                    <div className="col-span-full py-20 flex flex-col items-center justify-center border-2 border-dashed border-zinc-800 rounded-[2rem] text-zinc-600 gap-4">
                        <Activity size={48} strokeWidth={1} />
                        <div className="text-center">
                            <p className="text-sm font-bold text-zinc-400">No Integrations Configured</p>
                            <p className="text-[10px] font-medium mt-1">Add Slack, Discord or SIEM webhooks to get started</p>
                        </div>
                    </div>
                )}
            </div>

            {/* SIEM Info Box */}
            <div className="p-6 bg-blue-500/5 border border-blue-500/10 rounded-3xl flex items-start gap-4">
                <div className="p-2 bg-blue-500/10 rounded-lg text-blue-500 mt-1">
                    <Activity size={16} />
                </div>
                <div>
                    <h3 className="text-xs font-black text-white uppercase tracking-widest mb-1">SIEM Log Export</h3>
                    <p className="text-[10px] text-zinc-500 leading-relaxed font-medium">
                        Configure a <strong>SIEM</strong> integration above to automatically export all audit logs in batches every 30 seconds. Supports Splunk (HEC), ELK Stack, and Datadog.
                    </p>
                </div>
            </div>

            {/* Toast */}
            {toast && (
                <div className={`fixed bottom-8 right-8 px-6 py-3 rounded-xl border text-[10px] font-black uppercase tracking-widest flex items-center gap-3 animate-in slide-in-from-bottom duration-300 ${toast.type === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-500' : 'bg-red-500/10 border-red-500/20 text-red-500'}`}>
                    {toast.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}
                    {toast.message}
                </div>
            )}
        </div>
    );
};

export default IntegrationsManager;
