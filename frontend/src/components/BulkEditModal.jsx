import React, { useState } from 'react';
import { X, Save } from 'lucide-react';

const BulkEditModal = ({ isOpen, onClose, schema = [], onSubmit }) => {
    const [column, setColumn] = useState('');
    const [value, setValue] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    if (!isOpen) return null;

    const editableColumns = schema.filter(col => col.name !== 'id' && col.name !== 'created_at');

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!column) return;
        setIsSubmitting(true);
        try {
            await onSubmit({ [column]: value });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-lg bg-[#171717] border border-[#2e2e2e] rounded-xl shadow-2xl overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-[#2e2e2e]">
                    <div>
                        <h3 className="text-sm font-bold text-white uppercase tracking-wider">Bulk Edit</h3>
                        <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Apply to selected rows</p>
                    </div>
                    <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div className="space-y-2">
                        <label className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Column</label>
                        <select
                            value={column}
                            onChange={(e) => setColumn(e.target.value)}
                            className="w-full bg-[#111111] border border-[#2e2e2e] rounded-lg px-4 py-2 text-sm text-zinc-200 focus:outline-none focus:border-primary/50"
                        >
                            <option value="">Select column</option>
                            {editableColumns.map(col => (
                                <option key={col.name} value={col.name}>{col.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-2">
                        <label className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Value</label>
                        <input
                            type="text"
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            placeholder="New value"
                            className="w-full bg-[#111111] border border-[#2e2e2e] rounded-lg px-4 py-2 text-sm text-zinc-200 focus:outline-none focus:border-primary/50"
                        />
                    </div>

                    <div className="pt-2 flex items-center justify-end gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-xs font-bold text-zinc-500 hover:text-zinc-300 uppercase tracking-widest transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting || !column}
                            className="flex items-center gap-2 bg-primary text-black px-6 py-2.5 rounded-lg font-black text-xs uppercase tracking-[0.15em] hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
                        >
                            <Save size={14} strokeWidth={3} />
                            Apply
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default BulkEditModal;
