import React from 'react';
import { ChevronLeft, ChevronRight, Code2, Download } from 'lucide-react';

interface TableEditorFooterProps {
    totalRecords: number;
    visibleColumnCount: number;
    totalColumnCount: number;
    pageStartRecord: number;
    pageEndRecord: number;
    rowDensity: string;
    rowDensityOptions: Record<string, { label: string }>;
    setRowDensity: (density: string) => void;
    error: string | null;
    horizontalOverflow: { canScrollRight: boolean };
    pageSize: number;
    pageSizeOptions: number[];
    setPageSize: (pageSize: number) => void;
    currentPage: number;
    totalPages: number;
    goToPage: (page: number) => void;
    pageJumpInput: string;
    setPageJumpInput: (value: string) => void;
    onOpenSqlEditor?: (tableName: string | null) => void;
    tableName: string | null;
    onExportCSV: () => void;
    pinnedColumnNames: string[];
}

const TableEditorFooter: React.FC<TableEditorFooterProps> = ({
    totalRecords,
    visibleColumnCount,
    totalColumnCount,
    pageStartRecord,
    pageEndRecord,
    rowDensity,
    rowDensityOptions,
    setRowDensity,
    error,
    horizontalOverflow,
    pageSize,
    pageSizeOptions,
    setPageSize,
    currentPage,
    totalPages,
    goToPage,
    pageJumpInput,
    setPageJumpInput,
    onOpenSqlEditor,
    tableName,
    onExportCSV,
    pinnedColumnNames,
}) => (
    <div className="flex flex-col gap-3 border-t border-[#2e2e2e] bg-[#111111] px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] sm:px-6 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-3 text-zinc-500">
            <span className="rounded-full border border-[#2e2e2e] bg-[#161616] px-3 py-1 text-zinc-300">
                {totalRecords} rows
            </span>
            <span className="rounded-full border border-[#2e2e2e] bg-[#161616] px-3 py-1 text-zinc-300">
                {visibleColumnCount}/{totalColumnCount} cols
            </span>
            <span className="rounded-full border border-[#2e2e2e] bg-[#161616] px-3 py-1 text-zinc-300">
                {pageStartRecord}-{pageEndRecord}
            </span>
            {pinnedColumnNames.length > 0 && (
                <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-primary">
                    {pinnedColumnNames.length} frozen
                </span>
            )}
            <div className="flex items-center gap-1 rounded-full border border-[#2e2e2e] bg-[#161616] px-1 py-1">
                {Object.entries(rowDensityOptions).map(([key, option]) => (
                    <button
                        key={key}
                        onClick={() => setRowDensity(key)}
                        className={`rounded-full px-3 py-1 transition-colors ${
                            rowDensity === key
                                ? 'bg-primary/10 text-primary'
                                : 'text-zinc-500 hover:text-zinc-200'
                        }`}
                    >
                        {option.label}
                    </button>
                ))}
            </div>
            <div className="flex items-center gap-2 rounded-full border border-[#2e2e2e] bg-[#161616] px-3 py-1">
                <div className={`h-1.5 w-1.5 rounded-full ${error ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]' : 'bg-primary shadow-[0_0_6px_rgba(254,254,0,0.4)]'}`} />
                <span className={error ? 'text-red-400' : 'text-zinc-300'}>
                    {error ? 'db issue' : 'live'}
                </span>
            </div>
            {horizontalOverflow.canScrollRight && (
                <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-primary">
                    scroll for more columns
                </span>
            )}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-zinc-600">
            <label className="flex items-center gap-2 rounded-full border border-[#2e2e2e] bg-[#161616] px-3 py-1.5">
                <span>Rows</span>
                <select
                    value={pageSize}
                    onChange={(event) => setPageSize(Number(event.target.value))}
                    className="bg-transparent text-zinc-200 outline-none"
                >
                    {pageSizeOptions.map((size) => (
                        <option key={size} value={size} className="bg-[#111111] text-zinc-200">
                            {size}
                        </option>
                    ))}
                </select>
            </label>
            <div className="flex items-center gap-2 rounded-full border border-[#2e2e2e] bg-[#161616] px-2 py-1">
                <button
                    disabled={currentPage === 1}
                    onClick={() => goToPage(currentPage - 1)}
                    className="rounded-full p-1 transition-colors hover:text-primary disabled:opacity-30"
                    aria-label="Previous page"
                >
                    <ChevronLeft size={14} />
                </button>
                <span className="px-1 text-zinc-300">
                    page {currentPage} / {totalPages}
                </span>
                <button
                    disabled={currentPage >= totalPages}
                    onClick={() => goToPage(currentPage + 1)}
                    className="rounded-full p-1 transition-colors hover:text-primary disabled:opacity-30"
                    aria-label="Next page"
                >
                    <ChevronRight size={14} />
                </button>
            </div>
            <label className="flex items-center gap-2 rounded-full border border-[#2e2e2e] bg-[#161616] px-3 py-1.5">
                <span>Page</span>
                <input
                    value={pageJumpInput}
                    onChange={(event) => setPageJumpInput(event.target.value.replace(/[^\d]/g, ''))}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            goToPage(Number(pageJumpInput || '1'));
                        }
                    }}
                    className="w-14 bg-transparent text-zinc-200 outline-none"
                />
            </label>
            <button
                onClick={() => onOpenSqlEditor?.(tableName)}
                disabled={!tableName}
                className="flex items-center gap-1.5 rounded-full border border-[#2e2e2e] bg-[#161616] px-3 py-1.5 uppercase transition-colors hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
                <Code2 size={12} /> SQL
            </button>
            <button
                onClick={onExportCSV}
                className="flex items-center gap-1.5 rounded-full border border-[#2e2e2e] bg-[#161616] px-3 py-1.5 uppercase transition-colors hover:text-zinc-200"
            >
                <Download size={12} /> CSV
            </button>
        </div>
    </div>
);

export default TableEditorFooter;
