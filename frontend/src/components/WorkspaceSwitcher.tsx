import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
    ChevronDown, 
    Plus, 
    LayoutGrid, 
    Check, 
    Settings, 
    Briefcase, 
    Search,
    Globe,
    Lock,
    Users,
    Building2,
    Command
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

interface Workspace {
    id: string;
    name: string;
    slug: string;
}

interface WorkspaceSwitcherProps {
    onWorkspaceChange?: (workspaceID: string) => void;
    onViewSelect?: (view: string) => void;
    isExpanded?: boolean;
    workspaceId?: string | null;
}

const WorkspaceSwitcher = ({ onWorkspaceChange, onViewSelect, isExpanded = false, workspaceId = null }: WorkspaceSwitcherProps) => {
    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const dropdownRef = useRef<HTMLDivElement | null>(null);

    const fetchWorkspaces = React.useCallback(async () => {
        try {
            const res = await fetchWithAuth('/api/workspaces');
            if (res.ok) {
                const data: unknown = await res.json();
                const workspaceData = Array.isArray(data) ? (data as Workspace[]) : [];
                setWorkspaces(workspaceData);
                
                const storedId = workspaceId || localStorage.getItem('ozy_workspace_id');
                const active = workspaceData.find((w: any) => w.id === storedId) || workspaceData[0] || null;
                
                if (active) {
                    setActiveWorkspace(active);
                    if (!storedId || storedId !== active.id) {
                        localStorage.setItem('ozy_workspace_id', active.id);
                    }
                }
            }
        } catch (err) {
            console.error("Failed to load workspaces", err);
        }
    }, []);

    useEffect(() => {
        const init = async () => {
            await fetchWorkspaces();
        };
        init();
        
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && event.target instanceof Node && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [fetchWorkspaces]);

    useEffect(() => {
        if (!workspaceId || workspaces.length === 0) {
            return;
        }
        const nextActive = workspaces.find((workspace: Workspace) => workspace.id === workspaceId) || null;
        if (nextActive) {
            setActiveWorkspace(nextActive);
        }
    }, [workspaceId, workspaces]);

    const handleSelect = (workspace: Workspace) => {
        setActiveWorkspace(workspace);
        localStorage.setItem('ozy_workspace_id', workspace.id);
        setIsOpen(false);
        if (onWorkspaceChange) onWorkspaceChange(workspace.id);
    };

    const filteredWorkspaces = useMemo(() => {
        return workspaces.filter((w: any) => 
            w.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            w.slug.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [workspaces, searchQuery]);

    const getWorkspaceIcon = (name: string) => {
        const firstChar = name.charAt(0).toUpperCase();
        const colors = [
            'bg-emerald-500/20 text-emerald-500 border-emerald-500/30',
            'bg-blue-500/20 text-blue-500 border-blue-500/30',
            'bg-purple-500/20 text-purple-500 border-purple-500/30',
            'bg-amber-500/20 text-amber-500 border-amber-500/30',
            'bg-rose-500/20 text-rose-500 border-rose-500/30'
        ];
        const colorIdx = (name.length % colors.length);
        return { char: firstChar, style: colors[colorIdx] };
    };

    return (
        <div className={`relative w-full transition-all duration-300 ${isExpanded ? 'px-4 mb-6' : 'px-1 mb-4'}`} ref={dropdownRef}>
            <div 
                onClick={() => setIsOpen(!isOpen)}
                className={`group relative flex items-center transition-all cursor-pointer select-none ${
                    isExpanded 
                    ? `gap-4 p-3 rounded-2xl bg-[#0a0a0a] border hover:border-primary/30 hover:bg-[#111111] ${isOpen ? 'ring-2 ring-primary/20 border-primary/50 bg-[#111111]' : 'border-[#2e2e2e]'}`
                    : `justify-center p-2 rounded-xl bg-transparent hover:bg-zinc-800/40 border border-transparent ${isOpen ? 'bg-zinc-800/60 border-primary/30' : ''}`
                }`}
            >
                {/* Icon Container */}
                <div className={`rounded-xl flex items-center justify-center transition-all shrink-0 ${
                    isExpanded 
                    ? `w-12 h-12 ${activeWorkspace ? 'bg-primary/10 border border-primary/20 text-primary' : 'bg-[#1a1a1a] border border-[#2e2e2e] text-zinc-500'}`
                    : `w-9 h-9 ${activeWorkspace ? 'bg-primary/20 border border-primary/30 text-primary' : 'bg-zinc-900 border border-zinc-800 text-zinc-600'}`
                }`}>
                    {activeWorkspace ? (
                        <span className={`${isExpanded ? 'text-sm' : 'text-[10px]'} font-black uppercase`}>{activeWorkspace.name.charAt(0)}</span>
                    ) : (
                        <Briefcase size={isExpanded ? 20 : 16} />
                    )}
                </div>

                {/* Content - Hidden when collapsed */}
                {isExpanded && (
                    <div className="flex-1 min-w-0 animate-in fade-in slide-in-from-left-2 duration-300">
                        <h3 className="text-[10px] font-black text-white uppercase tracking-[0.2em] leading-none mb-1.5 flex items-center gap-2">
                            {isOpen ? 'Searching...' : 'Select Workspace'}
                        </h3>
                        <div className="flex items-center gap-2 text-zinc-500 group-hover:text-zinc-300 transition-colors">
                            <Globe size={12} className="text-primary/50" />
                            <span className="text-[11px] font-bold uppercase tracking-widest truncate">
                                {activeWorkspace?.name || 'OZYBASE'}
                            </span>
                        </div>
                    </div>
                )}

                {/* Shortcut Hint - Hidden when collapsed */}
                {isExpanded && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#050505] border border-[#2e2e2e] text-[10px] font-black text-zinc-600 shadow-inner animate-in fade-in zoom-in-95 duration-300">
                        <Command size={10} />
                        <span>K</span>
                    </div>
                )}

                {/* Subtle Glow */}
                {isExpanded && (
                    <div className={`absolute inset-x-0 -bottom-px h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />
                )}
            </div>

            {isOpen && (
                <div className={`absolute ${isExpanded ? 'top-[calc(100%+8px)] left-2 right-2' : 'top-0 left-[calc(100%+12px)] w-64'} bg-[#0c0c0c] border border-[#2e2e2e] rounded-2xl shadow-[0_20px_50px_-12px_rgba(0,0,0,0.8)] z-[200] overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-top-4 duration-300 backdrop-blur-xl`}>
                    {/* Search Bar */}
                    <div className="p-3 border-b border-[#2e2e2e] bg-[#111111]/50">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={14} />
                            <input
                                autoFocus
                                type="text"
                                placeholder="Search workspaces..."
                                value={searchQuery}
                                onChange={(e: any) => setSearchQuery(e.target.value)}
                                className="w-full bg-zinc-900/50 border border-zinc-800/50 rounded-lg pl-9 pr-4 py-2 text-[10px] font-bold text-white placeholder-zinc-600 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                            />
                        </div>
                    </div>

                    {/* Workspace List */}
                    <div className="max-h-[300px] overflow-y-auto custom-scrollbar p-2 space-y-1">
                        <h3 className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.2em] px-3 py-2">Your Projects</h3>
                        
                        {filteredWorkspaces.length === 0 ? (
                            <div className="py-8 px-4 text-center">
                                <p className="text-[10px] font-bold text-zinc-600 uppercase">No workspaces found</p>
                            </div>
                        ) : (
                            filteredWorkspaces.map((w: any) => (
                                <button
                                    key={w.id}
                                    onClick={() => handleSelect(w)}
                                    className={`w-full flex items-center justify-between p-2.5 rounded-xl transition-all group ${activeWorkspace?.id === w.id ? 'bg-primary/5 border border-primary/20' : 'hover:bg-zinc-900 border border-transparent'}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black border transition-transform group-hover:scale-110 ${getWorkspaceIcon(w.name).style}`}>
                                            {getWorkspaceIcon(w.name).char}
                                        </div>
                                        <div className="flex flex-col items-start">
                                            <span className={`text-[11px] font-black leading-tight ${activeWorkspace?.id === w.id ? 'text-white' : 'text-zinc-400 group-hover:text-zinc-200'}`}>{w.name}</span>
                                            <span className="text-[8px] text-zinc-600 uppercase font-black tracking-widest">{w.slug}</span>
                                        </div>
                                    </div>
                                    {activeWorkspace?.id === w.id && (
                                        <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                                            <Check size={10} className="text-black" />
                                        </div>
                                    )}
                                </button>
                            ))
                        )}
                    </div>

                    {/* Footer Actions */}
                    <div className="p-2 border-t border-[#2e2e2e] bg-[#080808]">
                        <button 
                            onClick={() => {
                                setIsOpen(false);
                                if (onViewSelect) onViewSelect('workspace_settings');
                            }}
                            className="w-full flex items-center gap-3 px-3 py-2.5 text-[10px] font-black text-zinc-500 hover:text-white hover:bg-zinc-900/50 rounded-xl transition-all uppercase tracking-widest group"
                        >
                            <Settings size={14} className="group-hover:rotate-45 transition-transform" />
                            Workspace Settings
                        </button>
                        <button 
                            onClick={() => {
                                setIsOpen(false);
                                if (onViewSelect) onViewSelect('workspaces');
                            }}
                            className="w-full flex items-center gap-3 px-3 py-2.5 text-[10px] font-black text-zinc-500 hover:text-white hover:bg-zinc-900/50 rounded-xl transition-all uppercase tracking-widest group"
                        >
                            <LayoutGrid size={14} className="group-hover:scale-110 transition-transform" />
                            All Workspaces
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WorkspaceSwitcher;
