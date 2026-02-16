import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
    Key,
    AtSign,
    Calendar,
    CheckCircle2,
    Plus,
    Filter,
    ArrowUpDown,
    Columns3,
    Search,
    RefreshCw,
    Code2,
    Download,
    Hash,
    Database,
    Trash2,
    FileUp,
    ChevronRight,
    ChevronLeft,
    ChevronDown,
    ListPlus,
    Globe,
    DollarSign,
    Layers,
    Cpu,
    Lock,
    GripVertical,
    Wifi,
    Settings
} from 'lucide-react';

import AddRowModal from './AddRowModal';
import AddColumnModal from './AddColumnModal';
import ConfirmModal from './ConfirmModal';
import InlineCellEditor from './InlineCellEditor';
import { fetchWithAuth } from '../utils/api';

// --- Custom Hooks ---

function useDebounce(value, delay) {
    const [debouncedValue, setDebouncedValue] = useState(value);
    useEffect(() => {
        const handler = setTimeout(() => setDebouncedValue(value), delay);
        return () => clearTimeout(handler);
    }, [value, delay]);
    return debouncedValue;
}

// localStorage key for column widths
const getStorageKey = (tableName) => `ozybase_column_widths_${tableName}`;

// Default column widths by type
const getDefaultWidth = (colName, colType) => {
    const type = (colType || 'text').toLowerCase();
    if (colName === 'id') return 280;
    if (type.includes('uuid')) return 280;
    if (type.includes('bool')) return 100;
    if (type.includes('int') || type.includes('num')) return 120;
    if (type.includes('date') || type.includes('time')) return 180;
    if (type.includes('json')) return 250;
    return 180; // default for text
};

const MAX_COLUMN_WIDTH = 5000;

// Dynamic minimum width based on header content
const calculateMinColumnWidth = () => {
    return 60;
};

