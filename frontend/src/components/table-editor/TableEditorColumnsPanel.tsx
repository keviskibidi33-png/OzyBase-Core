import React from 'react';
import { Pin, Search } from 'lucide-react';

interface ColumnOption {
    name: string;
    type: string;
}

interface TableEditorColumnsPanelProps {
    isOpen: boolean;
    onClose: () => void;
    visibleColumnCount: number;
    totalColumnCount: number;
    hiddenColumnCount: number;
    columnSearchTerm: string;
    setColumnSearchTerm: (value: string) => void;
    filteredColumnOptions: ColumnOption[];
    rowIdentityEnabled: boolean;
    hiddenColumnSet: Set<string>;
    pinnedColumnSet: Set<string>;
    getTypeIcon: (type: string) => React.ReactNode;
    showAllColumns: () => void;
    resetColumnLayout: () => void;
    toggleColumnVisibility: (columnName: string) => void;
    togglePinnedColumn: (columnName: string) => void;
    openAddColumn: () => void;
}

const TableEditorColumnsPanel: React.FC<TableEditorColumnsPanelProps> = ({
    isOpen,
    onClose,
    visibleColumnCount,
    totalColumnCount,
    hiddenColumnCount,
    columnSearchTerm,
    setColumnSearchTerm,
    filteredColumnOptions,
    rowIdentityEnabled,
    hiddenColumnSet,
    pinnedColumnSet,
    getTypeIcon,
    showAllColumns,
    resetColumnLayout,
    toggleColumnVisibility,
    togglePinnedColumn,
    openAddColumn,
}) => {
    if (!isOpen) {
        return null;
    }

    return (
        <>
            <div className="fixed inset-0 z-40 outline-none" onClick={onClose} />
            <div className="absolute right-0 top-full z-50 mt-2 w-[360px] max-w-[calc(100vw-1.5rem)] overflow-hidden ozy-floating-panel sm:left-0 sm:right-auto">
                <div className="border-b border-[#2e2e2e] px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Visible Columns</p>
                            <p className="mt-1 text-[11px] text-zinc-400">
                                {visibleColumnCount} of {totalColumnCount} visible
                                {hiddenColumnCount > 0 ? ` · ${hiddenColumnCount} hidden` : ''}
                            </p>
                        </div>
                        <button
                            onClick={openAddColumn}
                            className="rounded-lg border border-[#2e2e2e] px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-300 transition-colors hover:border-primary/30 hover:text-primary"
                        >
                            Add Column
                        </button>
                    </div>
                    <div className="relative mt-3">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={13} />
                        <input
                            type="text"
                            value={columnSearchTerm}
                            onChange={(event) => setColumnSearchTerm(event.target.value)}
                            placeholder="Find column..."
                            className="w-full rounded-lg border border-[#2e2e2e] bg-[#101010] py-2 pl-8 pr-3 text-[11px] text-zinc-200 placeholder:text-zinc-700 focus:border-primary/30 focus:outline-none"
                        />
                    </div>
                </div>

                <div className="flex items-center gap-2 border-b border-[#2e2e2e] px-4 py-3 text-[10px] font-black uppercase tracking-widest">
                    <button
                        onClick={showAllColumns}
                        className="rounded-lg border border-[#2e2e2e] px-3 py-1.5 text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
                    >
                        Show All
                    </button>
                    <button
                        onClick={resetColumnLayout}
                        className="rounded-lg border border-[#2e2e2e] px-3 py-1.5 text-zinc-500 transition-colors hover:border-zinc-500 hover:text-zinc-200"
                    >
                        Reset Layout
                    </button>
                </div>

                <div className="max-h-80 overflow-y-auto custom-scrollbar p-2">
                    {filteredColumnOptions.length === 0 ? (
                        <div className="px-3 py-6 text-center text-[11px] text-zinc-600">
                            No columns match this filter.
                        </div>
                    ) : (
                        filteredColumnOptions.map((column) => {
                            const isIdentityColumn = rowIdentityEnabled && column.name === 'id';
                            const isPinned = isIdentityColumn || pinnedColumnSet.has(column.name);
                            const checked = isIdentityColumn || !hiddenColumnSet.has(column.name);

                            return (
                                <div
                                    key={column.name}
                                    data-testid={`column-option-${column.name}`}
                                    className={`flex items-center gap-3 rounded-xl px-3 py-2 transition-colors ${
                                        checked ? 'bg-[#141414] text-zinc-200' : 'text-zinc-500 hover:bg-[#121212] hover:text-zinc-300'
                                    }`}
                                >
                                    <input
                                        data-testid={`column-visibility-${column.name}`}
                                        type="checkbox"
                                        checked={checked}
                                        disabled={isIdentityColumn}
                                        onChange={() => toggleColumnVisibility(column.name)}
                                        className="rounded border-border bg-transparent accent-primary"
                                    />
                                    <div className="flex min-w-0 flex-1 items-center gap-2">
                                        {getTypeIcon(column.type)}
                                        <div className="min-w-0">
                                            <div className="truncate text-[11px] font-bold">{column.name}</div>
                                            <div className="truncate text-[9px] uppercase tracking-widest text-zinc-600">{column.type || 'text'}</div>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        data-testid={`column-freeze-${column.name}`}
                                        onClick={() => togglePinnedColumn(column.name)}
                                        disabled={isIdentityColumn}
                                        className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[8px] font-black uppercase tracking-[0.18em] transition-colors ${
                                            isPinned
                                                ? 'border-primary/20 bg-primary/10 text-primary'
                                                : 'border-[#2e2e2e] text-zinc-500 hover:border-zinc-500 hover:text-zinc-200'
                                        } ${isIdentityColumn ? 'cursor-not-allowed opacity-60' : ''}`}
                                    >
                                        <Pin size={10} />
                                        {isPinned ? 'Frozen' : 'Freeze'}
                                    </button>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </>
    );
};

export default TableEditorColumnsPanel;
