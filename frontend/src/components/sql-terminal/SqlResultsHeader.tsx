import React from 'react';
import {
    Activity,
    CheckCircle2,
    ChevronDown,
    Clock,
    Download,
    FileCode,
    FileText,
    Search,
    Table,
    Zap
} from 'lucide-react';

interface SqlResultsHeaderProps {
    activeTab: string;
    setActiveTab: (tab: string) => void;
    results: {
        message: string;
        command: string;
        rowCount: number;
        rowsAffected: number;
        hasResultSet: boolean;
        truncated: boolean;
        resultLimit: number;
        executionTime?: string;
    } | null;
    hasTabularResults: boolean;
    canExportResults: boolean;
    resultSearchTerm: string;
    setResultSearchTerm: (value: string) => void;
    timeRange: number;
    showTimeMenu: boolean;
    setShowTimeMenu: React.Dispatch<React.SetStateAction<boolean>>;
    onApplyTimeRange: (minutes: number) => void;
    showExportMenu: boolean;
    setShowExportMenu: React.Dispatch<React.SetStateAction<boolean>>;
    onInitiateExport: (format: string) => void;
}

const SqlResultsHeader: React.FC<SqlResultsHeaderProps> = ({
    activeTab,
    setActiveTab,
    results,
    hasTabularResults,
    canExportResults,
    resultSearchTerm,
    setResultSearchTerm,
    timeRange,
    showTimeMenu,
    setShowTimeMenu,
    onApplyTimeRange,
    showExportMenu,
    setShowExportMenu,
    onInitiateExport,
}) => (
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
                <Zap size={12} />
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

            {results && activeTab === 'results' && (
                <div className="flex items-center gap-4 border-l border-zinc-800 pl-4 h-full">
                    <span className="text-[9px] font-bold text-green-500 uppercase tracking-widest flex items-center gap-1.5 font-mono">
                        <CheckCircle2 size={10} />
                        {results.message}
                    </span>
                    <span className="text-[9px] font-bold text-zinc-600 tracking-widest font-mono">CMD: {results.command}</span>
                    <span className="text-[9px] font-bold text-zinc-600 tracking-widest font-mono">
                        {results.hasResultSet ? `ROWS: ${results.rowCount}` : `AFFECTED: ${results.rowsAffected}`}
                    </span>
                    {results.truncated && (
                        <span className="text-[9px] font-bold text-amber-300 uppercase tracking-widest font-mono">
                            PREVIEW CAP: {results.resultLimit}
                        </span>
                    )}
                    <span className="text-[9px] font-bold text-zinc-600 tracking-widest font-mono">
                        EXEC: {results.executionTime || '0ms'}
                    </span>
                </div>
            )}
        </div>

        <div className="flex items-center gap-4">
            {activeTab === 'results' && hasTabularResults && (
                <div className="relative hidden xl:block">
                    <Search size={12} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
                    <input
                        type="text"
                        value={resultSearchTerm}
                        onChange={(event) => setResultSearchTerm(event.target.value)}
                        placeholder="Filter preview rows..."
                        className="w-56 rounded-lg border border-[#2e2e2e] bg-[#0c0c0c] py-1.5 pl-8 pr-3 text-[10px] font-bold tracking-[0.1em] text-zinc-200 placeholder:text-zinc-600 focus:border-primary/30 focus:outline-none"
                    />
                </div>
            )}
            {activeTab === 'visualize' && results && (
                <div className="relative">
                    <button
                        onClick={(event) => {
                            event.stopPropagation();
                            setShowTimeMenu((prev) => !prev);
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
                            onClick={(event) => event.stopPropagation()}
                        >
                            {[60, 120, 160, 200].map((minutes) => (
                                <button
                                    key={minutes}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        onApplyTimeRange(minutes);
                                    }}
                                    className={`w-full flex items-center justify-between px-4 py-2.5 text-[10px] font-black uppercase tracking-widest transition-all
                                        ${timeRange === minutes ? 'text-primary bg-primary/10' : 'text-zinc-500 hover:text-white hover:bg-zinc-800/50'}
                                    `}
                                >
                                    <span>Last {minutes} Minutes</span>
                                    {timeRange === minutes && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <div className="relative">
                <button
                    onClick={(event) => {
                        if (!canExportResults) return;
                        event.stopPropagation();
                        setShowExportMenu((prev) => !prev);
                    }}
                    disabled={!canExportResults}
                    className={`flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest transition-colors ${
                        canExportResults ? 'text-zinc-500 hover:text-white' : 'text-zinc-700 cursor-not-allowed'
                    }`}
                >
                    <Download size={12} />
                    Export Data
                    <ChevronDown size={10} className={`transition-transform ${showExportMenu ? 'rotate-180' : ''}`} />
                </button>

                {showExportMenu && (
                    <div className="absolute right-0 mt-2 w-36 bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg shadow-xl z-50 py-1 animate-in fade-in slide-in-from-top-1 duration-200">
                        <button
                            onClick={() => onInitiateExport('csv')}
                            className="w-full flex items-center gap-3 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                        >
                            <Table size={14} className="text-zinc-500" />
                            CSV (Excel)
                        </button>
                        <button
                            onClick={() => onInitiateExport('json')}
                            className="w-full flex items-center gap-3 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                        >
                            <FileCode size={14} className="text-zinc-500" />
                            JSON
                        </button>
                        <button
                            onClick={() => onInitiateExport('txt')}
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
);

export default SqlResultsHeader;
