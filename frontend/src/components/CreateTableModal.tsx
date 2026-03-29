import React, { useMemo, useState } from 'react';
import { X, Check, Plus, Trash2, Shield, Zap, Info, Link as LinkIcon, Settings, FileUp, FileText } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

const MODAL_ENTER_MS = 200;
const MODAL_EXIT_MS = 160;

type RlsAction = 'select' | 'insert' | 'update' | 'delete';

interface RlsPolicies {
    select: string;
    insert: string;
    update: string;
    delete: string;
}

interface ColumnDraft {
    id: string;
    name: string;
    type: string;
    defaultValue: string;
    isPrimary: boolean;
    isSystem: boolean;
    unique: boolean;
    required: boolean;
    references: string;
}

interface CreateTableModalProps {
    isOpen: boolean;
    onClose: () => void;
    onTableCreated: () => void;
    onMenuViewSelect: (view: string) => void;
    schema?: string;
}

interface CollectionSummary {
    name: string;
}

type CsvRecord = Record<string, string>;
type CollectionListResponse = CollectionSummary[];
type JsonRecord = Record<string, unknown>;

const RLS_ACTIONS: RlsAction[] = ['select', 'insert', 'update', 'delete'];

const makeColumnId = (): string => `${Date.now()}_${Math.random().toString(16).slice(2)}`;

