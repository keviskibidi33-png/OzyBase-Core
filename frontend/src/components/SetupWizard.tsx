import React, { useState, useEffect } from 'react';
import {
    ShieldCheck, Zap, Server, Globe, Lock,
    CheckCircle, ArrowRight, Database, Loader2
} from 'lucide-react';

type SetupMode = 'clean' | 'secure' | 'migrate';

interface SetupFormData {
    email: string;
    password: string;
    confirmPassword: string;
    country: string;
}

interface SetupWizardProps {
    onComplete: (token: string) => void;
}

interface SetupResponse {
    token?: string;
    error?: string;
}

const getErrorMessage = (error: unknown, fallback: string): string => {
    if (error instanceof Error) return error.message;
    return fallback;
};

const SetupWizard: React.FC<SetupWizardProps> = ({ onComplete }: any) => {
    const [step, setStep] = useState(1);
    const [mode, setMode] = useState<SetupMode | null>(null);
    const [formData, setFormData] = useState<SetupFormData>({
        email: '',
        password: '',
        confirmPassword: '',
        country: ''
    });
    const [loading, setLoading] = useState(false);
    const [detectingLoc, setDetectingLoc] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        setDetectingLoc(true);
        fetch('https://ipapi.co/json/')
            .then((res: any) => res.json())
            .then((data: unknown) => {
                const country = (
                    typeof data === 'object' &&
                    data !== null &&
                    'country' in data &&
                    typeof (data as { country?: unknown }).country === 'string'
                ) ? (data as { country: string }).country : '';
                setFormData((prev: any) => ({ ...prev, country }));
            })
            .catch(() => console.warn('Could not detect location'))
            .finally(() => setDetectingLoc(false));
    }, []);

    const handleSetup = async () => {
        if (formData.password !== formData.confirmPassword) {
            setError('Passwords do not match');
            return;
        }
        if (formData.password.length < 8) {
            setError('Password must be at least 8 characters');
            return;
        }

        setLoading(true);
        setError('');

        try {
            if (!mode) {
                throw new Error('Select setup mode');
            }
            const res = await fetch('/api/system/setup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: formData.email,
                    password: formData.password,
                    mode,
                    allow_country: formData.country
                })
            });

            const data = await res.json() as SetupResponse;
            if (!res.ok) throw new Error(data.error || 'Setup failed');

            if (data.token) {
                onComplete(data.token);
            } else {
                throw new Error('Security handshake failed: No token received.');
            }
        } catch (err: unknown) {
            setError(getErrorMessage(err, 'Setup failed'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/95 flex items-center justify-center p-4 z-50 backdrop-blur-sm animate-in fade-in duration-500">
            <div className="w-full max-w-4xl bg-[#0a0a0a] border border-zinc-800 rounded-[2rem] overflow-hidden shadow-2xl flex flex-col md:flex-row h-[600px]">
                <div className="w-full md:w-1/3 bg-zinc-900/50 p-8 flex flex-col justify-between border-r border-zinc-800 relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent pointer-events-none" />

                    <div>
                        <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center mb-6 shadow-[0_0_30px_-5px_rgba(34,197,94,0.3)]">
                            <Database className="text-black" size={24} strokeWidth={2.5} />
                        </div>
                        <h1 className="text-3xl font-black text-white uppercase tracking-tighter italic mb-2">
                            OzyBase <span className="text-primary">Setup</span>
                        </h1>
                        <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest">
                            Initialize your backend
                        </p>
                    </div>

                    <div className="space-y-4">
                        <div className="flex items-center gap-3 text-zinc-400">
                            <CheckCircle size={16} className="text-primary" />
                            <span className="text-xs font-medium">Database Schema Ready</span>
                        </div>
                        <div className="flex items-center gap-3 text-zinc-400">
                            <CheckCircle size={16} className="text-primary" />
                            <span className="text-xs font-medium">API Gateway Active</span>
                        </div>
                        <div className="flex items-center gap-3 text-zinc-400">
                            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${step >= 1 ? 'border-primary text-primary' : 'border-zinc-700 text-transparent'}`}>
                                <div className="w-1.5 h-1.5 bg-current rounded-full" />
                            </div>
                            <span className={`text-xs font-medium ${step === 1 ? 'text-white' : 'text-zinc-600'}`}>Choose Mode</span>
                        </div>
                        <div className="flex items-center gap-3 text-zinc-400">
                            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${step === 2 ? 'border-primary text-primary' : 'border-zinc-700 text-transparent'}`}>
                                <div className="w-1.5 h-1.5 bg-current rounded-full" />
                            </div>
                            <span className={`text-xs font-medium ${step === 2 ? 'text-white' : 'text-zinc-600'}`}>Register Admin</span>
                        </div>
                    </div>
                </div>

                <div className="flex-1 p-8 md:p-12 flex flex-col relative">
                    {step === 1 ? (
                        <div className="animate-in slide-in-from-right duration-500">
                            <h2 className="text-2xl font-black text-white uppercase tracking-tight mb-2">How do you want to start?</h2>
                            <p className="text-zinc-500 text-sm mb-8">Choose your initial security posture.</p>

                            <div className="grid grid-cols-1 gap-4">
                                <button
                                    onClick={() => { setMode('clean'); setStep(2); }}
                                    className="group p-6 rounded-2xl border border-zinc-800 bg-zinc-900/30 hover:bg-zinc-900 hover:border-zinc-700 text-left transition-all hover:scale-[1.01]"
                                >
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="p-3 bg-zinc-800 rounded-xl group-hover:bg-zinc-700 transition-colors">
                                            <Zap size={20} className="text-white" />
                                        </div>
                                        <ArrowRight size={16} className="text-zinc-600 group-hover:text-white transition-colors opacity-0 group-hover:opacity-100" />
                                    </div>
                                    <h3 className="text-lg font-bold text-white mb-1">Do it myself</h3>
                                    <p className="text-xs text-zinc-500 leading-relaxed">
                                        Start with a pristine database. Only system tables are created. You configure security rules manually.
                                    </p>
                                </button>

                                <button
                                    onClick={() => { setMode('secure'); setStep(2); }}
                                    className="group p-6 rounded-2xl border border-primary/20 bg-primary/5 hover:bg-primary/10 hover:border-primary/40 text-left transition-all hover:scale-[1.01] relative overflow-hidden"
                                >
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="p-3 bg-primary/20 rounded-xl text-primary">
                                            <ShieldCheck size={20} />
                                        </div>
                                        <span className="px-3 py-1 bg-primary text-black text-[10px] font-black uppercase tracking-widest rounded-full">Recommended</span>
                                    </div>
                                    <h3 className="text-lg font-bold text-white mb-1">Secure Fortress</h3>
                                    <p className="text-xs text-zinc-400 leading-relaxed">
                                        Start with enterprise-grade security.
                                        <span className="block mt-2 text-primary/80 flex items-center gap-2">
                                            <CheckCircle size={10} /> Auto-enable Geo-Fencing
                                        </span>
                                        <span className="block mt-1 text-primary/80 flex items-center gap-2">
                                            <CheckCircle size={10} /> Strict RBAC Defaults
                                        </span>
                                    </p>
                                </button>

                                <button
                                    onClick={() => { setMode('migrate'); setStep(2); }}
                                    className="group p-6 rounded-2xl border border-blue-500/20 bg-blue-500/5 hover:bg-blue-500/10 hover:border-blue-500/40 text-left transition-all hover:scale-[1.01]"
                                >
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="p-3 bg-blue-500/20 rounded-xl text-blue-400">
                                            <Database size={20} />
                                        </div>
                                        <ArrowRight size={16} className="text-zinc-600 group-hover:text-white transition-colors opacity-0 group-hover:opacity-100" />
                                    </div>
                                    <h3 className="text-lg font-bold text-white mb-1">Migrate existing data</h3>
                                    <p className="text-xs text-zinc-400 leading-relaxed">
                                        Keep your current database content and complete admin bootstrap only.
                                    </p>
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="animate-in slide-in-from-right duration-500 h-full flex flex-col">
                            <button onClick={() => setStep(1)} className="text-xs text-zinc-500 hover:text-white mb-4 flex items-center gap-1">Back</button>

                            <h2 className="text-2xl font-black text-white uppercase tracking-tight mb-2">Register Admin Account</h2>
                            <p className="text-zinc-500 text-sm mb-6">Create your credentials to administrate the whole system.</p>

                            <div className="space-y-4 flex-1">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Email</label>
                                    <input
                                        type="email"
                                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:border-primary/50 focus:outline-none transition-all"
                                        placeholder="admin@company.com"
                                        value={formData.email}
                                        onChange={(e: any) => setFormData({ ...formData, email: e.target.value })}
                                    />
                                </div>
                                <div className="row flex gap-4">
                                    <div className="space-y-2 flex-1">
                                        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Password</label>
                                        <input
                                            type="password"
                                            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:border-primary/50 focus:outline-none transition-all"
                                            placeholder="********"
                                            value={formData.password}
                                            onChange={(e: any) => setFormData({ ...formData, password: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2 flex-1">
                                        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Confirm</label>
                                        <input
                                            type="password"
                                            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:border-primary/50 focus:outline-none transition-all"
                                            placeholder="********"
                                            value={formData.confirmPassword}
                                            onChange={(e: any) => setFormData({ ...formData, confirmPassword: e.target.value })}
                                        />
                                    </div>
                                </div>

                                {mode === 'secure' && (
                                    <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl mt-4">
                                        <div className="flex items-center gap-2 mb-2 text-primary">
                                            <Globe size={16} />
                                            <span className="text-xs font-bold uppercase tracking-widest">Geo-Fencing Config</span>
                                        </div>
                                        <div className="flex items-center justify-between text-xs text-zinc-400">
                                            <span>Allowed Country:</span>
                                            {detectingLoc ? (
                                                <span className="flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Detecting...</span>
                                            ) : (
                                                <div className="flex items-center gap-2">
                                                    <span className="text-white font-mono bg-zinc-800 px-2 py-1 rounded">{formData.country || 'Unknown'}</span>
                                                    <span className="text-[10px] opacity-60">(Detected)</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {error && (
                                <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 text-red-500 text-xs font-bold rounded-lg flex items-center gap-2">
                                    <Lock size={14} /> {error}
                                </div>
                            )}

                            <div className="mt-6 pt-6 border-t border-zinc-800 flex justify-end">
                                <button
                                    onClick={handleSetup}
                                    disabled={loading}
                                    className="px-8 py-3 bg-primary text-black rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all disabled:opacity-50 flex items-center gap-2"
                                >
                                    {loading ? <Loader2 size={14} className="animate-spin" /> : <Server size={14} />}
                                    {loading ? 'Initializing...' : 'Initialize System'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SetupWizard;
