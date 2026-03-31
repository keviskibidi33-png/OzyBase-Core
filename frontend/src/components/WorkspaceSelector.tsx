import React from 'react';
import { Briefcase, Globe, Command } from 'lucide-react';

interface WorkspaceSummary {
    name?: string | null;
}

interface WorkspaceSelectorProps {
    activeWorkspace?: WorkspaceSummary | null;
    onClick?: () => void;
}

const WorkspaceSelector = ({ activeWorkspace, onClick }: WorkspaceSelectorProps) => {
    return (
        <div 
            onClick={onClick}
            className="group relative flex items-center gap-4 p-3 rounded-2xl bg-[#0f0f0f] border border-[#2e2e2e] hover:border-primary/30 hover:bg-[#141414] transition-all cursor-pointer select-none mb-8"
        >
            {/* Icon Container */}
            <div className="w-12 h-12 rounded-xl bg-[#1a1a1a] border border-[#2e2e2e] flex items-center justify-center text-zinc-500 group-hover:text-primary transition-colors">
                <Briefcase size={20} />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
                <h3 className="text-[10px] font-black text-white uppercase tracking-[0.2em] leading-none mb-1.5 flex items-center gap-2">
                    Select Project
                </h3>
                <div className="flex items-center gap-2 text-zinc-500 group-hover:text-zinc-300 transition-colors">
                    <Globe size={12} className="text-primary/50" />
                    <span className="text-[11px] font-bold uppercase tracking-widest truncate">
                        {activeWorkspace?.name || 'OZYBASE'}
                    </span>
                </div>
            </div>

            {/* Shortcut Hint */}
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#050505] border border-[#2e2e2e] text-[10px] font-black text-zinc-600">
                <Command size={10} />
                <span>K</span>
            </div>

            {/* Subtle Glow */}
            <div className="absolute inset-x-0 -bottom-px h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
    );
};

export default WorkspaceSelector;
