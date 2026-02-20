import React, { useState } from 'react';
import { X, Check, Plus, Trash2, Shield, Zap, Info, Link as LinkIcon, Settings, FileUp, FileText } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

const makeColumnId = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`;

const createColumn = (overrides = {}) => ({
    id: makeColumnId(),
    name: '',
    type: 'text',
    defaultValue: '',
    isPrimary: false,
    isSystem: false,
    unique: false,
    required: false,
    references: '',
    ...overrides
});

const getDefaultColumns = () => ([
    createColumn({ name: 'id', type: 'uuid', defaultValue: 'gen_random_uuid()', isPrimary: true, isSystem: true }),
    createColumn({ name: 'user_id', type: 'uuid' }),
    createColumn({ name: 'created_at', type: 'timestamptz', defaultValue: 'now()', isSystem: true })
]);

const CreateTableModal = ({ isOpen, onClose, onTableCreated, onMenuViewSelect, schema = 'public' }) => {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [isRLSEnabled, setIsRLSEnabled] = useState(true);
    const [rlsRule, setRlsRule] = useState('user_id = auth.uid()');
    const [isRealtimeEnabled, setIsRealtimeEnabled] = useState(false);

    // Default columns
    const [columns, setColumns] = useState(() => getDefaultColumns());

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [csvRecords, setCsvRecords] = useState([]);
    const [allTables, setAllTables] = useState([]); // For relations

    React.useEffect(() => {
        const fetchTables = async () => {
            try {
                const res = await fetchWithAuth('/api/collections');
                if (res.ok) {
                    const data = await res.json();
                    setAllTables(data);
                }
            } catch (e) { console.error(e); }
        };
        if (isOpen) fetchTables();
    }, [isOpen]);

    const handleCSVImport = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const text = event.target.result;
            const lines = text.split(/\r?\n/).filter(l => l.trim());
            if (lines.length < 1) return;

            // Robust split (handles quotes)
            const splitLine = (line) => {
                const result = [];
                let cur = '';
                let inQuote = false;
                for (let i = 0; i < line.length; i++) {
                    const char = line[i];
                    if (char === '"' && line[i + 1] === '"') { cur += '"'; i++; }
                    else if (char === '"') { inQuote = !inQuote; }
                    else if (char === ',' && !inQuote) { result.push(cur.trim()); cur = ''; }
                    else { cur += char; }
                }
                result.push(cur.trim());
                return result;
            };

            const headers = splitLine(lines[0]);
            const firstRow = lines.length > 1 ? splitLine(lines[1]) : [];
            const allRecords = [];

            for (let i = 1; i < lines.length; i++) {
                const values = splitLine(lines[i]);
                const record = {};
                headers.forEach((header, idx) => {
                    const val = values[idx];
                    if (val !== undefined) record[header.toLowerCase().replace(/[^a-z0-9_]/g, '_')] = val;
                });
                if (Object.keys(record).length > 0) allRecords.push(record);
            }
            setCsvRecords(allRecords);

            const newCols = headers.map((header, idx) => {
                const val = firstRow[idx] || '';
                let type = 'text';

                // Simple type inference
                if (!isNaN(val) && val !== '') {
                    type = val.includes('.') ? 'numeric' : 'int8';
                } else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)) {
                    type = 'uuid';
                } else if (val.toLowerCase() === 'true' || val.toLowerCase() === 'false') {
                    type = 'boolean';
                }

                return createColumn({
                    name: header.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                    type
                });
            });

            // Merge with system columns
            setColumns([
                createColumn({ name: 'id', type: 'uuid', defaultValue: 'gen_random_uuid()', isPrimary: true, isSystem: true }),
                ...newCols,
                createColumn({ name: 'created_at', type: 'timestamptz', defaultValue: 'now()', isSystem: true })
            ]);

            // Auto-suggest table name from file
            if (!name) {
                const fileName = file.name.split('.')[0].toLowerCase().replace(/[^a-z0-9_]/g, '_');
                setName(fileName);
            }
        };
        reader.readAsText(file);
    };

    if (!isOpen) return null;

    const handleAddColumn = () => {
        setColumns(prev => [...prev, createColumn()]);
    };

    const handleRemoveColumn = (index) => {
        setColumns(prev => prev.filter((_, i) => i !== index));
    };

    const handleColumnChange = (index, field, value) => {
        setColumns(prev => prev.map((col, i) => (i === index ? { ...col, [field]: value } : col)));
    };

    const handleSave = async () => {
        setLoading(true);
        setError(null);

        const customColumns = columns.filter(c => !c.isSystem).map(c => ({
            name: c.name,
            type: c.type,
            default: c.defaultValue || null,
            required: !!c.required,
            unique: !!c.unique,
            is_primary: !!c.isPrimary,
            references: c.references || null
        }));

        try {
            const res = await fetchWithAuth('/api/collections', {
                method: 'POST',
                body: JSON.stringify({
                    name,
                    schema: customColumns,
                    rls_enabled: isRLSEnabled,
                    rls_rule: isRLSEnabled ? rlsRule : '',
                    realtime_enabled: isRealtimeEnabled
                })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to create table');
            }

            onTableCreated();

            // Perform bulk import if records exist
            if (csvRecords.length > 0) {
                console.log(`[CSV] Importing ${csvRecords.length} records into ${name}`);
                await fetchWithAuth(`/api/tables/${name}/import`, {
                    method: 'POST',
                    body: JSON.stringify(csvRecords)
                });
            }

            onClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-end bg-black/50 backdrop-blur-sm"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="w-full max-w-2xl h-full bg-[#111111] border-l border-[#2e2e2e] shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-[#2e2e2e]">
                    <h2 className="text-sm font-medium text-zinc-100">
                        Create a new table under <span className="font-mono bg-zinc-800 px-1 py-0.5 rounded textxs text-zinc-300">{schema}</span>
                    </h2>
                    <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-8">

                    {/* Name */}
                    <div className="space-y-4">
                        <div className="space-y-1">
                            <label className="text-sm font-medium text-zinc-300">Name</label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="w-full bg-[#0c0c0c] border border-[#2e2e2e] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50 transition-colors"
                                placeholder="vlaber_table"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-medium text-zinc-300">Description</label>
                            <input
                                type="text"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                className="w-full bg-[#0c0c0c] border border-[#2e2e2e] rounded-md px-3 py-2 text-sm text-zinc-400 focus:outline-none focus:border-primary/50 transition-colors"
                                placeholder="Optional"
                            />
                        </div>
                    </div>

                    {/* RLS */}
                    <div className="bg-[#0c0c0c] border border-[#2e2e2e] rounded-md p-4 space-y-4">
                        <div className="flex items-start gap-3">
                            <input
                                type="checkbox"
                                checked={isRLSEnabled}
                                onChange={(e) => setIsRLSEnabled(e.target.checked)}
                                className="mt-1 accent-primary"
                            />
                            <div>
                                <h4 className="text-sm font-medium text-zinc-200">Enable Row Level Security (RLS) <span className="text-[10px] text-zinc-500 uppercase tracking-wider ml-2 border border-zinc-700 px-1 rounded">Recommended</span></h4>
                                <p className="text-xs text-zinc-500 mt-1">Restrict access to your table by enabling RLS and writing Postgres policies.</p>
                            </div>
                        </div>

                        {isRLSEnabled && (
                            <div className="bg-[#111111] border border-[#2e2e2e] rounded p-3 flex gap-3">
                                <Info size={16} className="text-zinc-400 shrink-0 mt-0.5" />
                                <div className="space-y-2">
                                    <p className="text-xs text-zinc-500">You need to create an access policy before you can query data from this table. Without a policy, querying this table will return an <span className="underline decoration-zinc-600">empty array</span> of results.</p>

                                    <div className="pt-2 space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-600">Preset Policy</label>
                                        <select
                                            value={rlsRule}
                                            onChange={(e) => setRlsRule(e.target.value)}
                                            className="w-full bg-[#0c0c0c] border border-[#2e2e2e] rounded px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-primary/50"
                                        >
                                            <option value="user_id = auth.uid()">Only owner can access (user_id = auth.uid())</option>
                                            <option value="public">Public read-only (Everyone)</option>
                                            <option value="">Custom (Experimental)</option>
                                        </select>
                                    </div>

                                    <button className="text-xs text-zinc-300 border border-zinc-700 rounded px-2 py-1 flex items-center gap-2 hover:bg-zinc-800 transition-colors">
                                        <FileText size={12} /> Documentation
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Realtime */}
                    <div className="flex items-start gap-3">
                        <input
                            type="checkbox"
                            checked={isRealtimeEnabled}
                            onChange={(e) => setIsRealtimeEnabled(e.target.checked)}
                            className="mt-1 accent-primary"
                        />
                        <div>
                            <h4 className="text-sm font-medium text-zinc-200">Enable Realtime</h4>
                            <p className="text-xs text-zinc-500 mt-1">Broadcast changes on this table to authorized subscribers</p>
                        </div>
                    </div>

                    {/* Columns */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-bold text-zinc-100">Columns</h3>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => {
                                        onMenuViewSelect('db_api');
                                        onClose();
                                    }}
                                    className="text-xs bg-[#171717] border border-[#2e2e2e] text-zinc-300 px-3 py-1.5 rounded hover:bg-zinc-800 transition-colors flex items-center gap-2"
                                >
                                    <Settings size={12} /> About data types
                                </button>
                                {csvRecords.length > 0 && (
                                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-900/20 border border-green-800/30 rounded text-[10px] font-black text-green-500 uppercase tracking-widest animate-in fade-in zoom-in duration-300">
                                        <Check size={12} /> {csvRecords.length} records staged
                                        <button
                                            onClick={() => { setCsvRecords([]); setColumns(getDefaultColumns()); }}
                                            className="ml-2 hover:text-white"
                                        >
                                            <Trash2 size={10} />
                                        </button>
                                    </div>
                                )}
                                <label className="text-xs bg-[#171717] border border-[#2e2e2e] text-zinc-300 px-3 py-1.5 rounded hover:bg-zinc-800 transition-colors cursor-pointer flex items-center gap-2">
                                    <FileUp size={12} />
                                    Import data from CSV
                                    <input
                                        type="file"
                                        accept=".csv"
                                        onChange={handleCSVImport}
                                        className="hidden"
                                    />
                                </label>
                            </div>
                        </div>

                        <div className="space-y-2">
                            {/* Header Row */}
                            <div className="grid grid-cols-12 gap-2 px-2 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                                <div className="col-span-1"></div>
                                <div className="col-span-3">Name</div>
                                <div className="col-span-2">Type</div>
                                <div className="col-span-2">Default Value</div>
                                <div className="col-span-1 text-center">PK</div>
                                <div className="col-span-1 text-center">UQ</div>
                                <div className="col-span-1 text-center">NN</div>
                                <div className="col-span-1 text-center">Rel</div>
                            </div>

                            {/* Column Rows */}
                            {columns.map((col, idx) => (
                                <div key={col.id} className="group grid grid-cols-12 gap-2 items-center bg-[#0c0c0c] border border-[#2e2e2e] rounded px-2 py-2 hover:border-zinc-700 transition-colors">
                                    <div className="col-span-1 flex justify-center cursor-move text-zinc-600 hover:text-zinc-400">
                                        <div className="space-y-0.5">
                                            <div className="w-3 h-0.5 bg-current rounded-full"></div>
                                            <div className="w-3 h-0.5 bg-current rounded-full"></div>
                                        </div>
                                    </div>
                                    <div className="col-span-3 relative">
                                        <input
                                            type="text"
                                            value={col.name}
                                            onChange={(e) => handleColumnChange(idx, 'name', e.target.value)}
                                            disabled={col.isSystem}
                                            className={`w-full bg-transparent text-xs text-white focus:outline-none ${col.isSystem ? 'opacity-50 cursor-not-allowed' : ''}`}
                                            placeholder="column_name"
                                        />
                                        {col.isSystem && <LinkIcon size={10} className="absolute right-0 top-1/2 -translate-y-1/2 text-zinc-600" />}
                                    </div>
                                    <div className="col-span-2">
                                        <select
                                            value={col.type}
                                            onChange={(e) => handleColumnChange(idx, 'type', e.target.value)}
                                            disabled={col.isSystem}
                                            className={`w-full bg-[#111111] border border-[#2e2e2e] rounded px-1 py-1 text-[10px] text-zinc-300 focus:outline-none ${col.isSystem ? 'opacity-50' : ''}`}
                                        >
                                            <option value="uuid">uuid</option>
                                            <option value="text">text</option>
                                            <option value="varchar">varchar</option>
                                            <option value="int8">int8</option>
                                            <option value="int4">int4</option>
                                            <option value="int2">int2</option>
                                            <option value="numeric">numeric</option>
                                            <option value="float8">float8</option>
                                            <option value="bool">bool</option>
                                            <option value="timestamptz">timestampz</option>
                                            <option value="date">date</option>
                                            <option value="jsonb">jsonb</option>
                                            <option value="text_array">text[]</option>
                                        </select>
                                    </div>
                                    <div className="col-span-2">
                                        <input
                                            type="text"
                                            value={col.defaultValue || ''}
                                            onChange={(e) => handleColumnChange(idx, 'defaultValue', e.target.value)}
                                            disabled={col.isSystem}
                                            className={`w-full bg-transparent text-xs text-zinc-400 focus:outline-none placeholder:text-zinc-700 ${col.isSystem ? 'opacity-50' : ''}`}
                                            placeholder="NULL"
                                        />
                                    </div>
                                    <div className="col-span-1 flex justify-center">
                                        <input 
                                            type="checkbox" 
                                            checked={col.isPrimary} 
                                            disabled={col.isSystem}
                                            onChange={(e) => handleColumnChange(idx, 'isPrimary', e.target.checked)}
                                            className="accent-primary"
                                        />
                                    </div>
                                    <div className="col-span-1 flex justify-center">
                                        <input 
                                            type="checkbox" 
                                            checked={col.unique} 
                                            disabled={col.isSystem}
                                            onChange={(e) => handleColumnChange(idx, 'unique', e.target.checked)}
                                            className="accent-primary"
                                        />
                                    </div>
                                    <div className="col-span-1 flex justify-center">
                                        <input 
                                            type="checkbox" 
                                            checked={col.required} 
                                            disabled={col.isSystem}
                                            onChange={(e) => handleColumnChange(idx, 'required', e.target.checked)}
                                            className="accent-primary"
                                        />
                                    </div>
                                    <div className="col-span-1 flex justify-center items-center gap-1 group/rel relative">
                                        {!col.isSystem && (
                                            <button 
                                                onClick={() => handleRemoveColumn(idx)} 
                                                className="text-zinc-600 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 mr-1"
                                                title="Remove Column"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        )}
                                        <LinkIcon 
                                            size={14} 
                                            className={`cursor-pointer hover:text-primary transition-colors ${col.references ? 'text-primary' : 'text-zinc-700'}`} 
                                            title={col.references ? `Ref: ${col.references}` : "Add Relation"}
                                            onClick={() => {
                                                if (col.isSystem) return;
                                                const suggestions = allTables.map(t => t.name).join(', ');
                                                const refs = prompt(`Enter reference (table.column). \nExisting tables: ${suggestions}`, col.references || "");
                                                if (refs !== null) handleColumnChange(idx, 'references', refs);
                                            }}
                                        />
                                        {col.references && (
                                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 bg-zinc-900 border border-zinc-800 text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover/rel:opacity-100 transition-opacity pointer-events-none whitespace-nowrap mb-1 z-10">
                                                {col.references}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}

                            <button
                                key="add-column-button"
                                type="button"
                                onClick={handleAddColumn}
                                className="w-full py-2 border border-dashed border-[#2e2e2e] rounded text-xs text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 transition-all flex items-center justify-center gap-2"
                            >
                                <Plus size={14} /> Add column
                            </button>
                        </div>
                    </div>

                    {error && (
                        <div className="bg-red-500/10 border border-red-500/20 text-red-500 p-3 rounded text-xs">
                            {error}
                        </div>
                    )}

                </div>

                {/* Footer */}
                <div className="p-6 border-t border-[#2e2e2e] flex justify-end gap-3 bg-[#0c0c0c]">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-xs font-medium text-zinc-400 hover:text-white transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={loading || !name}
                        className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-green-900/20"
                    >
                        {loading ? 'Saving...' : 'Save'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CreateTableModal;
