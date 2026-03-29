import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
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
    Settings,
    SlidersHorizontal,
    CheckSquare
} from 'lucide-react';

import AddRowModal from './AddRowModal';
import AddColumnModal from './AddColumnModal';
import ConfirmModal from './ConfirmModal';
import BulkEditModal from './BulkEditModal';
import InlineCellEditor from './InlineCellEditor';
import CSVImportModal from './CSVImportModal';
import { fetchWithAuth } from '../utils/api';

// --- Custom Hooks ---

function useDebounce(value: any, delay: any) {
    const [debouncedValue, setDebouncedValue] = useState(value);
    useEffect(() => {
        const handler = setTimeout(() => setDebouncedValue(value), delay);
        return () => clearTimeout(handler);
    }, [value, delay]);
    return debouncedValue;
}

// localStorage key for column widths
const getStorageKey = (tableName: any) => `ozybase_column_widths_${tableName}`;

// Default column widths by type
const getDefaultWidth = (colName: any, colType: any) => {
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
const DEFAULT_VIEWPORT_HEIGHT = 600;
const VIRTUAL_OVERSCAN_ROWS = 8;
const PAGE_SIZE_OPTIONS = [50, 100, 250, 500, 1000, 2000];
const FILTER_OPS = [
    { label: 'Equals', value: 'eq' },
    { label: 'Not equal', value: 'neq' },
    { label: 'Greater than', value: 'gt' },
    { label: 'Greater or equal', value: 'gte' },
    { label: 'Less than', value: 'lt' },
    { label: 'Less or equal', value: 'lte' },
    { label: 'Contains', value: 'ilike' }
];

// Dynamic minimum width based on header content
const calculateMinColumnWidth = (_columnName?: string) => {
    return 60;
};

const SkeletonRow = ({ columns, getColumnWidth, rowHeight }: any) => (
    <div className="flex border-b border-[#2e2e2e]/50" style={{ height: `${rowHeight}px` }}>
        <div className="w-10 px-4 flex items-center shrink-0">
            <div className="w-4 h-4 bg-zinc-800 rounded animate-pulse" />
        </div>
        {columns.map((col: any, i: any) => (
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

interface TableEditorProps {
    tableName: string | null;
    onTableSelect: (tableName: string) => void;
    allTables?: any[];
}

const TableEditor: React.FC<TableEditorProps> = ({ tableName, onTableSelect, allTables = [] }: any) => {
    const [data, setData] = useState<any[]>([]);
    const [schema, setSchema] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<any>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isColumnModalOpen, setIsColumnModalOpen] = useState(false);
    const [isInsertDropdownOpen, setIsInsertDropdownOpen] = useState(false);
    const [isTableSwitcherOpen, setIsTableSwitcherOpen] = useState(false);
    const [editingRow, setEditingRow] = useState<any>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearch = useDebounce(searchTerm, 500);
    const [confirmDeleteId, setConfirmDeleteId] = useState<any>(null);
    const [alertMessage, setAlertMessage] = useState<any>(null);
    const [realtimeEnabled, setRealtimeEnabled] = useState(false);
    const [isRealtimeLoading, setIsRealtimeLoading] = useState(false);
    const [filters, setFilters] = useState<any[]>([]);
    const [sorts, setSorts] = useState<any[]>([]);
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [isSortOpen, setIsSortOpen] = useState(false);
    const [views, setViews] = useState<any[]>([]);
    const [activeViewId, setActiveViewId] = useState<any>(null);
    const [viewName, setViewName] = useState('');
    const [isViewsOpen, setIsViewsOpen] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
    const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
    const [isCsvImportOpen, setIsCsvImportOpen] = useState(false);
    const [csvImport, setCsvImport] = useState<any>(null);

    // Pagination State
    const [pageSize, setPageSize] = useState(100);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalRecords, setTotalRecords] = useState(0);

    // --- NEW: Column Widths & Inline Editing State ---
    const [columnWidths, setColumnWidths] = useState<Record<string, any>>({});
    const [editingCell, setEditingCell] = useState<any>(null); // { rowId, colName }
    const [resizingColumn, setResizingColumn] = useState<any>(null);
    const resizeStartX = useRef(0);
    const resizeStartWidth = useRef(0);
    const columnWidthsRef = useRef<Record<string, any>>({});
    const selectAllRef = useRef<HTMLInputElement | null>(null);
    const csvInputRef = useRef<HTMLInputElement | null>(null);

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
    const saveColumnWidths = useCallback((widths: Record<string, any>) => {
        if (tableName) {
            localStorage.setItem(getStorageKey(tableName), JSON.stringify(widths));
        }
    }, [tableName]);

    const fetchRealtimeStatus = useCallback(async () => {
        if (!tableName) return;
        try {
            const res = await fetchWithAuth('/api/collections');
            const collections = await res.json();
            const current = collections.find((c: any) => c.name === tableName);
            if (current) setRealtimeEnabled(current.realtime_enabled);
        } catch (e) { console.error(e); }
    }, [tableName]);

    const applyView = useCallback((view: any) => {
        const config = view?.config || {};
        setFilters(Array.isArray(config.filters) ? config.filters : []);
        setSorts(Array.isArray(config.sorts) ? config.sorts : []);
        setSearchTerm(typeof config.searchTerm === 'string' ? config.searchTerm : '');
        setPageSize(Number.isFinite(config.pageSize) ? config.pageSize : 100);
        setCurrentPage(1);
        setActiveViewId(view?.id || null);
        setIsViewsOpen(false);
    }, []);

    const fetchViews = useCallback(async () => {
        if (!tableName) return;
        try {
            const res = await fetchWithAuth(`/api/tables/${tableName}/views`);
            if (!res.ok) return;
            const data = await res.json();
            const list = Array.isArray(data) ? data : [];
            setViews(list);
            const defaultView = list.find((v: any) => v.is_default);
            if (defaultView) {
                applyView(defaultView);
            } else if (activeViewId) {
                const stillExists = list.find((v: any) => v.id === activeViewId);
                if (!stillExists) setActiveViewId(null);
            }
        } catch (e) {
            console.error('Failed to fetch table views', e);
        }
    }, [tableName, activeViewId, applyView]);

    const currentViewConfig = useMemo(() => ({
        filters,
        sorts,
        searchTerm,
        pageSize
    }), [filters, sorts, searchTerm, pageSize]);

    const fetchData = useCallback(async () => {
        if (!tableName) return;
        setLoading(true);
        try {
            const offset = (currentPage - 1) * pageSize;
            const params = new URLSearchParams();
            params.set('limit', String(pageSize));
            params.set('offset', String(offset));
            if (debouncedSearch) params.set('q', debouncedSearch);

            const orderParam = sorts
                .filter((s: any) => s.column && s.direction)
                .map((s: any) => `${s.column}.${s.direction}`)
                .join(',');
            if (orderParam) params.set('order', orderParam);

            filters
                .filter((f: any) => f.column && f.value !== undefined && f.value !== '')
                .forEach((f: any) => {
                    params.append(f.column, `${f.op}.${f.value}`);
                });

            const [schemaRes, dataRes] = await Promise.all([
                fetchWithAuth(`/api/schema/${tableName}`),
                fetchWithAuth(`/api/tables/${tableName}?${params.toString()}`)
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
        } catch (err: any) {
            console.error(err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [tableName, currentPage, pageSize, debouncedSearch, filters, sorts]);

    useEffect(() => {
        if (tableName) {
            fetchData();
        }
    }, [tableName, fetchData]);

    useEffect(() => {
        if (tableName) {
            fetchRealtimeStatus();
        }
    }, [tableName, fetchRealtimeStatus]);

    useEffect(() => {
        if (tableName) {
            fetchViews();
            setEditingCell(null); // Clear editing state when table changes
        }
    }, [tableName, fetchViews]);

    const toggleRealtime = useCallback(async () => {
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
    }, [tableName, realtimeEnabled]);

    // --- Column Resize Handlers ---
    const handleResizeStart = useCallback((e: React.MouseEvent, colName: string) => {
        e.preventDefault();
        e.stopPropagation();
        setResizingColumn(colName);
        resizeStartX.current = e.clientX;
        resizeStartWidth.current = columnWidths[colName] || getDefaultWidth(colName, schema.find((c: any) => c.name === colName)?.type);
    }, [columnWidths, schema]);

    useEffect(() => {
        if (!resizingColumn) return;

        const handleResizeMove = (e: MouseEvent) => {
            const delta = e.clientX - resizeStartX.current;
            const minWidth = calculateMinColumnWidth(resizingColumn);
            const newWidth = Math.max(minWidth, Math.min(MAX_COLUMN_WIDTH, resizeStartWidth.current + delta));

            setColumnWidths((prev: any) => ({
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
    const containerRef = useRef<HTMLDivElement | null>(null);
    const ROW_HEIGHT = 45;
    const [viewportHeight, setViewportHeight] = useState(DEFAULT_VIEWPORT_HEIGHT);

    useEffect(() => {
        if (!containerRef.current) return undefined;

        const node = containerRef.current;
        const updateViewportHeight = () => {
            const nextHeight = node.clientHeight || DEFAULT_VIEWPORT_HEIGHT;
            setViewportHeight(Math.max(ROW_HEIGHT * 4, nextHeight));
        };

        updateViewportHeight();

        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', updateViewportHeight);
            return () => window.removeEventListener('resize', updateViewportHeight);
        }

        const observer = new ResizeObserver(updateViewportHeight);
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm]);

    useEffect(() => {
        if (!containerRef.current) return;
        containerRef.current.scrollTop = 0;
        setScrollTop(0);
    }, [tableName, currentPage, pageSize, debouncedSearch, filters, sorts]);

    useEffect(() => {
        setSelectedIds(new Set());
    }, [tableName, currentPage, pageSize, debouncedSearch, filters, sorts]);

    const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        setScrollTop(e.currentTarget.scrollTop);
    }, []);

    const visibleRowCount = Math.max(1, Math.ceil(viewportHeight / ROW_HEIGHT));
    const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - VIRTUAL_OVERSCAN_ROWS);
    const endIndex = Math.min(data.length, startIndex + visibleRowCount + (VIRTUAL_OVERSCAN_ROWS * 2));
    const visibleData = useMemo(() => data.slice(startIndex, endIndex), [data, startIndex, endIndex]);
    const topPadding = startIndex * ROW_HEIGHT;
    const bottomPadding = (data.length - endIndex) * ROW_HEIGHT;
    const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
    const pageStartRecord = totalRecords === 0 ? 0 : ((currentPage - 1) * pageSize) + 1;
    const pageEndRecord = totalRecords === 0 ? 0 : Math.min(currentPage * pageSize, totalRecords);
    const visibleIds = useMemo(() => visibleData.map((row: any) => String(row.id)), [visibleData]);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id: any) => selectedIds.has(id));
    const someVisibleSelected = visibleIds.some((id: any) => selectedIds.has(id));
    const selectedCount = selectedIds.size;

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);

    useEffect(() => {
        if (!selectAllRef.current) return;
        selectAllRef.current.indeterminate = !allVisibleSelected && someVisibleSelected;
    }, [allVisibleSelected, someVisibleSelected]);

    // --- Cell Editing Handlers ---
    const handleCellClick = useCallback((rowId: any, colName: any) => {
        // Don't allow editing id or created_at
        if (colName === 'id' || colName === 'created_at') return;
        setEditingCell({ rowId, colName });
    }, []);

    const handleCellSave = useCallback((rowId: any, colName: any, newValue: any) => {
        setData((prev: any) => prev.map((row: any) =>
            row.id === rowId ? { ...row, [colName]: newValue } : row
        ));
        setEditingCell(null);
    }, []);

    const handleCellCancel = useCallback(() => {
        setEditingCell(null);
    }, []);

    const normalizeHeader = useCallback((value: any) => {
        return String(value || '')
            .toLowerCase()
            .replace(/^\ufeff/, '')
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }, []);

    const buildInitialMapping = useCallback((headers: any, schemaColumns: any) => {
        const normalizedSchema = new Map();
        schemaColumns.forEach((col: any) => {
            normalizedSchema.set(normalizeHeader(col), col);
        });

        const mapping: Record<number, string> = {};
        headers.forEach((header: any) => {
            const normalized = normalizeHeader(header.raw || header.label);
            if (normalizedSchema.has(normalized)) {
                mapping[header.index] = normalizedSchema.get(normalized);
                return;
            }
            const alt = normalized.replace(/_/g, '');
            const fallback = [...normalizedSchema.entries()].find(([key]: any) => key.replace(/_/g, '') === alt);
            mapping[header.index] = fallback ? fallback[1] : '';
        });
        return mapping;
    }, [normalizeHeader]);

    const handleCSVImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event: ProgressEvent<FileReader>) => {
            const text = event.target?.result;
            if (typeof text !== 'string') return;
            const lines = text.split(/\r?\n/).filter((l: any) => l.trim());
            if (lines.length < 1) return;

            const detectDelimiter = (sampleLine: any) => {
                const candidates = [',', ';', '\t', '|'];
                const counts = candidates.map((delim: any) => {
                    let count = 0;
                    let inQuote = false;
                    for (let i = 0; i < sampleLine.length; i++) {
                        const char = sampleLine[i];
                        if (char === '"' && sampleLine[i + 1] === '"') { i++; continue; }
                        if (char === '"') { inQuote = !inQuote; continue; }
                        if (!inQuote && char === delim) count++;
                    }
                    return count;
                });
                let bestIndex = 0;
                counts.forEach((count: any, idx: any) => {
                    if (count > counts[bestIndex]) bestIndex = idx;
                });
                return counts[bestIndex] > 0 ? candidates[bestIndex] : ',';
            };

            const parseCsv = (rawLines: string[], delimiter: string, useHeaderRow: boolean, headerRowIndex: number) => {
                const splitLine = (line: string) => {
                    const result: string[] = [];
                    let cur = '';
                    let inQuote = false;
                    for (let i = 0; i < line.length; i++) {
                        const char = line[i];
                        if (char === '"' && line[i + 1] === '"') { cur += '"'; i++; }
                        else if (char === '"') { inQuote = !inQuote; }
                        else if (char === delimiter && !inQuote) { result.push(cur.trim()); cur = ''; }
                        else { cur += char; }
                    }
                    result.push(cur.trim());
                    return result;
                };

                const headerRow = Math.max(1, headerRowIndex || 1);
                const headerLine = useHeaderRow ? rawLines[headerRow - 1] || '' : '';
                const headerValues = useHeaderRow ? splitLine(headerLine) : [];
                const firstRowValues = useHeaderRow ? null : splitLine(rawLines[0]);
                const columnCount = Math.max(headerValues.length, firstRowValues?.length || 0);

                const rawHeaders = (useHeaderRow ? headerValues : Array.from({ length: columnCount }, (_: any, i: any) => `Column ${i + 1}`))
                    .map((header: any, index: any) => {
                        const label = header?.trim() || `Column ${index + 1}`;
                        return {
                            raw: header || '',
                            label,
                            index,
                            sampleValues: [] as string[]
                        };
                    });

                const parsedRows: string[][] = [];
                const startIndex = useHeaderRow ? headerRow : 0;
                for (let i = startIndex; i < rawLines.length; i++) {
                    const values = splitLine(rawLines[i]);
                    if (values.length === 1 && values[0] === '') continue;
                    parsedRows.push(values);
                    rawHeaders.forEach((header: any) => {
                        if (header.sampleValues.length < 3) {
                            const value = values[header.index];
                            if (value !== undefined && value !== '') {
                                header.sampleValues.push(value);
                            }
                        }
                    });
                }

                return { rawHeaders, parsedRows };
            };

            const detectedDelimiter = detectDelimiter(lines[0]);
            const useHeaderRow = true;
            const headerRowIndex = 1;
            const { rawHeaders, parsedRows } = parseCsv(lines, detectedDelimiter, useHeaderRow, headerRowIndex);

            const editableColumns = schema
                .map((col: any) => col.name)
                .filter((col: any) => col !== 'id' && col !== 'created_at');

            setCsvImport({
                fileName: file.name,
                lines,
                delimiter: 'auto',
                detectedDelimiter,
                useHeaderRow,
                headerRowIndex,
                headers: rawHeaders,
                rows: parsedRows,
                totalRows: parsedRows.length,
                columns: editableColumns,
                initialMapping: buildInitialMapping(rawHeaders, editableColumns)
            });
            setIsCsvImportOpen(true);
            setIsInsertDropdownOpen(false);
            if (csvInputRef.current) {
                csvInputRef.current.value = '';
            }
        };
        reader.readAsText(file);
    }, [schema, buildInitialMapping]);

    const updateCsvImport = useCallback((nextDelimiter: string, nextUseHeaderRow: boolean, nextHeaderRowIndex: number) => {
        setCsvImport((prev: any) => {
            if (!prev) return prev;
            const effectiveDelimiter = nextDelimiter === 'auto' ? (prev.detectedDelimiter || ',') : nextDelimiter;

            const splitLine = (line: string) => {
                const result: string[] = [];
                let cur = '';
                let inQuote = false;
                for (let i = 0; i < line.length; i++) {
                    const char = line[i];
                    if (char === '"' && line[i + 1] === '"') { cur += '"'; i++; }
                    else if (char === '"') { inQuote = !inQuote; }
                    else if (char === effectiveDelimiter && !inQuote) { result.push(cur.trim()); cur = ''; }
                    else { cur += char; }
                }
                result.push(cur.trim());
                return result;
            };

            const headerRow = Math.max(1, nextHeaderRowIndex || 1);
            const headerLine = nextUseHeaderRow ? prev.lines[headerRow - 1] || '' : '';
            const headerValues = nextUseHeaderRow ? splitLine(headerLine) : [];
            const firstRowValues = nextUseHeaderRow ? null : splitLine(prev.lines[0]);
            const columnCount = Math.max(headerValues.length, firstRowValues?.length || 0);

            const rawHeaders = (nextUseHeaderRow ? headerValues : Array.from({ length: columnCount }, (_: any, i: any) => `Column ${i + 1}`))
                .map((header: any, index: any) => {
                    const label = header?.trim() || `Column ${index + 1}`;
                    return {
                        raw: header || '',
                        label,
                        index,
                        sampleValues: [] as string[]
                    };
                });

            const parsedRows: string[][] = [];
            const startIndex = nextUseHeaderRow ? headerRow : 0;
            for (let i = startIndex; i < prev.lines.length; i++) {
                const values = splitLine(prev.lines[i]);
                if (values.length === 1 && values[0] === '') continue;
                parsedRows.push(values);
                rawHeaders.forEach((header: any) => {
                    if (header.sampleValues.length < 3) {
                        const value = values[header.index];
                        if (value !== undefined && value !== '') {
                            header.sampleValues.push(value);
                        }
                    }
                });
            }

            return {
                ...prev,
                delimiter: nextDelimiter,
                useHeaderRow: nextUseHeaderRow,
                headerRowIndex: headerRow,
                headers: rawHeaders,
                rows: parsedRows,
                totalRows: parsedRows.length,
                initialMapping: buildInitialMapping(rawHeaders, prev.columns)
            };
        });
    }, [buildInitialMapping]);

    const handleCSVImportConfirm = useCallback(async (mapping: Record<number, string>) => {
        if (!csvImport) return;
        const { headers, rows } = csvImport;

        const records = rows.map((values: any) => {
            const record: Record<string, any> = {};
            headers.forEach((header: any) => {
                const target = mapping[header.index];
                if (!target) return;
                const val = values[header.index];
                if (val !== undefined && val !== '') {
                    record[target] = val;
                }
            });
            return record;
        }).filter((record: any) => Object.keys(record).length > 0);

        if (records.length === 0) {
            setAlertMessage({ title: 'Import Failed', message: 'No valid columns mapped for import.', type: 'danger' });
            return;
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
                setIsCsvImportOpen(false);
                setCsvImport(null);
            } else {
                const err = await res.json();
                setAlertMessage({ title: 'Import Failed', message: err.error || 'Import failed', type: 'danger' });
            }
        } catch {
            setAlertMessage({ title: 'Error', message: 'Import failed due to network error', type: 'danger' });
        } finally {
            setLoading(false);
        }
    }, [csvImport, tableName, fetchData]);

    const handleDeleteRow = useCallback((id: string | number) => {
        setConfirmDeleteId(id);
    }, []);

    const toggleSelectRow = useCallback((id: string | number) => {
        const rowId = String(id);
        setSelectedIds((prev) => {
            const next = new Set<string>(prev);
            if (next.has(rowId)) {
                next.delete(rowId);
            } else {
                next.add(rowId);
            }
            return next;
        });
    }, []);

    const toggleSelectAllVisible = useCallback(() => {
        setSelectedIds((prev) => {
            const next = new Set<string>(prev);
            if (allVisibleSelected) {
                visibleIds.forEach((id: any) => next.delete(id));
            } else {
                visibleIds.forEach((id: any) => next.add(id));
            }
            return next;
        });
    }, [allVisibleSelected, visibleIds]);

    const confirmRowDeletion = useCallback(async () => {
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
        } catch (err: any) {
            console.error(err);
            setAlertMessage({ title: 'Error', message: 'Network error during deletion', type: 'danger' });
        }
    }, [confirmDeleteId, tableName, fetchData]);

    const handleExportCSV = useCallback(() => {
        if (data.length === 0) return;

        const headers = ['id', ...schema.map((c: any) => c.name), 'created_at'];
        const csvRows = [
            headers.join(','),
            ...data.map((row: any) => headers.map((h: any) => {
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
    }, [data, schema, tableName]);

    const handleExportSelected = useCallback(() => {
        if (selectedIds.size === 0) return;
        const headers = ['id', ...schema.map((c: any) => c.name), 'created_at'];
        const selectedRows = data.filter((row: any) => selectedIds.has(String(row.id)));
        const csvRows = [
            headers.join(','),
            ...selectedRows.map((row: any) => headers.map((h: any) => {
                const val = row[h];
                return typeof val === 'string' ? `"${val.replace(/"/g, '""')}"` : val;
            }).join(','))
        ];
        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${tableName}_selected_export.csv`;
        a.click();
    }, [data, schema, tableName, selectedIds]);

    const handleBulkDelete = useCallback(async () => {
        if (selectedIds.size === 0) return;
        try {
            const res = await fetchWithAuth(`/api/tables/${tableName}/rows/bulk`, {
                method: 'POST',
                body: JSON.stringify({
                    action: 'delete',
                    ids: Array.from(selectedIds)
                })
            });
            if (res.ok) {
                setSelectedIds(new Set());
                setIsBulkDeleteOpen(false);
                fetchData();
            } else {
                setAlertMessage({ title: 'Bulk Delete Failed', message: 'Could not delete selected rows.', type: 'danger' });
            }
        } catch (err: any) {
            console.error(err);
            setAlertMessage({ title: 'Bulk Delete Failed', message: 'Network error during bulk delete.', type: 'danger' });
        }
    }, [selectedIds, tableName, fetchData]);

    const handleBulkUpdate = useCallback(async (payload: Record<string, any>) => {
        try {
            const res = await fetchWithAuth(`/api/tables/${tableName}/rows/bulk`, {
                method: 'POST',
                body: JSON.stringify({
                    action: 'update',
                    ids: Array.from(selectedIds),
                    data: payload
                })
            });
            if (res.ok) {
                setSelectedIds(new Set());
                setIsBulkEditOpen(false);
                fetchData();
            } else {
                setAlertMessage({ title: 'Bulk Update Failed', message: 'Could not update selected rows.', type: 'danger' });
            }
        } catch (err: any) {
            console.error(err);
            setAlertMessage({ title: 'Bulk Update Failed', message: 'Network error during bulk update.', type: 'danger' });
        }
    }, [selectedIds, tableName, fetchData]);

    const handleEditRow = useCallback((row: Record<string, any>) => {
        setEditingRow(row);
        setIsModalOpen(true);
    }, []);

    const getTypeIcon = useCallback((type: string) => {
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
    }, []);

    const standardColumns = useMemo(() => [
        { name: 'id', type: 'uuid' },
        ...schema,
        { name: 'created_at', type: 'datetime' }
    ], [schema]);

    // Get column width with fallback to default
    const getColumnWidth = useCallback((colName: string, colType: string) => {
        return columnWidths[colName] || getDefaultWidth(colName, colType);
    }, [columnWidths]);

    // Calculate total table width
    const totalWidth = useMemo(() => 
        standardColumns.reduce((acc: any, col: any) => acc + getColumnWidth(col.name, col.type), 0) + 40 + 80, 
    [standardColumns, getColumnWidth]);

    const currentTableMeta = useMemo(
        () => allTables.find((t: any) => t.name === tableName),
        [allTables, tableName]
    );
    const currentTableLabel = currentTableMeta?.display_name || tableName;

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
                            <span className="text-[11px] font-bold text-white group-hover:text-primary transition-colors">{currentTableLabel}</span>
                            <ChevronDown size={14} className={`text-zinc-600 transition-transform ${isTableSwitcherOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {isTableSwitcherOpen && (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setIsTableSwitcherOpen(false)} />
                                <div className="absolute top-full left-0 mt-2 z-50 w-64 overflow-hidden ozy-floating-panel">
                                    <div className="max-h-80 overflow-y-auto custom-scrollbar p-1.5 space-y-4">
                                        <div>
                                            <p className="px-3 py-1 text-[9px] font-black text-zinc-600 uppercase tracking-widest">User Tables</p>
                                            {allTables.filter((t: any) => !t.is_system).map((t: any) => (
                                                <button
                                                    key={t.name}
                                                    onClick={() => {
                                                        onTableSelect(t.name);
                                                        setIsTableSwitcherOpen(false);
                                                    }}
                                                    className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-3 ${tableName === t.name ? 'bg-primary/10 text-primary font-bold' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}
                                                >
                                                    <Database size={12} className={tableName === t.name ? 'text-primary' : 'text-zinc-600'} />
                                                    <span className="truncate">{t.display_name || t.name}</span>
                                                </button>
                                            ))}
                                        </div>
                                        {allTables.some((t: any) => t.is_system) && (
                                            <div>
                                                <p className="px-3 py-1 text-[9px] font-black text-zinc-600 uppercase tracking-widest">System Tables</p>
                                                {allTables.filter((t: any) => t.is_system).map((t: any) => (
                                                    <button
                                                        key={t.name}
                                                        onClick={() => {
                                                            onTableSelect(t.name);
                                                            setIsTableSwitcherOpen(false);
                                                        }}
                                                        className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-3 font-mono opacity-80 ${tableName === t.name ? 'bg-primary/10 text-primary font-bold' : 'text-zinc-500 hover:bg-zinc-800 hover:text-white'}`}
                                                    >
                                                        <Lock size={12} className={tableName === t.name ? 'text-primary' : 'text-zinc-700'} />
                                                        <span className="truncate">{t.display_name || t.name}</span>
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
                            onClick={() => setIsViewsOpen(!isViewsOpen)}
                            className="flex items-center gap-2 px-3 py-1.5 bg-[#111111] border border-[#2e2e2e] rounded-lg hover:border-zinc-500 transition-all text-[10px] font-black uppercase tracking-widest text-zinc-300 shrink-0"
                        >
                            <SlidersHorizontal size={14} />
                            Views
                            <ChevronDown size={14} className={`transition-transform ${isViewsOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {isViewsOpen && (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setIsViewsOpen(false)} />
                                <div className="absolute top-full left-0 mt-2 z-50 w-80 overflow-hidden ozy-floating-panel">
                                    <div className="p-3 space-y-3">
                                        <div className="space-y-2">
                                            <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Saved Views</p>
                                            <div className="max-h-40 overflow-y-auto custom-scrollbar space-y-1">
                                                {views.length === 0 && (
                                                    <div className="text-[10px] text-zinc-600 px-2 py-2 border border-dashed border-zinc-800 rounded-lg">
                                                        No saved views yet.
                                                    </div>
                                                )}
                                                {views.map((view: any) => (
                                                    <button
                                                        key={view.id}
                                                        onClick={() => applyView(view)}
                                                        className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center justify-between ${activeViewId === view.id ? 'bg-primary/10 text-primary font-bold' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}
                                                    >
                                                        <span className="truncate">{view.name}</span>
                                                        {view.is_default && <span className="text-[9px] font-black uppercase tracking-widest">default</span>}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="h-[1px] bg-[#2e2e2e]" />

                                        <div className="space-y-2">
                                            <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Save Current</p>
                                            <div className="flex gap-2">
                                                <input
                                                    value={viewName}
                                                    onChange={(e: any) => setViewName(e.target.value)}
                                                    placeholder="View name"
                                                    className="flex-1 bg-[#111111] border border-[#2e2e2e] rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-primary/50"
                                                />
                                                <button
                                                    onClick={async () => {
                                                        if (!viewName.trim()) return;
                                                        const res = await fetchWithAuth(`/api/tables/${tableName}/views`, {
                                                            method: 'POST',
                                                            body: JSON.stringify({ name: viewName.trim(), config: currentViewConfig })
                                                        });
                                                        if (res.ok) {
                                                            setViewName('');
                                                            fetchViews();
                                                        }
                                                    }}
                                                    className="px-3 py-2 bg-primary text-black rounded-lg text-[10px] font-black uppercase tracking-widest"
                                                >
                                                    Save
                                                </button>
                                            </div>
                                            {activeViewId && (
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={async () => {
                                                            const res = await fetchWithAuth(`/api/tables/${tableName}/views/${activeViewId}`, {
                                                                method: 'PATCH',
                                                                body: JSON.stringify({ config: currentViewConfig })
                                                            });
                                                            if (res.ok) fetchViews();
                                                        }}
                                                        className="flex-1 px-3 py-2 bg-[#111111] border border-[#2e2e2e] rounded-lg text-[10px] font-black uppercase tracking-widest text-zinc-300"
                                                    >
                                                        Update
                                                    </button>
                                                    <button
                                                        onClick={async () => {
                                                            const res = await fetchWithAuth(`/api/tables/${tableName}/views/${activeViewId}`, {
                                                                method: 'PATCH',
                                                                body: JSON.stringify({ is_default: true })
                                                            });
                                                            if (res.ok) fetchViews();
                                                        }}
                                                        className="flex-1 px-3 py-2 bg-[#111111] border border-[#2e2e2e] rounded-lg text-[10px] font-black uppercase tracking-widest text-zinc-300"
                                                    >
                                                        Set Default
                                                    </button>
                                                    <button
                                                        onClick={async () => {
                                                            const res = await fetchWithAuth(`/api/tables/${tableName}/views/${activeViewId}`, {
                                                                method: 'DELETE'
                                                            });
                                                            if (res.ok) {
                                                                setActiveViewId(null);
                                                                fetchViews();
                                                            }
                                                        }}
                                                        className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-[10px] font-black uppercase tracking-widest text-red-400"
                                                    >
                                                        Delete
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        <div className="h-[1px] bg-[#2e2e2e]" />
                                        <button
                                            onClick={() => {
                                                setFilters([]);
                                                setSorts([]);
                                                setSearchTerm('');
                                                setPageSize(100);
                                                setActiveViewId(null);
                                            }}
                                            className="w-full px-3 py-2 bg-[#111111] border border-[#2e2e2e] rounded-lg text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-zinc-200"
                                        >
                                            Reset View
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

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
                                <div className="absolute top-full left-0 mt-2 z-50 w-56 overflow-hidden ozy-floating-panel">
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
                                                ref={csvInputRef}
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
                    <button
                        onClick={() => setIsFilterOpen(!isFilterOpen)}
                        className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800/50 rounded-md transition-colors text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-zinc-200 shrink-0"
                    >
                        <Filter size={14} />
                        Filter
                    </button>
                    <button
                        onClick={() => setIsSortOpen(!isSortOpen)}
                        className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800/50 rounded-md transition-colors text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-zinc-200 shrink-0"
                    >
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
                            onChange={(e: any) => setSearchTerm(e.target.value)}
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

            {/* Filter Panel */}
            {isFilterOpen && (
                <div className="border-b border-[#2e2e2e] bg-[#111111] px-6 py-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Filters</p>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setFilters((prev: any) => [...prev, { id: Date.now(), column: '', op: 'eq', value: '' }])}
                                className="px-2 py-1 bg-[#1a1a1a] border border-[#2e2e2e] rounded text-[10px] font-black uppercase tracking-widest text-zinc-400"
                            >
                                Add Filter
                            </button>
                            <button
                                onClick={() => setFilters([])}
                                className="px-2 py-1 bg-[#1a1a1a] border border-[#2e2e2e] rounded text-[10px] font-black uppercase tracking-widest text-zinc-400"
                            >
                                Clear
                            </button>
                        </div>
                    </div>
                    {filters.length === 0 && (
                        <div className="text-[10px] text-zinc-600">No filters applied.</div>
                    )}
                    {filters.map((f: any, idx: any) => (
                        <div key={f.id} className="grid grid-cols-[1fr_140px_1fr_28px] gap-2 items-center">
                            <select
                                value={f.column}
                                onChange={(e: any) => {
                                    const value = e.target.value;
                                    setFilters((prev: any) => prev.map((item: any) => item.id === f.id ? { ...item, column: value } : item));
                                }}
                                className="bg-[#0c0c0c] border border-[#2e2e2e] rounded-lg px-3 py-2 text-xs text-zinc-200"
                            >
                                <option value="">Select column</option>
                                {schema.map((col: any) => (
                                    <option key={col.name} value={col.name}>{col.name}</option>
                                ))}
                            </select>
                            <select
                                value={f.op}
                                onChange={(e: any) => {
                                    const value = e.target.value;
                                    setFilters((prev: any) => prev.map((item: any) => item.id === f.id ? { ...item, op: value } : item));
                                }}
                                className="bg-[#0c0c0c] border border-[#2e2e2e] rounded-lg px-3 py-2 text-xs text-zinc-200"
                            >
                                {FILTER_OPS.map((op: any) => (
                                    <option key={op.value} value={op.value}>{op.label}</option>
                                ))}
                            </select>
                            <input
                                value={f.value}
                                onChange={(e: any) => {
                                    const value = e.target.value;
                                    setFilters((prev: any) => prev.map((item: any) => item.id === f.id ? { ...item, value } : item));
                                }}
                                placeholder="Value"
                                className="bg-[#0c0c0c] border border-[#2e2e2e] rounded-lg px-3 py-2 text-xs text-zinc-200"
                            />
                            <button
                                onClick={() => setFilters((prev: any) => prev.filter((item: any) => item.id !== f.id))}
                                className="text-zinc-600 hover:text-red-400"
                                aria-label={`Remove filter ${idx + 1}`}
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Sort Panel */}
            {isSortOpen && (
                <div className="border-b border-[#2e2e2e] bg-[#111111] px-6 py-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Sort</p>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setSorts((prev: any) => [...prev, { id: Date.now(), column: '', direction: 'asc' }])}
                                className="px-2 py-1 bg-[#1a1a1a] border border-[#2e2e2e] rounded text-[10px] font-black uppercase tracking-widest text-zinc-400"
                            >
                                Add Sort
                            </button>
                            <button
                                onClick={() => setSorts([])}
                                className="px-2 py-1 bg-[#1a1a1a] border border-[#2e2e2e] rounded text-[10px] font-black uppercase tracking-widest text-zinc-400"
                            >
                                Clear
                            </button>
                        </div>
                    </div>
                    {sorts.length === 0 && (
                        <div className="text-[10px] text-zinc-600">No sorting applied.</div>
                    )}
                    {sorts.map((s: any) => (
                        <div key={s.id} className="grid grid-cols-[1fr_140px_28px] gap-2 items-center">
                            <select
                                value={s.column}
                                onChange={(e: any) => {
                                    const value = e.target.value;
                                    setSorts((prev: any) => prev.map((item: any) => item.id === s.id ? { ...item, column: value } : item));
                                }}
                                className="bg-[#0c0c0c] border border-[#2e2e2e] rounded-lg px-3 py-2 text-xs text-zinc-200"
                            >
                                <option value="">Select column</option>
                                {schema.map((col: any) => (
                                    <option key={col.name} value={col.name}>{col.name}</option>
                                ))}
                            </select>
                            <select
                                value={s.direction}
                                onChange={(e: any) => {
                                    const value = e.target.value;
                                    setSorts((prev: any) => prev.map((item: any) => item.id === s.id ? { ...item, direction: value } : item));
                                }}
                                className="bg-[#0c0c0c] border border-[#2e2e2e] rounded-lg px-3 py-2 text-xs text-zinc-200"
                            >
                                <option value="asc">Ascending</option>
                                <option value="desc">Descending</option>
                            </select>
                            <button
                                onClick={() => setSorts((prev: any) => prev.filter((item: any) => item.id !== s.id))}
                                className="text-zinc-600 hover:text-red-400"
                                aria-label="Remove sort"
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Bulk Actions */}
            {selectedCount > 0 && (
                <div className="border-b border-[#2e2e2e] bg-[#0f0f0f] px-6 py-3 flex items-center justify-between text-[10px] font-black uppercase tracking-widest">
                    <div className="flex items-center gap-3 text-zinc-400">
                        <CheckSquare size={14} className="text-primary" />
                        <span>{selectedCount} selected</span>
                        <span className="text-zinc-600">Selection is limited to the current page.</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setSelectedIds(new Set())}
                            className="px-3 py-1.5 bg-[#111111] border border-[#2e2e2e] rounded text-zinc-400"
                        >
                            Clear
                        </button>
                        <button
                            onClick={() => setIsBulkEditOpen(true)}
                            className="px-3 py-1.5 bg-[#111111] border border-[#2e2e2e] rounded text-zinc-300"
                        >
                            Bulk Edit
                        </button>
                        <button
                            onClick={() => setIsBulkDeleteOpen(true)}
                            className="px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded text-red-400"
                        >
                            Delete
                        </button>
                        <button
                            onClick={handleExportSelected}
                            className="px-3 py-1.5 bg-[#111111] border border-[#2e2e2e] rounded text-zinc-300"
                        >
                            Export
                        </button>
                    </div>
                </div>
            )}

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
                            <input
                                ref={selectAllRef}
                                type="checkbox"
                                checked={allVisibleSelected}
                                onChange={toggleSelectAllVisible}
                                className="rounded border-border bg-transparent accent-primary"
                            />
                        </div>

                        {/* Dynamic columns */}
                        {standardColumns.map((col: any) => {
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
                                        onMouseDown={(e: any) => handleResizeStart(e, col.name)}
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
                                {[...Array(10)].map((_: any, i: any) => (
                                    <SkeletonRow
                                        key={i}
                                        columns={standardColumns}
                                        getColumnWidth={getColumnWidth}
                                        rowHeight={ROW_HEIGHT}
                                    />
                                ))}
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

                                {visibleData.map((row: any) => {
                                    const isEditing = editingCell?.rowId === row.id;

                                    return (
                                        <div
                                            key={row.id}
                                            className="flex hover:bg-zinc-900/30 transition-colors group border-b border-[#2e2e2e]/30"
                                            style={{ height: `${ROW_HEIGHT}px` }}
                                        >
                                            {/* Checkbox */}
                                            <div className="w-10 px-4 flex items-center shrink-0">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.has(String(row.id))}
                                                    onChange={() => toggleSelectRow(row.id)}
                                                    className="rounded border-border bg-transparent accent-primary"
                                                />
                                            </div>

                                            {/* Data cells */}
                                            {standardColumns.map((col: any) => {
                                                const val = row[col.name];
                                                const width = getColumnWidth(col.name, col.type);
                                                const isCellEditing = isEditing && editingCell?.colName === col.name;
                                                const isEditable = col.name !== 'id' && col.name !== 'created_at';

                                                return (
                                                    <div
                                                        key={col.name}
                                                        onClick={() => isEditable && handleCellClick(row.id, col.name)}
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
                                                            tableName={tableName || ''}
                                                            isEditing={isCellEditing}
                                                            onSave={(newVal: any) => handleCellSave(row.id, col.name, newVal)}
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
                            {PAGE_SIZE_OPTIONS.map((size: any) => (
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
                            <span className="text-zinc-600">
                                SHOWING <span className="text-zinc-300">{pageStartRecord}-{pageEndRecord}</span>
                            </span>
                            <button
                                disabled={currentPage === 1}
                                onClick={() => setCurrentPage((prev: any) => Math.max(1, prev - 1))}
                                className="p-1 hover:text-primary disabled:opacity-30 transition-colors"
                            >
                                <ChevronLeft size={14} />
                            </button>
                            <span className="text-zinc-500 flex items-center gap-2">
                                PAGE <span className="text-primary">{currentPage}</span> OF {totalPages}
                            </span>
                            <button
                                disabled={currentPage >= totalPages}
                                onClick={() => setCurrentPage((prev: any) => prev + 1)}
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
                tableName={tableName || ''}
                initialData={editingRow}
                onRecordAdded={fetchData}
            />

            <AddColumnModal
                isOpen={isColumnModalOpen}
                onClose={() => setIsColumnModalOpen(false)}
                tableName={tableName || ''}
                onColumnAdded={fetchData}
            />

            <BulkEditModal
                isOpen={isBulkEditOpen}
                onClose={() => setIsBulkEditOpen(false)}
                schema={schema}
                onSubmit={handleBulkUpdate}
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
                isOpen={isBulkDeleteOpen}
                onClose={() => setIsBulkDeleteOpen(false)}
                onConfirm={handleBulkDelete}
                title="Delete Selected Records"
                message="Delete all selected records? This action cannot be undone."
                confirmText="Delete Records"
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

            <CSVImportModal
                key={`${csvImport?.fileName || 'csv'}-${csvImport?.delimiter || 'auto'}-${csvImport?.headerRowIndex || 1}-${csvImport?.useHeaderRow ? 'h1' : 'h0'}`}
                isOpen={isCsvImportOpen}
                onClose={() => { setIsCsvImportOpen(false); setCsvImport(null); }}
                fileName={csvImport?.fileName}
                headers={csvImport?.headers || []}
                sampleRows={(csvImport?.rows || []).slice(0, 10)}
                totalRows={csvImport?.totalRows || 0}
                columnOptions={csvImport?.columns || []}
                initialMapping={csvImport?.initialMapping || {}}
                delimiter={csvImport?.delimiter}
                detectedDelimiter={csvImport?.detectedDelimiter}
                useHeaderRow={csvImport?.useHeaderRow}
                headerRowIndex={csvImport?.headerRowIndex}
                onDelimiterChange={(value: any) => updateCsvImport(value, csvImport?.useHeaderRow ?? true, csvImport?.headerRowIndex ?? 1)}
                onHeaderToggle={(value: any) => updateCsvImport(csvImport?.delimiter || 'auto', value, csvImport?.headerRowIndex ?? 1)}
                onHeaderRowChange={(value: any) => updateCsvImport(csvImport?.delimiter || 'auto', csvImport?.useHeaderRow ?? true, value)}
                onConfirm={handleCSVImportConfirm}
            />
        </div>
    );
};

export default TableEditor;