const createColumn = (overrides: Partial<ColumnDraft> = {}): ColumnDraft => ({
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

const getDefaultColumns = (): ColumnDraft[] => ([
    createColumn({ name: 'id', type: 'uuid', defaultValue: 'gen_random_uuid()', isPrimary: true, isSystem: true }),
    createColumn({ name: 'user_id', type: 'uuid' }),
    createColumn({ name: 'created_at', type: 'timestamptz', defaultValue: 'now()', isSystem: true })
]);

const RLS_PRESETS: Record<string, RlsPolicies> = {
    owner_only: {
        select: 'user_id = auth.uid()',
        insert: 'user_id = auth.uid()',
        update: 'user_id = auth.uid()',
        delete: 'user_id = auth.uid()'
    },
    public_read_only: {
        select: 'true',
        insert: 'false',
        update: 'false',
        delete: 'false'
    },
    deny_all: {
        select: 'false',
        insert: 'false',
        update: 'false',
        delete: 'false'
    }
};

const getErrorMessage = (error: unknown, fallback: string): string => {
    if (error instanceof Error) return error.message;
    return fallback;
};

const normalizeIdentifier = (value: unknown): string => {
    const cleaned = String(value || '')
        .replace(/^\ufeff/, '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');

    if (!cleaned) return '';
    if (/^[0-9]/.test(cleaned)) return `t_${cleaned}`;
    return cleaned.slice(0, 63);
};

const buildUniqueIdentifiers = (values: Array<string | undefined>, fallbackPrefix: string): string[] => {
    const used = new Map<string, number>();
    return values.map((value: any, index: any) => {
        const baseRaw = normalizeIdentifier(value);
        const base = baseRaw || `${fallbackPrefix}_${index + 1}`;
        const count = used.get(base) || 0;
        used.set(base, count + 1);
        const next = count === 0 ? base : `${base}_${count + 1}`;
        return next.slice(0, 63);
    });
};

const CreateTableModal: React.FC<CreateTableModalProps> = ({ isOpen, onClose, onTableCreated, onMenuViewSelect, schema = 'public' }: any) => {
    const [shouldRender, setShouldRender] = React.useState(isOpen);
    const [isVisible, setIsVisible] = React.useState(false);
    const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const closingRef = React.useRef(false);

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [isRLSEnabled, setIsRLSEnabled] = useState(true);
    const [rlsPreset, setRlsPreset] = useState('owner_only');
    const [rlsPolicies, setRlsPolicies] = useState(() => ({ ...RLS_PRESETS.owner_only }));
    const [isRealtimeEnabled, setIsRealtimeEnabled] = useState(false);

    // Default columns
    const [columns, setColumns] = useState(() => getDefaultColumns());

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [csvRecords, setCsvRecords] = useState<CsvRecord[]>([]);
    const [allTables, setAllTables] = useState<CollectionSummary[]>([]); // For relations
    const [relationEditorIndex, setRelationEditorIndex] = useState<number | null>(null);
    const [relationDraft, setRelationDraft] = useState('');
    const normalizedTableName = useMemo(() => normalizeIdentifier(name), [name]);
    const usesUserIDInPolicies = useMemo(
        () => Object.values(rlsPolicies).some((rule: any) => String(rule || '').includes('user_id')),
        [rlsPolicies]
    );

    const handleRlsPresetChange = (presetKey: string) => {
        setRlsPreset(presetKey);
        if (presetKey !== 'custom' && RLS_PRESETS[presetKey]) {
            setRlsPolicies({ ...RLS_PRESETS[presetKey] });
        }
    };

    const handleRlsPolicyChange = (action: RlsAction, value: string) => {
        setRlsPreset('custom');
        setRlsPolicies((prev: any) => ({ ...prev, [action]: value }));
    };

    React.useEffect(() => {
        const fetchTables = async () => {
            try {
                const res = await fetchWithAuth('/api/collections');
                if (res.ok) {
                    const data: unknown = await res.json();
                    if (Array.isArray(data)) {
                        setAllTables(data.filter((item: any): item is CollectionSummary => (
                            typeof item === 'object' &&
                            item !== null &&
                            typeof (item as CollectionSummary).name === 'string'
                        )));
                    }
                }
            } catch (e: unknown) {
                console.error(e);
            }
        };
        if (isOpen) fetchTables();
    }, [isOpen]);

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

    const detectDelimiter = (sampleLines: string[]): string => {
        const candidates = [',', ';', '\t', '|'];
        const scores = new Map<string, number>(candidates.map((delim: any) => [delim, 0]));

        sampleLines.forEach((line: any) => {
            let inQuote = false;
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                if (char === '"' && line[i + 1] === '"') {
                    i++;
                    continue;
                }
                if (char === '"') {
                    inQuote = !inQuote;
                    continue;
                }
                if (!inQuote && scores.has(char)) {
                    scores.set(char, (scores.get(char) ?? 0) + 1);
                }
            }
        });

        let best = ',';
        for (const delim of candidates) {
            if ((scores.get(delim) ?? 0) > (scores.get(best) ?? 0)) best = delim;
        }
        return (scores.get(best) ?? 0) > 0 ? best : ',';
    };

    const splitCSVLine = (line: string, delimiter: string): string[] => {
        const result: string[] = [];
        let cur = '';
        let inQuote = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"' && line[i + 1] === '"') {
                cur += '"';
                i++;
            } else if (char === '"') {
                inQuote = !inQuote;
            } else if (char === delimiter && !inQuote) {
                result.push(cur.trim());
                cur = '';
            } else {
                cur += char;
            }
        }
        result.push(cur.trim());
        return result;
    };

    const sanitizeColumnName = (value: unknown, index: number): string => {
        const cleaned = String(value || '')
            .replace(/^\ufeff/, '')
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_+|_+$/g, '');
        return cleaned || `column_${index + 1}`;
    };

    const uniqueColumnNames = (headers: string[]): string[] => {
        const seen = new Map<string, number>();
        return headers.map((header: any, index: any) => {
            const base = sanitizeColumnName(header, index);
            const count = seen.get(base) || 0;
            seen.set(base, count + 1);
            return count === 0 ? base : `${base}_${count + 1}`;
        });
    };

    const inferTypeFromSamples = (samples: Array<string | undefined | null>): string => {
        const values = samples.filter((v: any): v is string => v !== undefined && v !== null && String(v).trim() !== '');
        if (values.length === 0) return 'text';

        if (values.every((v: any) => /^-?\d+$/.test(v.trim()))) return 'int8';
        if (values.every((v: any) => /^-?\d+(\.\d+)?$/.test(v.trim()))) return 'numeric';
        if (values.every((v: any) => /^(true|false)$/i.test(v.trim()))) return 'boolean';
        if (values.every((v: any) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim()))) return 'uuid';
        if (values.every((v: any) => /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(v.trim()))) return 'timestamptz';
        return 'text';
    };

    const handleCSVImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event: ProgressEvent<FileReader>) => {
            const text = event.target?.result;
            if (typeof text !== 'string') return;
            const lines = text.split(/\r?\n/).filter((l: any) => l.trim());
            if (lines.length < 1) return;

            const delimiter = detectDelimiter(lines.slice(0, 5));
            const headers = splitCSVLine(lines[0], delimiter);
            const normalizedHeaders = uniqueColumnNames(headers);
            const allRecords: CsvRecord[] = [];
            const columnSamples: string[][] = normalizedHeaders.map(() => []);

            for (let i = 1; i < lines.length; i++) {
                const values = splitCSVLine(lines[i], delimiter);
                const record: CsvRecord = {};
                normalizedHeaders.forEach((header: any, idx: any) => {
                    const val = values[idx];
                    if (val !== undefined) {
                        record[header] = val;
                        if (columnSamples[idx].length < 20 && String(val).trim() !== '') {
                            columnSamples[idx].push(val);
                        }
                    }
                });
                if (Object.keys(record).length > 0) allRecords.push(record);
            }
            setCsvRecords(allRecords);

            const newCols = normalizedHeaders.map((header: any, idx: any) => {
                return createColumn({
                    name: header,
                    type: inferTypeFromSamples(columnSamples[idx])
                });
            });

            // Merge with system columns
            setColumns([
                createColumn({ name: 'id', type: 'uuid', defaultValue: 'gen_random_uuid()', isPrimary: true, isSystem: true }),
                createColumn({ name: 'user_id', type: 'uuid' }),
                ...newCols,
                createColumn({ name: 'created_at', type: 'timestamptz', defaultValue: 'now()', isSystem: true })
            ]);

            // Auto-suggest table name from file
            if (!name) {
                const fileName = file.name.split('.')[0];
                setName(fileName);
            }
        };
        reader.readAsText(file);
    };

    if (!shouldRender) return null;

    const handleAddColumn = () => {
        setColumns((prev: any) => [...prev, createColumn()]);
    };

    const handleRemoveColumn = (index: number) => {
        setColumns((prev: any) => prev.filter((_: any, i: any) => i !== index));
    };

    const handleColumnChange = (index: number, field: keyof ColumnDraft, value: ColumnDraft[keyof ColumnDraft]) => {
        setColumns((prev: any) => prev.map((col: any, i: any) => (i === index ? { ...col, [field]: value } : col)));
    };

    const openRelationEditor = (index: number) => {
        setRelationEditorIndex(index);
        setRelationDraft(String(columns[index]?.references || ''));
    };

    const closeRelationEditor = () => {
        setRelationEditorIndex(null);
        setRelationDraft('');
    };

    const applyRelationDraft = () => {
        if (relationEditorIndex === null) {
            return;
        }
        handleColumnChange(relationEditorIndex, 'references', relationDraft.trim());
        closeRelationEditor();
    };

    const handleSave = async () => {
        setLoading(true);
        setError(null);

        const tableName = normalizedTableName;
        if (!tableName) {
            setError('Invalid table name. Use letters, numbers, and underscores (spaces are converted automatically).');
            setLoading(false);
            return;
        }

        const hasUserIDColumn = columns.some((c: any) => normalizeIdentifier(c.name) === 'user_id');
        if (isRLSEnabled && usesUserIDInPolicies && !hasUserIDColumn) {
            setError('RLS rule requires a user_id column. Add user_id or choose a different policy preset.');
            setLoading(false);
            return;
        }

        const normalizedRlsPolicies = {
            select: String(rlsPolicies.select || '').trim(),
            insert: String(rlsPolicies.insert || '').trim(),
            update: String(rlsPolicies.update || '').trim(),
            delete: String(rlsPolicies.delete || '').trim()
        };
        const hasAnyPolicy = Object.values(normalizedRlsPolicies).some(Boolean);
        if (isRLSEnabled && !hasAnyPolicy) {
            setError('At least one RLS policy action is required when RLS is enabled.');
            setLoading(false);
            return;
        }

        const customRawColumns = columns.filter((c: any) => !c.isSystem);
        const sanitizedColumnNames = buildUniqueIdentifiers(customRawColumns.map((c: any) => c.name), 'column');

        const customColumns = customRawColumns.map((c: any, idx: any) => ({
            name: sanitizedColumnNames[idx],
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
                    name: tableName,
                    display_name: String(name || '').trim() || tableName,
                    schema: customColumns,
                    rls_enabled: isRLSEnabled,
                    rls_rule: isRLSEnabled ? normalizedRlsPolicies.select : '',
                    rls_policies: isRLSEnabled ? normalizedRlsPolicies : {},
                    realtime_enabled: isRealtimeEnabled
                })
            });

            if (!res.ok) {
                const data: unknown = await res.json();
                const message = (
                    typeof data === 'object' &&
                    data !== null &&
                    'error' in data &&
                    typeof (data as JsonRecord).error === 'string'
                ) ? (data as JsonRecord).error as string : 'Failed to create table';
                throw new Error(message);
            }

            onTableCreated();

            // Perform bulk import if records exist
            if (csvRecords.length > 0) {
                console.log(`[CSV] Importing ${csvRecords.length} records into ${tableName}`);
                await fetchWithAuth(`/api/tables/${tableName}/import`, {
                    method: 'POST',
                    body: JSON.stringify(csvRecords)
                });
            }

            requestClose();
        } catch (err: unknown) {
            setError(getErrorMessage(err, 'Failed to create table'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            className={`fixed inset-0 z-50 flex items-center justify-end transition-opacity ${isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
            style={{ transitionDuration: `${isVisible ? MODAL_ENTER_MS : MODAL_EXIT_MS}ms` }}
            onClick={(e: any) => e.target === e.currentTarget && requestClose()}
        >
            <div className="absolute inset-0 ozy-overlay-backdrop backdrop-blur-md" />
            <div
                className={`ozy-sheet-panel h-full w-full max-w-2xl flex flex-col transform-gpu transition-all ${isVisible ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0'}`}
                style={{ transitionDuration: `${isVisible ? MODAL_ENTER_MS : MODAL_EXIT_MS}ms` }}
            >

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-[#2e2e2e]">
                    <h2 className="text-sm font-medium text-zinc-100">
                        Create a new table under <span className="font-mono bg-zinc-800 px-1 py-0.5 rounded textxs text-zinc-300">{schema}</span>
                    </h2>
                    <button onClick={requestClose} className="text-zinc-500 hover:text-white transition-colors">
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
                                onChange={(e: any) => setName(e.target.value)}
                                className="w-full bg-[#0c0c0c] border border-[#2e2e2e] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50 transition-colors"
                                placeholder="Mapeo de links"
                            />
                            <p className="text-[11px] text-zinc-500">
                                Technical name: <span className="font-mono text-zinc-300">{normalizedTableName || 'invalid_name'}</span>
                            </p>
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-medium text-zinc-300">Description</label>
                            <input
                                type="text"
                                value={description}
                                onChange={(e: any) => setDescription(e.target.value)}
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
                                onChange={(e: any) => setIsRLSEnabled(e.target.checked)}
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
                                <div className="space-y-3 w-full">
                                    <p className="text-xs text-zinc-500">
                                        Define policies per action. If an action has no policy, it is denied by default.
                                    </p>

                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-600">Policy Preset</label>
                                        <select
                                            value={rlsPreset}
                                            onChange={(e: any) => handleRlsPresetChange(e.target.value)}
                                            className="w-full bg-[#0c0c0c] border border-[#2e2e2e] rounded px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-primary/50"
                                        >
                                            <option value="owner_only">Owner only (user_id = auth.uid())</option>
                                            <option value="public_read_only">Public read only</option>
                                            <option value="deny_all">Deny all</option>
                                            <option value="custom">Custom</option>
                                        </select>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                        {RLS_ACTIONS.map((action) => (
                                            <div key={action} className="space-y-1">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-600">
                                                    {action}
                                                </label>
                                                <input
                                                    type="text"
                                                    value={rlsPolicies[action] || ''}
                                                    onChange={(e: any) => handleRlsPolicyChange(action, e.target.value)}
                                                    className="w-full bg-[#0c0c0c] border border-[#2e2e2e] rounded px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-primary/50 font-mono"
                                                    placeholder="false"
                                                />
                                            </div>
                                        ))}
                                    </div>

                                    <p className="text-[11px] text-zinc-500">
                                        Use SQL boolean expressions, e.g. <span className="font-mono">user_id = auth.uid()</span> or <span className="font-mono">true</span>.
                                    </p>

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
                            onChange={(e: any) => setIsRealtimeEnabled(e.target.checked)}
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
                            {columns.map((col: any, idx: any) => (
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
                                            onChange={(e: any) => handleColumnChange(idx, 'name', e.target.value)}
                                            disabled={col.isSystem}
                                            className={`w-full bg-transparent text-xs text-white focus:outline-none ${col.isSystem ? 'opacity-50 cursor-not-allowed' : ''}`}
                                            placeholder="column_name"
                                        />
                                        {col.isSystem && <LinkIcon size={10} className="absolute right-0 top-1/2 -translate-y-1/2 text-zinc-600" />}
                                    </div>
                                    <div className="col-span-2">
                                        <select
                                            value={col.type}
                                            onChange={(e: any) => handleColumnChange(idx, 'type', e.target.value)}
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
                                            onChange={(e: any) => handleColumnChange(idx, 'defaultValue', e.target.value)}
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
                                            onChange={(e: any) => handleColumnChange(idx, 'isPrimary', e.target.checked)}
                                            className="accent-primary"
                                        />
                                    </div>
                                    <div className="col-span-1 flex justify-center">
                                        <input 
                                            type="checkbox" 
                                            checked={col.unique} 
                                            disabled={col.isSystem}
                                            onChange={(e: any) => handleColumnChange(idx, 'unique', e.target.checked)}
                                            className="accent-primary"
                                        />
                                    </div>
                                    <div className="col-span-1 flex justify-center">
                                        <input 
                                            type="checkbox" 
                                            checked={col.required} 
                                            disabled={col.isSystem}
                                            onChange={(e: any) => handleColumnChange(idx, 'required', e.target.checked)}
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
                                        <button
                                            type="button"
                                            className={`cursor-pointer hover:text-primary transition-colors ${col.references ? 'text-primary' : 'text-zinc-700'}`}
                                            title={col.references ? `Ref: ${col.references}` : 'Add Relation'}
                                            onClick={() => {
                                                if (col.isSystem) return;
                                                openRelationEditor(idx);
                                            }}
                                        >
                                            <LinkIcon size={14} />
                                        </button>
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
                        onClick={requestClose}
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

                {relationEditorIndex !== null && (
                    <div className="absolute inset-0 z-20 flex items-center justify-center p-6">
                        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={closeRelationEditor} />
                        <div className="ozy-dialog-panel relative w-full max-w-xl overflow-hidden">
                            <div className="flex items-center justify-between border-b border-[#2e2e2e] bg-[#171717] px-6 py-4">
                                <div>
                                    <h3 className="text-sm font-black uppercase tracking-widest text-white">Configure Relation</h3>
                                    <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-zinc-500">
                                        Format: table.column
                                    </p>
                                </div>
                                <button onClick={closeRelationEditor} className="text-zinc-500 transition-colors hover:text-white">
                                    <X size={18} />
                                </button>
                            </div>
                            <div className="space-y-5 p-6">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Reference Target</label>
                                    <input
                                        autoFocus
                                        type="text"
                                        value={relationDraft}
                                        onChange={(event) => setRelationDraft(event.target.value)}
                                        placeholder="profiles.id"
                                        className="w-full rounded-xl border border-zinc-800 bg-[#0c0c0c] px-4 py-3 text-sm text-white focus:border-primary/50 focus:outline-none"
                                    />
                                </div>

                                <div className="space-y-3">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Detected Tables</p>
                                    <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto custom-scrollbar">
                                        {allTables.map((table: any) => (
                                            <button
                                                key={table.name}
                                                type="button"
                                                onClick={() => setRelationDraft(`${table.name}.id`)}
                                                className="rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-400 transition-colors hover:border-primary/30 hover:text-primary"
                                            >
                                                {table.name}.id
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center justify-end gap-3 border-t border-[#2e2e2e] bg-[#111111]/85 px-6 py-4">
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (relationEditorIndex !== null) {
                                            handleColumnChange(relationEditorIndex, 'references', '');
                                        }
                                        closeRelationEditor();
                                    }}
                                    className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-zinc-500 transition-colors hover:text-zinc-200"
                                >
                                    Clear
                                </button>
                                <button
                                    type="button"
                                    onClick={applyRelationDraft}
                                    className="rounded-xl bg-primary px-5 py-2 text-[10px] font-black uppercase tracking-widest text-black transition-colors hover:bg-[#E6E600]"
                                >
                                    Save Relation
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default CreateTableModal;
