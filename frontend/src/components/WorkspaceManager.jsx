import React, { useState, useEffect } from 'react';
import { 
    Plus, 
    Search, 
    Users, 
    Settings, 
    Briefcase,
    Globe,
    Shield,
    ArrowRight
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

const WorkspaceManager = ({ onWorkspaceChange, onViewSelect, view = 'wm_overview' }) => {
    const [workspaces, setWorkspaces] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newWorkspaceName, setNewWorkspaceName] = useState('');

    const fetchWorkspaces = async () => {
        try {
            const res = await fetchWithAuth('/api/workspaces');
            if (res.ok) {
                const data = await res.json();
                setWorkspaces(data || []);
            }
        } catch (err) {
            console.error("Failed to fetch workspaces", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchWorkspaces();
    }, []);

    const handleCreate = async () => {
        if (!newWorkspaceName.trim()) return;
        try {
            const res = await fetchWithAuth('/api/workspaces', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newWorkspaceName })
            });
            if (res.ok) {
                setNewWorkspaceName('');
                setShowCreateModal(false);
                fetchWorkspaces();
            }
        } catch (err) {
            console.error("Failed to create workspace", err);
        }
    };

    const handleSelect = (workspace) => {
        localStorage.setItem('ozy_workspace_id', workspace.id);
        if (onWorkspaceChange) onWorkspaceChange(workspace.id);
        if (onViewSelect) onViewSelect('overview');
    };

    const getWorkspaceIcon = (name) => {
        const firstChar = name.charAt(0).toUpperCase();
        const colors = [
            'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
            'bg-blue-500/10 text-blue-500 border-blue-500/20',
            'bg-purple-500/10 text-purple-500 border-purple-500/20',
            'bg-amber-500/10 text-amber-500 border-amber-500/20',
            'bg-rose-500/10 text-rose-500 border-rose-500/20'
        ];
        const colorIdx = (name.length % colors.length);
        return { char: firstChar, style: colors[colorIdx] };
    };

    const filteredWorkspaces = workspaces.filter(w => 
        w.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        w.slug.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="flex flex-col h-full bg-[#050505] p-10 overflow-y-auto custom-scrollbar">
            {/* Header Area */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
                <div>
                    <h1 className="text-4xl font-black text-white italic tracking-tighter uppercase mb-2">Projects</h1>
                    <p className="text-zinc-500 text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                        <Briefcase size={14} />
                        Manage your isolated environments
                    </p>
                </div>
                <button
                    onClick={() => setShowCreateModal(true)}
                    className="flex items-center gap-2 px-6 py-3 bg-primary text-black font-black uppercase text-xs tracking-widest rounded-xl hover:scale-105 transition-transform shadow-[0_0_20px_rgba(var(--primary-rgb),0.3)]"
                >
                    <Plus size={18} strokeWidth={3} />
                    New Project
                </button>
            </div>

            {/* View Content */}
            {view === 'wm_overview' && (
            <>
                {/* Search and Filters */}
                <div className="mb-8">
                    <div className="relative max-w-md">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={18} />
                        <input
                            type="text"
                            placeholder="Search your projects..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-[#111111] border border-[#2e2e2e] rounded-xl pl-12 pr-4 py-3.5 text-sm font-bold text-white placeholder-zinc-700 focus:outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/10 transition-all"
                        />
                    </div>
                </div>

                {/* Grid of Projects */}
                {loading ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-4">
                        <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                        <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em]">Synching Projects...</span>
                    </div>
                ) : filteredWorkspaces.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center bg-[#0a0a0a] border border-dashed border-[#2e2e2e] rounded-3xl p-20 text-center">
                        <div className="w-20 h-20 rounded-full bg-zinc-900 flex items-center justify-center mb-6">
                            <Briefcase size={40} className="text-zinc-700" />
                        </div>
                        <h2 className="text-2xl font-black text-white uppercase tracking-tighter mb-2">No projects found</h2>
                        <p className="text-zinc-500 font-bold uppercase text-[10px] tracking-widest mb-8 max-w-xs">
                            Start by creating your first isolated environment to manage your data and services.
                        </p>
                        <button
                            onClick={() => setShowCreateModal(true)}
                            className="px-8 py-3 bg-white text-black font-black uppercase text-xs tracking-[0.2em] rounded-xl hover:bg-zinc-200 transition-colors"
                        >
                            Create Project
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {filteredWorkspaces.map(w => {
                            const icon = getWorkspaceIcon(w.name);
                            return (
                                <div 
                                    key={w.id}
                                    className="group relative bg-[#0a0a0a] border border-[#2e2e2e] rounded-3xl p-6 hover:border-primary/50 hover:bg-[#0d0d0d] transition-all cursor-pointer overflow-hidden shadow-2xl"
                                    onClick={() => handleSelect(w)}
                                >
                                    {/* Decorative elements */}
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 blur-[80px] group-hover:bg-primary/10 transition-colors" />
                                    
                                    <div className="flex items-start justify-between mb-6 relative z-10">
                                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-black border group-hover:scale-110 transition-transform duration-500 ${icon.style}`}>
                                            {icon.char}
                                        </div>
                                        <button 
                                            className="p-2 text-zinc-600 hover:text-white transition-colors"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                localStorage.setItem('ozy_workspace_id', w.id);
                                                if (onWorkspaceChange) onWorkspaceChange(w.id);
                                                if (onViewSelect) onViewSelect('workspace_settings');
                                            }}
                                        >
                                            <Settings size={18} />
                                        </button>
                                    </div>

                                    <div className="relative z-10">
                                        <h3 className="text-xl font-black text-white tracking-tight mb-1 group-hover:text-primary transition-colors">{w.name}</h3>
                                        <div className="flex items-center gap-2 mb-6">
                                            <Globe size={12} className="text-zinc-600" />
                                            <span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">{w.slug}</span>
                                        </div>

                                        <div className="flex items-center gap-4 border-t border-zinc-900 pt-6">
                                            <div className="flex items-center gap-1.5">
                                                <Users size={12} className="text-zinc-500" />
                                                <span className="text-[10px] font-bold text-zinc-400">Owner</span>
                                            </div>
                                            <div className="w-[1px] h-3 bg-zinc-800" />
                                            <div className="flex items-center gap-1.5">
                                                <Shield size={12} className="text-zinc-500" />
                                                <span className="text-[10px] font-bold text-zinc-400">Production</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-all translate-x-4 group-hover:translate-x-0">
                                        <ArrowRight size={20} className="text-primary" />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </>
            )}

            {view === 'wm_shared' && (
                <div className="flex-1 flex flex-col items-center justify-center bg-[#0a0a0a] border border-dashed border-[#2e2e2e] rounded-3xl p-20 text-center animate-in fade-in duration-500">
                    <div className="w-20 h-20 rounded-full bg-zinc-900 flex items-center justify-center mb-6">
                        <Users size={40} className="text-zinc-700" />
                    </div>
                    <h2 className="text-2xl font-black text-white uppercase tracking-tighter mb-2">No Shared Projects</h2>
                    <p className="text-zinc-500 font-bold uppercase text-[10px] tracking-widest mb-8 max-w-xs">
                        Projects shared with you by other team members will appear here.
                    </p>
                </div>
            )}

            {view === 'wm_templates' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in duration-500">
                    {['SaaS Starter', 'E-commerce', 'Internal Tool'].map((template, i) => (
                        <div key={i} className="group bg-[#0a0a0a] border border-[#2e2e2e] rounded-3xl p-6 hover:border-primary/50 transition-all cursor-pointer">
                            <div className="h-32 bg-zinc-900 rounded-2xl mb-6 flex items-center justify-center">
                                <span className="text-4xl font-black text-zinc-800 group-hover:text-zinc-700 transition-colors">{template.charAt(0)}</span>
                            </div>
                            <h3 className="text-lg font-black text-white uppercase tracking-tight mb-2">{template}</h3>
                            <button className="w-full py-3 bg-[#1a1a1a] text-zinc-400 font-black uppercase text-xs tracking-widest rounded-xl group-hover:bg-primary group-hover:text-black transition-all">
                                Use Template
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Create Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[1000] flex items-center justify-center p-6 animate-in fade-in duration-300">
                    <div className="max-w-md w-full bg-[#111111] border border-[#2e2e2e] rounded-3xl p-8 shadow-[0_0_100px_rgba(0,0,0,0.8)] animate-in zoom-in-95 duration-300">
                        <h2 className="text-2xl font-black text-white italic uppercase tracking-tighter mb-2">Initialize New Project</h2>
                        <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest mb-8">Isolated environment creation</p>

                        <div className="space-y-6">
                            <div>
                                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-2 block">Project Name</label>
                                <input
                                    autoFocus
                                    type="text"
                                    value={newWorkspaceName}
                                    onChange={(e) => setNewWorkspaceName(e.target.value)}
                                    placeholder="Enter project name..."
                                    className="w-full bg-[#0a0a0a] border border-[#2e2e2e] rounded-xl px-4 py-3 text-white font-bold focus:outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/10 transition-all"
                                />
                            </div>

                            <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
                                <p className="text-[9px] text-primary font-black uppercase leading-relaxed tracking-wider">
                                    New projects are initialized with a default schema and dedicated storage bucket. You can configure high-availability and regional settings in the project dashboard.
                                </p>
                            </div>

                            <div className="flex gap-4 pt-4">
                                <button
                                    onClick={() => setShowCreateModal(false)}
                                    className="flex-1 px-6 py-3 bg-[#1a1a1a] text-zinc-400 font-black uppercase text-xs tracking-widest rounded-xl hover:text-white transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleCreate}
                                    disabled={!newWorkspaceName.trim()}
                                    className="flex-1 px-6 py-3 bg-primary text-black font-black uppercase text-xs tracking-widest rounded-xl hover:scale-105 transition-transform disabled:opacity-50 disabled:hover:scale-100"
                                >
                                    Create
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WorkspaceManager;
