import React, { useEffect, useState } from 'react';
import { CheckCircle2, Lock, Mail, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

const SETTING_CARDS = [
    { id: 'smtp_configured', label: 'SMTP Delivery', icon: Mail, description: 'Transactional email sending for auth flows.' },
    { id: 'oauth_enabled', label: 'OAuth Providers', icon: Lock, description: 'External identity provider support.' },
    { id: 'email_verification_enabled', label: 'Email Verification', icon: CheckCircle2, description: 'Email confirmation on signup.' },
    { id: 'mfa_supported', label: 'Multi-Factor Auth', icon: ShieldCheck, description: '2FA challenge support for user sessions.' },
];

interface AuthRuntimeConfig {
    smtp_configured?: boolean;
    oauth_enabled?: boolean;
    email_verification_enabled?: boolean;
    mfa_supported?: boolean;
}

const AuthSettingsView: React.FC = () => {
    const [config, setConfig] = useState<AuthRuntimeConfig | null>(null);
    const [loading, setLoading] = useState(true);

    const loadConfig = async () => {
        setLoading(true);
        try {
            const res = await fetchWithAuth('/api/auth/config');
            const data = await res.json();
            setConfig(data);
        } catch (error) {
            console.error('Failed to load auth config:', error);
            setConfig(null);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadConfig();
    }, []);

    return (
        <div className="p-8 max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
            <div className="flex items-center justify-between border-b border-[#2e2e2e] pb-6">
                <div>
                    <h1 className="text-3xl font-black text-white uppercase tracking-tighter italic">Auth Settings</h1>
                    <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest mt-1">
                        Secure deployment summary from the running backend
                    </p>
                </div>
                <button
                    onClick={() => void loadConfig()}
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
                <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {SETTING_CARDS.map((card) => {
                            const active = Boolean(config?.[card.id as keyof AuthRuntimeConfig]);
                            return (
                                <div key={card.id} className="bg-[#111111] border border-[#2e2e2e] rounded-3xl p-6 flex items-start justify-between gap-6">
                                    <div>
                                        <div className="flex items-center gap-3 mb-3">
                                            <div className={`p-3 rounded-2xl border ${active ? 'bg-green-500/10 border-green-500/20 text-green-500' : 'bg-zinc-900 border-zinc-800 text-zinc-600'}`}>
                                                <card.icon size={18} />
                                            </div>
                                            <div>
                                                <h2 className="text-lg font-black text-white uppercase tracking-tight">{card.label}</h2>
                                                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mt-1">{card.description}</p>
                                            </div>
                                        </div>
                                    </div>
                                    <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border shrink-0 ${active ? 'bg-green-500/10 border-green-500/20 text-green-500' : 'bg-red-500/10 border-red-500/20 text-red-500'}`}>
                                        {active ? 'Ready' : 'Missing'}
                                    </span>
                                </div>
                            );
                        })}
                    </div>

                    <div className="bg-[#111111] border border-[#2e2e2e] rounded-3xl p-6">
                        <div className="flex items-start gap-4">
                            <div className="p-3 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-500">
                                {config?.smtp_configured ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
                            </div>
                            <div>
                                <h3 className="text-sm font-black text-white uppercase tracking-widest">Operational Note</h3>
                                <p className="text-[11px] text-zinc-500 leading-relaxed mt-2">
                                    This screen exposes only safe runtime status. Secret material such as SMTP passwords, OAuth secrets,
                                    service keys or database credentials is intentionally excluded from the API contract.
                                </p>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default AuthSettingsView;
