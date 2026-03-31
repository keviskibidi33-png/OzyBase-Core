import React from 'react';
import {
    ArrowUpDown,
    ChevronDown,
    ChevronRight,
    Columns3,
    Database,
    FileUp,
    Filter,
    ListPlus,
    Lock,
    Plus,
    RefreshCw,
    Search,
    SlidersHorizontal,
    Wifi,
} from 'lucide-react';
import TableEditorColumnsPanel from './TableEditorColumnsPanel';

interface TableEditorToolbarProps {
    currentTableLabel: string | null;
    tableName: string | null;
    allTables: any[];
    onTableSelect: (tableName: string) => void;
    isTableSwitcherOpen: boolean;
    setIsTableSwitcherOpen: React.Dispatch<React.SetStateAction<boolean>>;
    isViewsOpen: boolean;
    setIsViewsOpen: React.Dispatch<React.SetStateAction<boolean>>;
    views: any[];
    activeViewId: string | null;
    applyView: (view: any) => void;
    viewName: string;
    setViewName: React.Dispatch<React.SetStateAction<string>>;
    onCreateView: () => Promise<void>;
    onUpdateView: () => Promise<void>;
    onSetDefaultView: () => Promise<void>;
    onDeleteView: () => Promise<void>;
    onResetViewControls: () => void;
    isInsertDropdownOpen: boolean;
    setIsInsertDropdownOpen: React.Dispatch<React.SetStateAction<boolean>>;
    rowIdentityEnabled: boolean;
    onOpenInsertRow: () => void;
    onOpenAddColumn: () => void;
    handleCSVImport: (event: React.ChangeEvent<HTMLInputElement>) => void;
    csvInputRef: React.RefObject<HTMLInputElement | null>;
    isFilterOpen: boolean;
    setIsFilterOpen: React.Dispatch<React.SetStateAction<boolean>>;
    isSortOpen: boolean;
    setIsSortOpen: React.Dispatch<React.SetStateAction<boolean>>;
    sorts: any[];
    isColumnsPanelOpen: boolean;
    setIsColumnsPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
    visibleColumnCount: number;
    totalColumnCount: number;
    hiddenColumnCount: number;
    columnSearchTerm: string;
    setColumnSearchTerm: React.Dispatch<React.SetStateAction<string>>;
    filteredColumnOptions: any[];
    hiddenColumnSet: Set<string>;
    pinnedColumnSet: Set<string>;
    getTypeIcon: (type: string) => React.ReactNode;
    showAllColumns: () => void;
    resetColumnLayout: () => void;
    toggleColumnVisibility: (columnName: string) => void;
    togglePinnedColumn: (columnName: string) => void;
    realtimeEnabled: boolean;
    isRealtimeLoading: boolean;
    onToggleRealtime: () => Promise<void>;
    searchTerm: string;
    setSearchTerm: React.Dispatch<React.SetStateAction<string>>;
    fetchData: () => Promise<void>;
    loading: boolean;
}

