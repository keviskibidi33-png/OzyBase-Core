import React, { useEffect, useState, useRef } from 'react';
import { fetchWithAuth } from '../utils/api';
import ConfirmModal from './ConfirmModal';
import {
    Database,
    ZoomIn,
    ZoomOut,
    RefreshCw,
    Code,
    Download,
    Layers,
    Search,
    Key,
    Link,
    Hash,
    Calendar,
    ToggleLeft,
    Type,
    FileJson,
    Loader2,
    Lock,
    FileSpreadsheet
} from 'lucide-react';

const SchemaVisualizer = ({ viewMode = 'user' }) => {
    const [schema, setSchema] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [scale, setScale] = useState(1);
    const containerRef = useRef(null);

    const [searchTerm, setSearchTerm] = useState('');
    const [hoveredTable, setHoveredTable] = useState(null);
    const [nodePositions, setNodePositions] = useState({});

    // Panning & Dragging State
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isSpacePressed, setIsSpacePressed] = useState(false);
    const [isPanning, setIsPanning] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 }); // For panning
    const [isDraggingNode, setIsDraggingNode] = useState(false); // For nodes
    const [dragNode, setDragNode] = useState(null);
    const [isExportConfirmOpen, setIsExportConfirmOpen] = useState(false);

    const fetchData = async () => {
        setLoading(true);
        try {
            const res = await fetchWithAuth('/api/collections/visualize');
            if (!res.ok) throw new Error('Failed to fetch schema');
            const data = await res.json();

            // Calculate initial positions (grid layout)
            const positions = {};
            const cols = 4;
            const xGap = 320;
            const yGap = 350;

            data.tables.forEach((table, i) => {
                const col = i % cols;
                const row = Math.floor(i / cols);
                positions[table.name] = {
                    x: 100 + (col * xGap),
                    y: 100 + (row * yGap)
                };
            });

            setNodePositions(positions);
            setSchema(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    useEffect(() => {
        const handleKeyDown = (e) => {
            // Space for Panning
            if (e.code === 'Space' && !e.repeat && !e.target.matches('input, textarea')) {
                setIsSpacePressed(true);
            }

            // Ctrl + +/-/0 for Zooming (using e.code for robustness)
            if (e.ctrlKey || e.metaKey) {
                if (['Equal', 'NumpadAdd', 'Plus'].includes(e.code) || (e.key === '+' || e.key === '=')) {
                    e.preventDefault();
                    setScale(prev => Math.min(prev + 0.1, 2));
                } else if (['Minus', 'NumpadSubtract', 'Hyphen'].includes(e.code) || (e.key === '-')) {
                    e.preventDefault();
                    setScale(prev => Math.max(prev - 0.1, 0.2));
                } else if (['Digit0', 'Numpad0'].includes(e.code) || (e.key === '0')) {
                    e.preventDefault();
                    setScale(1);
                }
            }
        };
        const handleKeyUp = (e) => {
            if (e.code === 'Space') {
                setIsSpacePressed(false);
                setIsPanning(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, []);

    // Native Wheel Listener for Non-Passive Zoom interception
    useEffect(() => {
        if (loading) return; // Wait for loading to finish
        const container = containerRef.current;
        if (!container) return;

        const handleWheel = (e) => {
            if (e.ctrlKey) {
                e.preventDefault();
                e.stopPropagation(); // Stop bubbling
                const delta = e.deltaY * -0.001;
                setScale(prev => Math.min(Math.max(prev + delta, 0.2), 2));
            }
        };

        // { passive: false } is CRITICAL to allow preventDefault()
        container.addEventListener('wheel', handleWheel, { passive: false });

        return () => {
            container.removeEventListener('wheel', handleWheel);
        };
    }, [loading]); // Re-run when loading state changes (element appears)

    const handleCanvasMouseDown = (e) => {
        // Start panning if Space is pressed (or middle click)
        if (isSpacePressed || e.button === 1) {
            setIsPanning(true);
            setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
            e.preventDefault(); // Prevent text selection
        }
    };

    const handleNodeMouseDown = (e, tableName) => {
        if (isSpacePressed) return; // Let it bubble to canvas for panning

        e.stopPropagation(); // Stop bubbling to prevent canvas pan
        setIsDraggingNode(true);
        setDragNode({
            name: tableName,
            startX: e.clientX,
            startY: e.clientY,
            initialX: nodePositions[tableName].x,
            initialY: nodePositions[tableName].y
        });
    };

    const handleMouseMove = (e) => {
        if (isPanning) {
            setPan({
                x: e.clientX - dragStart.x,
                y: e.clientY - dragStart.y
            });
        } else if (isDraggingNode && dragNode) {
            const dx = (e.clientX - dragNode.startX) / scale;
            const dy = (e.clientY - dragNode.startY) / scale;

            setNodePositions(prev => ({
                ...prev,
                [dragNode.name]: {
                    x: dragNode.initialX + dx,
                    y: dragNode.initialY + dy
                }
            }));
        }
    };

    const handleMouseUp = () => {
        setIsPanning(false);
        setIsDraggingNode(false);
        setDragNode(null);
    };

    const getColumnIcon = (type) => {
        const t = (type || '').toLowerCase();
        if (t.includes('uuid')) return <Key size={10} className="text-yellow-500" />;
        if (t.includes('int') || t.includes('num')) return <Hash size={10} className="text-blue-400" />;
        if (t.includes('bool')) return <ToggleLeft size={10} className="text-green-400" />;
        if (t.includes('time') || t.includes('date')) return <Calendar size={10} className="text-purple-400" />;
        if (t.includes('json')) return <FileJson size={10} className="text-orange-400" />;
        return <Type size={10} className="text-zinc-400" />;
    };

    const getPath = (rel) => {
        const fromPos = nodePositions[rel.from_table];
        const toPos = nodePositions[rel.to_table];

        if (!fromPos || !toPos) return '';

        const startX = fromPos.x + 280;
        const startY = fromPos.y + 40;
        const endX = toPos.x;
        const endY = toPos.y + 40;

        const cp1x = startX + (endX - startX) / 2;
        const cp2x = startX + (endX - startX) / 2;

        return `M ${startX} ${startY} C ${cp1x} ${startY}, ${cp2x} ${endY}, ${endX} ${endY}`;
    };

    // SVG Export Removed

    const handleExportCSV = () => {
        if (!schema || !schema.tables) return;

        const headers = ['Table', 'Column', 'Type', 'Is Primary', 'Foreign Key Table', 'Foreign Key Column', 'Visual X', 'Visual Y'];
        const rows = [headers.join(',')];

        // Export only visible tables (filtered)
        const tablesToExport = filteredTables;

        tablesToExport.forEach(table => {
            const pos = nodePositions[table.name] || { x: 0, y: 0 };

            if (table.columns && table.columns.length > 0) {
                table.columns.forEach(col => {
                    // Find FK
                    const rel = schema.relationships?.find(r => r.from_table === table.name && r.from_column === col.name);

                    const row = [
                        table.name,
                        col.name,
                        col.type,
                        col.is_primary ? 'Yes' : 'No',
                        rel ? rel.to_table : '',
                        rel ? rel.to_column : '',
                        Math.round(pos.x),
                        Math.round(pos.y)
                    ];

                    // Simple CSV escaping
                    rows.push(row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','));
                });
            } else {
                // Table with no columns, still export position
                const row = [table.name, '', '', '', '', '', Math.round(pos.x), Math.round(pos.y)];
                rows.push(row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','));
            }
        });

        const csvContent = rows.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', 'ozybase_schema_layout.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    if (loading) return (
        <div className="flex flex-col items-center justify-center h-full gap-4 text-zinc-500">
            <Loader2 className="animate-spin text-primary" size={32} />
            <span className="text-xs font-bold uppercase tracking-widest">Generating Schema Map...</span>
        </div>
    );

    if (error) return (
        <div className="flex items-center justify-center h-full text-red-500 gap-2">
            <Layers size={20} />
            <span className="text-sm font-medium">{error}</span>
        </div>
    );

    const filteredTables = schema.tables.filter(t => {
        const matchesSearch = t.name.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesView = viewMode === 'system' ? t.is_system : !t.is_system;
        return matchesSearch && matchesView;
    });

    return (
        <div className="flex flex-col h-full bg-[#0c0c0c] overflow-hidden text-zinc-300 font-sans relative">
            {/* Toolbar */}
            <div className="absolute top-4 left-4 z-50 flex items-center gap-4 bg-[#1a1a1a]/80 backdrop-blur-md border border-[#2e2e2e] p-2 px-4 rounded-xl shadow-2xl">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={14} />
                    <input
                        type="text"
                        placeholder="Find table..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="bg-zinc-900/50 border border-zinc-800 rounded-lg pl-9 pr-4 py-1.5 text-xs text-white focus:outline-none focus:border-primary/50 w-48 transition-all"
                    />
                </div>
                <div className="w-[1px] h-4 bg-zinc-800" />
                <div className="flex items-center gap-1">
                    <button onClick={() => setScale(s => Math.max(s - 0.1, 0.2))} className="p-1.5 hover:bg-zinc-800 rounded text-zinc-400 hover:text-white"><ZoomOut size={16} /></button>
                    <span className="text-[10px] font-mono w-10 text-center">{Math.round(scale * 100)}%</span>
                    <button onClick={() => setScale(s => Math.min(s + 0.1, 2))} className="p-1.5 hover:bg-zinc-800 rounded text-zinc-400 hover:text-white"><ZoomIn size={16} /></button>
                </div>
                <div className="w-[1px] h-4 bg-zinc-800" />

                {/* View Switcher */}
                <button onClick={() => setIsExportConfirmOpen(true)} className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800 rounded transition-colors text-zinc-400 hover:text-white text-[10px] font-black uppercase tracking-widest">
                    <FileSpreadsheet size={14} /> CSV
                </button>
            </div>

            {/* Canvas */}
            <div
                ref={containerRef}
                className={`flex-1 overflow-hidden relative transition-colors duration-200
                    ${isSpacePressed ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'}
                `}
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                style={{
                    backgroundImage: 'radial-gradient(#2e2e2e 1px, transparent 1px)',
                    backgroundSize: `${20 * scale}px ${20 * scale}px`,
                    backgroundPosition: `${pan.x}px ${pan.y}px` // Move grid with pan
                }}
            >
                <div
                    className="absolute top-0 left-0 w-full h-full transform-origin-top-left transition-transform duration-75 ease-out will-change-transform"
                    style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
                >
                    <svg className="absolute top-0 left-0 w-[5000px] h-[5000px] pointer-events-none z-0">
                        {(schema.relationships || []).filter(rel =>
                            filteredTables.find(t => t.name === rel.from_table) &&
                            filteredTables.find(t => t.name === rel.to_table)
                        ).map((rel, i) => {
                            const isRelated = hoveredTable === rel.from_table || hoveredTable === rel.to_table;
                            return (
                                <path
                                    key={i}
                                    d={getPath(rel)}
                                    stroke={isRelated ? "#F2F200" : "#2e2e2e"}
                                    strokeWidth={isRelated ? "3" : "2"}
                                    fill="none"
                                    markerEnd="url(#arrowhead)"
                                    className="transition-all duration-300"
                                    style={{ opacity: hoveredTable && !isRelated ? 0.2 : 1 }}
                                />
                            );
                        })}
                        <defs>
                            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                                <polygon points="0 0, 10 3.5, 0 7" fill={hoveredTable ? "#F2F200" : "#525252"} />
                            </marker>
                        </defs>
                    </svg>

                    {filteredTables.map((table) => {
                        const pos = nodePositions[table.name] || { x: 0, y: 0 };
                        const isHovered = hoveredTable === table.name;
                        const isMatch = searchTerm && table.name.toLowerCase().includes(searchTerm.toLowerCase());

                        return (
                            <div
                                key={table.name}
                                onMouseDown={(e) => handleNodeMouseDown(e, table.name)}
                                onMouseEnter={() => setHoveredTable(table.name)}
                                onMouseLeave={() => setHoveredTable(null)}
                                style={{
                                    transform: `translate(${pos.x}px, ${pos.y}px)`,
                                    width: '280px',
                                    zIndex: isHovered || isMatch ? 100 : 10
                                }}
                                className={`absolute bg-[#111111]/90 backdrop-blur-md border rounded-xl shadow-2xl transition-all duration-300 group
                                    ${table.is_system
                                        ? (isHovered ? 'border-amber-600/50 shadow-[0_0_30px_rgba(245,158,11,0.2)]' : 'border-amber-900/30 opacity-80')
                                        : (isHovered ? 'border-primary shadow-[0_0_30px_rgba(254,254,0,0.2)]' : 'border-[#2e2e2e]')
                                    }
                                    ${isMatch ? 'ring-2 ring-primary ring-offset-4 ring-offset-[#0c0c0c]' : ''}
                                    ${hoveredTable && !isHovered ? 'opacity-40 grayscale-[0.5]' : 'opacity-100'}
                                `}
                            >
                                {/* Header */}
                                <div className={`px-4 py-3 border-b rounded-t-xl flex items-center justify-between
                                    ${isSpacePressed ? 'cursor-grab' : 'cursor-move'}
                                    ${table.is_system
                                        ? (isHovered ? 'bg-amber-900/20 border-amber-900/50' : 'bg-[#1a0f05] border-amber-900/20')
                                        : (isHovered ? 'bg-primary/10 border-primary/30' : 'bg-[#1a1a1a] border-[#2e2e2e]')
                                    }
                                `}>
                                    <div className="flex items-center gap-2">
                                        {table.is_system ? (
                                            <Lock size={12} className={isHovered ? 'text-amber-500' : 'text-amber-700'} />
                                        ) : (
                                            <Database size={14} className={isHovered ? 'text-primary' : 'text-zinc-500'} />
                                        )}
                                        <span className={`text-xs font-black uppercase tracking-widest ${isHovered ? 'text-white' : (table.is_system ? 'text-amber-700/80' : 'text-zinc-100')}`}>{table.name}</span>
                                    </div>
                                    <div className={`flex items-center gap-2 px-2 py-0.5 rounded-full bg-zinc-900 border ${table.is_system ? 'border-amber-900/30' : 'border-zinc-800'}`}>
                                        <div className={`w-1.5 h-1.5 rounded-full ${table.is_system ? 'bg-amber-600' : 'bg-green-500'}`} />
                                        <span className={`text-[8px] font-black uppercase tracking-widest ${table.is_system ? 'text-amber-600' : 'text-zinc-500'}`}>{table.is_system ? 'System' : 'Public'}</span>
                                    </div>
                                </div>
                                {/* Columns */}
                                <div className="p-3 space-y-1">
                                    {(table.columns || []).map((col, i) => (
                                        <div key={i} className="flex items-center justify-between text-[10px] px-2 py-1.5 rounded-lg hover:bg-zinc-800/80 group/col transition-colors">
                                            <div className="flex items-center gap-3">
                                                <div className="w-4 flex justify-center">
                                                    {col.name === 'id' || col.is_primary ? (
                                                        <Key size={12} className="text-primary" />
                                                    ) : getColumnIcon(col.type)}
                                                </div>
                                                <span className={`font-mono ${col.name === 'id' || col.is_primary ? 'text-primary font-black' : 'text-zinc-400'}`}>
                                                    {col.name}
                                                </span>
                                            </div>
                                            <span className="text-zinc-600 font-mono text-[8px] group-hover/col:text-zinc-400 transition-colors uppercase">
                                                {col.type}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Legend Footer */}
            <div className="h-8 bg-[#111111] border-t border-[#2e2e2e] flex items-center justify-center gap-6 text-[10px] font-mono text-zinc-500 z-50">
                <div className="flex items-center gap-2"><Key size={12} className="text-primary" /> Primary Key</div>
                <div className="flex items-center gap-2"><Link size={12} className="text-zinc-500" /> Foreign Key</div>
                <div className="flex items-center gap-2"><Hash size={12} className="text-blue-400" /> Number</div>
                <div className="flex items-center gap-2"><Type size={12} className="text-zinc-400" /> Text</div>
                <div className="flex items-center gap-2"><Calendar size={12} className="text-purple-400" /> Date</div>
            </div>

            <ConfirmModal
                isOpen={isExportConfirmOpen}
                onClose={() => setIsExportConfirmOpen(false)}
                onConfirm={handleExportCSV}
                title="Export Schema Layout"
                message="Download a CSV file containing your current schema structure, including table relationships and visual positions? This can be used for documentation or backups."
                confirmText="Export CSV"
                type="info"
            />
        </div>
    );
};

export default SchemaVisualizer;
