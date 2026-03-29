import React, { useState, useEffect } from 'react';
import {
    Shield, ShieldCheck, Key, Copy, Check,
    AlertCircle, Loader2, Info, QrCode, Lock,
    Smartphone, Download
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { fetchWithAuth } from '../utils/api';
import ModuleScrollContainer from './ModuleScrollContainer';

const TwoFactorAuth = () => {
    const [isEnabled, setIsEnabled] = useState(false);
    const [loading, setLoading] = useState(true);
    const [setupData, setSetupData] = useState<any>(null);
    const [verificationCode, setVerificationCode] = useState('');
    const [toast, setToast] = useState<any>(null);
    const [step, setStep] = useState('status'); // status, setup, verify
    const [copiedIndex, setCopiedIndex] = useState<any>(null);

    useEffect(() => {
        checkStatus();
    }, []);

    const checkStatus = async () => {
        try {
            const res = await fetchWithAuth('/api/auth/2fa/status');
            const data = await res.json();
            setIsEnabled(data.enabled);
        } catch (error) {
            console.error("Failed to check 2FA status", error);
        } finally {
            setLoading(false);
        }
    };

    const startSetup = async () => {
        setLoading(true);
        try {
            const res = await fetchWithAuth('/api/auth/2fa/setup', { method: 'POST' });
            const data = await res.json();
            setSetupData(data);
            setStep('setup');
        } catch (error) {
            console.error('Failed to setup 2FA', error);
            setToast({ message: 'Failed to setup 2FA', type: 'error' });
        } finally {
            setLoading(false);
            setTimeout(() => setToast(null), 3000);
        }
    };

    const enable2FA = async () => {
        if (verificationCode.length !== 6) {
            setToast({ message: 'Code must be 6 digits', type: 'error' });
            setTimeout(() => setToast(null), 3000);
            return;
        }

        setLoading(true);
        try {
            const res = await fetchWithAuth('/api/auth/2fa/enable', {
                method: 'POST',
                body: JSON.stringify({ code: verificationCode })
            });

            if (res.ok) {
                setIsEnabled(true);
                setStep('status');
                setToast({ message: '2FA enabled successfully!', type: 'success' });
            } else {
                setToast({ message: 'Invalid verification code', type: 'error' });
            }
        } catch (error) {
            console.error('Failed to enable 2FA', error);
            setToast({ message: 'Failed to enable 2FA', type: 'error' });
        } finally {
            setLoading(false);
            setTimeout(() => setToast(null), 3000);
        }
    };

    const disable2FA = async () => {
        if (!confirm('Are you sure you want to disable 2FA? This will make your account less secure.')) {
            return;
        }

        setLoading(true);
        try {
            const res = await fetchWithAuth('/api/auth/2fa/disable', { method: 'POST' });
            if (res.ok) {
                setIsEnabled(false);
                setSetupData(null);
                setToast({ message: '2FA disabled', type: 'success' });
            }
        } catch (error) {
            console.error('Failed to disable 2FA', error);
            setToast({ message: 'Failed to disable 2FA', type: 'error' });
        } finally {
            setLoading(false);
            setTimeout(() => setToast(null), 3000);
        }
    };

    const copyToClipboard = (text: any, index: any) => {
        navigator.clipboard.writeText(text);
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex(null), 2000);
    };

    const downloadBackupCodes = () => {
        const content = `OzyBase 2FA Backup Codes\n\nGenerated: ${new Date().toLocaleString()}\n\n${setupData.backup_codes.join('\n')}\n\nKeep these codes in a safe place. Each code can only be used once.`;
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ozybase-2fa-backup-codes.txt';
        a.click();
    };

    if (loading && step === 'status') return (
        <div className="flex flex-col items-center justify-center h-full gap-4 text-zinc-500">
            <Loader2 className="animate-spin text-primary" size={32} />
            <span className="text-[10px] font-black uppercase tracking-widest">Loading 2FA Settings...</span>
        </div>
    );

    return (
        <ModuleScrollContainer width="4xl" innerClassName="animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#2e2e2e] pb-6">
                <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-2xl border ${isEnabled ? 'bg-green-500/10 border-green-500/20' : 'bg-zinc-900 border-zinc-800'}`}>
                        {isEnabled ? <ShieldCheck className="text-green-500" size={24} /> : <Shield className="text-zinc-500" size={24} />}
                    </div>
                    <div>
                        <h1 className="text-3xl font-black text-white uppercase tracking-tighter italic">Two-Factor Authentication</h1>
                        <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest mt-1">
                            {isEnabled ? 'Status: ACTIVE' : 'Status: DISABLED'}
                        </p>
                    </div>
                </div>
            </div>

            {/* Status View */}
            {step === 'status' && (
                <>
                    {/* Info Box */}
                    <div className="p-6 bg-blue-500/5 border border-blue-500/10 rounded-3xl flex items-start gap-4">
                        <div className="p-2 bg-blue-500/10 rounded-lg text-blue-500 mt-1">
                            <Info size={16} />
                        </div>
                        <div>
                            <h3 className="text-xs font-black text-white uppercase tracking-widest mb-1">What is 2FA?</h3>
                            <p className="text-[10px] text-zinc-500 leading-relaxed font-medium">
                                Two-Factor Authentication adds an extra layer of security to your account. Even if someone knows your password, they won't be able to access your account without the 6-digit code from your authenticator app.
                            </p>
                        </div>
                    </div>

                    {/* Status Card */}
                    <div className="p-8 bg-[#111111] border border-[#2e2e2e] rounded-[2rem]">
                        <div className="flex items-center justify-between mb-8">
                            <div>
                                <h2 className="text-xl font-black text-white uppercase tracking-tight italic mb-2">Current Status</h2>
                                <p className="text-[10px] text-zinc-600 uppercase font-bold tracking-widest">
                                    {isEnabled ? 'Your account is protected with 2FA' : 'Your account is not protected'}
                                </p>
                            </div>
                            <div className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest ${isEnabled ? 'bg-green-500/10 text-green-500 border border-green-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'}`}>
                                {isEnabled ? 'ENABLED' : 'DISABLED'}
                            </div>
                        </div>

                        {!isEnabled ? (
                            <button
                                onClick={startSetup}
                                className="w-full py-4 bg-primary text-black rounded-2xl text-[10px] font-black uppercase tracking-widest hover:scale-[1.02] transition-all flex items-center justify-center gap-2"
                            >
                                <Lock size={16} />
                                Enable Two-Factor Authentication
                            </button>
                        ) : (
                            <button
                                onClick={disable2FA}
                                className="w-full py-4 bg-red-500/10 text-red-500 border border-red-500/20 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-red-500/20 transition-all flex items-center justify-center gap-2"
                            >
                                <AlertCircle size={16} />
                                Disable Two-Factor Authentication
                            </button>
                        )}
                    </div>

                    {/* Recommended Apps */}
                    <div className="p-6 bg-zinc-900/30 border border-white/5 rounded-3xl">
                        <h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                            <Smartphone size={14} />
                            Recommended Authenticator Apps
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            {[
                                { name: 'Google Authenticator', platform: 'iOS & Android' },
                                { name: 'Microsoft Authenticator', platform: 'iOS & Android' },
                                { name: 'Authy', platform: 'iOS, Android & Desktop' }
                            ].map((app: any, i: any) => (
                                <div key={i} className="p-3 bg-zinc-900/50 rounded-xl border border-white/5">
                                    <p className="text-xs font-bold text-white mb-1">{app.name}</p>
                                    <p className="text-[9px] text-zinc-600 font-medium">{app.platform}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}

            {/* Setup View */}
            {step === 'setup' && setupData && (
                <>
                    <div className="p-8 bg-[#111111] border border-[#2e2e2e] rounded-[2rem] space-y-8">
                        {/* Step 1: Scan QR Code */}
                        <div>
                            <div className="flex items-center gap-2 mb-4">
                                <div className="w-8 h-8 bg-primary text-black rounded-full flex items-center justify-center text-xs font-black">1</div>
                                <h3 className="text-lg font-black text-white uppercase tracking-tight">Scan QR Code</h3>
                            </div>
                            <p className="text-[10px] text-zinc-500 mb-6 font-medium">Open your authenticator app and scan this QR code</p>

                            <div className="flex justify-center p-8 bg-white rounded-2xl">
                                <QRCodeSVG value={setupData.qr_code_url} size={200} />
                            </div>

                            <div className="mt-6 p-4 bg-zinc-900/50 rounded-xl border border-zinc-800">
                                <p className="text-[9px] text-zinc-600 uppercase font-bold tracking-widest mb-2">Manual Entry Key</p>
                                <div className="flex items-center justify-between">
                                    <code className="text-xs text-primary font-mono">{setupData.secret}</code>
                                    <button
                                        onClick={() => copyToClipboard(setupData.secret, 'secret')}
                                        className="p-2 hover:bg-zinc-800 rounded-lg transition-colors"
                                    >
                                        {copiedIndex === 'secret' ? <Check size={14} className="text-green-500" /> : <Copy size={14} className="text-zinc-500" />}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Step 2: Verify Code */}
                        <div>
                            <div className="flex items-center gap-2 mb-4">
                                <div className="w-8 h-8 bg-primary text-black rounded-full flex items-center justify-center text-xs font-black">2</div>
                                <h3 className="text-lg font-black text-white uppercase tracking-tight">Verify Code</h3>
                            </div>
                            <p className="text-[10px] text-zinc-500 mb-4 font-medium">Enter the 6-digit code from your authenticator app</p>

                            <div className="flex gap-3">
                                <input
                                    type="text"
                                    maxLength={6}
                                    placeholder="000000"
                                    value={verificationCode}
                                    onChange={(e: any) => setVerificationCode(e.target.value.replace(/\D/g, ''))}
                                    className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-6 py-4 text-2xl text-white text-center font-mono tracking-widest focus:outline-none focus:border-primary/50 transition-all"
                                />
                                <button
                                    onClick={enable2FA}
                                    disabled={loading || verificationCode.length !== 6}
                                    className="px-8 py-4 bg-primary text-black rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                >
                                    {loading ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                                    Verify
                                </button>
                            </div>
                        </div>

                        {/* Step 3: Backup Codes */}
                        <div>
                            <div className="flex items-center gap-2 mb-4">
                                <div className="w-8 h-8 bg-primary text-black rounded-full flex items-center justify-center text-xs font-black">3</div>
                                <h3 className="text-lg font-black text-white uppercase tracking-tight">Save Backup Codes</h3>
                            </div>
                            <p className="text-[10px] text-zinc-500 mb-4 font-medium">Store these codes in a safe place. Each can be used once if you lose access to your authenticator.</p>

                            <div className="grid grid-cols-2 gap-3 mb-4">
                                {setupData.backup_codes.map((code: any, i: any) => (
                                    <div key={i} className="p-3 bg-zinc-900/50 rounded-xl border border-zinc-800 flex items-center justify-between group">
                                        <code className="text-sm text-zinc-300 font-mono">{code}</code>
                                        <button
                                            onClick={() => copyToClipboard(code, i)}
                                            className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-zinc-800 rounded transition-all"
                                        >
                                            {copiedIndex === i ? <Check size={12} className="text-green-500" /> : <Copy size={12} className="text-zinc-500" />}
                                        </button>
                                    </div>
                                ))}
                            </div>

                            <button
                                onClick={downloadBackupCodes}
                                className="w-full py-3 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-zinc-800 transition-all flex items-center justify-center gap-2"
                            >
                                <Download size={14} />
                                Download Backup Codes
                            </button>
                        </div>
                    </div>

                    <button
                        onClick={() => { setStep('status'); setSetupData(null); }}
                        className="text-[10px] text-zinc-600 hover:text-zinc-400 uppercase font-bold tracking-widest transition-colors"
                    >
                        â† Back to Status
                    </button>
                </>
            )}

            {/* Toast */}
            {toast && (
                <div className={`fixed bottom-8 right-8 px-6 py-3 rounded-xl border text-[10px] font-black uppercase tracking-widest flex items-center gap-3 animate-in slide-in-from-bottom duration-300 ${toast.type === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-500' : 'bg-red-500/10 border-red-500/20 text-red-500'}`}>
                    {toast.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}
                    {toast.message}
                </div>
            )}
        </ModuleScrollContainer>
    );
};

export default TwoFactorAuth;

