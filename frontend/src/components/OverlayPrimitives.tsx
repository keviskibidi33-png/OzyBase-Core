import React from 'react';
import { AlertTriangle, CheckCircle2, Info, Shield, X } from 'lucide-react';

export const cx = (...classes: Array<string | false | null | undefined>) => (
    classes.filter(Boolean).join(' ')
);

export type BrandedToastTone = 'success' | 'error' | 'warning' | 'info';
export type BrandedToastPosition = 'top-right' | 'bottom-right';

interface BrandedToastProps {
    message: string;
    tone?: BrandedToastTone;
    title?: string;
    onClose?: () => void;
    className?: string;
    position?: BrandedToastPosition;
    durationMs?: number;
}

const TOAST_TONE_STYLES: Record<BrandedToastTone, { accent: string; title: string; icon: React.ReactNode }> = {
    success: {
        accent: 'text-green-400 border-green-500/20 ring-1 ring-green-500/15 bg-green-500/8',
        title: 'Success',
        icon: <CheckCircle2 size={18} className="animate-[ozy-success-bounce_420ms_ease-out]" />,
    },
    error: {
        accent: 'text-red-400 border-red-500/20 ring-1 ring-red-500/15 bg-red-500/8',
        title: 'Error',
        icon: <AlertTriangle size={18} />,
    },
    warning: {
        accent: 'text-amber-400 border-amber-500/20 ring-1 ring-amber-500/15 bg-amber-500/8',
        title: 'Warning',
        icon: <Shield size={18} />,
    },
    info: {
        accent: 'text-sky-400 border-sky-500/20 ring-1 ring-sky-500/15 bg-sky-500/8',
        title: 'Info',
        icon: <Info size={18} />,
    },
};

const POSITION_STYLES: Record<BrandedToastPosition, string> = {
    'top-right': 'top-6 right-6',
    'bottom-right': 'bottom-8 right-8',
};

export const BrandedToast: React.FC<BrandedToastProps> = ({
    message,
    tone = 'success',
    title,
    onClose,
    className,
    position = 'bottom-right',
    durationMs,
}) => {
    const config = TOAST_TONE_STYLES[tone];

    return (
        <div className={cx('fixed z-[300] min-w-[320px] max-w-[420px]', POSITION_STYLES[position], className)}>
            <div className={cx('ozy-toast-surface px-4 py-4 flex items-start gap-4', config.accent)}>
                <div className="mt-0.5 shrink-0">
                    {config.icon}
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-black uppercase tracking-widest leading-tight">{title || config.title}</p>
                    <p className="mt-1 text-[11px] font-medium leading-relaxed text-white/90">{message}</p>
                </div>
                {onClose && (
                    <button onClick={onClose} className="mt-0.5 shrink-0 text-current/50 transition-opacity hover:text-current">
                        <X size={14} />
                    </button>
                )}
                {durationMs ? (
                    <div
                        className="absolute bottom-0 left-0 h-0.5 bg-current opacity-30 animate-shrink-width"
                        style={{ animationDuration: `${durationMs}ms`, animationFillMode: 'forwards' }}
                    />
                ) : null}
            </div>
        </div>
    );
};
