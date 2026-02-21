import React, { useEffect, useMemo, useState } from 'react';
import { X, FileText, ArrowRightLeft, AlertTriangle, CheckCircle2, Wand2 } from 'lucide-react';

const buildHeaderWarnings = (headers) => {
    const seen = new Map();
    const duplicates = [];
    const empties = [];
    headers.forEach((header) => {
        const key = header.raw.trim().toLowerCase();
        if (!key) {
            empties.push(header.label);
            return;
        }
        if (seen.has(key)) {
            duplicates.push(header.label);
        } else {
            seen.set(key, header.label);
        }
    });
    return { duplicates, empties };
};

const CSVImportModal = ({
    isOpen,
    onClose,
    fileName,
    headers,
    sampleRows,
    totalRows,
    columnOptions,
    initialMapping,
    onConfirm
}) => {
    const [mapping, setMapping] = useState({});
    const [error, setError] = useState('');

    useEffect(() => {
        if (isOpen) {
            setMapping(initialMapping || {});
            setError('');
        }
    }, [isOpen, initialMapping]);

    const { duplicates, empties } = useMemo(() => buildHeaderWarnings(headers || []), [headers]);

    const mappedCount = useMemo(() => Object.values(mapping || {}).filter(Boolean).length, [mapping]);

    if (!isOpen) return null;

    const handleConfirm = () => {
        const targets = Object.values(mapping || {}).filter(Boolean);
        if (targets.length === 0) {
            setError('Select at least one column mapping to continue.');
            return;
        }
        const uniqueTargets = new Set(targets);
        if (uniqueTargets.size !== targets.length) {
            setError('Each database column can only be mapped once.');
            return;
        }
        setError('');
        onConfirm(mapping);
    };

    const handleAutoMap = () => {
        setMapping(initialMapping || {});
    };

    const handleClear = () => {
        const cleared = {};
        headers.forEach((header) => {
            cleared[header.index] = '';
        });
        setMapping(cleared);
    };

    return (
        <div
            className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="bg-[#171717] border border-[#2e2e2e] rounded-2xl w-full max-w-5xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="px-6 py-4 border-b border-[#2e2e2e] flex items-center justify-between bg-[#1a1a1a]">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-primary/10 text-primary">
                            <FileText size={18} />
                        </div>
                        <div>
                            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-200">CSV Import Preview</h3>
                            <p className="text-[11px] text-zinc-500">{fileName || 'CSV file'}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-zinc-600 hover:text-zinc-200 transition-colors">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    <div className="flex flex-wrap gap-3 text-[10px] uppercase tracking-[0.2em] font-black">
                        <div className="px-3 py-1.5 rounded-full bg-[#111111] border border-[#2e2e2e] text-zinc-400">
                            {headers.length} headers detected
                        </div>
                        <div className="px-3 py-1.5 rounded-full bg-[#111111] border border-[#2e2e2e] text-zinc-400">
                            {totalRows} rows loaded
                        </div>
                        <div className={`px-3 py-1.5 rounded-full border ${mappedCount > 0 ? 'bg-primary/10 text-primary border-primary/20' : 'bg-[#111111] text-zinc-400 border-[#2e2e2e]'}`}>
                            {mappedCount} columns mapped
                        </div>
                    </div>

                    {(duplicates.length > 0 || empties.length > 0) && (
                        <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 flex gap-3">
                            <AlertTriangle size={16} className="text-red-400 shrink-0" />
                            <div className="space-y-1 text-[11px] text-red-400/80">
                                {duplicates.length > 0 && <p>Duplicate headers detected: {duplicates.join(', ')}</p>}
                                {empties.length > 0 && <p>Empty headers detected: {empties.join(', ')}</p>}
                            </div>
                        </div>
                    )}

                    <div className="flex items-center justify-between">
                        <h4 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-300">Map Columns</h4>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleAutoMap}
                                className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest bg-primary/10 text-primary border border-primary/20 rounded-lg flex items-center gap-2"
                            >
                                <Wand2 size={12} /> Auto-map
                            </button>
                            <button
                                onClick={handleClear}
                                className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest bg-[#111111] text-zinc-400 border border-[#2e2e2e] rounded-lg"
                            >
                                Clear
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className="space-y-3">
                            {headers.map((header) => (
                                <div key={header.index} className="flex items-center gap-3 bg-[#111111] border border-[#2e2e2e] rounded-xl p-3">
                                    <div className="flex-1">
                                        <div className="text-[11px] font-black uppercase tracking-widest text-zinc-300">{header.label}</div>
                                        <div className="text-[10px] text-zinc-500 truncate">
                                            {header.sampleValues.length > 0 ? header.sampleValues.join(' · ') : 'No data in sample'}
                                        </div>
                                    </div>
                                    <ArrowRightLeft size={14} className="text-zinc-600" />
                                    <select
                                        value={mapping[header.index] || ''}
                                        onChange={(e) => setMapping((prev) => ({ ...prev, [header.index]: e.target.value }))}
                                        className="bg-black border border-[#2e2e2e] text-[11px] text-zinc-300 rounded-lg px-3 py-2 min-w-[180px]"
                                    >
                                        <option value="">Skip column</option>
                                        {columnOptions.map((col) => (
                                            <option key={col} value={col}>{col}</option>
                                        ))}
                                    </select>
                                </div>
                            ))}
                        </div>

                        <div className="bg-[#111111] border border-[#2e2e2e] rounded-2xl p-4">
                            <div className="flex items-center justify-between mb-3">
                                <h4 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-300">Data Preview</h4>
                                <span className="text-[10px] text-zinc-500 uppercase tracking-widest">First {sampleRows.length} rows</span>
                            </div>
                            <div className="overflow-x-auto custom-scrollbar">
                                <table className="w-full text-[11px] text-zinc-300">
                                    <thead>
                                        <tr className="text-[10px] uppercase tracking-widest text-zinc-500">
                                            {headers.map((header) => (
                                                <th key={header.index} className="text-left pb-2 pr-4 font-bold">
                                                    {header.label}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="text-zinc-400">
                                        {sampleRows.map((row, rowIdx) => (
                                            <tr key={rowIdx} className="border-t border-[#1f1f1f]">
                                                {headers.map((header) => (
                                                    <td key={header.index} className="py-2 pr-4">
                                                        {row[header.index] ?? ''}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="mt-4 flex items-center gap-2 text-[10px] text-zinc-500">
                                <CheckCircle2 size={12} className="text-primary" />
                                Values will be inserted into mapped columns only. Unmapped columns are ignored.
                            </div>
                        </div>
                    </div>

                    {error && (
                        <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3 text-[11px] text-red-400">
                            {error}
                        </div>
                    )}
                </div>

                <div className="px-6 py-4 bg-[#111111] border-t border-[#2e2e2e] flex items-center justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-zinc-200 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleConfirm}
                        className="px-6 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all shadow-lg active:scale-95 bg-primary text-black hover:bg-[#E6E600] shadow-primary/10"
                    >
                        Import Data
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CSVImportModal;
