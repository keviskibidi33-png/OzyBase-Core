import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Plus, LayoutGrid, Check, Settings, Briefcase } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

const WorkspaceSwitcher = ({ onWorkspaceChange }) => {
    const [workspaces, setWorkspaces] = useState([]);
    const [activeWorkspace, setActiveWorkspace] = useState(null);
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);

    const fetchWorkspaces = React.useCallback(async () => {
        try {
            const res = await fetchWithAuth('/api/workspaces');
            if (res.ok) {
                const data = await res.json();
                setWorkspaces(data || []);
                
                const storedId = localStorage.getItem('ozy_workspace_id');
                const active = data.find(w => w.id === storedId) || data[0];
                
                if (active) {
                    setActiveWorkspace(active);
                    if (!storedId) {
                        localStorage.setItem('ozy_workspace_id', active.id);
                    }
                }
            }
        } catch (err) {
            console.error("Failed to load workspaces", err);
        }
    }, [onWorkspaceChange]);

    useEffect(() => {
        fetchWorkspaces();
        
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [fetchWorkspaces]);

    const handleSelect = (workspace) => {
        setActiveWorkspace(workspace);
        localStorage.setItem('ozy_workspace_id', workspace.id);
        setIsOpen(false);
        if (onWorkspaceChange) onWorkspaceChange(workspace.id);
    };

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 px-3 py-1.5 bg-[#171717] hover:bg-zinc-800 border border-[#2e2e2e] rounded-xl transition-all group"
            >
                <div className="w-5 h-5 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20">
                    <Briefcase size={12} className="text-primary" />
                </div>
                <div className="flex flex-col items-start min-w-[100px] max-w-[150px]">
                    <span className="text-[10px] font-black text-white uppercase tracking-wider truncate w-full">
                        {activeWorkspace?.name || 'Select Workspace'}
                    </span>
                    <span className="text-[8px] font-bold text-zinc-600 uppercase tracking-widest">
                        {activeWorkspace?.slug || 'Production'}
                    </span>
                </div>
                <ChevronDown size={14} className={`text-zinc-600 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute top-full left-0 mt-2 w-64 bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl shadow-2xl z-[100] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                    <div className="p-3 border-b border-[#2e2e2e]">
                        <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-3">Your Workspaces</h3>
                        <div className="space-y-1">
                            {workspaces.map(w => (
                                <button
                                    key={w.id}
                                    onClick={() => handleSelect(w)}
                                    className={`w-full flex items-center justify-between p-2 rounded-lg transition-all ${activeWorkspace?.id === w.id ? 'bg-primary/10 border border-primary/20' : 'hover:bg-zinc-800 border border-transparent'}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`w-8 h-8 rounded flex items-center justify-center text-xs font-bold ${activeWorkspace?.id === w.id ? 'bg-primary text-black' : 'bg-zinc-800 text-zinc-500'}`}>
                                            {w.name.substring(0, 2).toUpperCase()}
                                        </div>
                                        <div className="flex flex-col items-start">
                                            <span className={`text-xs font-bold ${activeWorkspace?.id === w.id ? 'text-white' : 'text-zinc-400'}`}>{w.name}</span>
                                            <span className="text-[9px] text-zinc-600 uppercase font-bold tracking-tighter">{w.slug}</span>
                                        </div>
                                    </div>
                                    {activeWorkspace?.id === w.id && <Check size={14} className="text-primary" />}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="p-2 bg-[#111111]">
                        <button className="w-full flex items-center gap-2 px-3 py-2 text-[10px] font-bold text-zinc-500 hover:text-white transition-colors uppercase tracking-widest">
                            <Plus size={14} />
                            Create new workspace
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WorkspaceSwitcher;
