import React, { useEffect, useMemo, useState } from 'react';
import {
    Check,
    Copy,
    CreditCard,
    Info,
    Key,
    Loader2,
    RefreshCw,
    Server,
    Settings as SettingsIcon,
    Trash2,
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

const MENU_ITEMS = [
    { id: 'general', name: 'General', icon: SettingsIcon },
    { id: 'infrastructure', name: 'Infrastructure', icon: Server },
    { id: 'billing', name: 'Billing', icon: CreditCard },
    { id: 'api_keys', name: 'API Keys', icon: Key },
];

const EMPTY_KEY_FORM = {
    name: '',
    role: 'anon',
};

interface SettingsProps {
    view?: string;
    onViewSelect?: (view: string) => void;
}

interface ProjectInfo {
    database?: string;
    version?: string;
}

interface ConnectionInfo {
    host?: string;
    port?: string;
    database?: string;
    user?: string;
    api_url?: string;
    direct_uri_template?: string;
    pooler_uri_template?: string;
    app_version?: string;
    git_commit?: string;
}

interface APIKeyItem {
    id: string;
    name: string;
    prefix: string;
    role: string;
    is_active: boolean;
}

const Settings: React.FC<SettingsProps> = ({ view = 'general', onViewSelect }) => {
    const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null);
    const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(null);
    const [apiKeys, setApiKeys] = useState<APIKeyItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [keysLoading, setKeysLoading] = useState(false);
    const [keyForm, setKeyForm] = useState(EMPTY_KEY_FORM);
    const [creatingKey, setCreatingKey] = useState(false);
    const [createdKey, setCreatedKey] = useState<Record<string, any> | null>(null);
    const [copied, setCopied] = useState<string | null>(null);

    const currentView = useMemo(
        () => MENU_ITEMS.some((item) => item.id === view) ? view : 'general',
        [view],
    );

    const copyValue = async (value: string | undefined, key: string) => {
        if (!value) {
            return;
        }
        await navigator.clipboard.writeText(value);
        setCopied(key);
        window.setTimeout(() => setCopied(null), 1500);
    };

    const loadProjectData = async () => {
        setLoading(true);
        try {
            const [infoRes, connectionRes] = await Promise.all([
                fetchWithAuth('/api/project/info'),
                fetchWithAuth('/api/project/connection'),
            ]);
            const info = await infoRes.json();
            const connection = await connectionRes.json();
            setProjectInfo(info);
            setConnectionInfo(connection);
        } catch (error) {
            console.error('Failed to load project settings:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadKeys = async () => {
        setKeysLoading(true);
        try {
            const res = await fetchWithAuth('/api/project/keys');
            const data = await res.json();
            setApiKeys(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Failed to load API keys:', error);
            setApiKeys([]);
        } finally {
            setKeysLoading(false);
        }
    };

    useEffect(() => {
        void loadProjectData();
    }, []);

    useEffect(() => {
        if (currentView === 'api_keys') {
            void loadKeys();
        }
    }, [currentView]);

    const handleCreateKey = async (event: React.FormEvent) => {
        event.preventDefault();
        setCreatingKey(true);
        try {
            const res = await fetchWithAuth('/api/project/keys', {
                method: 'POST',
                body: JSON.stringify(keyForm),
            });
            const payload = await res.json();
            if (!res.ok) {
                return;
            }
            setCreatedKey(payload);
            setKeyForm(EMPTY_KEY_FORM);
            await loadKeys();
        } catch (error) {
            console.error('Failed to create API key:', error);
        } finally {
            setCreatingKey(false);
        }
    };

    const handleToggleKey = async (apiKey: APIKeyItem) => {
        try {
            const res = await fetchWithAuth(`/api/project/keys/${apiKey.id}/toggle`, {
                method: 'PATCH',
                body: JSON.stringify({ active: !apiKey.is_active }),
            });
            if (res.ok) {
                await loadKeys();
            }
        } catch (error) {
            console.error('Failed to toggle API key:', error);
        }
    };

    const handleDeleteKey = async (keyId: string) => {
        if (!window.confirm('Delete this API key?')) {
            return;
        }
        try {
            const res = await fetchWithAuth(`/api/project/keys/${keyId}`, { method: 'DELETE' });
            if (res.ok) {
                await loadKeys();
            }
        } catch (error) {
            console.error('Failed to delete API key:', error);
        }
    };

    const renderGeneral = () => (
        <div className="space-y-8 animate-in fade-in duration-300">
            <div>
                <h2 className="text-2xl font-black text-white italic tracking-tighter uppercase mb-2">Project Metadata</h2>
                <p className="text-zinc-500 text-sm font-medium">Safe project information exposed by the running deployment.</p>
            </div>

            <div className="bg-[#171717]/50 border border-[#2e2e2e] rounded-3xl overflow-hidden shadow-2xl">
                <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-6">
                    {[
                        { label: 'Project ID', value: projectInfo?.database || 'unknown', copyKey: 'project-id' },
                        { label: 'Postgres Version', value: projectInfo?.version || 'unknown' },
                        { label: 'App Version', value: connectionInfo?.app_version || 'dev' },
                        { label: 'Git Commit', value: connectionInfo?.git_commit || 'unknown' },
                    ].map((item) => (
                        <div key={item.label} className="bg-[#0c0c0c] border border-[#2e2e2e] rounded-2xl p-5">
                            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">{item.label}</p>
                            <div className="flex items-center justify-between gap-4">
                                <code className="text-sm text-white break-all">{item.value}</code>
                                {item.copyKey && (
                                    <button
                                        onClick={() => void copyValue(item.value, item.copyKey)}
                                        className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-white transition-colors"
                                    >
                                        {copied === item.copyKey ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
                <div className="px-8 py-5 border-t border-[#2e2e2e] bg-[#111111]/40">
                    <div className="flex items-start gap-4">
                        <Info size={16} className="text-primary mt-0.5" />
                        <p className="text-[11px] text-zinc-500 leading-relaxed">
                            Self-hosted mode does not expose mutable project lifecycle controls in the dashboard.
                            Unsupported actions such as restart, pause or domain management are intentionally hidden.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );

    const renderInfrastructure = () => (
        <div className="space-y-8 animate-in fade-in duration-300">
            <div>
                <h2 className="text-2xl font-black text-white italic tracking-tighter uppercase mb-2">Infrastructure</h2>
                <p className="text-zinc-500 text-sm font-medium">Connection metadata without passwords or service-role secrets.</p>
            </div>

            <div className="bg-[#171717]/50 border border-[#2e2e2e] rounded-3xl overflow-hidden shadow-2xl">
                <div className="p-8 space-y-6">
                    {[
                        { label: 'Direct URI', value: connectionInfo?.direct_uri_template, copyKey: 'direct-uri' },
                        { label: 'Pooler URI', value: connectionInfo?.pooler_uri_template, copyKey: 'pooler-uri' },
                        { label: 'API URL', value: connectionInfo?.api_url, copyKey: 'api-url' },
                    ].map((item) => (
                        <div key={item.label} className="bg-[#0c0c0c] border border-[#2e2e2e] rounded-2xl p-5">
                            <div className="flex items-center justify-between gap-4">
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">{item.label}</p>
                                    <code className="text-xs text-zinc-300 break-all">{item.value || 'not available'}</code>
                                </div>
                                <button
                                    onClick={() => void copyValue(item.value, item.copyKey)}
                                    className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-white transition-colors"
                                >
                                    {copied === item.copyKey ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                                </button>
                            </div>
                        </div>
                    ))}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {[
                            ['Host', connectionInfo?.host],
                            ['Port', connectionInfo?.port],
                            ['Database', connectionInfo?.database],
                            ['User', connectionInfo?.user],
                        ].map(([label, value]) => (
                            <div key={label} className="bg-[#0c0c0c] border border-[#2e2e2e] rounded-2xl p-5">
                                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">{label}</p>
                                <div className="flex items-center justify-between gap-4">
                                    <code className="text-sm text-white break-all">{value || 'unknown'}</code>
                                    <button
                                        onClick={() => void copyValue(typeof value === 'string' ? value : undefined, String(label))}
                                        className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-white transition-colors"
                                    >
                                        {copied === label ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );

    const renderBilling = () => (
        <div className="space-y-8 animate-in fade-in duration-300">
            <div>
                <h2 className="text-2xl font-black text-white italic tracking-tighter uppercase mb-2">Billing</h2>
                <p className="text-zinc-500 text-sm font-medium">Self-hosted deployments do not use the managed billing surface.</p>
            </div>
            <div className="bg-[#171717]/50 border border-[#2e2e2e] rounded-3xl p-8 shadow-2xl">
                <div className="flex items-start gap-4">
                    <CreditCard size={18} className="text-primary mt-0.5" />
                    <div>
                        <h3 className="text-sm font-black text-white uppercase tracking-widest">No managed billing provider attached</h3>
                        <p className="text-[11px] text-zinc-500 leading-relaxed mt-2">
                            Resource planning, cloud invoices and external load balancer costs remain managed outside OzyBase
                            in this deployment model. This section stays informational instead of exposing dead controls.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );

    const renderApiKeys = () => (
        <div className="space-y-8 animate-in fade-in duration-300">
            <div>
                <h2 className="text-2xl font-black text-white italic tracking-tighter uppercase mb-2">API Keys</h2>
                <p className="text-zinc-500 text-sm font-medium">Create, rotate and disable API keys backed by `/api/project/keys`.</p>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-6">
                <form onSubmit={handleCreateKey} className="bg-[#171717]/50 border border-[#2e2e2e] rounded-3xl p-8 space-y-5 shadow-2xl">
                    <h3 className="text-sm font-black text-white uppercase tracking-widest">Create New Key</h3>
                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Name</label>
                        <input
                            required
                            value={keyForm.name}
                            onChange={(event) => setKeyForm((current) => ({ ...current, name: event.target.value }))}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary/50"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Role</label>
                        <select
                            value={keyForm.role}
                            onChange={(event) => setKeyForm((current) => ({ ...current, role: event.target.value }))}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary/50"
                        >
                            <option value="anon">anon</option>
                            <option value="service_role">service_role</option>
                        </select>
                    </div>
                    <button
                        type="submit"
                        disabled={creatingKey}
                        className="w-full px-6 py-3 bg-primary text-black rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-60 flex items-center justify-center gap-2"
                    >
                        {creatingKey ? <Loader2 size={14} className="animate-spin" /> : <Key size={14} />}
                        {creatingKey ? 'Creating' : 'Create Key'}
                    </button>

                    {createdKey && (
                        <div className="bg-primary/10 border border-primary/20 rounded-2xl p-5 space-y-3">
                            <p className="text-[10px] font-black uppercase tracking-widest text-primary">Copy this key now</p>
                            <code className="text-xs text-white break-all">{String(createdKey.key || '')}</code>
                            <button
                                type="button"
                                onClick={() => void copyValue(String(createdKey.key || ''), 'new-key')}
                                className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-white transition-all"
                            >
                                {copied === 'new-key' ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                                {copied === 'new-key' ? 'Copied' : 'Copy Key'}
                            </button>
                        </div>
                    )}
                </form>

                <div className="bg-[#171717]/50 border border-[#2e2e2e] rounded-3xl overflow-hidden shadow-2xl">
                    <div className="px-8 py-5 border-b border-[#2e2e2e] bg-[#111111]/40 flex items-center justify-between">
                        <h3 className="text-sm font-black text-white uppercase tracking-widest">Existing Keys</h3>
                        <button
                            onClick={() => void loadKeys()}
                            className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-white transition-all"
                        >
                            <RefreshCw size={12} />
                            Refresh
                        </button>
                    </div>
                    <div className="p-6">
                        {keysLoading ? (
                            <div className="flex items-center justify-center py-16">
                                <Loader2 size={24} className="text-primary animate-spin" />
                            </div>
                        ) : apiKeys.length === 0 ? (
                            <div className="text-center py-16 text-zinc-500">
                                <Key size={28} className="mx-auto mb-3 opacity-50" />
                                <p className="text-[10px] font-black uppercase tracking-widest">No API keys created yet</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {apiKeys.map((apiKey) => (
                                    <div key={apiKey.id} className="bg-[#0c0c0c] border border-[#2e2e2e] rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                                        <div>
                                            <p className="text-sm font-black text-white">{apiKey.name}</p>
                                            <div className="flex flex-wrap items-center gap-3 mt-2 text-[10px] uppercase tracking-widest text-zinc-600 font-black">
                                                <span>{apiKey.prefix}</span>
                                                <span>{apiKey.role}</span>
                                                <span>{apiKey.is_active ? 'active' : 'disabled'}</span>
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap gap-3">
                                            <button
                                                onClick={() => void handleToggleKey(apiKey)}
                                                className="px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-white transition-all"
                                            >
                                                {apiKey.is_active ? 'Disable' : 'Enable'}
                                            </button>
                                            <button
                                                onClick={() => void handleDeleteKey(apiKey.id)}
                                                className="px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-xl text-[10px] font-black uppercase tracking-widest text-red-500 hover:bg-red-500/20 transition-all flex items-center gap-2"
                                            >
                                                <Trash2 size={12} />
                                                Delete
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="bg-[#171717]/50 border border-[#2e2e2e] rounded-3xl p-6 shadow-2xl">
                <p className="text-[11px] text-zinc-500 leading-relaxed">
                    The current session token stays local to your browser session and is not treated as a service-role secret.
                    Service-role API keys are only shown once at creation time and never re-exposed by the dashboard.
                </p>
            </div>
        </div>
    );

    if (loading) {
        return (
            <div className="flex h-full items-center justify-center bg-[#111111]">
                <Loader2 size={28} className="text-primary animate-spin" />
            </div>
        );
    }

    return (
        <div className="flex h-full bg-[#111111] animate-in fade-in duration-500 overflow-hidden">
            <div className="w-64 border-r border-[#2e2e2e] bg-[#0c0c0c] flex flex-col flex-shrink-0">
                <div className="px-6 py-6 font-black text-white uppercase tracking-tighter text-lg border-b border-[#2e2e2e]">
                    Settings
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2 py-8">
                    {MENU_ITEMS.map((item) => (
                        <button
                            key={item.id}
                            onClick={() => onViewSelect?.(item.id)}
                            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-all group ${currentView === item.id
                                ? 'bg-zinc-900 border border-zinc-800 text-primary font-bold'
                                : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900/40 border border-transparent'
                                }`}
                        >
                            <div className="flex items-center gap-3">
                                <item.icon size={14} className={currentView === item.id ? 'text-primary' : 'text-zinc-700 group-hover:text-zinc-400'} />
                                <span className="tracking-tight">{item.name}</span>
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar bg-[#111111]">
                <div className="max-w-5xl mx-auto py-12 px-12">
                    {currentView === 'general' && renderGeneral()}
                    {currentView === 'infrastructure' && renderInfrastructure()}
                    {currentView === 'billing' && renderBilling()}
                    {currentView === 'api_keys' && renderApiKeys()}
                </div>
            </div>
        </div>
    );
};

export default Settings;
