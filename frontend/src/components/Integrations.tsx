import React, { useEffect, useMemo, useState } from 'react';
import { Code, Copy, LayoutGrid, Loader2, Plus, RefreshCw } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import ConfirmModal from './ConfirmModal';

const WRAPPERS = [
    ['postgres_fdw', 'Postgres FDW'],
    ['file_fdw', 'File FDW'],
    ['mysql_fdw', 'MySQL FDW'],
    ['sqlite_fdw', 'SQLite FDW'],
    ['redis_fdw', 'Redis FDW'],
] as const;

const EMPTY = {
    webhook: { name: '', url: '', events: 'INSERT,UPDATE,DELETE', secret: '' },
    cron: { name: '', schedule: '0 * * * *', command: 'SELECT NOW();' },
    secret: { key: '', value: '', description: '' },
    wrapper: { name: 'postgres_fdw' },
};

interface IntegrationsProps {
    page?: string;
}

const Integrations: React.FC<IntegrationsProps> = ({ page = 'wrappers' }) => {
    const [extensions, setExtensions] = useState<any[]>([]);
    const [wrappers, setWrappers] = useState<any[]>([]);
    const [webhooks, setWebhooks] = useState<any[]>([]);
    const [cron, setCron] = useState<{ available: boolean; enabled: boolean; jobs: any[] }>({ available: false, enabled: false, jobs: [] });
    const [vault, setVault] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [modal, setModal] = useState<'webhook' | 'cron' | 'secret' | 'wrapper' | null>(null);
    const [form, setForm] = useState<Record<string, any>>(EMPTY.webhook);
    const [copied, setCopied] = useState<string | null>(null);
    const [pendingDelete, setPendingDelete] = useState<{ type: 'webhook' | 'cron' | 'secret' | 'wrapper'; id: string } | null>(null);

    const graphqlUrl = `${window.location.origin}/api/graphql/v1`;
    const graphiqlUrl = `${window.location.origin}/graphiql.html`;
    const graphQLEnabled = useMemo(() => (
        (Array.isArray(extensions) ? extensions : []).some((item) => item.name === 'pg_graphql' && item.installed)
    ), [extensions]);
    const activeWrappers = useMemo(() => new Set((Array.isArray(wrappers) ? wrappers : []).map((item) => String(item.name).toLowerCase())), [wrappers]);

    const copyValue = async (value: string, key: string) => {
        await navigator.clipboard.writeText(value);
        setCopied(key);
        window.setTimeout(() => setCopied(null), 1200);
    };

    const load = async () => {
        setLoading(true);
        try {
            if (page === 'wrappers') {
                const data = await (await fetchWithAuth('/api/wrappers')).json();
                setWrappers(Array.isArray(data) ? data : []);
            }
            if (page === 'webhooks') {
                const data = await (await fetchWithAuth('/api/webhooks')).json();
                setWebhooks(Array.isArray(data) ? data : []);
            }
            if (page === 'cron') {
                const data = await (await fetchWithAuth('/api/cron')).json();
                setCron({ available: Boolean(data?.available), enabled: Boolean(data?.enabled), jobs: Array.isArray(data?.jobs) ? data.jobs : [] });
            }
            if (page === 'vault') {
                const data = await (await fetchWithAuth('/api/vault')).json();
                setVault(Array.isArray(data) ? data : []);
            }
            if (page === 'extensions' || page === 'graphql') {
                const data = await (await fetchWithAuth('/api/extensions')).json();
                setExtensions(Array.isArray(data) ? data : []);
            }
        } catch (error) {
            console.error(`Failed to load ${page}:`, error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, [page]);

    const openModal = (type: 'webhook' | 'cron' | 'secret' | 'wrapper', seed: Record<string, any> = {}) => {
        setModal(type);
        setForm({ ...EMPTY[type], ...seed });
    };

    const addModalTypeForPage = () => {
        if (page === 'vault') return 'secret' as const;
        if (page === 'wrappers') return 'wrapper' as const;
        if (page === 'cron') return 'cron' as const;
        return 'webhook' as const;
    };

    const closeModal = () => {
        setModal(null);
        setForm(EMPTY.webhook);
    };

    const create = async (event: React.FormEvent) => {
        event.preventDefault();
        const endpoints = { webhook: '/api/webhooks', cron: '/api/cron', secret: '/api/vault', wrapper: '/api/wrappers' };
        const payload = modal === 'wrapper' ? { name: form.name } : form;
        if (!modal) {
            return;
        }
        setBusy(true);
        try {
            const res = await fetchWithAuth(endpoints[modal], { method: 'POST', body: JSON.stringify(payload) });
            if (res.ok) {
                closeModal();
                await load();
            }
        } finally {
            setBusy(false);
        }
    };

    const remove = async (type: 'webhook' | 'cron' | 'secret' | 'wrapper', id: string) => {
        const endpoints = { webhook: `/api/webhooks/${id}`, cron: `/api/cron/${id}`, secret: `/api/vault/${id}`, wrapper: `/api/wrappers/${id}` };
        setBusy(true);
        try {
            const res = await fetchWithAuth(endpoints[type], { method: 'DELETE' });
            if (res.ok) {
                await load();
            }
        } finally {
            setBusy(false);
        }
    };

    const toggleExtension = async (name: string, installed: boolean) => {
        setBusy(true);
        try {
            const action = installed ? 'disable' : 'enable';
            const res = await fetchWithAuth(`/api/extensions/${name}?action=${action}`, { method: 'POST' });
            if (res.ok) {
                await load();
            }
        } finally {
            setBusy(false);
        }
    };

    const enableCron = async () => {
        setBusy(true);
        try {
            const res = await fetchWithAuth('/api/cron/enable', { method: 'POST' });
            if (res.ok) {
                const data = await res.json();
                setCron({ available: Boolean(data?.available), enabled: Boolean(data?.enabled), jobs: Array.isArray(data?.jobs) ? data.jobs : [] });
            }
        } finally {
            setBusy(false);
        }
    };

    const itemClass = 'bg-[#111111] border border-[#2e2e2e] rounded-3xl p-6 shadow-2xl';

    const renderContent = () => {
        if (loading) {
            return <div className="flex items-center justify-center py-24"><Loader2 size={28} className="text-primary animate-spin" /></div>;
        }
        if (page === 'wrappers') {
            return (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {WRAPPERS.map(([id, name]) => (
                        <div key={id} className={itemClass}>
                            <p className="text-lg font-black text-white uppercase tracking-tight">{name}</p>
                            <p className="text-xs text-zinc-500 mt-2">{id}</p>
                            <div className="flex gap-3 mt-5">
                                <button onClick={() => openModal('wrapper', { name: id })} className="flex-1 px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-300">Configure Wrapper</button>
                                {activeWrappers.has(id.toLowerCase()) && <button onClick={() => setPendingDelete({ type: 'wrapper', id })} className="px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-xl text-[10px] font-black uppercase tracking-widest text-red-500">Remove</button>}
                            </div>
                        </div>
                    ))}
                </div>
            );
        }
        if (page === 'webhooks') {
            return webhooks.length === 0
                ? <div className={itemClass}>No webhooks configured.</div>
                : webhooks.map((item) => (
                    <div key={item.id} className={`${itemClass} mb-3`}>
                        <p className="text-sm font-black text-white">{item.name}</p>
                        <code className="text-xs text-zinc-500">{item.url}</code>
                        <div className="mt-4">
                            <button onClick={() => setPendingDelete({ type: 'webhook', id: String(item.id) })} className="px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-xl text-[10px] font-black uppercase tracking-widest text-red-500">Delete</button>
                        </div>
                    </div>
                ));
        }
        if (page === 'cron') {
            if (!cron.available) {
                return <div className={itemClass}>`pg_cron` is unavailable on this PostgreSQL instance.</div>;
            }
            if (!cron.enabled) {
                return (
                    <div className={itemClass}>
                        <p className="text-white font-black">pg_cron is disabled.</p>
                        <button onClick={() => void enableCron()} className="mt-4 px-4 py-2 bg-primary text-black rounded-xl text-[10px] font-black uppercase tracking-widest">Configure pg_cron</button>
                    </div>
                );
            }
            if (!cron.jobs?.length) {
                return <div className={itemClass}>pg_cron is enabled. No jobs configured yet.</div>;
            }
            return cron.jobs.map((item) => (
                <div key={item.id} className={`${itemClass} mb-3`}>
                    <p className="text-sm font-black text-white">{item.name}</p>
                    <p className="text-xs text-primary font-mono mt-2">{item.schedule}</p>
                    <p className="text-[10px] uppercase tracking-widest text-zinc-500 mt-2">Last: {item.last_run || 'Never'} | Next: {item.next_run || 'Unknown'}</p>
                    <div className="mt-4">
                        <button onClick={() => setPendingDelete({ type: 'cron', id: String(item.id) })} className="px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-xl text-[10px] font-black uppercase tracking-widest text-red-500">Delete</button>
                    </div>
                </div>
            ));
        }
        if (page === 'extensions') {
            return extensions.map((item) => (
                <div key={item.name} className={`${itemClass} mb-3`}>
                    <p className="text-sm font-black text-white">{item.name}</p>
                    <p className="text-xs text-zinc-500 mt-2">{item.description}</p>
                    <button onClick={() => void toggleExtension(String(item.name), Boolean(item.installed))} className={`mt-4 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest ${item.installed ? 'bg-red-500/10 border border-red-500/20 text-red-500' : 'bg-primary text-black'}`}>
                        {item.installed ? 'Disable' : 'Enable'}
                    </button>
                </div>
            ));
        }
        if (page === 'vault') {
            return vault.length === 0
                ? <div className={itemClass}>Vault is empty.</div>
                : vault.map((item) => (
                    <div key={item.id} className={`${itemClass} mb-3`}>
                        <p className="text-sm font-black text-white">{item.key}</p>
                        <p className="text-[10px] uppercase tracking-widest text-zinc-500 mt-2">Value hidden by design</p>
                        <button onClick={() => setPendingDelete({ type: 'secret', id: String(item.id) })} className="mt-4 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-xl text-[10px] font-black uppercase tracking-widest text-red-500">Revoke</button>
                    </div>
                ));
        }
        if (page === 'graphql') {
            return (
                <div className={itemClass}>
                    <p className="text-sm font-black text-white uppercase tracking-widest">GraphQL Endpoint</p>
                    <code className="text-xs text-zinc-400 block mt-3">{graphqlUrl}</code>
                    <div className="flex gap-3 mt-5">
                        <button disabled={!graphQLEnabled} onClick={() => window.open(graphiqlUrl, '_blank', 'noopener,noreferrer')} className="px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-300 disabled:opacity-40">Open Playground (GraphiQL)</button>
                        <button onClick={() => void copyValue(graphqlUrl, 'graphql')} className="px-4 py-2 bg-primary text-black rounded-xl text-[10px] font-black uppercase tracking-widest">{copied === 'graphql' ? 'Copied' : 'Copy URL'}</button>
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="flex flex-col h-full bg-[#171717] animate-in fade-in duration-500 overflow-hidden relative">
            {modal && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-6">
                    <div className="absolute inset-0 ozy-overlay-backdrop backdrop-blur-md" onClick={closeModal} />
                    <form onSubmit={create} className="ozy-dialog-panel relative w-full max-w-lg overflow-hidden">
                        <div className="px-8 py-6 border-b border-[#2e2e2e] bg-[#171717]"><h3 className="text-xl font-black text-white uppercase tracking-tight">{modal === 'wrapper' ? 'Configure Wrapper' : modal === 'webhook' ? 'Create Webhook' : modal === 'cron' ? 'New Cron Job' : 'Add Secret'}</h3></div>
                        <div className="p-8 space-y-4">
                            {modal === 'wrapper' && (
                                <select value={form.name} onChange={(event) => setForm({ name: event.target.value })} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white">
                                    {WRAPPERS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                                </select>
                            )}
                            {modal === 'webhook' && (
                                <>
                                    <input required placeholder="Name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white" />
                                    <input required placeholder="https://example.com/webhook" value={form.url} onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white" />
                                    <input required placeholder="INSERT,UPDATE,DELETE" value={form.events} onChange={(event) => setForm((current) => ({ ...current, events: event.target.value }))} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white" />
                                </>
                            )}
                            {modal === 'cron' && (
                                <>
                                    <input required placeholder="Job name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white" />
                                    <input required placeholder="0 * * * *" value={form.schedule} onChange={(event) => setForm((current) => ({ ...current, schedule: event.target.value }))} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white font-mono" />
                                    <textarea required value={form.command} onChange={(event) => setForm((current) => ({ ...current, command: event.target.value }))} className="w-full min-h-[120px] bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 text-sm text-white font-mono" />
                                </>
                            )}
                            {modal === 'secret' && (
                                <>
                                    <input required placeholder="Secret key" value={form.key} onChange={(event) => setForm((current) => ({ ...current, key: event.target.value }))} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white" />
                                    <input required type="password" placeholder="Secret value" value={form.value} onChange={(event) => setForm((current) => ({ ...current, value: event.target.value }))} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white" />
                                    <input placeholder="Description" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white" />
                                </>
                            )}
                        </div>
                        <div className="px-8 py-5 border-t border-[#2e2e2e] bg-[#171717] flex justify-end gap-3">
                            <button type="button" onClick={closeModal} className="px-5 py-2.5 text-[10px] font-black uppercase tracking-widest text-zinc-500">Cancel</button>
                            <button type="submit" disabled={busy} className="px-6 py-2.5 bg-primary text-black rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-60">{busy ? 'Saving' : 'Save'}</button>
                        </div>
                    </form>
                </div>
            )}

            <div className="px-8 py-10 border-b border-[#2e2e2e] bg-[#1a1a1a]">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-6">
                        <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center border border-primary/20"><LayoutGrid className="text-primary" size={28} /></div>
                        <div><h1 className="text-3xl font-black text-white uppercase tracking-tighter italic">Integrations</h1><p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest mt-1">Extensions, wrappers and runtime utilities</p></div>
                    </div>
                    <div className="flex gap-3">
                        {(page === 'wrappers' || page === 'webhooks' || page === 'cron' || page === 'vault') && <button onClick={() => openModal(addModalTypeForPage())} className="flex items-center gap-2 bg-primary text-black px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest"><Plus size={14} />Add</button>}
                        <button onClick={() => void load()} className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 text-zinc-300 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest"><RefreshCw size={14} />Refresh</button>
                    </div>
                </div>
            </div>

            <div className="p-8 flex-1 overflow-auto custom-scrollbar">{renderContent()}</div>

            <ConfirmModal
                isOpen={!!pendingDelete}
                onClose={() => setPendingDelete(null)}
                onConfirm={() => pendingDelete ? remove(pendingDelete.type, pendingDelete.id) : undefined}
                title="Delete Integration Item"
                message="This runtime integration entry will be removed from the project configuration."
                confirmText="Delete Item"
                type="danger"
            />
        </div>
    );
};

export default Integrations;
