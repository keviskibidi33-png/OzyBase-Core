import React, { useState, useEffect } from 'react';
import {
    Shield, ShieldCheck, Lock, Globe, Key,
    ChevronDown, Save, Loader2, Database,
    User, Users, Settings, AlertCircle, Info,
    Eye, Plus, Edit3, Trash2
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import ModuleScrollContainer from './ModuleScrollContainer';

type RuleKey = 'list_rule' | 'create_rule' | 'update_rule' | 'delete_rule';

interface CollectionRule {
    id: string;
    name: string;
    list_rule?: string;
    create_rule?: string;
    update_rule?: string;
    delete_rule?: string;
    [key: string]: unknown;
}

type ToastType = 'success' | 'error';

interface ToastState {
    message: string;
    type: ToastType;
}

const PermissionManager = () => {
    const [collections, setCollections] = useState<CollectionRule[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [toast, setToast] = useState<ToastState | null>(null);

    const fetchCollections = async () => {
        try {
            const res = await fetchWithAuth('/api/collections');
            const data: unknown = await res.json();
            setCollections(Array.isArray(data) ? (data as CollectionRule[]) : []);
        } catch (error) {
            console.error("Failed to fetch collections", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCollections();
    }, []);

    const updateRule = async (colName: string, type: RuleKey, value: string) => {
        setSaving(colName);
        try {
            const res = await fetchWithAuth(`/api/collections/rules`, {
                method: 'PATCH',
                body: JSON.stringify({
                    name: colName,
                    [type]: value
                })
            });

            if (res.ok) {
                setCollections((prev: any) => prev.map((c: any) =>
                    c.name === colName ? { ...c, [type]: value } : c
                ));
                setToast({ message: `Rule updated for ${colName}`, type: 'success' });
            }
        } catch (error) {
            console.error(`Failed to update rule for ${colName}`, error);
            setToast({ message: 'Update failed', type: 'error' });
        } finally {
            setSaving(null);
            setTimeout(() => setToast(null), 3000);
        }
    };

    if (loading) return (
        <div className="flex flex-col items-center justify-center h-full gap-4 text-zinc-500">
            <Loader2 className="animate-spin text-primary" size={32} />
            <span className="text-[10px] font-black uppercase tracking-widest">Applying RBAC Manifest...</span>
        </div>
    );

    const roles = ['public', 'auth', 'admin', 'editor', 'manager'];

    return (
        <ModuleScrollContainer width="6xl" innerClassName="animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#2e2e2e] pb-6">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-primary/10 rounded-2xl border border-primary/20">
                        <ShieldCheck className="text-primary" size={24} />
                    </div>
                    <div>
                        <h1 className="text-3xl font-black text-white uppercase tracking-tighter italic">RBAC Permissions</h1>
                        <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest mt-1">Configure database access control rules per collection</p>
                    </div>
                </div>
            </div>

            <div className="grid gap-6">
                {collections.map((col: any) => (
                    <div key={col.id} className="bg-[#111111] border border-[#2e2e2e] rounded-[2rem] overflow-hidden group hover:border-primary/20 transition-all">
                        <div className="px-8 py-5 border-b border-[#2e2e2e] bg-[#0d0d0d] flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <Database size={18} className="text-zinc-600" />
                                <span className="text-lg font-black text-white italic">{col.name}</span>
                            </div>
                            {saving === col.name && <Loader2 size={16} className="animate-spin text-primary" />}
                        </div>

                        <div className="p-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                            {([
                                { id: 'list_rule', label: 'List (Read)', icon: Eye },
                                { id: 'create_rule', label: 'Create', icon: Plus },
                                { id: 'update_rule', label: 'Update', icon: Edit3 },
                                { id: 'delete_rule', label: 'Delete', icon: Trash2 },
                            ] as const).map((rule: any) => {
                                const selectedValue = typeof col[rule.id] === 'string' ? col[rule.id] : 'admin';
                                const helperText = selectedValue === 'public'
                                    ? 'Everyone can access'
                                    : selectedValue === 'auth'
                                        ? 'Any logged user access'
                                        : `Only ${selectedValue} can access`;

                                return (
                                    <div key={rule.id} className="space-y-4">
                                        <div className="flex items-center gap-2">
                                            <rule.icon size={14} className="text-zinc-500" />
                                            <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">{rule.label}</label>
                                        </div>

                                        <div className="relative">
                                            <select
                                                value={selectedValue}
                                                onChange={(e: any) => updateRule(col.name, rule.id, e.target.value)}
                                                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-xs text-white appearance-none focus:outline-none focus:border-primary/50 transition-all cursor-pointer font-bold uppercase tracking-tight"
                                            >
                                                {roles.map((role: any) => (
                                                    <option key={role} value={role}>{role}</option>
                                                ))}
                                            </select>
                                            <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
                                        </div>

                                        <p className="text-[9px] text-zinc-600 font-medium italic">
                                            {helperText}
                                        </p>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>

            {/* Hint Box */}
            <div className="p-6 bg-zinc-900/50 border border-white/5 rounded-3xl flex items-start gap-4">
                <div className="p-2 bg-blue-500/10 rounded-lg text-blue-500 mt-1"><Info size={16} /></div>
                <div>
                    <h3 className="text-xs font-black text-white uppercase tracking-widest mb-1">Row Level Security (RLS)</h3>
                    <p className="text-[10px] text-zinc-500 leading-relaxed font-medium">
                        RBAC provides coarse-grained control at the table level. If you need fine-grained control (e.g., users can only see their own rows), enable RLS in the <span className="text-primary cursor-pointer hover:underline">Table Settings</span>.
                    </p>
                </div>
            </div>

            {/* Toast Notifications */}
            {toast && (
                <div className={`fixed bottom-8 right-8 px-6 py-3 rounded-xl border text-[10px] font-black uppercase tracking-widest flex items-center gap-3 animate-in slide-in-from-bottom duration-300 ${toast.type === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-500' : 'bg-red-500/10 border-red-500/20 text-red-500'}`}>
                    {toast.type === 'success' ? <ShieldCheck size={14} /> : <AlertCircle size={14} />}
                    {toast.message}
                </div>
            )}
        </ModuleScrollContainer>
    );
};

export default PermissionManager;
