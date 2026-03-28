import React, { useState, useEffect } from 'react';
import { 
    Users, 
    Settings, 
    Trash2, 
    Mail, 
    AlertTriangle,
    Save,
    UserPlus,
    Lock
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

interface Workspace {
    id: string | number;
    name: string;
    slug?: string;
    config?: Record<string, unknown>;
}

interface WorkspaceMember {
    user_id: string;
    email: string;
    role: 'owner' | 'admin' | 'member' | 'viewer' | string;
}

interface WorkspaceSettingsProps {
    workspaceId?: string | number | null;
    view?: 'ws_general' | 'ws_members' | 'ws_danger' | string;
    onViewSelect?: (view: string) => void;
    onWorkspaceChange?: (workspaceId: string | null) => void;
}

const isWorkspace = (value: unknown): value is Workspace => (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'name' in value &&
    typeof (value as { name: unknown }).name === 'string'
);

const isWorkspaceMember = (value: unknown): value is WorkspaceMember => (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { user_id?: unknown }).user_id === 'string' &&
    typeof (value as { email?: unknown }).email === 'string' &&
    typeof (value as { role?: unknown }).role === 'string'
);

const WorkspaceSettings: React.FC<WorkspaceSettingsProps> = ({
    workspaceId,
    view = 'ws_general',
    onViewSelect,
    onWorkspaceChange
}) => {
    const [workspace, setWorkspace] = useState<Workspace | null>(null);
    const [members, setMembers] = useState<WorkspaceMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState('member');
    const [saving, setSaving] = useState(false);
    const [name, setName] = useState('');

    const fetchData = React.useCallback(async () => {
        if (!workspaceId) {
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            // Fetch workspace info from the list
            const resWs = await fetchWithAuth('/api/workspaces');
            if (resWs.ok) {
                const data: unknown = await resWs.json();
                const workspaces = Array.isArray(data) ? data.filter(isWorkspace) : [];
                const current = workspaces.find((w: any) => String(w.id) === String(workspaceId));
                if (current) {
                    setWorkspace(current);
                    setName(current.name);
                }
            }

            // Fetch members
            const resMembers = await fetchWithAuth(`/api/workspaces/${workspaceId}/members`);
            if (resMembers.ok) {
                const data: unknown = await resMembers.json();
                const workspaceMembers = Array.isArray(data) ? data.filter(isWorkspaceMember) : [];
                setMembers(workspaceMembers);
            }
        } catch (err: unknown) {
            console.error("Failed to load settings data", err);
        } finally {
            setLoading(false);
        }
    }, [workspaceId]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleUpdateName = async () => {
        if (!workspaceId || !workspace) return;
        setSaving(true);
        try {
            const res = await fetchWithAuth(`/api/workspaces/${workspaceId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, config: workspace.config ?? {} })
            });
            if (res.ok) {
                fetchData();
            }
        } catch (err: unknown) {
            console.error(err);
        } finally {
            setSaving(false);
        }
    };

    const handleRemoveMember = async (userId: string) => {
        try {
            const res = await fetchWithAuth(`/api/workspaces/${workspaceId}/members/${userId}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                fetchData();
            }
        } catch (err: unknown) {
            console.error(err);
        }
    };

    const handleInvite = async () => {
        const identifier = inviteEmail.trim();
        if (!identifier) return;

        const payload = identifier.includes('@')
            ? { email: identifier, role: inviteRole }
            : { user_id: identifier, role: inviteRole };

        try {
            const res = await fetchWithAuth(`/api/workspaces/${workspaceId}/members`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                setInviteEmail('');
                fetchData();
            }
        } catch (err: unknown) {
            console.error(err);
        }
    };

    const handleDeleteWorkspace = async () => {
        if (!workspaceId || !workspace) return;
        const confirmed = window.confirm(`Delete workspace "${workspace.name}"? This action cannot be undone.`);
        if (!confirmed) return;

        setSaving(true);
        try {
            const res = await fetchWithAuth(`/api/workspaces/${workspaceId}`, {
                method: 'DELETE'
            });
            if (!res.ok) {
                throw new Error('failed to delete workspace');
            }

            const activeWorkspaceId = localStorage.getItem('ozy_workspace_id');
            if (activeWorkspaceId && String(activeWorkspaceId) === String(workspaceId)) {
                localStorage.removeItem('ozy_workspace_id');
                onWorkspaceChange?.(null);
            }

            onViewSelect?.('workspaces');
        } catch (err: unknown) {
            console.error(err);
        } finally {
            setSaving(false);
        }
    };

    if (loading) return (
        <div className="flex-1 flex items-center justify-center p-10 bg-[#0c0c0c]">
            <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
    );

    if (!workspace) return (
        <div className="flex-1 flex items-center justify-center p-10 bg-[#0c0c0c]">
             <div className="text-center">
                <AlertTriangle className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
                <h2 className="text-zinc-500 font-bold">No Workspace Selected</h2>
                <p className="text-zinc-700 text-sm mt-2">Please select a workspace to configure settings.</p>
             </div>
        </div>
    );

    return (
        <div className="flex-1 overflow-y-auto p-12 bg-[#0c0c0c] custom-scrollbar animate-in fade-in duration-500">
            <div className="max-w-4xl mx-auto">
                <div className="mb-12">
                    <h1 className="text-3xl font-black text-white uppercase italic tracking-tighter mb-2">Project Settings</h1>
                    <p className="text-zinc-500 text-[10px] font-black uppercase tracking-[0.3em]">Configure {workspace?.name} core parameters</p>
                </div>

                <div className="grid grid-cols-1 gap-12">
                    {/* General Settings */}
                    {(view === 'ws_general' || !view) && (
                    <section className="bg-[#0f0f0f] border border-[#2e2e2e] rounded-3xl overflow-hidden shadow-2xl">
                        <div className="p-8 border-b border-[#2e2e2e] bg-[#141414]">
                            <h2 className="text-lg font-black text-white uppercase tracking-wider flex items-center gap-3">
                                <Settings size={18} className="text-primary" />
                                General Configuration
                            </h2>
                        </div>
                        <div className="p-8 space-y-8">
                            <div>
                                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-4 block">Project Name</label>
                                <div className="flex gap-4">
                                    <input
                                        type="text"
                                        value={name}
                                        onChange={(e: any) => setName(e.target.value)}
                                        className="flex-1 bg-[#050505] border border-[#2e2e2e] rounded-xl px-4 py-3 text-sm font-bold text-white focus:outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/10 transition-all"
                                    />
                                    <button 
                                        onClick={handleUpdateName}
                                        disabled={saving || name === workspace?.name}
                                        className="px-6 py-3 bg-primary text-black font-black uppercase text-xs tracking-widest rounded-xl hover:scale-105 transition-transform disabled:opacity-50 disabled:hover:scale-100 flex items-center gap-2"
                                    >
                                        <Save size={16} />
                                        Save
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-4 block">Project Identifier (Slug)</label>
                                <div className="p-4 bg-[#0a0a0a] border border-zinc-900 rounded-xl flex items-center justify-between border-dashed">
                                    <span className="text-sm font-mono text-zinc-600">{workspace?.slug}</span>
                                    <Lock size={14} className="text-zinc-800" />
                                </div>
                                <p className="mt-2 text-[9px] text-zinc-700 font-bold uppercase tracking-wider">Identifiers cannot be changed after project initialization.</p>
                            </div>
                        </div>
                    </section>
                    )}

                    {/* Team Members */}
                    {view === 'ws_members' && (
                    <section className="bg-[#0f0f0f] border border-[#2e2e2e] rounded-3xl overflow-hidden shadow-2xl">
                        <div className="p-8 border-b border-[#2e2e2e] bg-[#141414] flex items-center justify-between">
                            <h2 className="text-lg font-black text-white uppercase tracking-wider flex items-center gap-3">
                                <Users size={18} className="text-primary" />
                                Access Control (IAM)
                            </h2>
                            <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-3 py-1 rounded-full font-black uppercase tracking-widest">
                                {members.length} Members
                            </span>
                        </div>
                        <div className="p-8">
                            {/* Invite Box */}
                            <div className="mb-10 bg-[#050505] p-6 border border-zinc-900 border-dashed rounded-2xl">
                                <h3 className="text-xs font-black text-white uppercase tracking-[0.15em] mb-4">Invite new collaborator</h3>
                                <div className="flex flex-col md:flex-row gap-4">
                                    <div className="flex-1 relative">
                                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={16} />
                                        <input
                                            type="text"
                                            placeholder="Member email or user ID"
                                            value={inviteEmail}
                                            onChange={(e: any) => setInviteEmail(e.target.value)}
                                            className="w-full bg-[#111111] border border-[#2e2e2e] rounded-xl pl-12 pr-4 py-3 text-sm font-bold text-white focus:outline-none focus:border-primary/50 transition-all"
                                        />
                                    </div>
                                    <select 
                                        value={inviteRole}
                                        onChange={(e: any) => setInviteRole(e.target.value)}
                                        className="bg-[#111111] border border-[#2e2e2e] rounded-xl px-4 py-3 text-xs font-black text-white uppercase tracking-widest focus:outline-none focus:border-primary/50"
                                    >
                                        <option value="member">Member</option>
                                        <option value="admin">Admin</option>
                                        <option value="viewer">Viewer</option>
                                    </select>
                                    <button 
                                        onClick={handleInvite}
                                        disabled={!inviteEmail.trim()}
                                        className="px-6 py-3 bg-white text-black font-black uppercase text-xs tracking-widest rounded-xl hover:bg-zinc-200 transition-colors flex items-center gap-2"
                                    >
                                        <UserPlus size={16} />
                                        Invite
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-4">
                                {members.map((member: any) => (
                                    <div key={member.user_id} className="flex items-center justify-between p-4 bg-[#0a0a0a] border border-[#2e2e2e] rounded-2xl group hover:border-zinc-700 transition-all">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500 font-black">
                                                {member.email.charAt(0).toUpperCase()}
                                            </div>
                                            <div>
                                                <div className="text-sm font-black text-white">{member.email}</div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">UID: {member.user_id.substring(0, 8)}...</span>
                                                    <span className={`text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest ${
                                                        member.role === 'owner' ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' :
                                                        member.role === 'admin' ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' :
                                                        'bg-zinc-800 text-zinc-400'
                                                    }`}>
                                                        {member.role}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        
                                        {member.role !== 'owner' && (
                                            <button 
                                                onClick={() => handleRemoveMember(member.user_id)}
                                                className="p-2.5 text-zinc-800 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </section>
                    )}

                    {/* Danger Zone */}
                    {view === 'ws_danger' && (
                    <section className="bg-red-500/5 border border-red-500/20 rounded-3xl overflow-hidden shadow-2xl">
                        <div className="p-8 border-b border-red-500/20 bg-red-500/10">
                            <h2 className="text-lg font-black text-red-500 uppercase tracking-wider flex items-center gap-3">
                                <AlertTriangle size={18} />
                                Termination Protocol
                            </h2>
                        </div>
                        <div className="p-8">
                            <p className="text-sm text-zinc-400 font-bold mb-6 italic">
                                Deleting this project will permanently erase all associated data, configurations, and edge functions. This action is catastrophic and irreversible.
                            </p>
                            <button
                                onClick={handleDeleteWorkspace}
                                disabled={saving}
                                className="px-8 py-3 bg-red-600 text-white font-black uppercase text-xs tracking-[0.2em] rounded-xl hover:bg-red-700 transition-colors flex items-center gap-3 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                <Trash2 size={16} />
                                Delete Workspace
                            </button>
                        </div>
                    </section>
                    )}
                </div>
            </div>
        </div>
    );
};

export default WorkspaceSettings;
