import React, { useState, useEffect } from 'react';
import {
    LayoutGrid,
    Globe,
    Zap,
    History,
    Cpu,
    Shield,
    Code,
    Plus,
    MoreVertical,
    CheckCircle,
    XCircle,
    ExternalLink,
    Search,
    RefreshCw,
    Loader2
} from 'lucide-react';

const Integrations = ({ page = 'wrappers' }: any) => {
    const [pgExtensions, setPgExtensions] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState('');
    const [webhooks, setWebhooks] = useState<any[]>([]);
    const [cronData, setCronData] = useState<{ enabled: boolean; jobs: any[] }>({ enabled: false, jobs: [] });
    const [secrets, setSecrets] = useState<any[]>([]);

    const [activeWrappers, setActiveWrappers] = useState<any[]>([]);

    useEffect(() => {
        if (page === 'extensions') fetchExtensions();
        if (page === 'webhooks') fetchWebhooks();
        if (page === 'cron') fetchCron();
        if (page === 'vault') fetchVault();
        if (page === 'wrappers') fetchWrappers();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page]);

    const fetchWrappers = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('ozy_token');
            const res = await fetch('/api/wrappers', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (Array.isArray(data)) setActiveWrappers(data);
        } catch (error) {
            console.error('Failed to fetch wrappers:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchExtensions = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('ozy_token');
            const res = await fetch('/api/extensions', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (Array.isArray(data)) {
                setPgExtensions(data);
            }
        } catch (error) {
            console.error('Failed to fetch extensions:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchWebhooks = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('ozy_token');
            const res = await fetch('/api/webhooks', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (Array.isArray(data)) setWebhooks(data);
        } catch (error) {
            console.error('Failed to fetch webhooks:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchCron = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('ozy_token');
            const res = await fetch('/api/cron', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            setCronData(data);
        } catch (error) {
            console.error('Failed to fetch cron:', error);
        } finally {
            setLoading(false);
        }
    };

    const [showModal, setShowModal] = useState<any>(null); // 'webhook', 'cron', 'secret'
    const [formData, setFormData] = useState<Record<string, any>>({});
    const [graphqlCopied, setGraphqlCopied] = useState(false);
    const graphqlEndpoint = new URL('/api/graphql/v1', window.location.origin).toString();

    const fetchSecrets = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('ozy_token');
            const res = await fetch('/api/vault', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (Array.isArray(data)) setSecrets(data);
        } catch (error) {
            console.error('Failed to fetch vault:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async (e: any) => {
        e.preventDefault();
        setLoading(true);
        try {
            const token = localStorage.getItem('ozy_token');
            const endpoint = `/api/${showModal === 'secret' ? 'vault' : showModal + 's'}`;
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });
            if (res.ok) {
                setShowModal(null);
                setFormData({});
                if (showModal === 'webhook') fetchWebhooks();
                if (showModal === 'cron') fetchCron();
                if (showModal === 'secret') fetchSecrets();
            }
        } catch (error) {
            console.error('Creation failed:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (type: any, id: any) => {
        if (!confirm('Are you sure?')) return;
        setLoading(true);
        try {
            const token = localStorage.getItem('ozy_token');
            const endpoint = `/api/${type === 'secret' ? 'vault' : type + 's'}/${id}`;
            const res = await fetch(endpoint, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                if (type === 'webhook') fetchWebhooks();
                if (type === 'cron') fetchCron();
                if (type === 'secret') fetchSecrets();
            }
        } catch (error) {
            console.error('Delete failed:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchVault = fetchSecrets; // Alias for consistency

    const toggleExtension = async (name: any, installed: any) => {
        setLoading(true);
        try {
            const token = localStorage.getItem('ozy_token');
            const action = installed ? 'disable' : 'enable';
            await fetch(`/api/extensions/${name}?action=${action}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            await fetchExtensions();
        } catch (error) {
            console.error('Toggle failed:', error);
        } finally {
            setLoading(false);
        }
    };

    const copyGraphQLEndpoint = async () => {
        try {
            await navigator.clipboard.writeText(graphqlEndpoint);
            setGraphqlCopied(true);
            window.setTimeout(() => setGraphqlCopied(false), 2000);
        } catch (error) {
            console.error('Failed to copy GraphQL endpoint:', error);
        }
    };

    const filteredExtensions = pgExtensions.filter((e: any) =>
        e.name.toLowerCase().includes(search.toLowerCase()) ||
        e.description.toLowerCase().includes(search.toLowerCase())
    );

    // List of officially supported wrappers that we show in the dashboard
    const wrappers = [
        { id: 'postgres_fdw', name: 'Postgres FDW', desc: 'Query other PostgreSQL databases', status: 'available', icon: 'ðŸ˜' },
        { id: 'file_fdw', name: 'File FDW', desc: 'Query server-side files as tables', status: 'available', icon: 'ðŸ“' },
        { id: 'mysql_fdw', name: 'MySQL FDW', desc: 'Connect to MySQL/MariaDB instances', status: 'available', icon: 'ðŸ¬' },
        { id: 'sqlite_fdw', name: 'SQLite FDW', desc: 'Access SQLite database files', status: 'available', icon: 'ðŸ’¾' },
        { id: 'redis_fdw', name: 'Redis FDW', desc: 'Query Redis key-value stores', status: 'available', icon: 'ðŸ§§' },
        { id: 'stripe', name: 'Stripe Wrapper', desc: 'Sync Stripe data via FDW', status: 'coming_soon', icon: 'ðŸ’³' }
    ];

    const getContent = () => {
        switch (page) {
            case 'wrappers':
                return (
                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="text-xl font-black text-white uppercase tracking-tight italic">Foreign Data Wrappers</h2>
                                <p className="text-zinc-500 text-xs mt-1 uppercase font-black tracking-widest">Connect external data sources directly to your database</p>
                            </div>
                            <button className="flex items-center gap-2 bg-primary text-black px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest hover:scale-105 transition-all shadow-[0_0_20px_rgba(254,254,0,0.3)]">
                                <Plus size={14} /> Add Wrapper
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {wrappers.map((w: any) => {
                                const isActive = activeWrappers.some((aw: any) => aw.name.toLowerCase().includes(w.id.toLowerCase()));
                                return (
                                    <div key={w.id} className={`bg-[#111111] border ${isActive ? 'border-primary/50 bg-primary/5' : 'border-[#2e2e2e]'} rounded-3xl p-6 hover:border-zinc-500 transition-all group relative overflow-hidden`}>
                                        <div className="flex items-start justify-between mb-4">
                                            <div className="w-12 h-12 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                                                {w.icon}
                                            </div>
                                            {isActive && (
                                                <span className="text-[9px] font-black uppercase tracking-widest text-primary bg-primary/10 border border-primary/20 px-2 py-1 rounded-full">Active</span>
                                            )}
                                            {w.status === 'coming_soon' && (
                                                <span className="text-[9px] font-black uppercase tracking-widest text-zinc-600 bg-zinc-800 px-2 py-1 rounded">Soon</span>
                                            )}
                                        </div>
                                        <h3 className="text-lg font-black text-white mb-1 italic uppercase tracking-tight">{w.name}</h3>
                                        <p className="text-xs text-zinc-500 mb-6 leading-relaxed">{w.desc}</p>

                                        <button
                                            disabled={w.status === 'coming_soon' || isActive}
                                            className={`w-full py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${isActive ? 'bg-zinc-800 text-zinc-500 cursor-default' :
                                                w.status === 'coming_soon' ? 'bg-zinc-900 text-zinc-700 cursor-not-allowed' :
                                                    'bg-[#1a1a1a] border border-[#2e2e2e] text-zinc-400 hover:text-white hover:border-primary'
                                                }`}
                                        >
                                            {isActive ? 'Currently Active' : w.status === 'coming_soon' ? 'Under Development' : 'Configure Wrapper'}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );

            case 'webhooks':
                return (
                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="text-xl font-black text-white uppercase tracking-tight italic">Webhooks</h2>
                                <p className="text-zinc-500 text-xs mt-1 uppercase font-black tracking-widest">Send HTTP requests when database events occur</p>
                            </div>
                            <button onClick={() => setShowModal('webhook')} className="flex items-center gap-2 bg-primary text-black px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest hover:scale-105 transition-all">
                                <Plus size={14} /> Create Webhook
                            </button>
                        </div>

                        {webhooks.length === 0 ? (
                            <div className="bg-[#111111] border border-[#2e2e2e] rounded-3xl p-12 text-center">
                                <div className="w-16 h-16 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-center mx-auto mb-6 text-zinc-700">
                                    <Zap size={32} />
                                </div>
                                <h3 className="text-lg font-bold text-zinc-400 mb-2 uppercase tracking-tight">No webhooks configured</h3>
                                <p className="text-xs text-zinc-600 max-w-xs mx-auto mb-8 leading-relaxed">Create your first webhook to trigger external services on database changes.</p>
                                <button onClick={() => setShowModal('webhook')} className="px-8 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white transition-all">Setup Hook</button>
                            </div>
                        ) : (
                            <div className="bg-[#111111] border border-[#2e2e2e] rounded-2xl overflow-hidden shadow-2xl">
                                <table className="w-full">
                                    <thead className="bg-[#0c0c0c] text-[10px] font-black uppercase tracking-widest text-zinc-600">
                                        <tr>
                                            <th className="px-6 py-4 text-left">Name</th>
                                            <th className="px-6 py-4 text-left">URL</th>
                                            <th className="px-6 py-4 text-left">Events</th>
                                            <th className="px-6 py-4 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#2e2e2e]/30">
                                        {webhooks.map((w: any) => (
                                            <tr key={w.id} className="hover:bg-zinc-900/30">
                                                <td className="px-6 py-4 text-sm font-bold text-white">{w.name}</td>
                                                <td className="px-6 py-4 text-xs text-zinc-500 font-mono">{w.url}</td>
                                                <td className="px-6 py-4 text-xs text-primary">{w.events}</td>
                                                <td className="px-6 py-4 text-right">
                                                    <button onClick={() => handleDelete('webhook', w.id)} className="text-red-500 hover:text-red-400 text-[10px] font-black uppercase">Delete</button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                );

            case 'cron':
                return (
                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="text-xl font-black text-white uppercase tracking-tight italic">Cron Jobs</h2>
                                <p className="text-zinc-500 text-xs mt-1 uppercase font-black tracking-widest">Schedule recurring database tasks with pg_cron</p>
                            </div>
                            <button onClick={() => setShowModal('cron')} className="flex items-center gap-2 bg-primary text-black px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest hover:scale-105 transition-all">
                                <Plus size={14} /> New Job
                            </button>
                        </div>

                        {!cronData.enabled ? (
                            <div className="bg-[#111111] border border-yellow-500/20 rounded-3xl p-12 text-center bg-gradient-to-br from-transparent to-yellow-500/5">
                                <div className="w-16 h-16 bg-yellow-500/10 border border-yellow-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6 text-yellow-500">
                                    <History size={32} />
                                </div>
                                <h3 className="text-lg font-black text-white mb-2 italic tracking-tighter uppercase">pg_cron extension not enabled</h3>
                                <p className="text-xs text-zinc-500 mb-8 max-w-xs mx-auto leading-relaxed">You must enable the pg_cron extension to use scheduled jobs.</p>
                                <button className="px-8 py-2.5 bg-yellow-500 text-black rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all">Configure pg_cron</button>
                            </div>
                        ) : cronData.jobs.length === 0 ? (
                            <div className="bg-[#111111] border border-[#2e2e2e] rounded-3xl p-12 text-center">
                                <div className="w-16 h-16 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-center mx-auto mb-6 text-zinc-700">
                                    <Plus size={32} />
                                </div>
                                <p className="text-sm text-zinc-500 uppercase font-black tracking-widest">No active cron jobs</p>
                                <button onClick={() => setShowModal('cron')} className="mt-4 text-primary text-xs font-black uppercase tracking-widest hover:underline">Create First Job</button>
                            </div>
                        ) : (
                            <div className="bg-[#111111] border border-[#2e2e2e] rounded-2xl overflow-hidden shadow-2xl">
                                <table className="w-full">
                                    <thead className="bg-[#0c0c0c] text-[10px] font-black uppercase tracking-widest text-zinc-600">
                                        <tr>
                                            <th className="px-6 py-4 text-left">Name</th>
                                            <th className="px-6 py-4 text-left">Schedule</th>
                                            <th className="px-6 py-4 text-left">Last Run</th>
                                            <th className="px-6 py-4 text-right">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#2e2e2e]/30">
                                        {cronData.jobs.map((j: any) => (
                                            <tr key={j.id} className="hover:bg-zinc-900/30">
                                                <td className="px-6 py-4 text-sm font-bold text-white">{j.name}</td>
                                                <td className="px-6 py-4 font-mono text-primary text-xs">{j.schedule}</td>
                                                <td className="px-6 py-4 text-[10px] text-zinc-500">{j.last_run || 'Never'}</td>
                                                <td className="px-6 py-4 text-right">
                                                    <button onClick={() => handleDelete('cron', j.id)} className="text-red-500 hover:text-red-400 text-[10px] font-black uppercase">Delete</button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                );

            case 'extensions':
                return (
                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="text-xl font-black text-white uppercase tracking-tight italic">Database Extensions</h2>
                                <p className="text-zinc-500 text-xs mt-1 uppercase font-black tracking-widest leading-none">Powered by PostgreSQL Shared Prelod libraries</p>
                            </div>
                            <div className="flex items-center gap-4">
                                <button onClick={fetchExtensions} className="p-2 text-zinc-500 hover:text-primary transition-colors">
                                    <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
                                </button>
                                <div className="relative">
                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
                                    <input
                                        type="text"
                                        value={search}
                                        onChange={(e: any) => setSearch(e.target.value)}
                                        placeholder="Search 100+ extensions..."
                                        className="bg-[#111111] border border-[#2e2e2e] rounded-xl pl-9 pr-6 py-2.5 text-xs text-zinc-300 focus:outline-none focus:border-primary/50 w-80 transition-all shadow-xl"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                            {(search ? filteredExtensions : filteredExtensions.slice(0, 50)).map((ext: any) => (
                                <div key={ext.name} className={`bg-[#111111] border ${ext.installed ? 'border-green-500/30 bg-green-500/[0.02]' : 'border-[#2e2e2e]'} rounded-3xl p-6 hover:border-zinc-700 transition-all group flex flex-col justify-between`}>
                                    <div>
                                        <div className="flex items-center justify-between mb-4">
                                            <div className="w-10 h-10 bg-zinc-900 border border-zinc-800 rounded-xl flex items-center justify-center text-zinc-500 group-hover:text-primary transition-colors">
                                                <Cpu size={20} />
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] font-mono text-zinc-600">{ext.version}</span>
                                                {ext.installed ? (
                                                    <span className="flex items-center gap-1 text-[9px] font-black uppercase text-green-500 bg-green-500/10 px-2 py-0.5 rounded-full border border-green-500/20">
                                                        <CheckCircle size={10} /> Enabled
                                                    </span>
                                                ) : (
                                                    <span className="flex items-center gap-1 text-[9px] font-black uppercase text-zinc-600 bg-zinc-900 px-2 py-0.5 rounded-full border border-zinc-800">
                                                        <XCircle size={10} /> Disabled
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <h3 className="text-md font-black text-white italic truncate uppercase tracking-tight mb-2 font-mono">{ext.name}</h3>
                                        <p className="text-[10px] text-zinc-500 line-clamp-2 leading-relaxed mb-6 h-10">{ext.description}</p>
                                    </div>

                                    <button
                                        onClick={() => toggleExtension(ext.name, ext.installed)}
                                        disabled={loading}
                                        className={`w-full py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${ext.installed
                                            ? 'bg-red-500/10 text-red-500 border border-red-500/10 hover:bg-red-500/20'
                                            : 'bg-zinc-100 text-black hover:bg-primary transition-all'
                                            }`}
                                    >
                                        {loading && !search ? <Loader2 className="animate-spin inline mr-2" size={14} /> : null}
                                        {ext.installed ? 'Uninstall Extension' : 'Install Extension'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                );

            case 'vault':
                return (
                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="text-xl font-black text-white uppercase tracking-tight italic">Vault</h2>
                                <p className="text-zinc-500 text-xs mt-1 uppercase font-black tracking-widest">Securely store secrets, API keys, and sensitive data</p>
                            </div>
                            <button onClick={() => setShowModal('secret')} className="flex items-center gap-2 bg-primary text-black px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest hover:scale-105 transition-all">
                                <Plus size={14} /> Add Secret
                            </button>
                        </div>

                        {secrets.length === 0 ? (
                            <div className="bg-[#111111] border border-[#2e2e2e] rounded-3xl p-12 text-center">
                                <div className="w-16 h-16 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-center mx-auto mb-6 text-zinc-700">
                                    <Shield size={32} />
                                </div>
                                <h3 className="text-lg font-bold text-zinc-400 mb-2 uppercase tracking-tight">Vault is empty</h3>
                                <p className="text-xs text-zinc-600 max-w-xs mx-auto mb-8 leading-relaxed">Securely store your API keys and connection strings.</p>
                                <button onClick={() => setShowModal('secret')} className="px-8 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white transition-all">Add First Secret</button>
                            </div>
                        ) : (
                            <div className="bg-[#111111] border border-[#2e2e2e] rounded-2xl overflow-hidden shadow-2xl">
                                <table className="w-full">
                                    <thead className="bg-[#0c0c0c] text-[10px] font-black uppercase tracking-widest text-zinc-600">
                                        <tr>
                                            <th className="px-6 py-4 text-left">Key Name</th>
                                            <th className="px-6 py-4 text-left">Value</th>
                                            <th className="px-6 py-4 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#2e2e2e]/30">
                                        {secrets.map((s: any) => (
                                            <tr key={s.id} className="hover:bg-zinc-900/30 transition-colors">
                                                <td className="px-6 py-4 text-sm font-bold text-primary font-mono">{s.key}</td>
                                                <td className="px-6 py-4 text-xs text-zinc-500 font-mono">****************</td>
                                                <td className="px-6 py-4 text-right">
                                                    <button onClick={() => handleDelete('secret', s.id)} className="text-red-500 hover:text-red-400 text-[10px] font-black uppercase">Revoke</button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                );

            case 'graphql':
                return (
                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="text-xl font-black text-white uppercase tracking-tight italic">GraphQL API</h2>
                                <p className="text-zinc-500 text-xs mt-1 uppercase font-black tracking-widest">Auto-generated GraphQL API powered by pg_graphql</p>
                            </div>
                            <button
                                onClick={() => void copyGraphQLEndpoint()}
                                className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 text-zinc-300 px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:border-primary/50 transition-all shadow-xl"
                            >
                                <ExternalLink size={14} /> {graphqlCopied ? 'Endpoint Copied' : 'Copy Endpoint'}
                            </button>
                        </div>

                        <div className="bg-[#111111] border border-[#2e2e2e] rounded-3xl p-8 shadow-2xl relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl" />

                            <div className="flex items-center justify-between mb-8 relative z-10">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 bg-[#e10098]/10 rounded-2xl flex items-center justify-center border border-[#e10098]/20">
                                        <Code className="text-[#e10098]" size={24} />
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-bold text-white">Public Endpoint</h4>
                                        <p className="text-[10px] text-zinc-500 uppercase tracking-widest">v1/graphql</p>
                                    </div>
                                </div>
                                {pgExtensions.find((e: any) => e.name === 'pg_graphql')?.installed ? (
                                    <span className="text-[9px] font-black uppercase tracking-widest text-green-500 bg-green-500/10 px-3 py-1 rounded-full border border-green-500/20 shadow-[0_0_15px_rgba(34,197,94,0.1)]">Active & Secure</span>
                                ) : (
                                    <span className="text-[9px] font-black uppercase tracking-widest text-yellow-500 bg-yellow-500/10 px-3 py-1 rounded-full border border-yellow-500/20">Requires pg_graphql</span>
                                )}
                            </div>

                            <div className="bg-[#0c0c0c] p-6 rounded-2xl border border-zinc-800/50 font-mono text-[11px] text-zinc-400 group relative">
                                <span className="text-primary/50 mr-2">âžœ</span>
                                {graphqlEndpoint}
                                <button
                                    onClick={() => void copyGraphQLEndpoint()}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-black uppercase text-zinc-500 hover:text-white"
                                >
                                    {graphqlCopied ? 'Copied' : 'Copy URL'}
                                </button>
                            </div>

                            <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="p-4 bg-zinc-900/30 rounded-2xl border border-zinc-800/50">
                                    <h5 className="text-[10px] font-black uppercase text-white mb-2">Schema Introspection</h5>
                                    <p className="text-[10px] text-zinc-500 leading-relaxed">Automatically maps your PostgreSQL schema, relationships and views to GraphQL types.</p>
                                </div>
                                <div className="p-4 bg-zinc-900/30 rounded-2xl border border-zinc-800/50">
                                    <h5 className="text-[10px] font-black uppercase text-white mb-2">Performance</h5>
                                    <p className="text-[10px] text-zinc-500 leading-relaxed">Compiles GraphQL queries directly into high-performance SQL. No over-fetching.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                );

            default:
                return (
                    <div className="flex items-center justify-center h-[50vh] text-zinc-500">
                        <LayoutGrid size={48} className="opacity-20" />
                    </div>
                );
        }
    };

    const renderModal = () => {
        if (!showModal) return null;

        const titles = {
            webhook: 'Create New Webhook',
            cron: 'Schedule New Cron Job',
            secret: 'Add New Secret to Vault'
        } as Record<string, string>;

        return (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
                <div
                    className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                    onClick={() => setShowModal(null)}
                />
                <div className="relative bg-[#0c0c0c] border border-zinc-800 rounded-3xl w-full max-w-md shadow-2xl animate-in zoom-in duration-200 overflow-hidden">
                    <form onSubmit={handleCreate}>
                        <div className="px-8 py-6 border-b border-zinc-800 bg-zinc-900/50">
                            <h3 className="text-xl font-black text-white italic uppercase tracking-tight">{titles[showModal]}</h3>
                            <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest mt-1">Fill in the details below</p>
                        </div>

                        <div className="p-8 space-y-6">
                            {showModal === 'webhook' && (
                                <>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase text-zinc-500 tracking-widest">Webhook Name</label>
                                        <input
                                            required
                                            className="w-full bg-[#111111] border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary"
                                            placeholder="My API Integration"
                                            onChange={(e: any) => setFormData({ ...formData, name: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase text-zinc-500 tracking-widest">Endpoint URL</label>
                                        <input
                                            required
                                            type="url"
                                            className="w-full bg-[#111111] border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary"
                                            placeholder="https://api.example.com/webhook"
                                            onChange={(e: any) => setFormData({ ...formData, url: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase text-zinc-500 tracking-widest">Events (Comma separated)</label>
                                        <input
                                            required
                                            className="w-full bg-[#111111] border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary"
                                            placeholder="INSERT, UPDATE, DELETE"
                                            onChange={(e: any) => setFormData({ ...formData, events: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase text-zinc-500 tracking-widest">Secret (Optional HMAC Key)</label>
                                        <input
                                            className="w-full bg-[#111111] border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary"
                                            placeholder="my-secret-key"
                                            onChange={(e: any) => setFormData({ ...formData, secret: e.target.value })}
                                        />
                                    </div>
                                </>
                            )}

                            {showModal === 'cron' && (
                                <>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase text-zinc-500 tracking-widest">Job Name</label>
                                        <input
                                            required
                                            className="w-full bg-[#111111] border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary"
                                            placeholder="Daily Cleanup"
                                            onChange={(e: any) => setFormData({ ...formData, name: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase text-zinc-500 tracking-widest">Schedule (Cron syntax)</label>
                                        <input
                                            required
                                            className="w-full bg-[#111111] border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary font-mono"
                                            placeholder="* * * * *"
                                            onChange={(e: any) => setFormData({ ...formData, schedule: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase text-zinc-500 tracking-widest">SQL Command to run</label>
                                        <textarea
                                            required
                                            className="w-full bg-[#111111] border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary font-mono min-h-[100px]"
                                            placeholder="SELECT do_something();"
                                            onChange={(e: any) => setFormData({ ...formData, command: e.target.value })}
                                        />
                                    </div>
                                </>
                            )}

                            {showModal === 'secret' && (
                                <>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase text-zinc-500 tracking-widest">Secret Key Name</label>
                                        <input
                                            required
                                            className="w-full bg-[#111111] border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary font-mono"
                                            placeholder="STRIPE_API_KEY"
                                            onChange={(e: any) => setFormData({ ...formData, key: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase text-zinc-500 tracking-widest">Secret Value</label>
                                        <input
                                            required
                                            type="password"
                                            className="w-full bg-[#111111] border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary"
                                            placeholder="****************"
                                            onChange={(e: any) => setFormData({ ...formData, value: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase text-zinc-500 tracking-widest">Description</label>
                                        <input
                                            className="w-full bg-[#111111] border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary"
                                            placeholder="Used for payment processing"
                                            onChange={(e: any) => setFormData({ ...formData, description: e.target.value })}
                                        />
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="p-8 bg-zinc-900/30 flex items-center justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => setShowModal(null)}
                                className="px-6 py-2.5 rounded-xl text-[10px] font-black uppercase text-zinc-400 hover:text-white transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={loading}
                                className="px-8 py-2.5 bg-primary text-black rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-xl disabled:opacity-50"
                            >
                                {loading ? 'Creating...' : 'Confirm Creation'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        );
    };

    return (
        <div className="flex flex-col h-full bg-[#171717] animate-in fade-in duration-500 overflow-hidden relative">
            {renderModal()}
            {/* Header */}
            <div className="px-8 py-10 border-b border-[#2e2e2e] bg-[#1a1a1a]">
                <div className="flex items-center gap-6">
                    <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center border border-primary/20">
                        <LayoutGrid className="text-primary" size={28} />
                    </div>
                    <div>
                        <h1 className="text-3xl font-black text-white uppercase tracking-tighter italic">Integrations</h1>
                        <p className="text-zinc-500 text-sm font-medium uppercase tracking-[0.2em] text-[10px] mt-1 flex items-center gap-2">
                            <Globe size={12} className="text-blue-500" />
                            Extensions, Wrappers & Third-Party Services
                        </p>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="p-8 flex-1 overflow-auto custom-scrollbar">
                {getContent()}
            </div>
        </div>
    );
};

export default Integrations;

