import React, { useState } from 'react';
import {
    X,
    AtSign,
    Hash,
    Calendar,
    CheckCircle2,
    Database,
    Key,
    Loader2,
    Check,
    Plus,
    Edit2
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

const MODAL_ENTER_MS = 200;
const MODAL_EXIT_MS = 160;

const AddRowModal = ({ isOpen, onClose, schema, tableName, onRecordAdded, initialData }) => {
    const [shouldRender, setShouldRender] = React.useState(isOpen);
    const [isVisible, setIsVisible] = React.useState(false);
    const closeTimerRef = React.useRef(null);
    const closingRef = React.useRef(false);
    const [formData, setFormData] = useState({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState(null);

    React.useEffect(() => {
        if (initialData) {
            setFormData(initialData);
        } else {
            setFormData({});
        }
    }, [initialData, isOpen]);

    React.useEffect(() => {
        if (isOpen) {
            closingRef.current = false;
            setShouldRender(true);
            const frame = requestAnimationFrame(() => setIsVisible(true));
            return () => cancelAnimationFrame(frame);
        }

        if (!shouldRender) return undefined;
        setIsVisible(false);
        const timer = setTimeout(() => {
            setShouldRender(false);
        }, MODAL_EXIT_MS);
        return () => clearTimeout(timer);
    }, [isOpen, shouldRender]);

    React.useEffect(() => () => {
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    }, []);

    const requestClose = React.useCallback(() => {
        if (closingRef.current) return;
        closingRef.current = true;
        setIsVisible(false);
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
        closeTimerRef.current = setTimeout(() => {
            closingRef.current = false;
            onClose?.();
        }, MODAL_EXIT_MS);
    }, [onClose]);

    if (!shouldRender) return null;

    const handleInputChange = (field, value) => {
        setFormData(prev => ({
            ...prev,
            [field]: value
        }));
    };

    const getTypeIcon = (type) => {
        const t = (type || '').toLowerCase();
        if (t.includes('uuid')) return <Key size={16} className="text-zinc-500" />;
        if (t.includes('text') || t.includes('char')) return <AtSign size={16} className="text-zinc-500" />;
        if (t.includes('time') || t.includes('date')) return <Calendar size={16} className="text-zinc-500" />;
        if (t.includes('bool')) return <CheckCircle2 size={16} className="text-zinc-500" />;
        if (t.includes('num') || t.includes('int') || t.includes('float')) return <Hash size={16} className="text-zinc-500" />;
        return <Database size={16} className="text-zinc-500" />;
    };

    const renderInput = (column) => {
        const { name, type, required } = column;
        const val = formData[name] ?? '';

        if (type === 'boolean' || type === 'bool') {
            return (
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={() => handleInputChange(name, !val)}
                        className={`w-10 h-5 rounded-full relative transition-colors ${val ? 'bg-primary' : 'bg-zinc-800'}`}
                    >
                        <div className={`absolute top-1 bottom-1 w-3 h-3 bg-white rounded-full transition-all ${val ? 'left-6 bg-black' : 'left-1'}`} />
                    </button>
                    <span className="text-sm text-zinc-400">{val ? 'True' : 'False'}</span>
                </div>
            );
        }

        if (type === 'datetime') {
            return (
                <input
                    type="datetime-local"
                    required={required}
                    value={val ? new Date(val).toISOString().slice(0, 16) : ''}
                    className="w-full bg-[#111111] border border-[#2e2e2e] rounded-md px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-primary/50"
                    onChange={(e) => handleInputChange(name, e.target.value)}
                />
            );
        }

        if (type === 'number') {
            return (
                <input
                    type="number"
                    value={val}
                    required={required}
                    className="w-full bg-[#111111] border border-[#2e2e2e] rounded-md px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-primary/50"
                    onChange={(e) => handleInputChange(name, e.target.value)}
                    placeholder="Enter number..."
                />
            );
        }

        return (
            <input
                type="text"
                value={val}
                required={required}
                className="w-full bg-[#111111] border border-[#2e2e2e] rounded-md px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-primary/50 placeholder:text-zinc-700"
                onChange={(e) => handleInputChange(name, e.target.value)}
                placeholder={`Enter ${name}...`}
            />
        );
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError(null);

        try {
            const isEdit = !!initialData;
            const url = isEdit
                ? `/api/tables/${tableName}/rows/${initialData.id}`
                : `/api/tables/${tableName}/rows`;

            const res = await fetchWithAuth(url, {
                method: isEdit ? 'PATCH' : 'POST',
                body: JSON.stringify(formData),
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || 'Failed to process row');
            }

            onRecordAdded();
            requestClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div
            className={`fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-opacity ${isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
            style={{ transitionDuration: `${isVisible ? MODAL_ENTER_MS : MODAL_EXIT_MS}ms` }}
            onClick={(e) => e.target === e.currentTarget && requestClose()}
        >
            <div
                className={`w-full max-w-5xl bg-[#171717] border border-[#2e2e2e] rounded-xl shadow-2xl overflow-hidden origin-top transition-all transform-gpu ${isVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-1.5 scale-95'}`}
                style={{ transitionDuration: `${isVisible ? MODAL_ENTER_MS : MODAL_EXIT_MS}ms` }}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-[#2e2e2e]">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                            {initialData ? <Edit2 className="text-primary" size={18} /> : <Plus className="text-primary" size={18} />}
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-white uppercase tracking-wider">{initialData ? 'Update Row' : 'Insert New Row'}</h3>
                            <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Table: {tableName}</p>
                        </div>
                    </div>
                    <button onClick={requestClose} className="text-zinc-500 hover:text-zinc-200 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit}>
                    <div className="px-6 py-8 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
                        {error && (
                            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-md text-red-500 text-xs font-medium uppercase tracking-wide">
                                Error: {error}
                            </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-6">
                            {schema.map((col) => (
                                <div key={col.name} className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <label className="flex items-center gap-2 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                                            {getTypeIcon(col.type)}
                                            {col.name}
                                            {col.required && <span className="text-primary">*</span>}
                                        </label>
                                        <span className="text-[8px] font-bold text-zinc-700 uppercase tracking-tighter bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
                                            {col.type}
                                        </span>
                                    </div>
                                    {renderInput(col)}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="px-6 py-4 bg-[#111111] border-t border-[#2e2e2e] flex items-center justify-end gap-3">
                        <button
                            type="button"
                            onClick={requestClose}
                            className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 font-medium transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="flex items-center gap-2 bg-primary text-black px-6 py-2 rounded-md font-bold text-sm hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:scale-100 shadow-[0_0_20px_rgba(254,254,0,0.15)]"
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" />
                                    {initialData ? 'Updating...' : 'Inserting...'}
                                </>
                            ) : (
                                <>
                                    {initialData ? <Check size={16} strokeWidth={3} /> : <Plus size={16} strokeWidth={3} />}
                                    {initialData ? 'Update Row' : 'Insert Row'}
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AddRowModal;