const TableEditorToolbar: React.FC<TableEditorToolbarProps> = ({
    currentTableLabel,
    tableName,
    allTables,
    onTableSelect,
    isTableSwitcherOpen,
    setIsTableSwitcherOpen,
    isViewsOpen,
    setIsViewsOpen,
    views,
    activeViewId,
    applyView,
    viewName,
    setViewName,
    onCreateView,
    onUpdateView,
    onSetDefaultView,
    onDeleteView,
    onResetViewControls,
    isInsertDropdownOpen,
    setIsInsertDropdownOpen,
    rowIdentityEnabled,
    onOpenInsertRow,
    onOpenAddColumn,
    handleCSVImport,
    csvInputRef,
    isFilterOpen,
    setIsFilterOpen,
    isSortOpen,
    setIsSortOpen,
    sorts,
    isColumnsPanelOpen,
    setIsColumnsPanelOpen,
    visibleColumnCount,
    totalColumnCount,
    hiddenColumnCount,
    columnSearchTerm,
    setColumnSearchTerm,
    filteredColumnOptions,
    hiddenColumnSet,
    pinnedColumnSet,
    getTypeIcon,
    showAllColumns,
    resetColumnLayout,
    toggleColumnVisibility,
    togglePinnedColumn,
    realtimeEnabled,
    isRealtimeLoading,
    onToggleRealtime,
    searchTerm,
    setSearchTerm,
    fetchData,
    loading,
}) => (
    <div className="border-b border-[#2e2e2e] bg-[#1a1a1a] shrink-0 px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
            <div className="min-w-0 2xl:flex-1">
                <div className="overflow-x-auto custom-scrollbar pb-1">
                    <div className="flex min-w-max items-center gap-3 pr-1">
                        <div className="relative">
                            <button
                                onClick={() => setIsTableSwitcherOpen(!isTableSwitcherOpen)}
                                className="flex items-center gap-2 px-3 py-1.5 bg-[#111111] border border-[#2e2e2e] rounded-lg hover:border-zinc-500 transition-all group shrink-0"
                                title={currentTableLabel || ''}
                            >
                                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Table</span>
                                <span className="max-w-[180px] truncate text-[11px] font-bold text-white group-hover:text-primary transition-colors">
                                    {currentTableLabel}
                                </span>
                                <ChevronDown
                                    size={14}
                                    className={`text-zinc-600 transition-transform ${isTableSwitcherOpen ? 'rotate-180' : ''}`}
                                />
                            </button>

                            {isTableSwitcherOpen && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setIsTableSwitcherOpen(false)} />
                                    <div className="absolute top-full left-0 mt-2 z-50 w-64 overflow-hidden ozy-floating-panel">
                                        <div className="max-h-80 overflow-y-auto custom-scrollbar p-1.5 space-y-4">
                                            <div>
                                                <p className="px-3 py-1 text-[9px] font-black text-zinc-600 uppercase tracking-widest">
                                                    User Tables
                                                </p>
                                                {allTables.filter((entry: any) => !entry.is_system).map((entry: any) => (
                                                    <button
                                                        key={entry.name}
                                                        onClick={() => {
                                                            onTableSelect(entry.name);
                                                            setIsTableSwitcherOpen(false);
                                                        }}
                                                        className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-3 ${
                                                            tableName === entry.name
                                                                ? 'bg-primary/10 text-primary font-bold'
                                                                : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                                                        }`}
                                                    >
                                                        <Database
                                                            size={12}
                                                            className={tableName === entry.name ? 'text-primary' : 'text-zinc-600'}
                                                        />
                                                        <span className="truncate">{entry.display_name || entry.name}</span>
                                                    </button>
                                                ))}
                                            </div>
                                            {allTables.some((entry: any) => entry.is_system) && (
                                                <div>
                                                    <p className="px-3 py-1 text-[9px] font-black text-zinc-600 uppercase tracking-widest">
                                                        System Tables
                                                    </p>
                                                    {allTables.filter((entry: any) => entry.is_system).map((entry: any) => (
                                                        <button
                                                            key={entry.name}
                                                            onClick={() => {
                                                                onTableSelect(entry.name);
                                                                setIsTableSwitcherOpen(false);
                                                            }}
                                                            className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-3 font-mono opacity-80 ${
                                                                tableName === entry.name
                                                                    ? 'bg-primary/10 text-primary font-bold'
                                                                    : 'text-zinc-500 hover:bg-zinc-800 hover:text-white'
                                                            }`}
                                                        >
                                                            <Lock
                                                                size={12}
                                                                className={tableName === entry.name ? 'text-primary' : 'text-zinc-700'}
                                                            />
                                                            <span className="truncate">{entry.display_name || entry.name}</span>
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
                                Saved Views
                                <ChevronDown size={14} className={`transition-transform ${isViewsOpen ? 'rotate-180' : ''}`} />
                            </button>

                            {isViewsOpen && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setIsViewsOpen(false)} />
                                    <div className="absolute top-full left-0 mt-2 z-50 w-80 overflow-hidden ozy-floating-panel">
                                        <div className="p-3 space-y-3">
                                            <div className="space-y-2">
                                                <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                                                    Saved Views
                                                </p>
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
                                                            className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center justify-between ${
                                                                activeViewId === view.id
                                                                    ? 'bg-primary/10 text-primary font-bold'
                                                                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                                                            }`}
                                                        >
                                                            <span className="truncate">{view.name}</span>
                                                            {view.is_default && (
                                                                <span className="text-[9px] font-black uppercase tracking-widest">default</span>
                                                            )}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="h-[1px] bg-[#2e2e2e]" />

                                            <div className="space-y-2">
                                                <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                                                    Save This Layout
                                                </p>
                                                <div className="flex gap-2">
                                                    <input
                                                        value={viewName}
                                                        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setViewName(event.target.value)}
                                                        placeholder="View name"
                                                        className="flex-1 bg-[#111111] border border-[#2e2e2e] rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-primary/50"
                                                    />
                                                    <button
                                                        onClick={() => {
                                                            void onCreateView();
                                                        }}
                                                        className="px-3 py-2 bg-primary text-black rounded-lg text-[10px] font-black uppercase tracking-widest"
                                                    >
                                                        Save
                                                    </button>
                                                </div>
                                                {activeViewId && (
                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={() => {
                                                                void onUpdateView();
                                                            }}
                                                            className="flex-1 px-3 py-2 bg-[#111111] border border-[#2e2e2e] rounded-lg text-[10px] font-black uppercase tracking-widest text-zinc-300"
                                                        >
                                                            Update
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                void onSetDefaultView();
                                                            }}
                                                            className="flex-1 px-3 py-2 bg-[#111111] border border-[#2e2e2e] rounded-lg text-[10px] font-black uppercase tracking-widest text-zinc-300"
                                                        >
                                                            Set Default
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                void onDeleteView();
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
                                                onClick={onResetViewControls}
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
                                className="flex items-center gap-2 bg-primary text-black px-4 py-1.5 rounded-lg font-black text-[10px] uppercase tracking-widest hover:bg-[#E6E600] transition-all transform active:scale-95 shadow-[0_0_20px_rgba(254,254,0,0.1)] shrink-0"
                            >
                                <Plus size={14} strokeWidth={3} />
                                Insert
                                <ChevronDown
                                    size={14}
                                    className={`transition-transform duration-200 ${isInsertDropdownOpen ? 'rotate-180' : ''}`}
                                />
                            </button>

                            {isInsertDropdownOpen && (
                                <>
                                    <div className="fixed inset-0 z-40 outline-none" onClick={() => setIsInsertDropdownOpen(false)} />
                                    <div className="absolute top-full left-0 mt-2 z-50 w-56 overflow-hidden ozy-floating-panel">
                                        <div className="p-1.5 space-y-0.5">
                                            <button
                                                onClick={() => {
                                                    if (!rowIdentityEnabled) {
                                                        return;
                                                    }
                                                    onOpenInsertRow();
                                                    setIsInsertDropdownOpen(false);
                                                }}
                                                disabled={!rowIdentityEnabled}
                                                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-bold transition-all group ${
                                                    rowIdentityEnabled
                                                        ? 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                                                        : 'text-zinc-700 cursor-not-allowed opacity-60'
                                                }`}
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
                                                onClick={() => {
                                                    onOpenAddColumn();
                                                    setIsInsertDropdownOpen(false);
                                                }}
                                                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-bold text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all group"
                                            >
                                                <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0 group-hover:border-primary/50 transition-colors">
                                                    <Database size={16} className="text-zinc-500 group-hover:text-primary" />
                                                </div>
                                                <div className="flex flex-col text-left">
                                                    <span className="uppercase tracking-wide">Add Column</span>
                                                    <span className="text-[9px] text-zinc-600">Add a new field</span>
                                                </div>
                                                <ChevronRight size={14} className="ml-auto text-zinc-700" />
                                            </button>

                                            <div className="h-[1px] bg-[#2e2e2e] my-1 mx-2" />

                                            <label
                                                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-bold transition-all group ${
                                                    rowIdentityEnabled
                                                        ? 'text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer'
                                                        : 'text-zinc-700 cursor-not-allowed opacity-60'
                                                }`}
                                            >
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
                                                    disabled={!rowIdentityEnabled}
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
                            {sorts.length > 0 && (
                                <span className="rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[9px] tracking-[0.15em] text-primary">
                                    {sorts.length}
                                </span>
                            )}
                        </button>
                        <div className="relative">
                            <button
                                onClick={() => setIsColumnsPanelOpen(!isColumnsPanelOpen)}
                                className={`flex items-center gap-2 px-3 py-1.5 border rounded-lg transition-all text-[10px] font-black uppercase tracking-widest shrink-0 ${
                                    isColumnsPanelOpen
                                        ? 'bg-primary/10 border-primary/30 text-primary'
                                        : 'bg-[#111111] border-[#2e2e2e] text-zinc-300 hover:border-zinc-500'
                                }`}
                            >
                                <Columns3 size={14} />
                                Columns
                                <span className="rounded-full bg-black/30 px-1.5 py-0.5 text-[9px] tracking-[0.15em]">
                                    {visibleColumnCount}/{totalColumnCount}
                                </span>
                            </button>
                            <TableEditorColumnsPanel
                                isOpen={isColumnsPanelOpen}
                                onClose={() => setIsColumnsPanelOpen(false)}
                                visibleColumnCount={visibleColumnCount}
                                totalColumnCount={totalColumnCount}
                                hiddenColumnCount={hiddenColumnCount}
                                columnSearchTerm={columnSearchTerm}
                                setColumnSearchTerm={setColumnSearchTerm}
                                filteredColumnOptions={filteredColumnOptions}
                                rowIdentityEnabled={rowIdentityEnabled}
                                hiddenColumnSet={hiddenColumnSet}
                                pinnedColumnSet={pinnedColumnSet}
                                getTypeIcon={getTypeIcon}
                                showAllColumns={showAllColumns}
                                resetColumnLayout={resetColumnLayout}
                                toggleColumnVisibility={toggleColumnVisibility}
                                togglePinnedColumn={togglePinnedColumn}
                                openAddColumn={() => {
                                    setIsColumnsPanelOpen(false);
                                    onOpenAddColumn();
                                }}
                            />
                        </div>

                        <div className="h-4 w-[1px] bg-[#2e2e2e] mx-2" />

                        <button
                            onClick={() => {
                                void onToggleRealtime();
                            }}
                            disabled={isRealtimeLoading || !tableName || tableName.startsWith('_v_')}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all text-[10px] font-black uppercase tracking-widest shrink-0 ${
                                realtimeEnabled
                                    ? 'bg-primary/10 border-primary/30 text-primary'
                                    : 'bg-[#111111] border-[#2e2e2e] text-zinc-500 hover:text-zinc-300'
                            } ${(isRealtimeLoading || tableName?.startsWith('_v_')) ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            <Wifi size={14} className={realtimeEnabled ? 'animate-pulse' : ''} />
                            Realtime {realtimeEnabled ? 'On' : 'Off'}
                        </button>
                    </div>
                </div>
            </div>

            <div className="flex min-w-0 items-center gap-3 2xl:w-auto">
                <div className="relative min-w-0 flex-1 group 2xl:w-72">
                    <Search
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within:text-primary transition-colors"
                        size={14}
                    />
                    <input
                        type="text"
                        placeholder="Search records..."
                        value={searchTerm}
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(event.target.value)}
                        className="w-full bg-[#111111] border border-[#2e2e2e] rounded-lg pl-9 pr-4 py-1.5 text-[11px] font-bold focus:outline-none focus:border-primary/50 text-zinc-200 placeholder:text-zinc-700 transition-all focus:ring-1 focus:ring-primary/10"
                    />
                </div>
                <button
                    onClick={() => {
                        void fetchData();
                    }}
                    disabled={loading}
                    className="shrink-0 p-2 border border-[#2e2e2e] rounded-lg hover:bg-zinc-800 transition-colors disabled:opacity-50 group"
                >
                    <RefreshCw
                        size={14}
                        className={`${loading ? 'animate-spin text-primary' : 'text-zinc-500 group-hover:text-zinc-200'}`}
                    />
                </button>
            </div>
        </div>
    </div>
);

export default TableEditorToolbar;
