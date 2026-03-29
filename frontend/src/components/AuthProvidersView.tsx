import React, { useEffect, useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, KeyRound, RefreshCw, XCircle } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import ModuleScrollContainer from './ModuleScrollContainer';

interface ProviderInfo {
    name: string;
    enabled: boolean;
    configured: boolean;
    callback_url: string;
    login_url: string;
}

const AuthProvidersView: React.FC = () => {
    const [providers, setProviders] = useState<ProviderInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [copied, setCopied] = useState<string | null>(null);

    const loadProviders = async () => {
        setLoading(true);
        try {
            const res = await fetchWithAuth('/api/auth/providers');
            const data = await res.json();
            setProviders(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Failed to load providers:', error);
            setProviders([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadProviders();
    }, []);

    const handleCopy = async (value: string, key: string) => {
        await navigator.clipboard.writeText(value);
        setCopied(key);
        window.setTimeout(() => setCopied(null), 1500);
    };

    return (
        <ModuleScrollContainer width="6xl" innerClassName="animate-in fade-in duration-500">
            <div className="flex items-center justify-between border-b border-[#2e2e2e] pb-6">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-primary/10 rounded-2xl border border-primary/20">
                        <KeyRound className="text-primary" size={24} />
                    </div>
                    <div>
                        <h1 className="text-3xl font-black text-white uppercase tracking-tighter italic">Auth Providers</h1>
                        <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest mt-1">
                            OAuth provider wiring and callback validation
                        </p>
                    </div>
                </div>
                <button
                    onClick={() => void loadProviders()}
                    className="flex items-center gap-2 px-5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-white transition-all"
                >
                    <RefreshCw size={14} />
                    Refresh
                </button>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {providers.map((provider) => (
                        <div key={provider.name} className="bg-[#111111] border border-[#2e2e2e] rounded-3xl p-6 space-y-6 shadow-2xl">
                            <div className="flex items-start justify-between">
                                <div>
                                    <h2 className="text-xl font-black text-white uppercase tracking-tight">{provider.name}</h2>
                                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mt-1">
                                        {provider.configured ? 'Configured in environment' : 'Missing client credentials'}
                                    </p>
                                </div>
                                <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${provider.enabled ? 'bg-green-500/10 border-green-500/20 text-green-500' : 'bg-zinc-900 border-zinc-800 text-zinc-500'}`}>
                                    {provider.enabled ? 'Enabled' : 'Disabled'}
                                </span>
                            </div>

                            <div className="space-y-4">
                                <div className="flex items-start gap-3">
                                    {provider.configured ? <CheckCircle2 size={16} className="text-green-500 mt-0.5" /> : <XCircle size={16} className="text-red-500 mt-0.5" />}
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Callback URL</p>
                                        <code className="text-xs text-zinc-300 break-all">{provider.callback_url}</code>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3">
                                    <ExternalLink size={16} className="text-primary mt-0.5" />
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Login URL</p>
                                        <code className="text-xs text-zinc-300 break-all">{provider.login_url}</code>
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-wrap gap-3 pt-2">
                                <button
                                    onClick={() => void handleCopy(provider.callback_url, `${provider.name}-callback`)}
                                    className="px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-white transition-all flex items-center gap-2"
                                >
                                    <Copy size={12} />
                                    {copied === `${provider.name}-callback` ? 'Copied' : 'Copy Callback'}
                                </button>
                                <button
                                    disabled={!provider.enabled}
                                    onClick={() => window.open(provider.login_url, '_blank', 'noopener,noreferrer')}
                                    className="px-4 py-2 bg-primary text-black rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    Test Login
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </ModuleScrollContainer>
    );
};

export default AuthProvidersView;
