import React, { useEffect, useState } from 'react';
import { Database, Lock, Mail, Loader2, ArrowRight, ShieldCheck } from 'lucide-react';

const Login = ({ onLoginSuccess }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const [flow, setFlow] = useState('login'); // 'login', 'request', 'confirm'
    const [token, setToken] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [message, setMessage] = useState('');
    const [mfaCode, setMfaCode] = useState('');
    const [mfaUser, setMfaUser] = useState(null);

    useEffect(() => {
        const resetToken = sessionStorage.getItem('ozy_reset_token');
        if (!resetToken) return;

        setToken(resetToken);
        setFlow('confirm');
        setMessage('Recovery token loaded. Set a new password.');
        sessionStorage.removeItem('ozy_reset_token');
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setMessage(null);

        try {
            if (flow === 'login') {
                const res = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password }),
                });

                const data = await res.json();
                if (res.status === 202 && data.mfa_required) {
                    setMfaUser(data.mfa_store); // Assuming backend sends userID in mfa_store
                    setFlow('mfa');
                    return;
                }
                
                if (!res.ok) throw new Error(data.error || 'Login failed');

                localStorage.setItem('ozy_token', data.token);
                localStorage.setItem('ozy_user', JSON.stringify(data.user));
                onLoginSuccess();
            } else if (flow === 'mfa') {
                const res = await fetch('/api/auth/2fa/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id: mfaUser, code: mfaCode }),
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Verification failed');

                localStorage.setItem('ozy_token', data.token);
                localStorage.setItem('ozy_user', JSON.stringify(data.user)); // Backend should return user in verification too
                onLoginSuccess();
            } else if (flow === 'request') {
                const res = await fetch('/api/auth/reset-password/request', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Request failed');

                setMessage("Reset token generated (Check console/terminal for OzyBase labs)");
                setFlow('confirm');
                if (data.token) console.log("OZYBASE_LABS_TOKEN:", data.token);
            } else if (flow === 'confirm') {
                const res = await fetch('/api/auth/reset-password/confirm', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token, new_password: newPassword }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Reset failed');

                setMessage("Password reset successful! Please login.");
                setFlow('login');
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleSocialLogin = async (provider) => {
        try {
            const res = await fetch(`/api/auth/login/${provider}`);
            const data = await res.json();
            if (data.url) {
                window.location.href = data.url;
            } else {
                setError("Failed to get auth URL");
            }
        } catch {
            setError("OAuth initialization failed");
        }
    };

    return (
        <div className="min-h-screen bg-[#111111] flex items-center justify-center p-4 font-sans text-zinc-100">
            <div className="w-full max-w-md space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                {/* Logo & Header */}
                <div className="flex flex-col items-center text-center space-y-4">
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-[0_0_30px_rgba(254,254,0,0.15)] ring-4 ring-primary/10 overflow-hidden border border-zinc-800">
                        <img src="/logo.jpg" alt="OzyBase" className="w-full h-full object-cover" />
                    </div>
                    <div className="space-y-1">
                        <h1 className="text-3xl font-bold tracking-tighter text-white uppercase italic">
                            {flow === 'login' ? 'OzyBase' : 'Reset Access'}
                        </h1>
                        <p className="text-zinc-500 text-sm font-medium uppercase tracking-widest flex items-center justify-center gap-2">
                            <ShieldCheck size={14} className="text-primary" />
                            {flow === 'login' ? 'Backend Fortress' : 'Identity Recovery'}
                        </p>
                    </div>
                </div>

                {/* Login Card */}
                <div className="bg-[#171717]/80 backdrop-blur-xl border border-[#2e2e2e] rounded-2xl p-8 shadow-2xl ring-1 ring-white/5">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        {error && (
                            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-500 text-xs font-bold uppercase tracking-wide flex items-center gap-3 animate-in shake duration-300">
                                <div className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]" />
                                {error}
                            </div>
                        )}

                        {message && (
                            <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 text-green-500 text-xs font-bold uppercase tracking-wide flex items-center gap-3 animate-in fade-in">
                                <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]" />
                                {message}
                            </div>
                        )}

                        {flow === 'login' && (
                            <>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] ml-1">Admin Email</label>
                                    <div className="relative group">
                                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600 transition-colors group-focus-within:text-primary" size={18} />
                                        <input
                                            type="email"
                                            required
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            placeholder="system@ozybase.local"
                                            className="w-full bg-[#111111] border border-[#2e2e2e] rounded-xl pl-12 pr-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-700 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all font-mono"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <div className="flex justify-between items-center ml-1">
                                        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em]">Access Key</label>
                                        <button
                                            type="button"
                                            onClick={() => setFlow('request')}
                                            className="text-[9px] font-black text-zinc-600 hover:text-primary transition-colors uppercase"
                                        >
                                            Forgot key?
                                        </button>
                                    </div>
                                    <div className="relative group">
                                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600 transition-colors group-focus-within:text-primary" size={18} />
                                        <input
                                            type="password"
                                            required
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            placeholder="Enter your 32-char password"
                                            className="w-full bg-[#111111] border border-[#2e2e2e] rounded-xl pl-12 pr-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-700 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                                        />
                                    </div>
                                </div>
                            </>
                        )}

                        {flow === 'request' && (
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] ml-1">Account Email</label>
                                <div className="relative group">
                                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600 transition-colors group-focus-within:text-primary" size={18} />
                                    <input
                                        type="email"
                                        required
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="system@ozybase.local"
                                        className="w-full bg-[#111111] border border-[#2e2e2e] rounded-xl pl-12 pr-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-700 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setFlow('login')}
                                    className="text-[9px] font-black text-zinc-600 hover:text-primary transition-colors uppercase ml-1"
                                >
                                    Back to login
                                </button>
                            </div>
                        )}

                        {flow === 'confirm' && (
                            <>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] ml-1">Recovery Token</label>
                                    <input
                                        type="text"
                                        required
                                        value={token}
                                        onChange={(e) => setToken(e.target.value)}
                                        placeholder="Paste token here"
                                        className="w-full bg-[#111111] border border-[#2e2e2e] rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-700 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all font-mono"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] ml-1">New Access Key</label>
                                    <input
                                        type="password"
                                        required
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        placeholder="Minimum 8 characters"
                                        className="w-full bg-[#111111] border border-[#2e2e2e] rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-700 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setFlow('login')}
                                    className="text-[9px] font-black text-zinc-600 hover:text-primary transition-colors uppercase ml-1"
                                >
                                    Cancel
                                </button>
                            </>
                        )}

                        {flow === 'mfa' && (
                            <div className="space-y-4">
                                <div className="text-center space-y-2">
                                    <h3 className="text-sm font-bold text-white uppercase tracking-widest">Multi-Factor Authentication</h3>
                                    <p className="text-[10px] text-zinc-500 font-medium">Please enter the 6-digit code from your authenticator app.</p>
                                </div>
                                <div className="relative group">
                                    <ShieldCheck className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600 transition-colors group-focus-within:text-primary" size={18} />
                                    <input
                                        type="text"
                                        required
                                        maxLength={6}
                                        value={mfaCode}
                                        onChange={(e) => setMfaCode(e.target.value)}
                                        placeholder="000000"
                                        className="w-full bg-[#111111] border border-[#2e2e2e] rounded-xl pl-12 pr-4 py-3 text-lg font-bold tracking-[0.5em] text-center text-primary placeholder:text-zinc-700 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all font-mono"
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setFlow('login')}
                                    className="w-full text-[9px] font-black text-zinc-600 hover:text-primary transition-colors uppercase text-center"
                                >
                                    Cancel & Return
                                </button>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-primary text-black py-4 rounded-xl font-black text-sm uppercase tracking-widest shadow-[0_0_20px_rgba(254,254,0,0.1)] hover:shadow-[0_0_30px_rgba(254,254,0,0.2)] hover:scale-[1.01] active:scale-[0.98] transition-all flex items-center justify-center gap-3 group disabled:opacity-50 disabled:scale-100"
                        >
                            {loading ? (
                                <Loader2 className="animate-spin" size={20} />
                            ) : (
                                <>
                                    {flow === 'login' ? 'Establish Link' : flow === 'mfa' ? 'Verify Identity' : flow === 'request' ? 'Request Recovery' : 'Reset Identity'}
                                    <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
                                </>
                            )}
                        </button>

                        {flow === 'login' && (
                            <div className="space-y-3">
                                <div className="relative flex items-center py-2">
                                    <div className="flex-grow border-t border-zinc-800"></div>
                                    <span className="flex-shrink mx-4 text-[10px] font-black text-zinc-600 uppercase tracking-widest">or continue with</span>
                                    <div className="flex-grow border-t border-zinc-800"></div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <button
                                        type="button"
                                        onClick={() => handleSocialLogin('google')}
                                        className="flex items-center justify-center gap-2 bg-[#1c1c1c] border border-zinc-800 py-3 rounded-xl hover:bg-zinc-800 transition-colors text-xs font-bold text-zinc-300"
                                    >
                                        Google
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleSocialLogin('github')}
                                        className="flex items-center justify-center gap-2 bg-[#1c1c1c] border border-zinc-800 py-3 rounded-xl hover:bg-zinc-800 transition-colors text-xs font-bold text-zinc-300"
                                    >
                                        GitHub
                                    </button>
                                </div>
                            </div>
                        )}
                    </form>
                </div>

                {/* Footer Info */}
                <div className="text-center space-y-4">
                    <p className="text-zinc-600 text-[10px] font-bold uppercase tracking-widest">
                        OzyBase Engine v1.0.0-Ready
                    </p>
                </div>
            </div>
        </div>
    );
};

export default Login;