const TableEditor = ({ tableName, onTableSelect, allTables = [] }) => {
    const [data, setData] = useState([]);
    const [schema, setSchema] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isColumnModalOpen, setIsColumnModalOpen] = useState(false);
    const [isInsertDropdownOpen, setIsInsertDropdownOpen] = useState(false);
    const [isTableSwitcherOpen, setIsTableSwitcherOpen] = useState(false);
    const [editingRow, setEditingRow] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearch = useDebounce(searchTerm, 500);
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);
    const [alertMessage, setAlertMessage] = useState(null);
    const [realtimeEnabled, setRealtimeEnabled] = useState(false);
    const [isRealtimeLoading, setIsRealtimeLoading] = useState(false);

    // Pagination State
    const [pageSize, setPageSize] = useState(100);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalRecords, setTotalRecords] = useState(0);

    // --- NEW: Column Widths & Inline Editing State ---
    const [columnWidths, setColumnWidths] = useState({});
    const [editingCell, setEditingCell] = useState(null); // { rowId, colName }
    const [resizingColumn, setResizingColumn] = useState(null);
    const resizeStartX = useRef(0);
    const resizeStartWidth = useRef(0);
    const columnWidthsRef = useRef({});

    // Keep ref in sync with state
    useEffect(() => {
        columnWidthsRef.current = columnWidths;
    }, [columnWidths]);

    // Load saved column widths from localStorage
    useEffect(() => {
        if (tableName) {
            const saved = localStorage.getItem(getStorageKey(tableName));
            if (saved) {
                try {
                    setColumnWidths(JSON.parse(saved));
                } catch {
                    setColumnWidths({});
                }
            } else {
                setColumnWidths({});
            }
        }
    }, [tableName]);

    // Save column widths to localStorage
    const saveColumnWidths = useCallback((widths) => {
        if (tableName) {
            localStorage.setItem(getStorageKey(tableName), JSON.stringify(widths));
        }
    }, [tableName]);

    const fetchData = useCallback(async () => {
        if (!tableName) return;
        setLoading(true);
        try {
            const offset = (currentPage - 1) * pageSize;
            const searchParam = debouncedSearch ? `&q=${encodeURIComponent(debouncedSearch)}` : '';

            const [schemaRes, dataRes] = await Promise.all([
                fetchWithAuth(`/api/schema/${tableName}`),
                fetchWithAuth(`/api/tables/${tableName}?limit=${pageSize}&offset=${offset}${searchParam}`)
            ]);

            if (!schemaRes.ok) throw new Error(`Table '${tableName}' schema lookup failed`);
            if (!dataRes.ok) throw new Error('Failed to fetch data');

            const [schemaItems, result] = await Promise.all([
                schemaRes.json(),
                dataRes.json()
            ]);

            setSchema(schemaItems);
            setData(Array.isArray(result.data) ? result.data : []);
            setTotalRecords(typeof result.total === 'number' ? result.total : 0);
            setError(null);
        } catch (err) {
            console.error(err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [tableName, currentPage, pageSize, debouncedSearch]);

    useEffect(() => {
        if (tableName) {
            fetchData();
            fetchRealtimeStatus();
            setEditingCell(null); // Clear editing state when table changes
        }
    }, [tableName, fetchData, fetchRealtimeStatus]);

    const fetchRealtimeStatus = useCallback(async () => {
        if (!tableName) return;
        try {
            const res = await fetchWithAuth('/api/collections');
            const collections = await res.json();
            const current = collections.find(c => c.name === tableName);
            if (current) setRealtimeEnabled(current.realtime_enabled);
        } catch (e) { console.error(e); }
    }, [tableName]);

    const toggleRealtime = async () => {
        setIsRealtimeLoading(true);
        try {
            const res = await fetchWithAuth('/api/collections/realtime', {
                method: 'PATCH',
                body: JSON.stringify({ name: tableName, enabled: !realtimeEnabled })
            });
            if (res.ok) {
                setRealtimeEnabled(!realtimeEnabled);
            }
        } catch (e) { console.error(e); }
        setIsRealtimeLoading(false);
    };

    // --- Column Resize Handlers ---
    const handleResizeStart = (e, colName) => {
        e.preventDefault();
        e.stopPropagation();
        setResizingColumn(colName);
        resizeStartX.current = e.clientX;
        resizeStartWidth.current = columnWidths[colName] || getDefaultWidth(colName, schema.find(c => c.name === colName)?.type);
    };

    useEffect(() => {
        if (!resizingColumn) return;

        const handleResizeMove = (e) => {
            const delta = e.clientX - resizeStartX.current;
            const minWidth = calculateMinColumnWidth(resizingColumn);
            const newWidth = Math.max(minWidth, Math.min(MAX_COLUMN_WIDTH, resizeStartWidth.current + delta));

            setColumnWidths(prev => ({
                ...prev,
                [resizingColumn]: newWidth
            }));
        };

        const handleResizeEnd = () => {
            saveColumnWidths(columnWidthsRef.current);
            setResizingColumn(null);
        };

        document.addEventListener('mousemove', handleResizeMove);
        document.addEventListener('mouseup', handleResizeEnd);

        return () => {
            document.removeEventListener('mousemove', handleResizeMove);
            document.removeEventListener('mouseup', handleResizeEnd);
        };
    }, [resizingColumn, saveColumnWidths]);

    // --- Virtualization Logic ---
    const [scrollTop, setScrollTop] = useState(0);
    const containerRef = useRef(null);
    const ROW_HEIGHT = 45;

    const handleScroll = (e) => {
        setScrollTop(e.target.scrollTop);
    };

    const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 5);
    const endIndex = Math.min(data.length, startIndex + Math.ceil(600 / ROW_HEIGHT) + 10);
    const visibleData = data.slice(startIndex, endIndex);
    const topPadding = startIndex * ROW_HEIGHT;
    const bottomPadding = (data.length - endIndex) * ROW_HEIGHT;

    // --- Cell Editing Handlers ---
    const handleCellClick = (rowId, colName) => {
        // Don't allow editing id or created_at
        if (colName === 'id' || colName === 'created_at') return;
        setEditingCell({ rowId, colName });
    };

    const handleCellSave = (rowId, colName, newValue) => {
        setData(prev => prev.map(row =>
            row.id === rowId ? { ...row, [colName]: newValue } : row
        ));
        setEditingCell(null);
    };

    const handleCellCancel = () => {
        setEditingCell(null);
    };

    const handleCSVImport = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
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
            const records = [];

            for (let i = 1; i < lines.length; i++) {
                const values = splitLine(lines[i]);
                const record = {};
                headers.forEach((header, index) => {
                    const val = values[index];
                    if (val !== undefined) {
                        record[header] = val;
                    }
                });
                if (Object.keys(record).length > 0) {
                    records.push(record);
                }
            }

            try {
                setLoading(true);
                const res = await fetchWithAuth(`/api/tables/${tableName}/import`, {
                    method: 'POST',
                    body: JSON.stringify(records)
                });
                if (res.ok) {
                    setAlertMessage({ title: 'Success', message: 'Imported successfully!', type: 'success' });
                    fetchData();
                } else {
                    const err = await res.json();
                    setAlertMessage({ title: 'Import Failed', message: err.error, type: 'danger' });
                }
            } catch {
                setAlertMessage({ title: 'Error', message: 'Import failed due to network error', type: 'danger' });
            } finally {
                setLoading(false);
                setIsInsertDropdownOpen(false);
            }
        };
        reader.readAsText(file);
    };

    const handleDeleteRow = (id) => {
        setConfirmDeleteId(id);
    };

    const confirmRowDeletion = async () => {
        const id = confirmDeleteId;
        try {
            const res = await fetchWithAuth(`/api/tables/${tableName}/rows/${id}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                fetchData();
            } else {
                setAlertMessage({ title: 'Error', message: 'Failed to delete row', type: 'danger' });
            }
        } catch (err) {
            console.error(err);
            setAlertMessage({ title: 'Error', message: 'Network error during deletion', type: 'danger' });
        }
    };

    const handleExportCSV = () => {
        if (data.length === 0) return;

        const headers = ['id', ...schema.map(c => c.name), 'created_at'];
        const csvRows = [
            headers.join(','),
            ...data.map(row => headers.map(h => {
                const val = row[h];
                return typeof val === 'string' ? `"${val.replace(/"/g, '""')}"` : val;
            }).join(','))
        ];

        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${tableName}_export.csv`;
        a.click();
    };

    const handleEditRow = (row) => {
        setEditingRow(row);
        setIsModalOpen(true);
    };

    const getTypeIcon = (type) => {
        const t = (type || 'text').toLowerCase();
        if (t.includes('uuid')) return <Key size={14} className="text-primary" />;
        if (t.includes('text') || t.includes('char')) return <AtSign size={14} className="text-primary" />;
        if (t.includes('time') || t.includes('date') || t.includes('interval')) return <Calendar size={14} className="text-primary" />;
        if (t.includes('bool')) return <CheckCircle2 size={14} className="text-primary" />;
        if (t.includes('num') || t.includes('int') || t.includes('float')) return <Hash size={14} className="text-primary" />;
        if (t.includes('inet') || t.includes('cidr')) return <Globe size={14} className="text-primary" />;
        if (t.includes('money')) return <DollarSign size={14} className="text-primary" />;
        if (t.includes('array')) return <Layers size={14} className="text-primary" />;
        if (t.includes('macaddr')) return <Cpu size={14} className="text-primary" />;
        if (t.includes('json')) return <Code2 size={14} className="text-primary" />;
        return <Database size={14} className="text-primary" />;
    };

    const standardColumns = [
        { name: 'id', type: 'uuid' },
        ...schema,
        { name: 'created_at', type: 'datetime' }
    ];

    // Get column width with fallback to default
    const getColumnWidth = (colName, colType) => {
        return columnWidths[colName] || getDefaultWidth(colName, colType);
    };

    const SkeletonRow = () => (
        <div className="flex border-b border-[#2e2e2e]/50" style={{ height: `${ROW_HEIGHT}px` }}>
            <div className="w-10 px-4 flex items-center shrink-0">
                <div className="w-4 h-4 bg-zinc-800 rounded animate-pulse" />
            </div>
            {standardColumns.map((col, i) => (
                <div
                    key={i}
                    className="px-4 flex items-center shrink-0"
                    style={{ width: `${getColumnWidth(col.name, col.type)}px` }}
                >
                    <div className="h-4 bg-zinc-800 rounded animate-pulse w-[80%]" />
                </div>
            ))}
            <div className="w-20 px-4 flex items-center shrink-0" />
        </div>
    );

    // Calculate total table width
    const totalWidth = standardColumns.reduce((acc, col) => acc + getColumnWidth(col.name, col.type), 0) + 40 + 80; // +checkbox +actions

    return (
        <div className="flex flex-col h-full w-full max-w-full overflow-hidden text-zinc-400 font-sans animate-in fade-in duration-500">
            {/* Table Toolbar */}
            <div className="h-14 flex items-center justify-between px-6 border-b border-[#2e2e2e] bg-[#1a1a1a] shrink-0">
                <div className="flex items-center gap-4">
                    {/* Table Switcher Breadcrumb */}
                    <div className="relative">
                        <button
                            onClick={() => setIsTableSwitcherOpen(!isTableSwitcherOpen)}
                            className="flex items-center gap-2 px-3 py-1.5 bg-[#111111] border border-[#2e2e2e] rounded-lg hover:border-zinc-500 transition-all group shrink-0"
                        >
                            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Table</span>
                            <span className="text-[11px] font-bold text-white group-hover:text-primary transition-colors">{tableName}</span>
                            <ChevronDown size={14} className={`text-zinc-600 transition-transform ${isTableSwitcherOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {isTableSwitcherOpen && (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setIsTableSwitcherOpen(false)} />
                                <div className="absolute top-full left-0 mt-2 w-64 bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                                    <div className="max-h-80 overflow-y-auto custom-scrollbar p-1.5 space-y-4">
                                        <div>
                                            <p className="px-3 py-1 text-[9px] font-black text-zinc-600 uppercase tracking-widest">User Tables</p>
                                            {allTables.filter(t => !t.is_system).map(t => (
                                                <button
                                                    key={t.name}
                                                    onClick={() => {
                                                        onTableSelect(t.name);
                                                        setIsTableSwitcherOpen(false);
                                                    }}
                                                    className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-3 ${tableName === t.name ? 'bg-primary/10 text-primary font-bold' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}
                                                >
                                                    <Database size={12} className={tableName === t.name ? 'text-primary' : 'text-zinc-600'} />
                                                    {t.name}
                                                </button>
                                            ))}
                                        </div>
                                        {allTables.some(t => t.is_system) && (
                                            <div>
                                                <p className="px-3 py-1 text-[9px] font-black text-zinc-600 uppercase tracking-widest">System Tables</p>
                                                {allTables.filter(t => t.is_system).map(t => (
                                                    <button
                                                        key={t.name}
                                                        onClick={() => {
                                                            onTableSelect(t.name);
                                                            setIsTableSwitcherOpen(false);
                                                        }}
                                                        className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-3 font-mono opacity-80 ${tableName === t.name ? 'bg-primary/10 text-primary font-bold' : 'text-zinc-500 hover:bg-zinc-800 hover:text-white'}`}
                                                    >
                                                        <Lock size={12} className={tableName === t.name ? 'text-primary' : 'text-zinc-700'} />
                                                        {t.name}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

                    <div className="h-4 w-[1px] bg-[#2e2e2e]" />

                    <div className="relative">
                        <button
                            onClick={() => setIsInsertDropdownOpen(!isInsertDropdownOpen)}
                            className="flex items-center gap-2 bg-primary text-black px-4 py-1.5 rounded-lg font-black text-[10px] uppercase tracking-widest hover:bg-[#E6E600] transition-all transform active:scale-95 shadow-[0_0_20px_rgba(254,254,0,0.1) shrink-0"
                        >
                            <Plus size={14} strokeWidth={3} />
                            Insert
                            <ChevronDown size={14} className={`transition-transform duration-200 ${isInsertDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {isInsertDropdownOpen && (
                            <>
                                <div
                                    className="fixed inset-0 z-40 outline-none"
                                    onClick={() => setIsInsertDropdownOpen(false)}
                                />
                                <div className="absolute top-full left-0 mt-2 w-56 bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                                    <div className="p-1.5 space-y-0.5">
                                        <button
                                            onClick={() => { setEditingRow(null); setIsModalOpen(true); setIsInsertDropdownOpen(false); }}
                                            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-bold text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all group"
                                        >
                                            <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0 group-hover:border-primary/50 transition-colors">
                                                <ListPlus size={16} className="text-zinc-500 group-hover:text-primary" />
                                            </div>
                                            <div className="flex flex-col text-left">
                                                <span className="uppercase tracking-wide">Insert Row</span>
                                                <span className="text-[9px] text-zinc-600">Add a new record</span>
                                            </div>
                                            <ChevronRight size={14} className="ml-auto text-zinc-700" />
                                        </button>

                                        <button
                                            onClick={() => { setIsColumnModalOpen(true); setIsInsertDropdownOpen(false); }}
                                            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-bold text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all group"
                                        >
                                            <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0 group-hover:border-primary/50 transition-colors">
                                                <Database size={16} className="text-zinc-500 group-hover:text-primary" />
                                            </div>
                                            <div className="flex flex-col text-left">
                                                <span className="uppercase tracking-wide">Insert Column</span>
                                                <span className="text-[9px] text-zinc-600">Add a new field</span>
                                            </div>
                                            <ChevronRight size={14} className="ml-auto text-zinc-700" />
                                        </button>

                                        <div className="h-[1px] bg-[#2e2e2e] my-1 mx-2" />

                                        <label className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-bold text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all group cursor-pointer">
                                            <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0 group-hover:border-primary/50 transition-colors">
                                                <FileUp size={16} className="text-zinc-500 group-hover:text-primary" />
                                            </div>
                                            <div className="flex flex-col text-left text-zinc-400">
                                                <span className="uppercase tracking-wide">Import CSV</span>
                                                <span className="text-[9px] text-zinc-600">Upload bulk data</span>
                                            </div>
                                            <input
                                                type="file"
                                                accept=".csv"
                                                onChange={handleCSVImport}
                                                className="hidden"
                                            />
                                            <ChevronRight size={14} className="ml-auto text-zinc-700" />
                                        </label>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

                    <div className="h-4 w-[1px] bg-[#2e2e2e] mx-2" />
                    <button className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800/50 rounded-md transition-colors text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-zinc-200 shrink-0">
                        <Filter size={14} />
                        Filter
                    </button>
                    <button className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800/50 rounded-md transition-colors text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-zinc-200 shrink-0">
                        <ArrowUpDown size={14} />
                        Sort
                    </button>
                    <button
                        onClick={() => setIsColumnModalOpen(true)}
                        className="flex items-center gap-2 px-3 py-1.5 bg-[#111111] border border-[#2e2e2e] rounded-lg hover:border-zinc-500 transition-all text-[10px] font-black uppercase tracking-widest text-zinc-300 shrink-0"
                    >
                        <Columns3 size={14} />
                        Columns
                    </button>

                    <div className="h-4 w-[1px] bg-[#2e2e2e] mx-2" />
                    
                    <button
                        onClick={toggleRealtime}
                        disabled={isRealtimeLoading || !tableName || tableName.startsWith('_v_')}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all text-[10px] font-black uppercase tracking-widest shrink-0 ${
                            realtimeEnabled 
                                ? 'bg-primary/10 border-primary/30 text-primary' 
                                : 'bg-[#111111] border-[#2e2e2e] text-zinc-500 hover:text-zinc-300'
                        } ${(isRealtimeLoading || tableName?.startsWith('_v_')) ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        <Wifi size={14} className={realtimeEnabled ? "animate-pulse" : ""} />
                        Realtime {realtimeEnabled ? 'On' : 'Off'}
                    </button>
                </div>

                <div className="flex items-center gap-3">
                    <div className="relative group">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within:text-primary transition-colors" size={14} />
                        <input
                            type="text"
                            placeholder="Search records..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="bg-[#111111] border border-[#2e2e2e] rounded-lg pl-9 pr-4 py-1.5 text-[11px] font-bold focus:outline-none focus:border-primary/50 w-64 text-zinc-200 placeholder:text-zinc-700 transition-all focus:ring-1 focus:ring-primary/10"
                        />
                    </div>
                    <button
                        onClick={fetchData}
                        disabled={loading}
                        className="p-2 border border-[#2e2e2e] rounded-lg hover:bg-zinc-800 transition-colors disabled:opacity-50 group"
                    >
                        <RefreshCw size={14} className={`${loading ? "animate-spin text-primary" : "text-zinc-500 group-hover:text-zinc-200"}`} />
                    </button>
                </div>
            </div>

            {/* Table Content - Dynamic Width */}
            <div
                ref={containerRef}
                onScroll={handleScroll}
                className="flex-1 overflow-auto bg-[#171717] custom-scrollbar"
            >
                <div style={{ minWidth: `${totalWidth}px` }}>
                    {/* Table Header */}
                    <div className="sticky top-0 bg-[#111111] z-10 border-b border-[#2e2e2e] flex">
                        {/* Checkbox column */}
                        <div className="w-10 px-4 py-3 flex items-center shrink-0">
                            <input type="checkbox" className="rounded border-border bg-transparent accent-primary" />
                        </div>

                        {/* Dynamic columns */}
                        {standardColumns.map((col) => {
                            const width = getColumnWidth(col.name, col.type);
                            const isResizing = resizingColumn === col.name;

                            return (
                                <div
                                    key={col.name}
                                    className="relative flex items-center shrink-0"
                                    style={{ width: `${width}px` }}
                                >
                                    <div className="flex-1 px-4 py-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-600 overflow-hidden">
                                        {getTypeIcon(col.type)}
                                        <span className="truncate">{col.name}</span>
                                    </div>

                                    {/* Resize Handle */}
                                    <div
                                        onMouseDown={(e) => handleResizeStart(e, col.name)}
                                        className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize group/resize flex items-center justify-center
                                            ${isResizing ? 'bg-primary' : 'hover:bg-primary/50'} transition-colors`}
                                    >
                                        <div className={`w-[2px] h-4 rounded-full transition-colors
                                            ${isResizing ? 'bg-primary' : 'bg-zinc-700 group-hover/resize:bg-primary'}`}
                                        />
                                    </div>
                                </div>
                            );
                        })}

                        {/* Actions column */}
                        <div className="w-20 px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-600 shrink-0">
                            Actions
                        </div>
                    </div>

                    {/* Table Body */}
                    <div className="divide-y divide-[#2e2e2e]/50 font-mono">
                        {loading && data.length === 0 ? (
                            <div className="space-y-0">
                                {[...Array(10)].map((_, i) => <SkeletonRow key={i} />)}
                            </div>
                        ) : error ? (
                            <div className="py-32 text-center">
                                <div className="max-w-xs mx-auto space-y-4">
                                    <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto text-red-500">
                                        <Code2 size={24} />
                                    </div>
                                    <p className="text-red-500/70 uppercase tracking-widest font-black text-[10px]">
                                        API Error: {error}
                                    </p>
                                </div>
                            </div>
                        ) : data.length === 0 ? (
                            <div className="py-40 text-center">
                                <div className="max-w-xs mx-auto space-y-6">
                                    <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-[#2e2e2e] flex items-center justify-center mx-auto text-zinc-700 shadow-xl">
                                        <Database size={32} strokeWidth={1.5} />
                                    </div>
                                    <div className="space-y-2">
                                        <h4 className="text-zinc-300 font-bold text-sm uppercase tracking-widest">No records found</h4>
                                        <p className="text-zinc-600 text-xs tracking-tight">Try adjusting your search or add your first row.</p>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <>
                                {/* Virtual Top Padding */}
                                {topPadding > 0 && (
                                    <div style={{ height: `${topPadding}px` }} />
                                )}

                                {visibleData.map((row) => {
                                    const isEditing = editingCell?.rowId === row.id;

                                    return (
                                        <div
                                            key={row.id}
                                            className="flex hover:bg-zinc-900/30 transition-colors group border-b border-[#2e2e2e]/30"
                                            style={{ height: `${ROW_HEIGHT}px` }}
                                        >
                                            {/* Checkbox */}
                                            <div className="w-10 px-4 flex items-center shrink-0">
                                                <input type="checkbox" className="rounded border-border bg-transparent accent-primary" />
                                            </div>

                                            {/* Data cells */}
                                            {standardColumns.map((col) => {
                                                const val = row[col.name];
                                                const width = getColumnWidth(col.name, col.type);
                                                const isCellEditing = isEditing && editingCell?.colName === col.name;
                                                const isEditable = col.name !== 'id' && col.name !== 'created_at';

                                                return (
                                                    <div
                                                        key={col.name}
                                                        onClick={() => isEditable && handleCellClick(row.id, col.name, col.type)}
                                                        className={`px-4 flex items-center text-xs shrink-0 overflow-hidden
                                                            ${isEditable ? 'cursor-cell hover:bg-zinc-800/30' : 'cursor-default'}
                                                            ${isCellEditing ? 'bg-zinc-800/50 ring-1 ring-primary/30' : ''}`}
                                                        style={{ width: `${width}px` }}
                                                    >
                                                        <InlineCellEditor
                                                            value={val}
                                                            columnName={col.name}
                                                            columnType={col.type}
                                                            rowId={row.id}
                                                            tableName={tableName}
                                                            isEditing={isCellEditing}
                                                            onSave={(newVal) => handleCellSave(row.id, col.name, newVal)}
                                                            onCancel={handleCellCancel}
                                                        />
                                                    </div>
                                                );
                                            })}

                                            {/* Actions */}
                                            <div className="w-20 px-4 flex items-center justify-end gap-2 shrink-0">
                                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button
                                                        onClick={() => handleEditRow(row)}
                                                        className="p-1.5 hover:text-primary transition-colors hover:bg-zinc-800 rounded"
                                                        title="Edit in modal"
                                                    >
                                                        <GripVertical size={12} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteRow(row.id)}
                                                        className="p-1.5 hover:text-red-500 transition-colors hover:bg-zinc-800 rounded"
                                                        title="Delete row"
                                                    >
                                                        <Trash2 size={12} />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}

                                {/* Virtual Bottom Padding */}
                                {bottomPadding > 0 && (
                                    <div style={{ height: `${bottomPadding}px` }} />
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Table Footer */}
            <div className="flex items-center justify-between px-6 py-2 border-t border-[#2e2e2e] bg-[#111111] text-[9px] font-black tracking-[0.2em]">
                <div className="flex items-center gap-6">
                    <span className="uppercase text-zinc-500 font-bold">{totalRecords} TOTAL RECORDS</span>

                    <div className="h-4 w-[1px] bg-[#2e2e2e]" />

                    {/* Pagination Controls */}
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1 group">
                            <span className="text-zinc-600 uppercase">Per Page:</span>
                            {[100, 500, 1000].map(size => (
                                <button
                                    key={size}
                                    onClick={() => { setPageSize(size); setCurrentPage(1); }}
                                    className={`px-1.5 py-0.5 rounded transition-all ${pageSize === size ? 'bg-primary text-black' : 'text-zinc-600 hover:text-zinc-300'}`}
                                >
                                    {size}
                                </button>
                            ))}
                        </div>

                        <div className="h-4 w-[1px] bg-[#2e2e2e]" />

                        <div className="flex items-center gap-4">
                            <button
                                disabled={currentPage === 1}
                                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                className="p-1 hover:text-primary disabled:opacity-30 transition-colors"
                            >
                                <ChevronLeft size={14} />
                            </button>
                            <span className="text-zinc-500 flex items-center gap-2">
                                PAGE <span className="text-primary">{currentPage}</span> OF {Math.ceil(totalRecords / pageSize) || 1}
                            </span>
                            <button
                                disabled={currentPage >= Math.ceil(totalRecords / pageSize)}
                                onClick={() => setCurrentPage(prev => prev + 1)}
                                className="p-1 hover:text-primary disabled:opacity-30 transition-colors"
                            >
                                <ChevronRight size={14} />
                            </button>
                        </div>
                    </div>

                    <div className="h-4 w-[1px] bg-[#2e2e2e]" />

                    <div className="flex items-center gap-2">
                        <div className={`w-1 h-1 rounded-full ${error ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]' : 'bg-primary shadow-[0_0_6px_rgba(254,254,0,0.4)]'}`} />
                        <span className="uppercase text-zinc-500">
                            {error ? 'DATABASE DISCONNECTED' : 'SYSTEM OPERATIONAL'}
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-4 text-zinc-600">
                    <button className="flex items-center gap-1.5 hover:text-zinc-200 uppercase transition-colors">
                        <Code2 size={12} /> SQL
                    </button>
                    <button
                        onClick={handleExportCSV}
                        className="flex items-center gap-1.5 hover:text-zinc-200 uppercase transition-colors"
                    >
                        <Download size={12} /> CSV
                    </button>
                </div>
            </div>

            <AddRowModal
                isOpen={isModalOpen}
                onClose={() => { setIsModalOpen(false); setEditingRow(null); }}
                schema={schema}
                tableName={tableName}
                initialData={editingRow}
                onRecordAdded={fetchData}
            />

            <AddColumnModal
                isOpen={isColumnModalOpen}
                onClose={() => setIsColumnModalOpen(false)}
                tableName={tableName}
                onColumnAdded={fetchData}
            />

            <ConfirmModal
                isOpen={!!confirmDeleteId}
                onClose={() => setConfirmDeleteId(null)}
                onConfirm={confirmRowDeletion}
                title="Delete Record"
                message="Are you sure you want to delete this record? This action will permanently remove the data from OzyBase."
                confirmText="Delete Record"
            />

            <ConfirmModal
                isOpen={!!alertMessage}
                onClose={() => setAlertMessage(null)}
                onConfirm={() => setAlertMessage(null)}
                title={alertMessage?.title}
                message={alertMessage?.message}
                confirmText="Dismiss"
                type={alertMessage?.type || 'success'}
            />
        </div>
    );
};

export default TableEditor;
