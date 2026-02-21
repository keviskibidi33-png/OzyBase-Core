import React, { useState } from 'react';
import {
    X,
    Plus,
    Loader2,
    Database,
    Hash,
    AtSign,
    Calendar,
    CheckCircle2,
    Key,
    Code,
    Globe,
    DollarSign,
    Layers,
    Clock,
    Cpu
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

const MODAL_ENTER_MS = 200;
const MODAL_EXIT_MS = 160;

const AddColumnModal = ({ isOpen, onClose, tableName, onColumnAdded }) => {
    const [name, setName] = useState('');
    const [type, setType] = useState('text');
    const [required, setRequired] = useState(false);
    const [defaultValue, setDefaultValue] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [shouldRender, setShouldRender] = React.useState(isOpen);
    const [isVisible, setIsVisible] = React.useState(false);
    const closeTimerRef = React.useRef(null);
    const closingRef = React.useRef(false);

    React.useEffect(() => {
        if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }

        if (isOpen) {
            closingRef.current = false;
            setShouldRender(true);
            requestAnimationFrame(() => setIsVisible(true));
            return undefined;
        }

        if (!shouldRender) return undefined;

        closingRef.current = true;
        setIsVisible(false);
        closeTimerRef.current = setTimeout(() => {
            setShouldRender(false);
            closingRef.current = false;
        }, MODAL_EXIT_MS);

        return () => {
            if (closeTimerRef.current) {
                clearTimeout(closeTimerRef.current);
                closeTimerRef.current = null;
            }
        };
    }, [isOpen, shouldRender]);

    React.useEffect(() => () => {
        if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
        }
    }, []);

    const requestClose = React.useCallback(() => {
        if (closingRef.current) return;
        closingRef.current = true;
        setIsVisible(false);
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
        closeTimerRef.current = setTimeout(() => {
            setShouldRender(false);
            closingRef.current = false;
            onClose();
        }, MODAL_EXIT_MS);
    }, [onClose]);

    if (!shouldRender) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError(null);

        try {
            const res = await fetchWithAuth(`/api/tables/${tableName}/columns`, {
                method: 'POST',
                body: JSON.stringify({
                    name,
                    type,
                    required,
                    default: defaultValue || null
                }),
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || 'Failed to add column');
            }

            onColumnAdded();
            requestClose();
            setName('');
            setType('text');
            setRequired(false);
            setDefaultValue('');
        } catch (err) {
            setError(err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const types = [
        { label: 'text', value: 'text', icon: AtSign, desc: 'Variable-length character string' },
        { label: 'varchar', value: 'varchar', icon: AtSign, desc: 'Variable-length character string' },
        { label: 'uuid', value: 'uuid', icon: Key, desc: 'Universally unique identifier' },
        { label: 'int2', value: 'int2', icon: Hash, desc: 'Signed two-byte integer' },
        { label: 'int4', value: 'int4', icon: Hash, desc: 'Signed four-byte integer' },
        { label: 'int8', value: 'int8', icon: Hash, desc: 'Signed eight-byte integer' },
        { label: 'float4', value: 'float4', icon: Hash, desc: 'Single precision floating-point number' },
        { label: 'float8', value: 'float8', icon: Hash, desc: 'Double precision floating-point number' },
        { label: 'numeric', value: 'numeric', icon: Hash, desc: 'Exact numeric of selectable precision' },
        { label: 'json', value: 'json', icon: Code, desc: 'Textual JSON data' },
        { label: 'jsonb', value: 'jsonb', icon: Code, desc: 'Binary JSON data, decomposed' },
        { label: 'date', value: 'date', icon: Calendar, desc: 'Calendar date (year, month, day)' },
        { label: 'time', value: 'time', icon: Calendar, desc: 'Time of day (no time zone)' },
        { label: 'timetz', value: 'timetz', icon: Calendar, desc: 'Time of day, including time zone' },
        { label: 'timestamp', value: 'timestamp', icon: Calendar, desc: 'Date and time (no time zone)' },
        { label: 'timestamptz', value: 'timestamptz', icon: Calendar, desc: 'Date and time, including time zone' },
        { label: 'bool', value: 'bool', icon: CheckCircle2, desc: 'Logical boolean (true/false)' },
        { label: 'bytea', value: 'bytea', icon: Database, desc: 'Variable-length binary string' },
        { label: 'inet', value: 'inet', icon: Globe, desc: 'IPv4 or IPv6 host address' },
        { label: 'cidr', value: 'cidr', icon: Globe, desc: 'IPv4 or IPv6 network address' },
        { label: 'macaddr', value: 'macaddr', icon: Cpu, desc: 'MAC address' },
        { label: 'interval', value: 'interval', icon: Clock, desc: 'Time span / Duration' },
        { label: 'money', value: 'money', icon: DollarSign, desc: 'Currency / Monetary amount' },
        { label: 'text_array', value: 'text_array', icon: Layers, desc: 'Array of strings' },
        { label: 'int_array', value: 'int_array', icon: Layers, desc: 'Array of integers' },
    ];

    return (
        <div
            className={`fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-opacity ${isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
            style={{ transitionDuration: `${isVisible ? MODAL_ENTER_MS : MODAL_EXIT_MS}ms` }}
            onClick={(e) => e.target === e.currentTarget && requestClose()}
        >
            <div
                className={`w-full max-w-2xl bg-[#171717] border border-[#2e2e2e] rounded-xl shadow-2xl overflow-hidden origin-top transition-all transform-gpu ${isVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-1.5 scale-95'}`}
                style={{ transitionDuration: `${isVisible ? MODAL_ENTER_MS : MODAL_EXIT_MS}ms` }}
            >
                <div className="flex items-center justify-between px-6 py-4 border-b border-[#2e2e2e]">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Plus className="text-primary" size={18} />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Add New Column</h3>
                            <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Table: {tableName}</p>
                        </div>
                    </div>
                    <button onClick={requestClose} className="text-zinc-500 hover:text-zinc-200 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    {error && (
                        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-md text-red-500 text-[10px] font-bold uppercase tracking-wide">
                            {error}
                        </div>
                    )}

                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Column Name</label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    required
                                    placeholder="e.g. description"
                                    className="w-full bg-[#111111] border border-[#2e2e2e] rounded-lg px-4 py-2 text-sm text-zinc-200 focus:outline-none focus:border-primary/50 placeholder:text-zinc-800"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Default Value (Optional)</label>
                                <input
                                    type="text"
                                    value={defaultValue}
                                    onChange={(e) => setDefaultValue(e.target.value)}
                                    placeholder="NULL"
                                    className="w-full bg-[#111111] border border-[#2e2e2e] rounded-lg px-4 py-2 text-sm text-zinc-200 focus:outline-none focus:border-primary/50 placeholder:text-zinc-800"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Data Type</label>
                            <div className="grid grid-cols-2 gap-1.5 max-h-64 overflow-y-auto custom-scrollbar pr-1 bg-[#111111] border border-[#2e2e2e] rounded-lg p-2">
                                {types.map((t) => (
                                    <button
                                        key={t.value}
                                        type="button"
                                        onClick={() => setType(t.value)}
                                        className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-all text-left group border ${type === t.value ? 'bg-primary/5 border-primary/50 text-primary' : 'bg-transparent border-transparent text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300'}`}
                                    >
                                        <t.icon size={14} className={type === t.value ? 'text-primary' : 'text-zinc-700'} />
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-[10px] font-bold leading-tight uppercase tracking-wider truncate">{t.label}</span>
                                            <span className="text-[8px] text-zinc-600 leading-tight truncate font-medium uppercase">{t.desc}</span>
                                        </div>
                                        {type === t.value && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(254,254,0,0.6)] shrink-0" />}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex items-center justify-between p-4 bg-[#111111] rounded-lg border border-[#2e2e2e]">
                            <div className="flex flex-col">
                                <span className="text-xs font-bold text-zinc-300">Required</span>
                                <span className="text-[9px] text-zinc-600 font-bold uppercase tracking-tighter">Cannot be null</span>
                            </div>
                            <button
                                type="button"
                                onClick={() => setRequired(!required)}
                                className={`w-10 h-5 rounded-full relative transition-colors ${required ? 'bg-primary' : 'bg-zinc-800'}`}
                            >
                                <div className={`absolute top-1 bottom-1 w-3 h-3 bg-white rounded-full transition-all ${required ? 'left-6 bg-black' : 'left-1'}`} />
                            </button>
                        </div>
                    </div>

                    <div className="pt-4 flex items-center justify-end gap-3">
                        <button
                            type="button"
                            onClick={requestClose}
                            className="px-4 py-2 text-xs font-bold text-zinc-500 hover:text-zinc-300 uppercase tracking-widest transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="flex items-center gap-2 bg-primary text-black px-6 py-2.5 rounded-lg font-black text-xs uppercase tracking-[0.15em] hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 shadow-[0_4px_20px_rgba(254,254,0,0.15)]"
                        >
                            {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} strokeWidth={3} />}
                            Add Column
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AddColumnModal;
