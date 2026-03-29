import React, { useEffect, useState } from 'react';
import {
    AlertCircle,
    Check,
    Copy,
    Download,
    Info,
    Loader2,
    Lock,
    Shield,
    ShieldCheck,
    Smartphone,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { fetchWithAuth } from '../utils/api';
import ConfirmModal from './ConfirmModal';
import ModuleScrollContainer from './ModuleScrollContainer';
import { BrandedToast } from './OverlayPrimitives';

const TwoFactorAuth = () => {
    const [isEnabled, setIsEnabled] = useState(false);
    const [loading, setLoading] = useState(true);
    const [setupData, setSetupData] = useState<any>(null);
    const [verificationCode, setVerificationCode] = useState('');
    const [toast, setToast] = useState<any>(null);
    const [step, setStep] = useState('status');
    const [copiedIndex, setCopiedIndex] = useState<any>(null);
    const [isDisableConfirmOpen, setIsDisableConfirmOpen] = useState(false);

    useEffect(() => {
        checkStatus();
    }, []);

    const checkStatus = async () => {
        try {
            const res = await fetchWithAuth('/api/auth/2fa/status');
            const data = await res.json();
            setIsEnabled(data.enabled);
        } catch (error) {
            console.error('Failed to check 2FA status', error);
        } finally {
            setLoading(false);
        }
    };

    const showToast = (message: string, type: 'success' | 'error') => {
        setToast({ message, type });
        window.setTimeout(() => setToast(null), 3000);
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
            showToast('Failed to setup 2FA', 'error');
        } finally {
            setLoading(false);
        }
    };

    const enable2FA = async () => {
        if (verificationCode.length !== 6) {
            showToast('Code must be 6 digits', 'error');
            return;
        }

        setLoading(true);
        try {
            const res = await fetchWithAuth('/api/auth/2fa/enable', {
                method: 'POST',
                body: JSON.stringify({ code: verificationCode }),
            });

            if (res.ok) {
                setIsEnabled(true);
                setStep('status');
                showToast('2FA enabled successfully!', 'success');
            } else {
                showToast('Invalid verification code', 'error');
            }
        } catch (error) {
            console.error('Failed to enable 2FA', error);
            showToast('Failed to enable 2FA', 'error');
        } finally {
            setLoading(false);
        }
    };

    const disable2FA = async () => {
        setLoading(true);
        try {
            const res = await fetchWithAuth('/api/auth/2fa/disable', { method: 'POST' });
            if (res.ok) {
                setIsEnabled(false);
                setSetupData(null);
                showToast('2FA disabled', 'success');
            } else {
                showToast('Failed to disable 2FA', 'error');
            }
        } catch (error) {
            console.error('Failed to disable 2FA', error);
            showToast('Failed to disable 2FA', 'error');
        } finally {
            setLoading(false);
        }
    };

    const copyToClipboard = (text: any, index: any) => {
        navigator.clipboard.writeText(text);
        setCopiedIndex(index);
        window.setTimeout(() => setCopiedIndex(null), 2000);
    };

    const downloadBackupCodes = () => {
        const content = `OzyBase 2FA Backup Codes\n\nGenerated: ${new Date().toLocaleString()}\n\n${setupData.backup_codes.join('\n')}\n\nKeep these codes in a safe place. Each code can only be used once.`;
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'ozybase-2fa-backup-codes.txt';
        link.click();
    };

    if (loading && step === 'status') {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-zinc-500">
                <Loader2 className="animate-spin text-primary" size={32} />
                <span className="text-[10px] font-black uppercase tracking-widest">Loading 2FA Settings...</span>
            </div>
        );
    }

    return (
        <ModuleScrollContainer width="4xl" innerClassName="animate-in fade-in duration-500">
            <div className="flex items-center justify-between border-b border-[#2e2e2e] pb-6">
                <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-2xl border ${isEnabled ? 'bg-green-500/10 border-green-500/20' : 'bg-zinc-900 border-zinc-800'}`}>
                        {isEnabled ? <ShieldCheck className="text-green-500" size={24} /> : <Shield className="text-zinc-500" size={24} />}
                    </div>
                    <div>
                        <h1 className="text-3xl font-black text-white uppercase tracking-tighter italic">Two-Factor Authentication</h1>
                        <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-zinc-500">
                            {isEnabled ? 'Status: ACTIVE' : 'Status: DISABLED'}
                        </p>
                    </div>
                </div>
            </div>

            {step === 'status' && (
                <>
                    <div className="flex items-start gap-4 rounded-3xl border border-blue-500/10 bg-blue-500/5 p-6">
                        <div className="mt-1 rounded-lg bg-blue-500/10 p-2 text-blue-500">
                            <Info size={16} />
                        </div>
                        <div>
                            <h3 className="mb-1 text-xs font-black uppercase tracking-widest text-white">What is 2FA?</h3>
                            <p className="text-[10px] font-medium leading-relaxed text-zinc-500">
                                Two-Factor Authentication adds an extra layer of security to your account. Even if someone knows your password,
                                they will not be able to access your account without the 6-digit code from your authenticator app.
                            </p>
                        </div>
                    </div>

                    <div className="rounded-[2rem] border border-[#2e2e2e] bg-[#111111] p-8">
                        <div className="mb-8 flex items-center justify-between">
                            <div>
                                <h2 className="mb-2 text-xl font-black uppercase tracking-tight italic text-white">Current Status</h2>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">
                                    {isEnabled ? 'Your account is protected with 2FA' : 'Your account is not protected'}
                                </p>
                            </div>
                            <div className={`rounded-xl px-4 py-2 text-[10px] font-black uppercase tracking-widest ${isEnabled ? 'border border-green-500/20 bg-green-500/10 text-green-500' : 'border border-red-500/20 bg-red-500/10 text-red-500'}`}>
                                {isEnabled ? 'ENABLED' : 'DISABLED'}
                            </div>
                        </div>

                        {!isEnabled ? (
                            <button
                                onClick={startSetup}
                                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 text-[10px] font-black uppercase tracking-widest text-black transition-all hover:scale-[1.02]"
                            >
                                <Lock size={16} />
                                Enable Two-Factor Authentication
                            </button>
                        ) : (
                            <button
                                onClick={() => setIsDisableConfirmOpen(true)}
                                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 py-4 text-[10px] font-black uppercase tracking-widest text-red-500 transition-all hover:bg-red-500/20"
                            >
                                <AlertCircle size={16} />
                                Disable Two-Factor Authentication
                            </button>
                        )}
                    </div>

                    <div className="rounded-3xl border border-white/5 bg-zinc-900/30 p-6">
                        <h3 className="mb-4 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-zinc-500">
                            <Smartphone size={14} />
                            Recommended Authenticator Apps
                        </h3>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                            {[
                                { name: 'Google Authenticator', platform: 'iOS & Android' },
                                { name: 'Microsoft Authenticator', platform: 'iOS & Android' },
                                { name: 'Authy', platform: 'iOS, Android & Desktop' },
                            ].map((app: any) => (
                                <div key={app.name} className="rounded-xl border border-white/5 bg-zinc-900/50 p-3">
                                    <p className="mb-1 text-xs font-bold text-white">{app.name}</p>
                                    <p className="text-[9px] font-medium text-zinc-600">{app.platform}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}

            {step === 'setup' && setupData && (
                <>
                    <div className="space-y-8 rounded-[2rem] border border-[#2e2e2e] bg-[#111111] p-8">
                        <div>
                            <div className="mb-4 flex items-center gap-2">
                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-black text-black">1</div>
                                <h3 className="text-lg font-black uppercase tracking-tight text-white">Scan QR Code</h3>
                            </div>
                            <p className="mb-6 text-[10px] font-medium text-zinc-500">Open your authenticator app and scan this QR code</p>

                            <div className="flex justify-center rounded-2xl bg-white p-8">
                                <QRCodeSVG value={setupData.qr_code_url} size={200} />
                            </div>

                            <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
                                <p className="mb-2 text-[9px] font-bold uppercase tracking-widest text-zinc-600">Manual Entry Key</p>
                                <div className="flex items-center justify-between">
                                    <code className="text-xs font-mono text-primary">{setupData.secret}</code>
                                    <button
                                        onClick={() => copyToClipboard(setupData.secret, 'secret')}
                                        className="rounded-lg p-2 transition-colors hover:bg-zinc-800"
                                    >
                                        {copiedIndex === 'secret' ? <Check size={14} className="text-green-500" /> : <Copy size={14} className="text-zinc-500" />}
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div>
                            <div className="mb-4 flex items-center gap-2">
                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-black text-black">2</div>
                                <h3 className="text-lg font-black uppercase tracking-tight text-white">Verify Code</h3>
                            </div>
                            <p className="mb-4 text-[10px] font-medium text-zinc-500">Enter the 6-digit code from your authenticator app</p>

                            <div className="flex gap-3">
                                <input
                                    type="text"
                                    maxLength={6}
                                    placeholder="000000"
                                    value={verificationCode}
                                    onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, ''))}
                                    className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900 px-6 py-4 text-center font-mono text-2xl tracking-widest text-white transition-all focus:border-primary/50 focus:outline-none"
                                />
                                <button
                                    onClick={enable2FA}
                                    disabled={loading || verificationCode.length !== 6}
                                    className="flex items-center gap-2 rounded-xl bg-primary px-8 py-4 text-[10px] font-black uppercase tracking-widest text-black transition-all hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {loading ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                                    Verify
                                </button>
                            </div>
                        </div>

                        <div>
                            <div className="mb-4 flex items-center gap-2">
                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-black text-black">3</div>
                                <h3 className="text-lg font-black uppercase tracking-tight text-white">Save Backup Codes</h3>
                            </div>
                            <p className="mb-4 text-[10px] font-medium text-zinc-500">
                                Store these codes in a safe place. Each can be used once if you lose access to your authenticator.
                            </p>

                            <div className="mb-4 grid grid-cols-2 gap-3">
                                {setupData.backup_codes.map((code: any, index: any) => (
                                    <div key={code} className="group flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
                                        <code className="text-sm font-mono text-zinc-300">{code}</code>
                                        <button
                                            onClick={() => copyToClipboard(code, index)}
                                            className="rounded p-1.5 opacity-0 transition-all hover:bg-zinc-800 group-hover:opacity-100"
                                        >
                                            {copiedIndex === index ? <Check size={12} className="text-green-500" /> : <Copy size={12} className="text-zinc-500" />}
                                        </button>
                                    </div>
                                ))}
                            </div>

                            <button
                                onClick={downloadBackupCodes}
                                className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 py-3 text-[10px] font-black uppercase tracking-widest text-zinc-300 transition-all hover:bg-zinc-800"
                            >
                                <Download size={14} />
                                Download Backup Codes
                            </button>
                        </div>
                    </div>

                    <button
                        onClick={() => { setStep('status'); setSetupData(null); }}
                        className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 transition-colors hover:text-zinc-400"
                    >
                        Back to Status
                    </button>
                </>
            )}

            <ConfirmModal
                isOpen={isDisableConfirmOpen}
                onClose={() => setIsDisableConfirmOpen(false)}
                onConfirm={disable2FA}
                title="Disable 2FA"
                message="This account will go back to password-only access. Disable it only after verifying your recovery path."
                confirmText="Disable Protection"
                type="danger"
            />

            {toast ? (
                <BrandedToast
                    tone={toast.type === 'success' ? 'success' : 'error'}
                    message={toast.message}
                    onClose={() => setToast(null)}
                />
            ) : null}
        </ModuleScrollContainer>
    );
};

export default TwoFactorAuth;
