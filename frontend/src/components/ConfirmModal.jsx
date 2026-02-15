import React from 'react';
import { AlertCircle, X, ShieldAlert } from 'lucide-react';

const ConfirmModal = ({ isOpen, onClose, onConfirm, title, message, confirmText = "Confirm", type = "danger" }) => {
    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#000000]/80 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="bg-[#171717] border border-[#2e2e2e] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="px-6 py-4 border-b border-[#2e2e2e] flex items-center justify-between bg-[#1a1a1a]">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${type === 'danger' ? 'bg-red-500/10 text-red-500' : 'bg-primary/10 text-primary'}`}>
                            {type === 'danger' ? <ShieldAlert size={18} /> : <AlertCircle size={18} />}
                        </div>
                        <h3 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-200">{title}</h3>
                    </div>
                    <button onClick={onClose} className="text-zinc-600 hover:text-zinc-200 transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-8 space-y-4">
                    <p className="text-sm text-zinc-400 leading-relaxed font-medium">
                        {message}
                    </p>
                    {type === 'danger' && (
                        <div className="bg-red-500/5 border border-red-500/10 rounded-xl p-4 flex gap-3">
                            <AlertCircle size={16} className="text-red-500 shrink-0" />
                            <p className="text-[10px] text-red-500/70 font-bold uppercase tracking-wider leading-normal">
                                Warning: This operation is permanent and cannot be reversed by the core engine.
                            </p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-[#111111] border-t border-[#2e2e2e] flex items-center justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-zinc-200 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => {
                            onConfirm();
                            onClose();
                        }}
                        className={`px-6 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all shadow-lg active:scale-95 ${type === 'danger'
                            ? 'bg-red-600 text-white hover:bg-red-500 shadow-red-600/10'
                            : 'bg-primary text-black hover:bg-[#E6E600] shadow-primary/10'
                            }`}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmModal;
