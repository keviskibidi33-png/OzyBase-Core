import React from 'react';

interface TableEditorStateBarProps {
    activeViewId: string | null;
    searchTerm: string;
    hiddenColumnCount: number;
    pinnedColumnNames: string[];
    filtersCount: number;
    sorts: Array<{ column?: string; direction?: string }>;
    selectedCount: number;
    onReset: () => void;
}

const TableEditorStateBar: React.FC<TableEditorStateBarProps> = ({
    activeViewId,
    searchTerm,
    hiddenColumnCount,
    pinnedColumnNames,
    filtersCount,
    sorts,
    selectedCount,
    onReset,
}) => {
    const visibleSorts = sorts.filter((sort) => sort.column && sort.direction);
    const hasState =
        hiddenColumnCount > 0 ||
        pinnedColumnNames.length > 0 ||
        filtersCount > 0 ||
        visibleSorts.length > 0 ||
        selectedCount > 0 ||
        searchTerm.trim() !== '' ||
        !!activeViewId;

    if (!hasState) {
        return null;
    }

    const pinnedLabel =
        pinnedColumnNames.length <= 2
            ? pinnedColumnNames.join(', ')
            : `${pinnedColumnNames.slice(0, 2).join(', ')} +${pinnedColumnNames.length - 2}`;

    return (
        <div className="border-b border-[#2e2e2e] bg-[#121212] px-4 py-2 sm:px-6">
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                {activeViewId && (
                    <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-primary">
                        saved view active
                    </span>
                )}
                {searchTerm.trim() !== '' && (
                    <span className="rounded-full border border-[#2e2e2e] bg-[#171717] px-3 py-1 text-zinc-300">
                        search: {searchTerm.trim()}
                    </span>
                )}
                {hiddenColumnCount > 0 && (
                    <span className="rounded-full border border-[#2e2e2e] bg-[#171717] px-3 py-1 text-zinc-300">
                        {hiddenColumnCount} hidden columns
                    </span>
                )}
                {pinnedColumnNames.length > 0 && (
                    <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-primary">
                        frozen: {pinnedLabel}
                    </span>
                )}
                {filtersCount > 0 && (
                    <span className="rounded-full border border-[#2e2e2e] bg-[#171717] px-3 py-1 text-zinc-300">
                        {filtersCount} active filters
                    </span>
                )}
                {visibleSorts.map((sort) => (
                    <span
                        key={`${sort.column}-${sort.direction}`}
                        className="rounded-full border border-[#2e2e2e] bg-[#171717] px-3 py-1 text-zinc-300"
                    >
                        sort: {sort.column} {sort.direction}
                    </span>
                ))}
                {selectedCount > 0 && (
                    <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-primary">
                        {selectedCount} selected rows
                    </span>
                )}
                <button
                    onClick={onReset}
                    className="rounded-full border border-[#2e2e2e] bg-[#171717] px-3 py-1 text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
                >
                    reset view
                </button>
            </div>
        </div>
    );
};

export default TableEditorStateBar;
