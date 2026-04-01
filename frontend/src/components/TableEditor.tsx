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
    SlidersHorizontal,
    CheckSquare
} from 'lucide-react';

import AddRowModal from './AddRowModal';
import AddColumnModal from './AddColumnModal';
import ConfirmModal from './ConfirmModal';
import BulkEditModal from './BulkEditModal';
import InlineCellEditor from './InlineCellEditor';
import CSVImportModal from './CSVImportModal';
import TableEditorFooter from './table-editor/TableEditorFooter';
import TableEditorStateBar from './table-editor/TableEditorStateBar';
import TableEditorToolbar from './table-editor/TableEditorToolbar';
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
const getHiddenColumnsStorageKey = (tableName: any) => `ozybase_hidden_columns_${tableName}`;
const getPinnedColumnsStorageKey = (tableName: any) => `ozybase_pinned_columns_${tableName}`;

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
const CHECKBOX_COLUMN_WIDTH = 40;
const ACTIONS_COLUMN_WIDTH = 80;
const TABLE_DENSITY_STORAGE_KEY = 'ozybase_table_density';
const ROW_DENSITY_OPTIONS: Record<string, { label: string; rowHeight: number }> = {
    compact: { label: 'Compact', rowHeight: 36 },
    standard: { label: 'Standard', rowHeight: 45 },
    comfortable: { label: 'Comfortable', rowHeight: 56 }
};
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

const SkeletonRow = ({ columns, getColumnWidth, rowHeight, showSelection = true, showActions = true }: any) => (
    <div className="flex border-b border-[#2e2e2e]/50" style={{ height: `${rowHeight}px` }}>
        {showSelection && (
            <div className="w-10 px-4 flex items-center shrink-0">
                <div className="w-4 h-4 bg-zinc-800 rounded animate-pulse" />
            </div>
        )}
        {columns.map((col: any, i: any) => (
            <div
                key={i}
                className="px-4 flex items-center shrink-0"
                style={{ width: `${getColumnWidth(col.name, col.type)}px` }}
            >
                <div className="h-4 bg-zinc-800 rounded animate-pulse w-[80%]" />
            </div>
        ))}
        {showActions && <div className="w-20 px-4 flex items-center shrink-0" />}
    </div>
);

interface TableEditorProps {
    tableName: string | null;
    onTableSelect: (tableName: string) => void;
    onOpenSqlEditor?: (tableName: string | null) => void;
    allTables?: any[];
}

