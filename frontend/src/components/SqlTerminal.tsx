import React, { useState } from 'react';
import {
    Terminal,
    Play,
    Save,
    History,
    Database,
    Search,
    ChevronRight,
    Loader2,
    CheckCircle2,
    XCircle,
    Copy,
    Trash2,
    Download,
    Plus,
    RefreshCcw,
    Sparkles,
    ChevronDown,
    Table,
    Activity,
    BookMarked,
    Code,
    MessageSquare,
    Zap,
    LogOut,
    FileCode,
    FileText,
    Clock,
    Filter
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import { useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import loader from '@monaco-editor/loader';
import * as monaco from 'monaco-editor';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));

// Force local Monaco bundle instead of CDN loader to satisfy strict CSP.
loader.config({ monaco });

const SQL_KEYWORDS = [
    'SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN',
    'GROUP BY', 'ORDER BY', 'LIMIT', 'OFFSET', 'HAVING', 'DISTINCT', 'AS', 'ON', 'IN', 'NOT IN', 'EXISTS',
    'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'TRUNCATE', 'VALUES', 'SET', 'AND', 'OR', 'NOT', 'NULL',
    'TRUE', 'FALSE', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'NOW()', 'CURRENT_DATE'
];

const BarChart = ({ data, columns }: any) => {
    if (!data || data.length === 0) return null;

    const numericIndices: number[] = [];
    if (data[0]) {
        data[0].forEach((val: any, i: any) => {
            const numericVal = Number(val);
            if (!isNaN(numericVal) && typeof val !== 'boolean' && val !== null && val !== '') {
                numericIndices.push(i);
            }
        });
    }

    if (numericIndices.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
                <div className="w-16 h-16 rounded-3xl bg-zinc-900 flex items-center justify-center text-zinc-600 mb-2 border border-[#2e2e2e]">
                    <Activity size={32} />
                </div>
                <h3 className="text-sm font-black text-white uppercase tracking-widest">No Numeric Data</h3>
                <p className="text-[10px] text-zinc-500 max-w-xs leading-relaxed uppercase tracking-widest font-medium">
                    This view requires at least one column with numbers to generate a chart.
                    Try a query with counts or sums (e.g., <span className="text-primary">SELECT count(*), role FROM users GROUP BY 2</span>).
                </p>
            </div>
        );
    }

    const chartIndex = numericIndices[0];
    let labelIndex = -1;
    const nonNumericIndices: number[] = [];
    columns.forEach((col: any, i: any) => {
        if (!numericIndices.includes(i)) nonNumericIndices.push(i);
    });

    const labelKeywords = ['name', 'label', 'id', 'date', 'fecha', 'email', 'category', 'title', 'key', 'code'];
    const findByKeyword = (indices: any) => {
        return indices.find((idx: any) =>
            labelKeywords.some((kw: any) => columns[idx].toLowerCase().includes(kw))
        );
    };

    labelIndex = findByKeyword(nonNumericIndices);
    if (labelIndex === undefined || labelIndex === -1) labelIndex = nonNumericIndices[0];
    if (labelIndex === undefined || labelIndex === -1) labelIndex = findByKeyword(numericIndices.filter((i: any) => i !== chartIndex));
    if (labelIndex === undefined || labelIndex === -1) labelIndex = 0;

    const maxVal = Math.max(...data.map((r: any) => Number(r[chartIndex]) || 0), 1);
    const chartHeight = 200;


    return (
        <div className="relative bg-[#0c0c0c] border border-[#2e2e2e] p-8 rounded-2xl overflow-x-auto custom-scrollbar shadow-2xl">
            <div className="flex items-end gap-3 h-[250px] min-w-max pb-8">
                {data.slice(0, 20).map((row: any, i: any) => {
                    const val = Number(row[chartIndex]) || 0;
                    const height = (val / maxVal) * chartHeight;
                    const rawLabel = row[labelIndex];
                    const label = (rawLabel !== null && rawLabel !== undefined && rawLabel !== '') ? String(rawLabel).slice(0, 12) : `Row ${i + 1}`;
                    return (
                        <div key={i} className="flex flex-col items-center gap-3 group">
                            <div className="relative w-10 flex flex-col justify-end h-full">
                                <div className="bg-primary/20 border-t-2 border-primary group-hover:bg-primary/40 transition-all duration-500 rounded-t-sm relative" style={{ height: `${height}px` }}>
                                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap text-[9px] font-black pointer-events-none text-primary">{val}</div>
                                </div>
                            </div>
                            <span className="text-[8px] font-black text-zinc-600 group-hover:text-zinc-300 transition-colors uppercase tracking-widest rotate-45 origin-left whitespace-nowrap">{label}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const SqlTerminal = () => {
    const [query, setQuery] = useState('SELECT * FROM users LIMIT 10;');
    const [results, setResults] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<any>(null);
    const [history, setHistory] = useState<any[]>([]);
    const [savedQueries, setSavedQueries] = useState<any[]>([]);
    const [syncing, setSyncing] = useState(false);
    const [syncSuccess, setSyncSuccess] = useState(false);
    const [panelHeight, setPanelHeight] = useState(300);
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
    const [toast, setToast] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTab, setActiveTab] = useState('results'); // 'results' | 'explain' | 'visualize'
    const [explainData, setExplainData] = useState<any>(null);
    const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
    const [isExportConfirmOpen, setIsExportConfirmOpen] = useState(false);
    const [exportFormat, setExportFormat] = useState<string | null>(null);
    const [queryName, setQueryName] = useState('');
    const [timeRange, setTimeRange] = useState(60); // minutes
    const [showTimeMenu, setShowTimeMenu] = useState(false);
    const [catalog, setCatalog] = useState<{ tables: string[]; columnsByTable: Record<string, string[]>; allColumns: string[] }>({ tables: [], columnsByTable: {}, allColumns: [] });
    const isResizing = useRef<boolean>(false);
    const monacoRef = useRef<any>(null);
    const editorRef = useRef<any>(null);
    const completionProviderRef = useRef<any>(null);

    // Derived states for filtering
    const filteredSaved = savedQueries.filter((item: any) =>
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.query.toLowerCase().includes(searchQuery.toLowerCase())
    );
    const filteredHistory = history.filter((item: any) =>
        item.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Close menus on outside click
    useEffect(() => {
        const handleOutsideClick = () => {
            setShowExportMenu(false);
            setShowTimeMenu(false);
        };
        if (showExportMenu || showTimeMenu) {
            window.addEventListener('click', handleOutsideClick);
        }
        return () => window.removeEventListener('click', handleOutsideClick);
    }, [showExportMenu, showTimeMenu]);

    // Initial load from localStorage
    useEffect(() => {
        const savedHist = localStorage.getItem('ozy_sql_history');
        const savedQueriesStore = localStorage.getItem('ozy_sql_saved');
        if (savedHist) setHistory(JSON.parse(savedHist));
        if (savedQueriesStore) setSavedQueries(JSON.parse(savedQueriesStore));
    }, []);

    // Save to localStorage
    useEffect(() => {
        localStorage.setItem('ozy_sql_history', JSON.stringify(history));
    }, [history]);

    useEffect(() => {
        localStorage.setItem('ozy_sql_saved', JSON.stringify(savedQueries));
    }, [savedQueries]);

    const normalizeToken = useCallback((value: any) => {
        return String(value || '').toLowerCase().replace(/_/g, '');
    }, []);

    const isSubsequence = useCallback((needle: any, haystack: any) => {
        if (!needle) return true;
        let i = 0;
        let j = 0;
        while (i < needle.length && j < haystack.length) {
            if (needle[i] === haystack[j]) i++;
            j++;
        }
        return i === needle.length;
    }, []);

    const buildFilterText = useCallback((value: any) => {
        const raw = String(value || '');
        const lower = raw.toLowerCase();
        const normalized = normalizeToken(raw);
        const spaced = lower.replace(/_/g, ' ');
        return `${raw} ${lower} ${normalized} ${spaced}`;
    }, [normalizeToken]);

    const rankSuggestion = useCallback((needle: any, candidate: any) => {
        if (!needle) return 50;
        const a = needle.toLowerCase();
        const b = candidate.toLowerCase();
        const an = normalizeToken(a);
        const bn = normalizeToken(b);
        if (b.startsWith(a)) return 0;
        if (b.includes(a)) return 1;
        if (bn.startsWith(an)) return 2;
        if (bn.includes(an)) return 3;
        if (isSubsequence(an, bn)) return 4;
        if (isSubsequence(a, b)) return 5;
        return 9;
    }, [normalizeToken, isSubsequence]);

    const fetchCatalog = useCallback(async () => {
        try {
            const res = await fetchWithAuth('/api/collections');
            if (!res.ok) return;
            const data = await res.json();
            const tables: string[] = [];
            const columnsByTable: Record<string, string[]> = {};
            const allColumnsSet = new Set<string>();

            (Array.isArray(data) ? data : []).forEach((collection: any) => {
                const tableName = collection?.name;
                if (!tableName) return;
                tables.push(tableName);
                const schemaCols = Array.isArray(collection?.schema)
                    ? collection.schema.map((field: any) => field?.name).filter(Boolean)
                    : [];
                columnsByTable[tableName] = schemaCols;
                schemaCols.forEach((col: string) => allColumnsSet.add(col));
            });

            setCatalog({
                tables,
                columnsByTable,
                allColumns: Array.from(allColumnsSet)
            });
        } catch (e) {
            console.error('Failed to load SQL autocomplete catalog', e);
        }
    }, []);

    useEffect(() => {
        fetchCatalog();
    }, [fetchCatalog]);

    useEffect(() => {
        if (syncSuccess) {
            fetchCatalog();
        }
    }, [syncSuccess, fetchCatalog]);

    const registerCompletionProvider = useCallback(() => {
        if (!monacoRef.current) return;

        if (completionProviderRef.current) {
            completionProviderRef.current.dispose();
        }

        completionProviderRef.current = monacoRef.current.languages.registerCompletionItemProvider('sql', {
            triggerCharacters: ['.', '_'],
            provideCompletionItems: (model: any, position: any) => {
                const linePrefix = model.getValueInRange({
                    startLineNumber: position.lineNumber,
                    startColumn: 1,
                    endLineNumber: position.lineNumber,
                    endColumn: position.column
                });
                const word = model.getWordUntilPosition(position);
                const typed = (word.word || '').toLowerCase();
                const range = {
                    startLineNumber: position.lineNumber,
                    endLineNumber: position.lineNumber,
                    startColumn: word.startColumn,
                    endColumn: word.endColumn
                };

                const fullTextUntilCursor = model.getValueInRange({
                    startLineNumber: 1,
                    startColumn: 1,
                    endLineNumber: position.lineNumber,
                    endColumn: position.column
                });

                const aliasMap: Record<string, string> = {};
                const aliasRegex = /\b(?:from|join)\s+([a-zA-Z_][\w]*)\s+(?:as\s+)?([a-zA-Z_][\w]*)/gi;
                let aliasMatch;
                while ((aliasMatch = aliasRegex.exec(fullTextUntilCursor)) !== null) {
                    aliasMap[aliasMatch[2]] = aliasMatch[1];
                }

                const dotMatch = linePrefix.match(/([a-zA-Z_][\w]*)\.([a-zA-Z_0-9]*)$/i);
                let tableScopedColumns: string[] | null = null;
                if (dotMatch) {
                    const token = dotMatch[1];
                    const resolvedTable = aliasMap[token] || token;
                    tableScopedColumns = catalog.columnsByTable[resolvedTable] || [];
                }

                const keywordSuggestions = SQL_KEYWORDS.map((keyword: any) => ({
                    label: keyword,
                    kind: monacoRef.current.languages.CompletionItemKind.Keyword,
                    insertText: keyword,
                    range,
                    filterText: buildFilterText(keyword),
                    sortText: `k_${String(rankSuggestion(typed, keyword)).padStart(2, '0')}_${keyword.toLowerCase()}`
                }));

                const tableSuggestions = catalog.tables.map((table: any) => ({
                    label: table,
                    kind: monacoRef.current.languages.CompletionItemKind.Class,
                    insertText: table,
                    detail: 'Table',
                    documentation: `Normalized: ${normalizeToken(table)}`,
                    range,
                    filterText: buildFilterText(table),
                    sortText: `t_${String(rankSuggestion(typed, table)).padStart(2, '0')}_${table}`
                }));

                const columnSource = tableScopedColumns || catalog.allColumns;
                const columnSuggestions = columnSource.map((column: any) => ({
                    label: column,
                    kind: monacoRef.current.languages.CompletionItemKind.Field,
                    insertText: column,
                    detail: tableScopedColumns ? 'Column (table scope)' : 'Column',
                    documentation: `Normalized: ${normalizeToken(column)}`,
                    range,
                    filterText: buildFilterText(column),
                    sortText: `c_${String(rankSuggestion(typed, column)).padStart(2, '0')}_${column}`
                }));

                const tableColumnSuggestions = tableScopedColumns
                    ? []
                    : catalog.tables.flatMap((table: any) => (catalog.columnsByTable[table] || []).map((column: any) => ({
                        label: `${table}.${column}`,
                        kind: monacoRef.current.languages.CompletionItemKind.Property,
                        insertText: `${table}.${column}`,
                        detail: 'Table.Column',
                        documentation: `Normalized: ${normalizeToken(`${table}.${column}`)}`,
                        range,
                        filterText: buildFilterText(`${table}.${column}`),
                        sortText: `p_${String(rankSuggestion(typed, `${table}.${column}`)).padStart(2, '0')}_${table}_${column}`
                    })));

                const suggestions = dotMatch
                    ? columnSuggestions
                    : [...tableSuggestions, ...columnSuggestions, ...tableColumnSuggestions, ...keywordSuggestions];

                return { suggestions };
            }
        });
    }, [catalog, rankSuggestion, buildFilterText, normalizeToken]);

    useEffect(() => {
        registerCompletionProvider();
        return () => {
            if (completionProviderRef.current) {
                completionProviderRef.current.dispose();
                completionProviderRef.current = null;
            }
        };
    }, [registerCompletionProvider]);

    const runQuery = async (customQuery?: string | null) => {
        // Handle cases where an event object might be passed if called directly in onClick
        const targetQuery = (typeof customQuery === 'string' ? customQuery : query) || '';
        if (!targetQuery.trim()) return;

        setLoading(true);
        setError(null);
        setActiveTab('results');
        try {
            const res = await fetchWithAuth('/api/sql', {
                method: 'POST',
                body: JSON.stringify({ query: targetQuery })
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.error || 'Failed to execute query');
            }

            const data = await res.json();

            if (targetQuery.toLowerCase().includes('explain')) {
                setExplainData(data.rows);
                setActiveTab('explain');
            } else {
                setResults({
                    columns: data.columns || [],
                    rows: data.rows || [],
                    rowCount: data.rowCount || 0,
                    executionTime: data.executionTime || '0ms'
                });

                // Add to history if successful and not already the last one
                setHistory((prev: any) => {
                    if (prev[0] === targetQuery) return prev;
                    return [targetQuery, ...prev].slice(0, 50);
                });
            }
            setSelectedRows(new Set());
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleExplain = () => {
        const explainQuery = `EXPLAIN (ANALYZE, COSTS, VERBOSE, BUFFERS, FORMAT JSON) ${query}`;
        runQuery(explainQuery);
    };

    const handleSaveQuery = () => {
        setIsSaveModalOpen(true);
    };

    const confirmSaveQuery = () => {
        if (!queryName.trim()) return;

        const newSaved = {
            id: crypto.randomUUID(),
            name: queryName,
            query,
            timestamp: new Date().toISOString()
        };

        setSavedQueries((prev: any) => [newSaved, ...prev]);
        showToast('Query saved successfully', 'success');
        setIsSaveModalOpen(false);
        setQueryName('');
    };

    const deleteSavedQuery = (e: any, id: any) => {
        e.stopPropagation();
        setSavedQueries((prev: any) => prev.filter((q: any) => q.id !== id));
        showToast('Query deleted', 'info');
    };

    const clearHistory = () => {
        setHistory([]);
        showToast('History cleared', 'info');
    };

    const handleSync = async () => {
        setSyncing(true);
        setSyncSuccess(false);
        setError(null);
        try {
            const res = await fetchWithAuth('/api/sql/sync', {
                method: 'POST'
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.error || 'Failed to sync system schema');
            }

            setSyncSuccess(true);
            setTimeout(() => setSyncSuccess(false), 3000);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSyncing(false);
        }
    };

    const startResizing = () => {
        isResizing.current = true;
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', stopResizing);
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
    };

    const handleMouseMove = useCallback((e: any) => {
        if (!isResizing.current) return;

        const newHeight = window.innerHeight - e.clientY;
        if (newHeight > 100 && newHeight < window.innerHeight - 200) {
            setPanelHeight(newHeight);
        }
    }, []);

    const stopResizing = useCallback(() => {
        isResizing.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', stopResizing);
        document.body.style.cursor = 'default';
        document.body.style.userSelect = 'auto';
    }, [handleMouseMove]);

    useEffect(() => {
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', stopResizing);
        };
    }, [handleMouseMove, stopResizing]);

    const initiateExport = (format: any) => {
        setExportFormat(format);
        setIsExportConfirmOpen(true);
    };

    const confirmExport = () => {
        if (exportFormat === 'csv') exportToCSV();
        else if (exportFormat === 'json') exportToJSON();
        else if (exportFormat === 'txt') exportToTXT();
        setIsExportConfirmOpen(false);
    };

    const exportToCSV = () => {
        if (!results) return;
        const headers = results.columns.join(',');
        const rows = results.rows.map((row: any) =>
            row.map((val: any) => {
                const s = String(val).replace(/"/g, '""');
                return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
            }).join(',')
        ).join('\n');
        downloadFile(`${headers}\n${rows}`, 'export.csv', 'text/csv');
        setShowExportMenu(false);
    };

    const exportToJSON = () => {
        if (!results) return;
        const data = results.rows.map((row: any) => {
            const obj: Record<string, any> = {};
            results.columns.forEach((col: any, i: any) => {
                obj[col] = row[i];
            });
            return obj;
        });
        downloadFile(JSON.stringify(data, null, 2), 'export.json', 'application/json');
        setShowExportMenu(false);
    };

    const exportToTXT = () => {
        if (!results) return;
        const headers = results.columns.join('\t');
        const rows = results.rows.map((row: any) => row.join('\t')).join('\n');
        downloadFile(`${headers}\n${rows}`, 'export.txt', 'text/plain');
        setShowExportMenu(false);
    };

    const downloadFile = (content: any, fileName: any, contentType: any) => {
        const a = document.createElement('a');
        const file = new Blob([content], { type: contentType });
        a.href = URL.createObjectURL(file);
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const toggleRow = (index: any) => {
        const next = new Set(selectedRows);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        setSelectedRows(next);
    };

    const toggleAllRows = () => {
        if (!results) return;
        if (selectedRows.size === results.rows.length) {
            setSelectedRows(new Set());
        } else {
            setSelectedRows(new Set(results.rows.map((_: any, i: any) => i)));
        }
    };

    const copySelected = (format: any) => {
        if (!results || selectedRows.size === 0) return;

        const selectedData = results.rows.filter((_: any, i: any) => selectedRows.has(i));
        let content = '';

        if (format === 'json') {
            const data = selectedData.map((row: any) => {
                const obj: Record<string, any> = {};
                results.columns.forEach((col: any, i: any) => {
                    obj[col] = row[i];
                });
                return obj;
            });
            content = JSON.stringify(data, null, 2);
        } else if (format === 'csv') {
            const headers = results.columns.join(',');
            const rows = selectedData.map((row: any) =>
                row.map((val: any) => {
                    const s = String(val).replace(/"/g, '""');
                    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
                }).join(',')
            ).join('\n');
            content = `${headers}\n${rows}`;
        } else {
            const headers = results.columns.join('\t');
            const rows = selectedData.map((row: any) => row.join('\t')).join('\n');
            content = `${headers}\n${rows}`;
        }

        navigator.clipboard.writeText(content);
        showToast(`Copied ${selectedRows.size} rows to clipboard`, 'success');
    };

    const handleLogout = () => {
        localStorage.removeItem('ozy_token');
        localStorage.removeItem('ozy_user');
        window.location.reload();
    };

    const showToast = (message: any, type: any = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    };

    const handleClearSelection = () => {
        setSelectedRows(new Set());
        showToast('Selection cleared', 'info');
    };


    return (
        <div className="flex h-full bg-[#0c0c0c] animate-in fade-in duration-500 overflow-hidden">
            {/* Unified SQL Sidebar */}
            <div className="w-72 border-r border-[#1a1a1a] bg-[#0c0c0c] flex flex-col hidden lg:flex">
                <div className="h-14 flex items-center px-6 border-b border-[#1a1a1a]">
                    <span className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">
                        SQL Editor
                    </span>
                </div>

                <div className="p-4">
                    <div className="relative group">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within:text-primary transition-colors" size={14} />
                        <input
                            type="text"
                            placeholder="Explore queries..."
                            className="w-full bg-[#111111] border border-[#1a1a1a] rounded-lg py-2 pl-9 pr-4 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-primary/50 transition-all"
                            value={searchQuery}
                            onChange={(e: any) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-6">
                    {/* Saved Queries */}
                    <div>
                        <div className="flex items-center justify-between px-3 mb-3">
                            <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Saved Queries</h3>
                            <button onClick={handleSaveQuery} className="text-zinc-600 hover:text-white transition-colors">
                                <Plus size={14} />
                            </button>
                        </div>

                        <div className="space-y-1">
                            {filteredSaved.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-8 px-4 border border-dashed border-[#1a1a1a] rounded-xl bg-[#0e0e0e]/50 gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-[#1a1a1a] flex items-center justify-center text-zinc-600">
                                        <BookMarked size={18} />
                                    </div>
                                    <div className="text-center">
                                        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">No saved queries</p>
                                    </div>
                                </div>
                            ) : (
                                filteredSaved.map((q: any) => (
                                    <div
                                        key={q.id}
                                        onClick={() => {
                                            setQuery(q.query);
                                            showToast(`Loaded "${q.name}"`, 'success');
                                        }}
                                        className="group relative flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#1a1a1a] cursor-pointer transition-all border border-transparent hover:border-[#2e2e2e]"
                                    >
                                        <Code size={14} className="text-zinc-500 group-hover:text-primary" />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[11px] font-bold text-zinc-300 truncate tracking-wide">{q.name}</div>
                                            <div className="text-[9px] text-zinc-600 truncate mt-0.5 font-medium">{new Date(q.timestamp).toLocaleDateString()}</div>
                                        </div>
                                        <button
                                            onClick={(e: any) => deleteSavedQuery(e, q.id)}
                                            className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500/10 hover:text-red-500 rounded-md transition-all"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Query History */}
                    <div>
                        <div className="flex items-center justify-between px-3 mb-3">
                            <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">History</h3>
                            {history.length > 0 && (
                                <button onClick={clearHistory} className="text-[9px] font-black text-zinc-600 hover:text-red-500 uppercase tracking-widest transition-colors">
                                    Clear
                                </button>
                            )}
                        </div>
                        <div className="space-y-1">
                            {filteredHistory.length === 0 ? (
                                <div className="px-3 py-4 text-[10px] font-medium text-zinc-600 italic uppercase tracking-wider">
                                    No history yet
                                </div>
                            ) : (
                                filteredHistory.map((h: any, i: any) => (
                                    <div
                                        key={i}
                                        onClick={() => setQuery(h)}
                                        className="group flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#111111] cursor-pointer transition-colors border border-transparent hover:border-[#1a1a1a]"
                                    >
                                        <div className="w-1.5 h-1.5 rounded-full bg-zinc-800 group-hover:bg-primary/50 transition-colors" />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[10px] text-zinc-400 group-hover:text-zinc-200 truncate font-mono">{h}</div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                {/* Bottom Profile/Signout */}
                <div className="mt-auto p-4 border-t border-[#1a1a1a]">
                    <button
                        onClick={handleLogout}
                        className="flex items-center gap-3 text-zinc-500 hover:text-white transition-colors w-full group"
                    >
                        <div className="w-8 h-8 rounded-lg bg-[#1a1a1a] flex items-center justify-center group-hover:bg-zinc-800 transition-colors">
                            <LogOut size={14} />
                        </div>
                        <span className="text-[10px] font-black uppercase tracking-[0.2em]">Sign Out</span>
                    </button>
                </div>
            </div>

            {/* Main Editor Area */}
            <div className="flex-1 flex flex-col bg-[#080808] min-w-0">
                {/* Toolbar */}
                <div className="h-14 border-b border-[#2e2e2e] bg-[#1a1a1a] flex items-center justify-between px-6">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 px-3 py-1 bg-[#111111] border border-[#2e2e2e] rounded-lg">
                            <Database size={12} className="text-primary" />
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Production DB</span>
                        </div>
                        <button
                            onClick={() => { void runQuery(); }}
                            disabled={loading}
                            className="flex items-center gap-2 bg-primary text-black px-5 py-1.5 rounded-lg font-black text-[10px] uppercase tracking-widest hover:bg-[#E6E600] active:scale-95 transition-all shadow-[0_0_20px_rgba(254,254,0,0.1)] py-2"
                        >
                            {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} fill="currentColor" />}
                            Run Query
                        </button>
                        <button
                            onClick={handleExplain}
                            disabled={loading}
                            className="flex items-center gap-2 border border-zinc-800 text-zinc-400 px-4 py-1.5 rounded-lg font-black text-[10px] uppercase tracking-widest hover:text-white hover:border-zinc-600 active:scale-95 transition-all py-2"
                        >
                            < Zap size={14} className={loading ? "animate-pulse" : ""} />
                            Explain
                        </button>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleSync}
                            disabled={syncing}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all
                                ${syncSuccess
                                    ? 'bg-green-500/10 text-green-500 border border-green-500/20'
                                    : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-600'}
                            `}
                        >
                            {syncing ? <Loader2 size={14} className="animate-spin" /> : syncSuccess ? <Sparkles size={14} /> : <RefreshCcw size={14} />}
                            {syncSuccess ? 'System Synced!' : 'Sync System'}
                        </button>
                        <div className="h-4 w-[1px] bg-[#2e2e2e]" />
                        <button onClick={handleSaveQuery} title="Save Query" className="p-2 text-zinc-600 hover:text-primary transition-colors"><Save size={16} /></button>
                        <div className="h-4 w-[1px] bg-[#2e2e2e]" />
                        <button onClick={() => setQuery('')} title="Clear Editor" className="p-2 text-zinc-600 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
                    </div>
                </div>

                {/* SQL Input (Monaco Editor - Lazy Loaded) */}
                <div className="flex-1 relative flex flex-col overflow-hidden bg-[#111111]">
                    <Suspense fallback={
                        <div className="flex-1 flex items-center justify-center bg-[#111111]">
                            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-600 animate-pulse">Loading Editor...</span>
                        </div>
                    }>
                        <MonacoEditor
                            height="100%"
                            defaultLanguage="sql"
                            value={query}
                            onChange={(value: any) => setQuery(value || '')}
                            theme="vs-dark"
                            options={{
                                minimap: { enabled: false },
                                fontSize: 14,
                                lineHeight: 24,
                                padding: { top: 16 },
                                fontFamily: 'monospace',
                                scrollBeyondLastLine: false,
                                automaticLayout: true,
                                wordWrap: 'on',
                                renderLineHighlight: 'line',
                                overviewRulerLanes: 0,
                                hideCursorInOverviewRuler: true,
                                overviewRulerBorder: false,
                                scrollbar: {
                                    vertical: 'hidden',
                                    horizontal: 'auto',
                                    verticalScrollbarSize: 0,
                                },
                            }}
                            beforeMount={(monaco: any) => {
                                monaco.editor.defineTheme('ozy-dark', {
                                    base: 'vs-dark',
                                    inherit: true,
                                    rules: [],
                                    colors: {
                                        'editor.background': '#111111',
                                        'editor.lineHighlightBackground': '#1a1a1a',
                                    }
                                });
                            }}
                            onMount={(editor: any, monaco: any) => {
                                editorRef.current = editor;
                                monacoRef.current = monaco;
                                monaco.editor.setTheme('ozy-dark');
                                registerCompletionProvider();
                            }}
                        />
                    </Suspense>
                </div>

                {/* Resizer Handle */}
                <div
                    onMouseDown={startResizing}
                    className="h-[2px] w-full bg-[#2e2e2e] hover:bg-primary cursor-row-resize transition-colors group relative z-20"
                >
                    <div className="absolute inset-x-0 -top-1 -bottom-1" /> {/* Larger hit area */}
                </div>

                {/* Results Panel */}
                <div
                    style={{ height: `${panelHeight}px` }}
                    className="border-t border-[#2e2e2e] bg-[#1a1a1a] flex flex-col"
                >
                    <div className="h-10 border-b border-[#2e2e2e] flex items-center justify-between px-6 bg-[#111111] sticky top-0 z-50">
                        <div className="flex items-center gap-4">
                            <button
                                onClick={() => setActiveTab('results')}
                                className={`text-[10px] font-black uppercase tracking-widest transition-all px-4 h-full border-b-2 flex items-center gap-2
                                    ${activeTab === 'results' ? 'text-primary border-primary' : 'text-zinc-500 border-transparent hover:text-zinc-300'}`}
                            >
                                <Table size={12} />
                                Query Results
                            </button>
                            <button
                                onClick={() => setActiveTab('explain')}
                                className={`text-[10px] font-black uppercase tracking-widest transition-all px-4 h-full border-b-2 flex items-center gap-2
                                    ${activeTab === 'explain' ? 'text-primary border-primary' : 'text-zinc-500 border-transparent hover:text-zinc-300'}`}
                            >
                                < Zap size={12} />
                                Explain Plan
                            </button>
                            <button
                                onClick={() => setActiveTab('visualize')}
                                className={`text-[10px] font-black uppercase tracking-widest transition-all px-4 h-full border-b-2 flex items-center gap-2
                                    ${activeTab === 'visualize' ? 'text-primary border-primary' : 'text-zinc-500 border-transparent hover:text-zinc-300'}`}
                            >
                                <Activity size={12} />
                                Visualize
                            </button>

                            {(results || explainData) && activeTab === 'results' && (
                                <div className="flex items-center gap-4 border-l border-zinc-800 pl-4 h-full">
                                    <span className="text-[9px] font-bold text-green-500 uppercase tracking-widest flex items-center gap-1.5 font-mono">
                                        <CheckCircle2 size={10} />
                                        Success ({results?.rowCount || 0} rows)
                                    </span>
                                    <span className="text-[9px] font-bold text-zinc-600 tracking-widest font-mono">EXEC: {results?.executionTime || '0ms'}</span>
                                </div>
                            )}
                        </div>

                        <div className="flex items-center gap-4">
                            {activeTab === 'visualize' && results && (
                                <div className="relative">
                                    <button
                                        onClick={(e: any) => {
                                            e.stopPropagation();
                                            setShowTimeMenu((prev: any) => !prev);
                                        }}
                                        className="flex items-center gap-2 text-[9px] font-bold text-zinc-500 hover:text-white uppercase tracking-widest transition-colors border-r border-[#2e2e2e] pr-4"
                                    >
                                        <Clock size={12} />
                                        Last {timeRange} mins
                                        <ChevronDown size={10} className={`transition-transform ${showTimeMenu ? 'rotate-180' : ''}`} />
                                    </button>

                                    {showTimeMenu && (
                                        <div
                                            className="absolute right-0 mt-3 w-52 bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] z-[100] py-2 animate-in fade-in slide-in-from-top-2 duration-200"
                                            onClick={(e: any) => e.stopPropagation()}
                                        >
                                            {[60, 120, 160, 200].map((mins: any) => (
                                                <button
                                                    key={mins}
                                                    onClick={(e: any) => {
                                                        e.stopPropagation();
                                                        setTimeRange(mins);
                                                        setShowTimeMenu(false);
                                                        const timeFilter = `WHERE created_at > NOW() - INTERVAL '${mins} minutes'`;
                                                        if (query.toLowerCase().includes('where')) {
                                                            showToast(`Add "AND created_at > NOW() - INTERVAL '${mins} minutes'" to your query`, 'info');
                                                        } else if (query.toLowerCase().includes('from')) {
                                                            const parts = query.split(/LIMIT|GROUP BY|ORDER BY/i);
                                                            const base = parts[0].trim();
                                                            const suffix = query.substring(base.length);
                                                            setQuery(`${base} ${timeFilter} ${suffix.trim()};`.replace(/;;$/, ';'));
                                                            showToast(`Applied ${mins}m filter`, 'success');
                                                        }
                                                    }}
                                                    className={`w-full flex items-center justify-between px-4 py-2.5 text-[10px] font-black uppercase tracking-widest transition-all
                                                        ${timeRange === mins ? 'text-primary bg-primary/10' : 'text-zinc-500 hover:text-white hover:bg-zinc-800/50'}
                                                    `}
                                                >
                                                    <span>Last {mins} Minutes</span>
                                                    {timeRange === mins && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="relative">
                                <button
                                    onClick={(e: any) => {
                                        e.stopPropagation();
                                        setShowExportMenu(!showExportMenu);
                                    }}
                                    className="flex items-center gap-2 text-[9px] font-bold text-zinc-500 hover:text-white uppercase tracking-widest transition-colors"
                                >
                                    <Download size={12} />
                                    Export Data
                                    <ChevronDown size={10} className={`transition-transform ${showExportMenu ? 'rotate-180' : ''}`} />
                                </button>

                                {showExportMenu && (
                                    <div className="absolute right-0 mt-2 w-36 bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg shadow-xl z-50 py-1 animate-in fade-in slide-in-from-top-1 duration-200">
                                        <button
                                            onClick={() => initiateExport('csv')}
                                            className="w-full flex items-center gap-3 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                                        >
                                            <Table size={14} className="text-zinc-500" />
                                            CSV (Excel)
                                        </button>
                                        <button
                                            onClick={() => initiateExport('json')}
                                            className="w-full flex items-center gap-3 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                                        >
                                            <FileCode size={14} className="text-zinc-500" />
                                            JSON
                                        </button>
                                        <button
                                            onClick={() => initiateExport('txt')}
                                            className="w-full flex items-center gap-3 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                                        >
                                            <FileText size={14} className="text-zinc-500" />
                                            TXT (Tab)
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 overflow-auto custom-scrollbar">
                        <div className="min-w-full inline-block align-middle">
                            <div className="overflow-x-auto">
                                {loading ? (
                                    <div className="flex flex-col items-center justify-center h-full gap-4 py-20">
                                        <Loader2 className="animate-spin text-primary" size={24} />
                                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600 animate-pulse">Consulting the Oracle...</span>
                                    </div>
                                ) : error ? (
                                    <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center py-20">
                                        <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-500">
                                            <XCircle size={24} />
                                        </div>
                                        <div>
                                            <p className="text-[10px] font-black text-red-500 uppercase tracking-widest mb-1">Syntax Error or Connection Failure</p>
                                            <p className="text-xs text-zinc-500 font-mono tracking-tight">{error}</p>
                                        </div>
                                    </div>
                                ) : activeTab === 'results' && results ? (
                                    <table className="min-w-full text-left border-collapse table-auto">
                                        <thead className="sticky top-0 bg-[#0c0c0c] z-10 border-b border-[#2e2e2e]">
                                            <tr>
                                                <th className="w-10 px-6 py-3 border-r border-[#2e2e2e]/30">
                                                    <input
                                                        type="checkbox"
                                                        className="w-3.5 h-3.5 rounded border-zinc-700 bg-zinc-900 checked:bg-primary checked:border-primary focus:ring-0 transition-all cursor-pointer accent-primary"
                                                        checked={results.rows.length > 0 && selectedRows.size === results.rows.length}
                                                        onChange={toggleAllRows}
                                                    />
                                                </th>
                                                {results.columns?.map((col: any) => (
                                                    <th key={col} className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-zinc-500 border-r border-[#2e2e2e]/30 whitespace-nowrap">
                                                        {col}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-[#2e2e2e]/50">
                                            {results.rows?.map((row: any, i: any) => (
                                                <tr
                                                    key={i}
                                                    className={`transition-colors cursor-pointer ${selectedRows.has(i) ? 'bg-primary/5' : 'hover:bg-zinc-900'}`}
                                                    onClick={() => toggleRow(i)}
                                                >
                                                    <td className="w-10 px-6 py-3 border-r border-[#2e2e2e]/30" onClick={(e: any) => e.stopPropagation()}>
                                                        <input
                                                            type="checkbox"
                                                            className="w-3.5 h-3.5 rounded border-zinc-700 bg-zinc-900 checked:bg-primary checked:border-primary focus:ring-0 transition-all cursor-pointer accent-primary"
                                                            checked={selectedRows.has(i)}
                                                            onChange={() => toggleRow(i)}
                                                        />
                                                    </td>
                                                    {row.map((val: any, cellIdx: any) => (
                                                        <td key={cellIdx} className="px-6 py-3 text-xs font-mono text-zinc-400 border-r border-[#2e2e2e]/30 whitespace-nowrap max-w-[400px] overflow-hidden text-ellipsis">
                                                            {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                ) : activeTab === 'explain' && explainData ? (
                                    <div className="p-6 font-mono text-xs text-zinc-400 leading-relaxed max-w-4xl mx-auto">
                                        <div className="flex items-center gap-3 mb-6 p-4 bg-primary/5 border border-primary/20 rounded-xl">
                                            <Zap size={20} className="text-primary" />
                                            <div>
                                                <h3 className="text-sm font-black text-white uppercase tracking-widest">Query Execution Plan</h3>
                                                <p className="text-[10px] text-zinc-500">PostgreSQL Cost Analysis & Node Optimization</p>
                                            </div>
                                        </div>
                                        <pre className="whitespace-pre-wrap bg-[#0c0c0c] p-6 rounded-xl border border-[#2e2e2e] shadow-2xl">
                                            {JSON.stringify(explainData, null, 2)}
                                        </pre>
                                    </div>
                                ) : activeTab === 'visualize' && results ? (
                                    <div className="p-8 max-w-5xl mx-auto flex flex-col gap-6">
                                        <div>
                                            <h3 className="text-sm font-black text-white uppercase tracking-widest mb-1">Data Visualization</h3>
                                            <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Results distribution and time series analysis</p>
                                        </div>
                                        <BarChart
                                            data={results.rows}
                                            columns={results.columns}
                                        />
                                    </div>
                                ) : activeTab === 'visualize' ? (
                                    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
                                        <div className="w-16 h-16 rounded-3xl bg-primary/10 flex items-center justify-center text-primary mb-2">
                                            <Activity size={32} />
                                        </div>
                                        <h3 className="text-sm font-black text-white uppercase tracking-widest">Chart Visualization</h3>
                                        <p className="text-[10px] text-zinc-500 max-w-xs leading-relaxed uppercase tracking-widest">Run a query that returns numeric data to generate a visual representation.</p>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-full gap-2 py-20">
                                        <Play size={24} className="text-zinc-800" />
                                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600">Run a query to see results</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Floating Multi-action Bar */}
                    {selectedRows.size > 0 && (
                        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-[#111111] border border-primary/20 rounded-full px-6 py-3 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.5)] flex items-center gap-6 animate-in fade-in slide-in-from-bottom-4 duration-300 z-50">
                            <span className="text-[10px] font-black uppercase tracking-widest text-primary border-r border-zinc-800 pr-6 mr-2">
                                {selectedRows.size} Rows Selected
                            </span>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => copySelected('txt')}
                                    className="flex items-center gap-2 px-4 py-1.5 bg-primary text-black rounded-full text-[9px] font-black uppercase tracking-widest hover:bg-[#E6E600] active:scale-95 transition-all"
                                >
                                    <Copy size={12} />
                                    Copy Selected
                                </button>
                                <button
                                    onClick={handleClearSelection}
                                    className="px-4 py-1.5 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-600 rounded-full text-[9px] font-black uppercase tracking-widest transition-all"
                                >
                                    Clear
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Toast Notification */}
                    {toast && (
                        <div className="absolute top-4 right-4 z-[100] animate-in fade-in slide-in-from-right-4 duration-300">
                            <div className={`px-4 py-2 rounded-lg border shadow-lg flex items-center gap-3 ${toast.type === 'success'
                                ? 'bg-green-500/10 border-green-500/20 text-green-500'
                                : 'bg-primary/10 border-primary/20 text-primary'
                                }`}>
                                {toast.type === 'success' ? <CheckCircle2 size={14} /> : <Sparkles size={14} />}
                                <span className="text-[10px] font-black uppercase tracking-widest">{toast.message}</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Professional Modals */}
            {isSaveModalOpen && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 animate-in fade-in duration-300">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsSaveModalOpen(false)} />
                    <div className="relative w-full max-w-md bg-[#111111] border border-[#2e2e2e] rounded-2xl shadow-2xl p-6 animate-in zoom-in-95 duration-300">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                                <Save size={20} />
                            </div>
                            <div>
                                <h3 className="text-sm font-black text-white uppercase tracking-widest">Save Query</h3>
                                <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Store this query for later use</p>
                            </div>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-1.5 block">Query Name</label>
                                <input
                                    type="text"
                                    value={queryName}
                                    onChange={(e: any) => setQueryName(e.target.value)}
                                    placeholder="e.g., Get All Users"
                                    className="w-full bg-[#0c0c0c] border border-[#2e2e2e] rounded-lg px-4 py-2.5 text-xs text-white placeholder:text-zinc-800 focus:outline-none focus:border-primary/50 transition-all font-bold"
                                    autoFocus
                                />
                            </div>
                            <div className="flex items-center gap-3 pt-2">
                                <button
                                    onClick={() => setIsSaveModalOpen(false)}
                                    className="flex-1 px-4 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:bg-zinc-900 transition-all"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={confirmSaveQuery}
                                    disabled={!queryName.trim()}
                                    className="flex-1 px-4 py-2.5 bg-primary text-black rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-[#E6E600] active:scale-95 transition-all shadow-[0_0_20px_rgba(254,254,0,0.1)] disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Save Query
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {isExportConfirmOpen && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 animate-in fade-in duration-300">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsExportConfirmOpen(false)} />
                    <div className="relative w-full max-w-sm bg-[#111111] border border-[#2e2e2e] rounded-2xl shadow-2xl p-6 animate-in zoom-in-95 duration-300">
                        <div className="flex flex-col items-center text-center gap-4 py-4">
                            <div className="w-16 h-16 rounded-3xl bg-primary/10 flex items-center justify-center text-primary mb-2">
                                <Download size={32} />
                            </div>
                            <div>
                                <h3 className="text-sm font-black text-white uppercase tracking-widest mb-1">Export Data</h3>
                                <p className="text-[10px] text-zinc-500 uppercase tracking-widest leading-relaxed">
                                    You are about to download the results as <span className="text-primary font-black">.{exportFormat}</span>. Is that correct?
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 mt-4">
                            <button
                                onClick={() => setIsExportConfirmOpen(false)}
                                className="flex-1 px-4 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:bg-zinc-900 transition-all"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmExport}
                                className="flex-1 px-4 py-2.5 bg-primary text-black rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-[#E6E600] active:scale-95 transition-all shadow-[0_0_20px_rgba(254,254,0,0.1)]"
                            >
                                Confirm Export
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SqlTerminal;

