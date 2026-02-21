import React, { useState, useEffect, useCallback } from 'react';
import {
    FolderOpen,
    Plus,
    Search,
    HardDrive,
    Shield,
    FileIcon,
    Image as ImageIcon,
    Video,
    Lock,
    Settings,
    MoreHorizontal,
    LayoutGrid,
    List
} from 'lucide-react';

const StorageManager = () => {
    const [viewMode, setViewMode] = useState('grid');
    const [files, setFiles] = useState([]);
    const [buckets, setBuckets] = useState([]);
    const [selectedBucket, setSelectedBucket] = useState('default');
    const [loading, setLoading] = useState(true);
    const fileInputRef = React.useRef(null);

    const fetchBuckets = useCallback(async () => {
        try {
            const token = localStorage.getItem('ozy_token');
            const res = await fetch('/api/files/buckets', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (Array.isArray(data)) {
                setBuckets(data);
                // If current selected bucket not in list (and not 'default'), select first
                if (data.length > 0 && !data.find(b => b.name === selectedBucket)) {
                    // But we keep default if it's there
                }
            }
        } catch (error) {
            console.error('Failed to fetch buckets:', error);
        }
    }, [selectedBucket]);

    const fetchFiles = useCallback(async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('ozy_token');
            const res = await fetch(`/api/files?bucket=${selectedBucket}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            const data = await res.json();
            if (Array.isArray(data)) {
                setFiles(data);
            }
        } catch (error) {
            console.error('Failed to fetch files:', error);
        } finally {
            setLoading(false);
        }
    }, [selectedBucket]);

    useEffect(() => {
        fetchBuckets();
    }, [fetchBuckets]);

    useEffect(() => {
        fetchFiles();
    }, [fetchFiles]);

    const createBucket = async () => {
        const name = prompt("Enter bucket name:");
        if (!name) return;
        const isPublic = confirm("Make bucket public?");
        const isRLS = confirm("Enable Row Level Security (RLS)?");

        let rlsRule = "auth.uid() = owner_id";
        if (isRLS) {
            const ruleInput = prompt("Enter RLS Rule (default: auth.uid() = owner_id)\nOptions: auth.uid() = owner_id, auth.role() = 'admin', true, false", rlsRule);
            if (ruleInput) rlsRule = ruleInput;
        }

        try {
            const token = localStorage.getItem('ozy_token');
            const res = await fetch('/api/files/buckets', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name,
                    public: isPublic,
                    rls_enabled: isRLS,
                    rls_rule: rlsRule
                })
            });

            if (res.ok) {
                await fetchBuckets();
            }
        } catch (error) {
            console.error('Failed to create bucket:', error);
        }
    };

    const handleUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        setLoading(true);
        try {
            const token = localStorage.getItem('ozy_token');
            const res = await fetch(`/api/files?bucket=${selectedBucket}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: formData
            });

            if (res.ok) {
                await fetchFiles();
            } else {
                console.error('Failed to upload file');
            }
        } catch (error) {
            console.error('Upload error:', error);
        } finally {
            setLoading(false);
        }
    };

    const triggerUpload = () => {
        fileInputRef.current?.click();
    };

    const formatSize = (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    return (
        <div className="flex h-full bg-[#171717] animate-in fade-in duration-500 overflow-hidden">
            {/* Sidebar for Buckets */}
            <div className="w-64 border-r border-[#2e2e2e] bg-[#0c0c0c] flex flex-col p-6">
                <div className="flex items-center justify-between mb-8">
                    <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Buckets</h3>
                    <button
                        onClick={createBucket}
                        className="text-zinc-600 hover:text-primary"
                    >
                        <Plus size={14} />
                    </button>
                </div>
                <div className="space-y-2">
                    {[{ name: 'default', public: true }, ...buckets.filter(b => b.name !== 'default')].map(b => (
                        <button
                            key={b.name}
                            onClick={() => setSelectedBucket(b.name)}
                            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-xs font-bold transition-all ${selectedBucket === b.name
                                ? 'bg-primary/10 text-primary border border-primary/20'
                                : 'text-zinc-500 hover:bg-zinc-900 border border-transparent'
                                }`}
                        >
                            <div className="flex items-center gap-3">
                                <HardDrive size={16} className={selectedBucket === b.name ? 'text-primary' : 'text-zinc-700'} />
                                {b.name}
                            </div>
                            {b.public ? <Settings size={12} className="opacity-40" /> : <Lock size={12} className="opacity-40" />}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Header Controls */}
                <div className="px-8 py-10 border-b border-[#2e2e2e] bg-[#1a1a1a]">
                    <div className="flex items-center justify-between mb-10">
                        <div className="flex items-center gap-6">
                            <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center border border-primary/20">
                                <FolderOpen className="text-primary" size={28} />
                            </div>
                            <div>
                                <h1 className="text-3xl font-black text-white uppercase tracking-tighter italic">Storage</h1>
                                <p className="text-zinc-500 text-[10px] font-black uppercase tracking-[0.2em] mt-1 flex items-center gap-2">
                                    <Shield size={12} className="text-primary" />
                                    Object Storage Engine
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            <button
                                onClick={fetchFiles}
                                className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-500 hover:text-white transition-all"
                            >
                                <Settings size={18} />
                            </button>
                            <button
                                onClick={triggerUpload}
                                className="flex items-center gap-2 bg-primary text-black px-6 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-[#E6E600] transition-all shadow-[0_0_25px_rgba(254,254,0,0.15)]"
                            >
                                <Plus size={16} strokeWidth={3} />
                                Upload File
                            </button>
                            <input
                                type="file"
                                className="hidden"
                                ref={fileInputRef}
                                onChange={handleUpload}
                            />
                        </div>
                    </div>

                    <div className="flex items-center justify-between px-2">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setViewMode('grid')}
                                className={`p-2 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-primary text-black' : 'text-zinc-600 hover:text-zinc-300'}`}
                            >
                                <LayoutGrid size={18} />
                            </button>
                            <button
                                onClick={() => setViewMode('list')}
                                className={`p-2 rounded-lg transition-all ${viewMode === 'list' ? 'bg-primary text-black' : 'text-zinc-600 hover:text-zinc-300'}`}
                            >
                                <List size={18} />
                            </button>
                            <div className="h-4 w-[1px] bg-[#2e2e2e] mx-2" />
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={14} />
                                <input
                                    type="text"
                                    placeholder="Search files..."
                                    className="bg-transparent border-none text-xs font-bold uppercase tracking-widest text-zinc-300 focus:outline-none w-64 placeholder:text-zinc-700"
                                />
                            </div>
                        </div>

                        <div className="flex items-center gap-8">
                            <div className="text-right">
                                <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Total Files</p>
                                <p className="text-sm font-black text-zinc-200">{files.length} ITEMS</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Buckets Explorer */}
                <div className="flex-1 p-8 overflow-y-auto custom-scrollbar">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center h-64 gap-4">
                            <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600">Accessing Storage Nodes...</p>
                        </div>
                    ) : files.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-zinc-900 rounded-3xl gap-4">
                            <FolderOpen size={48} className="text-zinc-800" />
                            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600">Storage is empty</p>
                            <button
                                onClick={triggerUpload}
                                className="text-primary text-[10px] font-black uppercase tracking-widest hover:underline"
                            >
                                Click to upload
                            </button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            {files.map((f, i) => (
                                <div key={i} className="bg-[#111111] border border-[#2e2e2e] rounded-3xl p-6 shadow-2xl hover:border-primary/30 transition-all group relative overflow-hidden">
                                    <div className="relative z-10">
                                        <div className="flex items-start justify-between mb-6">
                                            <div className="p-4 rounded-2xl bg-primary/10 text-primary border border-primary/20">
                                                {f.name.match(/\.(jpg|jpeg|png|gif|svg)$/i) ? <ImageIcon size={24} /> : <FileIcon size={24} />}
                                            </div>
                                            <button className="text-zinc-700 hover:text-zinc-200"><MoreHorizontal size={20} /></button>
                                        </div>
                                        <h3 className="text-xl font-black text-white tracking-tighter italic uppercase truncate mb-1" title={f.name}>{f.name.split('_').pop()}</h3>
                                        <div className="flex items-center gap-3 mb-6">
                                            <span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">{formatSize(f.size)}</span>
                                        </div>

                                        <div className="flex items-center justify-between mt-auto">
                                            <div className="flex items-center gap-2 px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800">
                                                <Lock size={10} className="text-zinc-600" />
                                                <span className="text-[8px] font-black uppercase tracking-widest text-zinc-500">
                                                    Active
                                                </span>
                                            </div>
                                            <a href={f.path} target="_blank" rel="noreferrer" className="text-[10px] font-black uppercase tracking-[0.2em] text-primary hover:underline">View Asset</a>
                                        </div>
                                    </div>
                                    <div className="absolute -right-4 -bottom-4 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity">
                                        <HardDrive size={120} />
                                    </div>
                                </div>
                            ))}

                            <div
                                onClick={triggerUpload}
                                className="border-2 border-dashed border-zinc-900 rounded-3xl p-6 flex flex-col items-center justify-center gap-4 group cursor-pointer hover:border-primary/20 transition-all"
                            >
                                <div className="w-12 h-12 rounded-full bg-zinc-900 flex items-center justify-center text-zinc-700 group-hover:text-primary transition-colors">
                                    <Plus size={24} />
                                </div>
                                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-700 group-hover:text-zinc-400">Add asset</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default StorageManager;