const TableEditor: React.FC<TableEditorProps> = ({ tableName, onTableSelect, onOpenSqlEditor, allTables = [] }: any) => {
    const [data, setData] = useState<any[]>([]);
    const [schema, setSchema] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<any>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isColumnModalOpen, setIsColumnModalOpen] = useState(false);
    const [isColumnsPanelOpen, setIsColumnsPanelOpen] = useState(false);
    const [isInsertDropdownOpen, setIsInsertDropdownOpen] = useState(false);
    const [isTableSwitcherOpen, setIsTableSwitcherOpen] = useState(false);
    const [editingRow, setEditingRow] = useState<any>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearch = useDebounce(searchTerm, 500);
    const [pageJumpInput, setPageJumpInput] = useState('1');
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
    const [columnSearchTerm, setColumnSearchTerm] = useState('');
    const [rowDensity, setRowDensity] = useState(() => {
        if (typeof window === 'undefined') return 'standard';
        const saved = window.localStorage.getItem(TABLE_DENSITY_STORAGE_KEY);
        return saved && ROW_DENSITY_OPTIONS[saved] ? saved : 'standard';
    });

    // Pagination State
    const [pageSize, setPageSize] = useState(100);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalRecords, setTotalRecords] = useState(0);
    const [hasMoreRecords, setHasMoreRecords] = useState(false);
    const [isTotalExact, setIsTotalExact] = useState(true);

    // --- NEW: Column Widths & Inline Editing State ---
    const [columnWidths, setColumnWidths] = useState<Record<string, any>>({});
    const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
    const [pinnedColumns, setPinnedColumns] = useState<string[]>([]);
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

    const saveHiddenColumns = useCallback((nextHiddenColumns: string[]) => {
        if (tableName) {
            localStorage.setItem(getHiddenColumnsStorageKey(tableName), JSON.stringify(nextHiddenColumns));
        }
    }, [tableName]);

    const savePinnedColumns = useCallback((nextPinnedColumns: string[]) => {
        if (tableName) {
            localStorage.setItem(getPinnedColumnsStorageKey(tableName), JSON.stringify(nextPinnedColumns));
        }
    }, [tableName]);

    useEffect(() => {
        if (!tableName) {
            setHiddenColumns([]);
            return;
        }
        const saved = localStorage.getItem(getHiddenColumnsStorageKey(tableName));
        if (!saved) {
            setHiddenColumns([]);
            return;
        }
        try {
            const parsed = JSON.parse(saved);
            setHiddenColumns(Array.isArray(parsed) ? parsed.filter((value: any) => typeof value === 'string') : []);
        } catch {
            setHiddenColumns([]);
        }
    }, [tableName, schema.length]);

    useEffect(() => {
        if (!tableName) {
            setPinnedColumns([]);
            return;
        }
        const saved = localStorage.getItem(getPinnedColumnsStorageKey(tableName));
        if (!saved) {
            setPinnedColumns([]);
            return;
        }
        try {
            const parsed = JSON.parse(saved);
            setPinnedColumns(Array.isArray(parsed) ? parsed.filter((value: any) => typeof value === 'string') : []);
        } catch {
            setPinnedColumns([]);
        }
    }, [tableName, schema.length]);

    useEffect(() => {
        window.localStorage.setItem(TABLE_DENSITY_STORAGE_KEY, rowDensity);
    }, [rowDensity]);

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

    const handleCreateView = useCallback(async () => {
        if (!tableName || !viewName.trim()) {
            return;
        }
        const res = await fetchWithAuth(`/api/tables/${tableName}/views`, {
            method: 'POST',
            body: JSON.stringify({ name: viewName.trim(), config: currentViewConfig })
        });
        if (!res.ok) {
            return;
        }
        setViewName('');
        fetchViews();
    }, [currentViewConfig, fetchViews, tableName, viewName]);

    const handleUpdateView = useCallback(async () => {
        if (!tableName || !activeViewId) {
            return;
        }
        const res = await fetchWithAuth(`/api/tables/${tableName}/views/${activeViewId}`, {
            method: 'PATCH',
            body: JSON.stringify({ config: currentViewConfig })
        });
        if (res.ok) {
            fetchViews();
        }
    }, [activeViewId, currentViewConfig, fetchViews, tableName]);

    const handleSetDefaultView = useCallback(async () => {
        if (!tableName || !activeViewId) {
            return;
        }
        const res = await fetchWithAuth(`/api/tables/${tableName}/views/${activeViewId}`, {
            method: 'PATCH',
            body: JSON.stringify({ is_default: true })
        });
        if (res.ok) {
            fetchViews();
        }
    }, [activeViewId, fetchViews, tableName]);

    const handleDeleteView = useCallback(async () => {
        if (!tableName || !activeViewId) {
            return;
        }
        const res = await fetchWithAuth(`/api/tables/${tableName}/views/${activeViewId}`, {
            method: 'DELETE'
        });
        if (!res.ok) {
            return;
        }
        setActiveViewId(null);
        fetchViews();
    }, [activeViewId, fetchViews, tableName]);

    const resetViewControls = useCallback(() => {
        setFilters([]);
        setSorts([]);
        setSearchTerm('');
        setPageSize(100);
        setCurrentPage(1);
        setActiveViewId(null);
    }, []);

    const fetchData = useCallback(async () => {
        if (!tableName) return;
        setLoading(true);
        try {
            const offset = (currentPage - 1) * pageSize;
            const params = new URLSearchParams();
            params.set('limit', String(pageSize));
            params.set('offset', String(offset));
            params.set('count_mode', 'auto');
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
            setHasMoreRecords(Boolean(result.hasMore));
            setIsTotalExact(Boolean(result.totalExact ?? true));
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
            setIsColumnsPanelOpen(false);
            setColumnSearchTerm('');
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
    const rowHeight = ROW_DENSITY_OPTIONS[rowDensity]?.rowHeight || ROW_DENSITY_OPTIONS.standard.rowHeight;
    const [viewportHeight, setViewportHeight] = useState(DEFAULT_VIEWPORT_HEIGHT);
    const [horizontalOverflow, setHorizontalOverflow] = useState({ canScrollLeft: false, canScrollRight: false });

    const updateHorizontalOverflow = useCallback((node?: HTMLDivElement | null) => {
        if (!node) {
            setHorizontalOverflow({ canScrollLeft: false, canScrollRight: false });
            return;
        }
        const maxScrollLeft = Math.max(0, node.scrollWidth - node.clientWidth);
        setHorizontalOverflow({
            canScrollLeft: node.scrollLeft > 6,
            canScrollRight: node.scrollLeft < maxScrollLeft - 6,
        });
    }, []);

    useEffect(() => {
        if (!containerRef.current) return undefined;

        const node = containerRef.current;
        const updateViewportHeight = () => {
            const nextHeight = node.clientHeight || DEFAULT_VIEWPORT_HEIGHT;
            setViewportHeight(Math.max(rowHeight * 4, nextHeight));
            updateHorizontalOverflow(node);
        };

        updateViewportHeight();

        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', updateViewportHeight);
            return () => window.removeEventListener('resize', updateViewportHeight);
        }

        const observer = new ResizeObserver(updateViewportHeight);
        observer.observe(node);
        return () => observer.disconnect();
    }, [rowHeight, updateHorizontalOverflow]);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm]);

    useEffect(() => {
        if (!containerRef.current) return;
        containerRef.current.scrollTop = 0;
        containerRef.current.scrollLeft = 0;
        setScrollTop(0);
        updateHorizontalOverflow(containerRef.current);
    }, [tableName, currentPage, pageSize, debouncedSearch, filters, sorts]);

    const currentTableMeta = useMemo(
        () => allTables.find((t: any) => t.name === tableName),
        [allTables, tableName]
    );
    const rowIdentityEnabled = currentTableMeta?.has_primary_id ?? true;
    const createdAtEnabled = currentTableMeta?.has_created_at ?? true;
    const selectionColumnWidth = rowIdentityEnabled ? CHECKBOX_COLUMN_WIDTH : 0;
    const actionsColumnWidth = rowIdentityEnabled ? ACTIONS_COLUMN_WIDTH : 0;

    useEffect(() => {
        setSelectedIds(new Set());
    }, [tableName, currentPage, pageSize, debouncedSearch, filters, sorts]);

    useEffect(() => {
        if (!rowIdentityEnabled) {
            setSelectedIds(new Set());
        }
    }, [rowIdentityEnabled]);

    const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        setScrollTop(e.currentTarget.scrollTop);
        updateHorizontalOverflow(e.currentTarget);
    }, [updateHorizontalOverflow]);

    const visibleRowCount = Math.max(1, Math.ceil(viewportHeight / rowHeight));
    const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - VIRTUAL_OVERSCAN_ROWS);
    const endIndex = Math.min(data.length, startIndex + visibleRowCount + (VIRTUAL_OVERSCAN_ROWS * 2));
    const visibleData = useMemo(() => data.slice(startIndex, endIndex), [data, startIndex, endIndex]);
    const topPadding = startIndex * rowHeight;
    const bottomPadding = (data.length - endIndex) * rowHeight;
    const totalPages = isTotalExact
        ? Math.max(1, Math.ceil(totalRecords / pageSize))
        : Math.max(currentPage, currentPage + (hasMoreRecords ? 1 : 0));
    const pageStartRecord = data.length === 0 ? 0 : ((currentPage - 1) * pageSize) + 1;
    const pageEndRecord = data.length === 0 ? 0 : (((currentPage - 1) * pageSize) + data.length);
    const visibleIds = useMemo(() => rowIdentityEnabled ? visibleData.map((row: any) => String(row.id)) : [], [visibleData, rowIdentityEnabled]);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id: any) => selectedIds.has(id));
    const someVisibleSelected = visibleIds.some((id: any) => selectedIds.has(id));
    const selectedCount = rowIdentityEnabled ? selectedIds.size : 0;

    useEffect(() => {
        if (isTotalExact && currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, isTotalExact, totalPages]);

    useEffect(() => {
        setPageJumpInput(String(currentPage));
    }, [currentPage]);

    const goToPage = useCallback((rawPage: number) => {
        const maxPage = isTotalExact ? totalPages : Math.max(1, rawPage);
        const nextPage = Math.min(maxPage, Math.max(1, rawPage));
        setCurrentPage(nextPage);
        setPageJumpInput(String(nextPage));
    }, [isTotalExact, totalPages]);

    const resetDataView = useCallback(() => {
        setSearchTerm('');
        setFilters([]);
        setSorts([]);
        setCurrentPage(1);
        setActiveViewId(null);
        setHiddenColumns([]);
        setPinnedColumns([]);
        saveHiddenColumns([]);
        savePinnedColumns([]);
        setAlertMessage({
            title: 'View Reset',
            message: 'Search, filters, sorts, page, hidden columns and frozen columns were reset for this table.',
            type: 'success'
        });
    }, [saveHiddenColumns, savePinnedColumns]);

    useEffect(() => {
        if (!selectAllRef.current) return;
        selectAllRef.current.indeterminate = !allVisibleSelected && someVisibleSelected;
    }, [allVisibleSelected, someVisibleSelected]);

    // --- Cell Editing Handlers ---
    const handleCellClick = useCallback((rowId: any, colName: any) => {
        if (!rowIdentityEnabled) return;
        // Don't allow editing id or created_at
        if (colName === 'id' || colName === 'created_at') return;
        setEditingCell({ rowId, colName });
    }, [rowIdentityEnabled]);

    const handleCellSave = useCallback((rowId: any, colName: any, newValue: any) => {
        if (!rowIdentityEnabled) return;
        setData((prev: any) => prev.map((row: any) =>
            row.id === rowId ? { ...row, [colName]: newValue } : row
        ));
        setEditingCell(null);
    }, [rowIdentityEnabled]);

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
        if (!rowIdentityEnabled) return;
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
    }, [buildInitialMapping, rowIdentityEnabled, schema]);

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
        if (!rowIdentityEnabled) return;
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
    }, [csvImport, fetchData, rowIdentityEnabled, tableName]);

    const handleDeleteRow = useCallback((id: string | number) => {
        if (!rowIdentityEnabled) return;
        setConfirmDeleteId(id);
    }, [rowIdentityEnabled]);

    const toggleSelectRow = useCallback((id: string | number) => {
        if (!rowIdentityEnabled) return;
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
    }, [rowIdentityEnabled]);

    const toggleSelectAllVisible = useCallback(() => {
        if (!rowIdentityEnabled) return;
        setSelectedIds((prev) => {
            const next = new Set<string>(prev);
            if (allVisibleSelected) {
                visibleIds.forEach((id: any) => next.delete(id));
            } else {
                visibleIds.forEach((id: any) => next.add(id));
            }
            return next;
        });
    }, [allVisibleSelected, rowIdentityEnabled, visibleIds]);

    const confirmRowDeletion = useCallback(async () => {
        if (!rowIdentityEnabled) return;
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
    }, [confirmDeleteId, fetchData, rowIdentityEnabled, tableName]);

    const handleExportCSV = useCallback(() => {
        if (data.length === 0) return;

        const headers = [
            ...(rowIdentityEnabled ? ['id'] : []),
            ...schema.map((c: any) => c.name),
            ...(createdAtEnabled ? ['created_at'] : [])
        ];
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
    }, [createdAtEnabled, data, rowIdentityEnabled, schema, tableName]);

    const handleExportSelected = useCallback(() => {
        if (!rowIdentityEnabled) return;
        if (selectedIds.size === 0) return;
        const headers = [
            'id',
            ...schema.map((c: any) => c.name),
            ...(createdAtEnabled ? ['created_at'] : [])
        ];
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
    }, [createdAtEnabled, data, rowIdentityEnabled, schema, selectedIds, tableName]);

    const handleBulkDelete = useCallback(async () => {
        if (!rowIdentityEnabled) return;
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
    }, [fetchData, rowIdentityEnabled, selectedIds, tableName]);

    const handleBulkUpdate = useCallback(async (payload: Record<string, any>) => {
        if (!rowIdentityEnabled) return;
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
    }, [fetchData, rowIdentityEnabled, selectedIds, tableName]);

    const handleEditRow = useCallback((row: Record<string, any>) => {
        if (!rowIdentityEnabled) return;
        setEditingRow(row);
        setIsModalOpen(true);
    }, [rowIdentityEnabled]);

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
        ...(rowIdentityEnabled ? [{ name: 'id', type: 'uuid' }] : []),
        ...schema,
        ...(createdAtEnabled ? [{ name: 'created_at', type: 'datetime' }] : [])
    ], [createdAtEnabled, rowIdentityEnabled, schema]);
    const hiddenColumnSet = useMemo(() => new Set(hiddenColumns), [hiddenColumns]);
    const pinnedColumnSet = useMemo(() => new Set(pinnedColumns), [pinnedColumns]);
    const visibleColumns = useMemo(() => standardColumns.filter((col: any) => {
        if (rowIdentityEnabled && col.name === 'id') {
            return true;
        }
        return !hiddenColumnSet.has(col.name);
    }), [hiddenColumnSet, rowIdentityEnabled, standardColumns]);
    const visibleColumnCount = visibleColumns.length;
    const totalColumnCount = standardColumns.length;
    const filteredColumnOptions = useMemo(() => {
        const needle = columnSearchTerm.trim().toLowerCase();
        if (!needle) {
            return standardColumns;
        }
        return standardColumns.filter((col: any) => {
            const haystack = `${col.name} ${col.type || ''}`.toLowerCase();
            return haystack.includes(needle);
        });
    }, [columnSearchTerm, standardColumns]);

    useEffect(() => {
        if (standardColumns.length === 0) {
            return;
        }
        const allowed = new Set(standardColumns.map((col: any) => col.name));
        setHiddenColumns((prev: any) => {
            const next = prev.filter((name: string) => {
                if (rowIdentityEnabled && name === 'id') {
                    return false;
                }
                return allowed.has(name);
            });
            if (next.length !== prev.length) {
                saveHiddenColumns(next);
            }
            return next;
        });
    }, [rowIdentityEnabled, saveHiddenColumns, standardColumns]);

    useEffect(() => {
        if (standardColumns.length === 0) {
            return;
        }
        const visible = new Set(visibleColumns.map((col: any) => col.name));
        const allowed = new Set(standardColumns.map((col: any) => col.name));
        setPinnedColumns((prev: any) => {
            const next = prev.filter((name: string) => {
                if (rowIdentityEnabled && name === 'id') {
                    return false;
                }
                return allowed.has(name) && visible.has(name);
            });
            if (next.length !== prev.length) {
                savePinnedColumns(next);
            }
            return next;
        });
    }, [rowIdentityEnabled, savePinnedColumns, standardColumns, visibleColumns]);

    // Get column width with fallback to default
    const getColumnWidth = useCallback((colName: string, colType: string) => {
        return columnWidths[colName] || getDefaultWidth(colName, colType);
    }, [columnWidths]);

    // Calculate total table width
    const totalWidth = useMemo(() => 
        visibleColumns.reduce((acc: any, col: any) => acc + getColumnWidth(col.name, col.type), 0) + selectionColumnWidth + actionsColumnWidth, 
    [actionsColumnWidth, getColumnWidth, selectionColumnWidth, visibleColumns]);
    const currentTableLabel = currentTableMeta?.display_name || tableName;
    const readOnlyCompatibilityMessage = !rowIdentityEnabled
        ? 'This SQL table does not expose an id primary key, so Table Editor is running in read-only mode. Use SQL Editor for writes until the table has a standard row identity.'
        : null;
    const hiddenColumnCount = Math.max(0, totalColumnCount - visibleColumnCount);
    const hasQueryModifiers = searchTerm.trim() !== '' || filters.length > 0 || sorts.length > 0;
    const frozenColumnNames = useMemo(() => {
        const names = visibleColumns
            .filter((col: any) => (rowIdentityEnabled && col.name === 'id') || pinnedColumnSet.has(col.name))
            .map((col: any) => col.name);
        return rowIdentityEnabled ? names.filter((name: string) => name !== 'id') : names;
    }, [pinnedColumnSet, rowIdentityEnabled, visibleColumns]);
    const pinnedOffsets = useMemo(() => {
        let nextOffset = selectionColumnWidth;
        const offsets: Record<string, number> = {};

        visibleColumns.forEach((col: any) => {
            const isPinned = (rowIdentityEnabled && col.name === 'id') || pinnedColumnSet.has(col.name);
            if (!isPinned) {
                return;
            }
            offsets[col.name] = nextOffset;
            nextOffset += getColumnWidth(col.name, col.type);
        });

        return offsets;
    }, [getColumnWidth, pinnedColumnSet, rowIdentityEnabled, selectionColumnWidth, visibleColumns]);

    useEffect(() => {
        updateHorizontalOverflow(containerRef.current);
    }, [data.length, totalRecords, totalWidth, updateHorizontalOverflow, visibleColumns.length]);

    const resetColumnLayout = useCallback(() => {
        setColumnWidths({});
        setPinnedColumns([]);
        if (tableName) {
            localStorage.removeItem(getStorageKey(tableName));
            localStorage.removeItem(getPinnedColumnsStorageKey(tableName));
        }
    }, [tableName]);

    const showAllColumns = useCallback(() => {
        setHiddenColumns([]);
        saveHiddenColumns([]);
    }, [saveHiddenColumns]);

    const toggleColumnVisibility = useCallback((columnName: string) => {
        if (rowIdentityEnabled && columnName === 'id') {
            return;
        }
        if (pinnedColumnSet.has(columnName)) {
            setAlertMessage({
                title: 'Column Is Frozen',
                message: 'Unfreeze this column before hiding it so the sticky layout stays predictable.',
                type: 'info'
            });
            return;
        }
        setHiddenColumns((prev: any) => {
            const nextSet = new Set(prev);
            if (nextSet.has(columnName)) {
                nextSet.delete(columnName);
            } else {
                const currentlyVisible = standardColumns.filter((col: any) => {
                    if (rowIdentityEnabled && col.name === 'id') {
                        return false;
                    }
                    return !nextSet.has(col.name);
                }).length;
                if (currentlyVisible <= 1) {
                    setAlertMessage({
                        title: 'Keep One Column Visible',
                        message: 'Table Editor needs at least one visible data column. Use SQL Editor for schema-wide inspection if you want a raw query view.',
                        type: 'info'
                    });
                    return prev;
                }
                nextSet.add(columnName);
            }
            const next = Array.from(nextSet) as string[];
            saveHiddenColumns(next);
            return next;
        });
    }, [pinnedColumnSet, rowIdentityEnabled, saveHiddenColumns, standardColumns]);

    const togglePinnedColumn = useCallback((columnName: string) => {
        if (rowIdentityEnabled && columnName === 'id') {
            return;
        }
        setPinnedColumns((prev: any) => {
            const nextSet = new Set(prev);
            if (nextSet.has(columnName)) {
                nextSet.delete(columnName);
            } else {
                nextSet.add(columnName);
            }
            const next = Array.from(nextSet) as string[];
            savePinnedColumns(next);
            return next;
        });
        setHiddenColumns((prev: any) => {
            if (!prev.includes(columnName)) {
                return prev;
            }
            const next = prev.filter((name: string) => name !== columnName);
            saveHiddenColumns(next);
            return next;
        });
    }, [rowIdentityEnabled, saveHiddenColumns, savePinnedColumns]);

    return (
        <div className="flex flex-col h-full w-full max-w-full overflow-hidden text-zinc-400 font-sans animate-in fade-in duration-500">
            <TableEditorToolbar
                currentTableLabel={currentTableLabel}
                tableName={tableName}
                allTables={allTables}
                onTableSelect={onTableSelect}
                isTableSwitcherOpen={isTableSwitcherOpen}
                setIsTableSwitcherOpen={setIsTableSwitcherOpen}
                isViewsOpen={isViewsOpen}
                setIsViewsOpen={setIsViewsOpen}
                views={views}
                activeViewId={activeViewId}
                applyView={applyView}
                viewName={viewName}
                setViewName={setViewName}
                onCreateView={handleCreateView}
                onUpdateView={handleUpdateView}
                onSetDefaultView={handleSetDefaultView}
                onDeleteView={handleDeleteView}
                onResetViewControls={resetViewControls}
                isInsertDropdownOpen={isInsertDropdownOpen}
                setIsInsertDropdownOpen={setIsInsertDropdownOpen}
                rowIdentityEnabled={rowIdentityEnabled}
                onOpenInsertRow={() => {
                    setEditingRow(null);
                    setIsModalOpen(true);
                }}
                onOpenAddColumn={() => setIsColumnModalOpen(true)}
                handleCSVImport={handleCSVImport}
                csvInputRef={csvInputRef}
                isFilterOpen={isFilterOpen}
                setIsFilterOpen={setIsFilterOpen}
                isSortOpen={isSortOpen}
                setIsSortOpen={setIsSortOpen}
                sorts={sorts}
                isColumnsPanelOpen={isColumnsPanelOpen}
                setIsColumnsPanelOpen={setIsColumnsPanelOpen}
                visibleColumnCount={visibleColumnCount}
                totalColumnCount={totalColumnCount}
                hiddenColumnCount={hiddenColumnCount}
                columnSearchTerm={columnSearchTerm}
                setColumnSearchTerm={setColumnSearchTerm}
                filteredColumnOptions={filteredColumnOptions}
                hiddenColumnSet={hiddenColumnSet}
                pinnedColumnSet={pinnedColumnSet}
                getTypeIcon={getTypeIcon}
                showAllColumns={showAllColumns}
                resetColumnLayout={resetColumnLayout}
                toggleColumnVisibility={toggleColumnVisibility}
                togglePinnedColumn={togglePinnedColumn}
                realtimeEnabled={realtimeEnabled}
                isRealtimeLoading={isRealtimeLoading}
                onToggleRealtime={toggleRealtime}
                searchTerm={searchTerm}
                setSearchTerm={setSearchTerm}
                fetchData={fetchData}
                loading={loading}
            />

            {readOnlyCompatibilityMessage && (
                <div className="border-b border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[10px] font-bold tracking-wide text-amber-200 sm:px-6">
                    {readOnlyCompatibilityMessage}
                </div>
            )}

            <TableEditorStateBar
                activeViewId={activeViewId}
                searchTerm={searchTerm}
                hiddenColumnCount={hiddenColumnCount}
                pinnedColumnNames={frozenColumnNames}
                filtersCount={filters.length}
                sorts={sorts}
                selectedCount={selectedCount}
                onReset={resetDataView}
            />

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
                        <div key={s.id} data-testid={`sort-row-${s.id}`} className="grid grid-cols-[1fr_140px_28px] gap-2 items-center">
                            <select
                                data-testid={`sort-column-${s.id}`}
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
                                data-testid={`sort-direction-${s.id}`}
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
            {rowIdentityEnabled && selectedCount > 0 && (
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
            <div className="relative flex-1 overflow-hidden bg-[#171717]">
                {horizontalOverflow.canScrollLeft && (
                    <div className="pointer-events-none absolute inset-y-0 left-0 z-40 w-10 bg-gradient-to-r from-[#171717] via-[#171717]/90 to-transparent" />
                )}
                {horizontalOverflow.canScrollRight && (
                    <div className="pointer-events-none absolute inset-y-0 right-0 z-40 w-10 bg-gradient-to-l from-[#171717] via-[#171717]/90 to-transparent" />
                )}
                <div
                    ref={containerRef}
                    onScroll={handleScroll}
                    className="h-full overflow-auto custom-scrollbar"
                >
                    <div style={{ minWidth: `${totalWidth}px` }}>
                    {/* Table Header */}
                    <div className="sticky top-0 bg-[#111111] z-10 border-b border-[#2e2e2e] flex">
                        {rowIdentityEnabled && (
                            <div className="w-10 px-4 py-3 flex items-center shrink-0 sticky left-0 z-30 bg-[#111111] border-r border-[#2e2e2e]/60">
                                <input
                                    ref={selectAllRef}
                                    type="checkbox"
                                    checked={allVisibleSelected}
                                    onChange={toggleSelectAllVisible}
                                    className="rounded border-border bg-transparent accent-primary"
                                />
                            </div>
                        )}

                        {/* Dynamic columns */}
                        {visibleColumns.map((col: any) => {
                            const width = getColumnWidth(col.name, col.type);
                            const isResizingColumn = resizingColumn === col.name;
                            const isPinnedColumn = pinnedOffsets[col.name] !== undefined;

                            return (
                                <div
                                    key={col.name}
                                    data-testid={`table-header-${col.name}`}
                                    data-column-name={col.name}
                                    className={`relative flex items-center shrink-0 ${isPinnedColumn ? 'sticky z-20 bg-[#111111] border-r border-[#2e2e2e]/60 shadow-[10px_0_16px_-14px_rgba(0,0,0,0.85)]' : ''}`}
                                    style={{
                                        width: `${width}px`,
                                        ...(isPinnedColumn ? { left: `${pinnedOffsets[col.name]}px` } : {})
                                    }}
                                >
                                    <div className="flex-1 px-4 py-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-600 overflow-hidden">
                                        {getTypeIcon(col.type)}
                                        <span className="truncate">{col.name}</span>
                                    </div>

                                    {/* Resize Handle */}
                                    <div
                                        data-testid={`table-resize-${col.name}`}
                                        onMouseDown={(e: any) => handleResizeStart(e, col.name)}
                                        className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize group/resize flex items-center justify-center
                                            ${isResizingColumn ? 'bg-primary' : 'hover:bg-primary/50'} transition-colors`}
                                    >
                                        <div className={`w-[2px] h-4 rounded-full transition-colors
                                            ${isResizingColumn ? 'bg-primary' : 'bg-zinc-700 group-hover/resize:bg-primary'}`}
                                        />
                                    </div>
                                </div>
                            );
                        })}

                        {rowIdentityEnabled && (
                            <div className="w-20 px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-600 shrink-0 sticky right-0 z-20 bg-[#111111] border-l border-[#2e2e2e]/60 shadow-[-10px_0_16px_-14px_rgba(0,0,0,0.85)]">
                                Actions
                            </div>
                        )}
                    </div>

                    {/* Table Body */}
                    <div className="divide-y divide-[#2e2e2e]/50 font-mono">
                        {loading && data.length === 0 ? (
                            <div className="space-y-0">
                                <div className="border-b border-[#2e2e2e]/60 bg-[#111111] px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                                    loading rows {pageStartRecord}-{Math.max(pageStartRecord, pageEndRecord)}
                                </div>
                                {[...Array(10)].map((_: any, i: any) => (
                                    <SkeletonRow
                                        key={i}
                                        columns={visibleColumns}
                                        getColumnWidth={getColumnWidth}
                                        rowHeight={rowHeight}
                                        showSelection={rowIdentityEnabled}
                                        showActions={rowIdentityEnabled}
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
                                <div className="max-w-sm mx-auto space-y-6">
                                    <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-[#2e2e2e] flex items-center justify-center mx-auto text-zinc-700 shadow-xl">
                                        <Database size={32} strokeWidth={1.5} />
                                    </div>
                                    <div className="space-y-2">
                                        <h4 className="text-zinc-300 font-bold text-sm uppercase tracking-widest">
                                            {hasQueryModifiers ? 'No rows match this view' : 'No records yet'}
                                        </h4>
                                        <p className="text-zinc-600 text-xs tracking-tight">
                                            {hasQueryModifiers
                                                ? 'Reset filters, search or sort rules to inspect the full dataset again.'
                                                : 'Insert the first record or import a CSV to start shaping this table.'}
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap items-center justify-center gap-2">
                                        {hasQueryModifiers && (
                                            <button
                                                onClick={resetDataView}
                                                className="rounded-full border border-[#2e2e2e] bg-[#161616] px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
                                            >
                                                Reset View
                                            </button>
                                        )}
                                        {rowIdentityEnabled && (
                                            <button
                                                onClick={() => {
                                                    setEditingRow(null);
                                                    setIsModalOpen(true);
                                                }}
                                                className="rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-primary transition-colors hover:border-primary/40 hover:bg-primary/15"
                                            >
                                                Insert Row
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <>
                                {/* Virtual Top Padding */}
                                {topPadding > 0 && (
                                    <div style={{ height: `${topPadding}px` }} />
                                )}

                                {visibleData.map((row: any, visibleIndex: any) => {
                                    const isEditing = editingCell?.rowId === row.id;
                                    const rowKey = rowIdentityEnabled ? String(row.id) : `row-${startIndex + visibleIndex}`;

                                    return (
                                        <div
                                            key={rowKey}
                                            className="flex hover:bg-zinc-900/30 transition-colors group border-b border-[#2e2e2e]/30"
                                            style={{ height: `${rowHeight}px` }}
                                        >
                                            {rowIdentityEnabled && (
                                                <div className="w-10 px-4 flex items-center shrink-0 sticky left-0 z-20 bg-[#171717] border-r border-[#2e2e2e]/40 group-hover:bg-zinc-900/30">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedIds.has(String(row.id))}
                                                        onChange={() => toggleSelectRow(row.id)}
                                                        className="rounded border-border bg-transparent accent-primary"
                                                    />
                                                </div>
                                            )}

                                            {/* Data cells */}
                                            {visibleColumns.map((col: any) => {
                                                const val = row[col.name];
                                                const width = getColumnWidth(col.name, col.type);
                                                const isCellEditing = isEditing && editingCell?.colName === col.name;
                                                const isEditable = rowIdentityEnabled && col.name !== 'id' && col.name !== 'created_at';
                                                const isPinnedColumn = pinnedOffsets[col.name] !== undefined;

                                                return (
                                                    <div
                                                        key={col.name}
                                                        onClick={() => isEditable && handleCellClick(row.id, col.name)}
                                                        className={`px-4 flex items-center text-xs shrink-0 overflow-hidden
                                                            ${isEditable ? 'cursor-cell hover:bg-zinc-800/30' : 'cursor-default'}
                                                            ${isCellEditing ? 'bg-zinc-800/50 ring-1 ring-primary/30' : ''}
                                                            ${isPinnedColumn ? 'sticky z-10 bg-[#171717] border-r border-[#2e2e2e]/40 group-hover:bg-zinc-900/30 shadow-[10px_0_16px_-14px_rgba(0,0,0,0.75)]' : ''}`}
                                                        style={{
                                                            width: `${width}px`,
                                                            ...(isPinnedColumn ? { left: `${pinnedOffsets[col.name]}px` } : {})
                                                        }}
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

                                            {rowIdentityEnabled && (
                                                <div className="w-20 px-4 flex items-center justify-end gap-2 shrink-0 sticky right-0 z-20 bg-[#171717] border-l border-[#2e2e2e]/40 group-hover:bg-zinc-900/30 shadow-[-10px_0_16px_-14px_rgba(0,0,0,0.75)]">
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
                                            )}
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
            </div>

            <TableEditorFooter
                totalRecords={totalRecords}
                hasMoreRecords={hasMoreRecords}
                isTotalExact={isTotalExact}
                visibleColumnCount={visibleColumnCount}
                totalColumnCount={totalColumnCount}
                pageStartRecord={pageStartRecord}
                pageEndRecord={pageEndRecord}
                rowDensity={rowDensity}
                rowDensityOptions={ROW_DENSITY_OPTIONS}
                setRowDensity={setRowDensity}
                error={error}
                horizontalOverflow={horizontalOverflow}
                pageSize={pageSize}
                pageSizeOptions={PAGE_SIZE_OPTIONS}
                setPageSize={(nextPageSize) => {
                    setPageSize(nextPageSize);
                    setCurrentPage(1);
                }}
                currentPage={currentPage}
                totalPages={totalPages}
                goToPage={goToPage}
                pageJumpInput={pageJumpInput}
                setPageJumpInput={setPageJumpInput}
                onOpenSqlEditor={onOpenSqlEditor}
                tableName={tableName}
                onExportCSV={handleExportCSV}
                pinnedColumnNames={frozenColumnNames}
            />

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
