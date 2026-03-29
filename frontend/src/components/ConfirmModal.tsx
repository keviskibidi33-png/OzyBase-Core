import React from 'react';
import { AlertCircle, Loader2, ShieldAlert, X } from 'lucide-react';

type ConfirmModalType = 'danger' | 'info' | 'success';

interface ConfirmModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void | Promise<void>;
    title?: string;
    message?: string;
    confirmText?: string;
    cancelText?: string;
    type?: ConfirmModalType;
    confirmDisabled?: boolean;
    closeOnConfirm?: boolean;
}

const ConfirmModal = ({
    isOpen,
    onClose,
    onConfirm,
    title = '',
    message = '',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    type = 'danger',
    confirmDisabled = false,
    closeOnConfirm = true,
}: ConfirmModalProps) => {
    const [submitting, setSubmitting] = React.useState(false);

    if (!isOpen) return null;

    const handleConfirm = async () => {
        if (submitting || confirmDisabled) {
            return;
        }

        setSubmitting(true);
        try {
            await onConfirm();
            if (closeOnConfirm) {
                onClose();
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            onClick={(e: React.MouseEvent<HTMLDivElement>) => e.target === e.currentTarget && onClose()}
        >
            <div className="absolute inset-0 ozy-overlay-backdrop backdrop-blur-md" />
            <div className="ozy-dialog-panel w-full max-w-md shadow-2xl">
                {/* Header */}
                <div className="relative px-6 py-4 border-b border-[#2e2e2e] flex items-center justify-between bg-[#1a1a1a]/80">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-xl border ${type === 'danger' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-primary/10 text-primary border-primary/20'}`}>
                            {type === 'danger' ? <ShieldAlert size={18} /> : <AlertCircle size={18} />}
                        </div>
                        <h3 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-200">{title}</h3>
                    </div>
                    <button onClick={onClose} className="text-zinc-600 hover:text-zinc-200 transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <div className="relative p-8 space-y-4">
                    <p className="text-sm text-zinc-400 leading-relaxed font-medium">
                        {message}
                    </p>
                    {type === 'danger' && (
                        <div className="bg-red-500/6 border border-red-500/15 rounded-2xl p-4 flex gap-3">
                            <AlertCircle size={16} className="text-red-400 shrink-0" />
                            <p className="text-[10px] text-red-300/80 font-bold uppercase tracking-wider leading-normal">
                                Warning: This operation is permanent and cannot be reversed by the core engine.
                            </p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="relative px-6 py-4 bg-[#111111]/85 border-t border-[#2e2e2e] flex items-center justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-zinc-200 transition-colors"
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={() => void handleConfirm()}
                        disabled={submitting || confirmDisabled}
                        className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed ${type === 'danger'
                            ? 'bg-red-600 text-white hover:bg-red-500 shadow-red-600/10'
                            : 'bg-primary text-black hover:bg-[#E6E600] shadow-primary/10'
                            }`}
                    >
                        <span className="inline-flex items-center gap-2">
                            {submitting ? <Loader2 size={12} className="animate-spin" /> : null}
                            {confirmText}
                        </span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmModal;
