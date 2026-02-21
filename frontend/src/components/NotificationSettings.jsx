import React, { useState, useEffect } from 'react';
import {
    Bell, Mail, Plus, Trash2, Shield, Check,
    AlertCircle, Loader2, Info, BellRing
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

const NotificationSettings = () => {
    const [recipients, setRecipients] = useState([]);
    const [loading, setLoading] = useState(true);
    const [newEmail, setNewEmail] = useState('');
    const [adding, setAdding] = useState(false);
    const [toast, setToast] = useState(null);

    const fetchRecipients = async () => {
        try {
            const res = await fetchWithAuth('/api/project/security/notifications');
            const data = await res.json();
            setRecipients(data || []);
        } catch (error) {
            console.error("Failed to fetch recipients", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchRecipients();
    }, []);

    const addRecipient = async () => {
        if (!newEmail || !newEmail.includes('@')) {
            setToast({ message: 'Invalid email address', type: 'error' });
            setTimeout(() => setToast(null), 3000);
            return;
        }

        setAdding(true);
        try {
            const res = await fetchWithAuth('/api/project/security/notifications', {
                method: 'POST',
                body: JSON.stringify({
                    email: newEmail,
                    alert_types: ['geo_breach', 'unauthorized_access', 'rate_limit_exceeded']
                })
            });

            if (res.ok) {
                setNewEmail('');
                fetchRecipients();
                setToast({ message: 'Recipient added successfully', type: 'success' });
            } else {
                setToast({ message: 'Failed to add recipient', type: 'error' });
            }
        } catch (error) {
            console.error('Failed to add recipient', error);
            setToast({ message: 'Network error', type: 'error' });
        } finally {
            setAdding(false);
            setTimeout(() => setToast(null), 3000);
        }
    };

    const deleteRecipient = async (id) => {
        try {
            const res = await fetchWithAuth(`/api/project/security/notifications/${id}`, {
                method: 'DELETE'
            });

            if (res.ok) {
                fetchRecipients();
                setToast({ message: 'Recipient removed', type: 'success' });
            }
        } catch (error) {
            console.error('Failed to delete recipient', error);
            setToast({ message: 'Failed to delete', type: 'error' });
        } finally {
            setTimeout(() => setToast(null), 3000);
        }
    };

    if (loading) return (
        <div className="flex flex-col items-center justify-center h-full gap-4 text-zinc-500">
            <Loader2 className="animate-spin text-primary" size={32} />
            <span className="text-[10px] font-black uppercase tracking-widest">Loading Notification Settings...</span>
        </div>
    );

    return (
        <div className="p-8 max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#2e2e2e] pb-6">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-blue-500/10 rounded-2xl border border-blue-500/20">
                        <BellRing className="text-blue-500" size={24} />
                    </div>
                    <div>
                        <h1 className="text-3xl font-black text-white uppercase tracking-tighter italic">Security Alerts</h1>
                        <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest mt-1">Email notifications for critical security events</p>
                    </div>
                </div>
            </div>

            {/* Info Box */}
            <div className="p-6 bg-blue-500/5 border border-blue-500/10 rounded-3xl flex items-start gap-4">
                <div className="p-2 bg-blue-500/10 rounded-lg text-blue-500 mt-1">
                    <Info size={16} />
                </div>
                <div>
                    <h3 className="text-xs font-black text-white uppercase tracking-widest mb-1">Real-Time Email Alerts</h3>
                    <p className="text-[10px] text-zinc-500 leading-relaxed font-medium">
                        When a security breach is detected (e.g., geo-fencing violation), all active recipients will receive an instant email notification with detailed information about the threat.
                    </p>
                </div>
            </div>

            {/* Add New Recipient */}
            <div className="p-8 bg-[#111111] border border-[#2e2e2e] rounded-[2rem]">
                <h2 className="text-lg font-black text-white uppercase tracking-tight mb-6 flex items-center gap-2">
                    <Plus size={18} className="text-primary" />
                    Add Notification Recipient
                </h2>

                <div className="flex gap-3">
                    <input
                        type="email"
                        placeholder="admin@company.com"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addRecipient()}
                        className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary/50 transition-all"
                    />
                    <button
                        onClick={addRecipient}
                        disabled={adding}
                        className="px-8 py-3 bg-primary text-black rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {adding ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
                        {adding ? 'Adding...' : 'Add'}
                    </button>
                </div>
            </div>

            {/* Recipients List */}
            <div className="p-8 bg-[#111111] border border-[#2e2e2e] rounded-[2rem]">
                <h2 className="text-lg font-black text-white uppercase tracking-tight mb-6 flex items-center gap-2">
                    <Bell size={18} className="text-zinc-500" />
                    Active Recipients ({recipients.length})
                </h2>

                {recipients.length === 0 ? (
                    <div className="py-16 flex flex-col items-center justify-center border-2 border-dashed border-zinc-800 rounded-3xl text-zinc-700 gap-3">
                        <Mail size={32} strokeWidth={1} />
                        <span className="text-[10px] font-black uppercase tracking-widest">No recipients configured</span>
                        <p className="text-[9px] text-zinc-600 font-medium">Add an email address above to start receiving alerts</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {recipients.map((recipient) => (
                            <div
                                key={recipient.id}
                                className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-2xl flex items-center justify-between group hover:border-zinc-700 transition-all"
                            >
                                <div className="flex items-center gap-4">
                                    <div className="p-2 bg-green-500/10 rounded-lg text-green-500">
                                        <Check size={16} />
                                    </div>
                                    <div>
                                        <p className="text-sm font-bold text-white">{recipient.email}</p>
                                        <p className="text-[9px] text-zinc-600 uppercase font-bold tracking-widest mt-0.5">
                                            {recipient.alert_types?.join(', ') || 'All alerts'}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => deleteRecipient(recipient.id)}
                                    className="p-2 text-zinc-600 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Alert Types Reference */}
            <div className="p-6 bg-zinc-900/30 border border-white/5 rounded-3xl">
                <h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest mb-4">Alert Types</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[
                        { name: 'Geo Breach', desc: 'Unauthorized geographic access' },
                        { name: 'Unauthorized Access', desc: 'Failed authentication attempts' },
                        { name: 'Rate Limit Exceeded', desc: 'Suspicious request patterns' }
                    ].map((alert, i) => (
                        <div key={i} className="p-3 bg-zinc-900/50 rounded-xl border border-white/5">
                            <p className="text-xs font-bold text-white mb-1">{alert.name}</p>
                            <p className="text-[9px] text-zinc-600 font-medium">{alert.desc}</p>
                        </div>
                    ))}
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

export default NotificationSettings;
