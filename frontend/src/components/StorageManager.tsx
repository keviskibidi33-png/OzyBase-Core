import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
    Download,
    FileIcon,
    FolderOpen,
    Globe,
    HardDrive,
    Image as ImageIcon,
    LayoutGrid,
    List,
    Lock,
    Plus,
    RefreshCw,
    Search,
    Settings,
    Shield,
    Trash2,
    Upload,
} from 'lucide-react';

import ConfirmModal from './ConfirmModal';
import ModulePageHero from './ModulePageHero';
import { BrandedToast } from './OverlayPrimitives';
import { fetchWithAuth } from '../utils/api';

type ToastTone = 'success' | 'error' | 'warning' | 'info';
type BucketDialogMode = 'create' | 'edit';

interface StorageManagerProps {
    view?: 'buckets' | 'policies' | 'usage' | 'settings';
}

interface StorageBucket {
    id: string;
    name: string;
    public: boolean;
    rls_enabled: boolean;
    rls_rule: string;
    max_file_size_bytes: number;
    max_total_size_bytes: number;
    lifecycle_delete_after_days: number;
    usage_ratio_pct?: number;
    created_at?: string;
    object_count: number;
    total_size: number;
}

interface StorageObject {
    id: string;
    name: string;
    size: number;
    content_type: string;
    path: string;
    download_url: string;
    storage_key: string;
    created_at?: string;
}

interface BucketFormState {
    name: string;
    isPublic: boolean;
    isRLS: boolean;
    rlsRule: string;
    maxFileSizeMB: string;
    maxTotalSizeMB: string;
    lifecycleDeleteAfterDays: string;
}

const DEFAULT_RLS_RULE = "auth.uid() = owner_id";
const EMPTY_BUCKET_FORM: BucketFormState = { name: '', isPublic: false, isRLS: false, rlsRule: DEFAULT_RLS_RULE, maxFileSizeMB: '', maxTotalSizeMB: '', lifecycleDeleteAfterDays: '' };

interface StorageUploadSession {
    upload_url: string;
    upload_token: string;
    bucket: string;
    filename: string;
    content_type: string;
    size: number;
    storage_key: string;
    expires_at: string;
    max_file_size_bytes: number;
}

interface MultipartUploadSession {
    session_id: string;
    mode: 'multipart';
    bucket: string;
    filename: string;
    content_type: string;
    size: number;
    storage_key: string;
    chunk_size_bytes: number;
    total_parts: number;
    expires_at: string;
    max_file_size_bytes: number;
    max_total_size_bytes: number;
}

const formatSize = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / 1024 ** index;
    return `${value.toFixed(value >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
};

const parseMaxFileSizeMB = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const parsed = Number.parseFloat(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return Math.round(parsed * 1024 * 1024);
};

const parsePositiveInt = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return parsed;
};

const formatBucketLimit = (bytes: number): string => (
    Number.isFinite(bytes) && bytes > 0 ? formatSize(bytes) : 'Unlimited'
);

const MULTIPART_THRESHOLD_BYTES = 64 * 1024 * 1024;

const formatDate = (value?: string): string => {
    if (!value) return 'Recently';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Recently';
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
};

const extractError = async (response: Response, fallback: string): Promise<string> => {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    return payload?.error || fallback;
};

const StorageManager = (_props: StorageManagerProps) => {
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [searchQuery, setSearchQuery] = useState('');
    const deferredSearch = useDeferredValue(searchQuery);
    const [files, setFiles] = useState<StorageObject[]>([]);
    const [buckets, setBuckets] = useState<StorageBucket[]>([]);
    const [selectedBucketName, setSelectedBucketName] = useState('default');
    const [loadingBuckets, setLoadingBuckets] = useState(true);
    const [loadingFiles, setLoadingFiles] = useState(true);
    const [bucketDialogMode, setBucketDialogMode] = useState<BucketDialogMode | null>(null);
    const [bucketForm, setBucketForm] = useState<BucketFormState>(EMPTY_BUCKET_FORM);
    const [isSavingBucket, setIsSavingBucket] = useState(false);
    const [bucketPendingDelete, setBucketPendingDelete] = useState<StorageBucket | null>(null);
    const [filePendingDelete, setFilePendingDelete] = useState<StorageObject | null>(null);
    const [isDeletingBucket, setIsDeletingBucket] = useState(false);
    const [isDeletingFile, setIsDeletingFile] = useState(false);
    const [isSweepingLifecycle, setIsSweepingLifecycle] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadSummary, setUploadSummary] = useState('');
    const [toast, setToast] = useState<{ message: string; type: ToastTone } | null>(null);
    const fileInputRef = React.useRef<HTMLInputElement | null>(null);

    const showToast = useCallback((message: string, type: ToastTone) => setToast({ message, type }), []);

    const fetchBuckets = useCallback(async (preferredBucket?: string) => {
        setLoadingBuckets(true);
        try {
            const response = await fetchWithAuth('/api/files/buckets');
            if (!response.ok) throw new Error(await extractError(response, 'Failed to load buckets'));
            const payload = await response.json().catch(() => []) as StorageBucket[];
            const safeBuckets = Array.isArray(payload) ? payload : [];
            setBuckets(safeBuckets);
            setSelectedBucketName((current) => {
                const desired = preferredBucket ?? current;
                return safeBuckets.some((bucket) => bucket.name === desired) ? desired : safeBuckets[0]?.name ?? 'default';
            });
        } catch (error) {
            console.error(error);
            showToast(error instanceof Error ? error.message : 'Failed to load buckets', 'error');
        } finally {
            setLoadingBuckets(false);
        }
    }, [showToast]);

    const fetchFiles = useCallback(async (bucketName: string) => {
        setLoadingFiles(true);
        try {
            const response = await fetchWithAuth(`/api/files?bucket=${encodeURIComponent(bucketName)}`);
            if (!response.ok) throw new Error(await extractError(response, 'Failed to load objects'));
            const payload = await response.json().catch(() => []) as StorageObject[];
            setFiles(Array.isArray(payload) ? payload : []);
        } catch (error) {
            console.error(error);
            setFiles([]);
            showToast(error instanceof Error ? error.message : 'Failed to load objects', 'error');
        } finally {
            setLoadingFiles(false);
        }
    }, [showToast]);

    useEffect(() => { void fetchBuckets(); }, [fetchBuckets]);
    useEffect(() => { void fetchFiles(selectedBucketName); }, [fetchFiles, selectedBucketName]);

    const selectedBucket = useMemo<StorageBucket>(() => (
        buckets.find((bucket) => bucket.name === selectedBucketName) ?? {
            id: 'default',
            name: selectedBucketName || 'default',
            public: true,
            rls_enabled: false,
            rls_rule: 'true',
            max_file_size_bytes: 0,
            max_total_size_bytes: 0,
            lifecycle_delete_after_days: 0,
            usage_ratio_pct: 0,
            object_count: files.length,
            total_size: files.reduce((sum, file) => sum + file.size, 0),
        }
    ), [buckets, files, selectedBucketName]);

    const filteredFiles = useMemo(() => {
        const term = deferredSearch.trim().toLowerCase();
        if (!term) return files;
        return files.filter((file) => file.name.toLowerCase().includes(term) || file.content_type.toLowerCase().includes(term));
    }, [deferredSearch, files]);
    const storageHeroPills = [
        { label: selectedBucket.public ? 'public reads allowed' : 'private bucket', tone: selectedBucket.public ? 'accent' : 'neutral' },
        { label: selectedBucket.rls_enabled ? 'rls enforced' : 'rls optional', tone: selectedBucket.rls_enabled ? 'success' : 'warning' },
        { label: `per-file ${formatBucketLimit(selectedBucket.max_file_size_bytes)}`, tone: selectedBucket.max_file_size_bytes > 0 ? 'warning' : 'neutral' },
        { label: `bucket ${formatBucketLimit(selectedBucket.max_total_size_bytes)}`, tone: selectedBucket.max_total_size_bytes > 0 ? 'warning' : 'neutral' },
        { label: `${selectedBucket.object_count} object${selectedBucket.object_count === 1 ? '' : 's'}`, tone: 'neutral' },
    ] as const;
    const storageHeroStats = [
        {
            label: 'Bucket',
            value: selectedBucket.name,
            hint: 'Pick a bucket on the left, then manage files and access rules here.',
        },
        {
            label: 'Stored Size',
            value: formatSize(selectedBucket.total_size),
            hint: 'Uploads now stream through the same origin, so large files do not depend on the normal API body limit.',
        },
        {
            label: 'Search Scope',
            value: deferredSearch.trim() ? 'Filtered objects' : 'All bucket objects',
            hint: deferredSearch.trim()
                ? `Filtering by "${deferredSearch.trim()}".`
                : 'Search by file name or MIME type inside the current bucket.',
        },
        {
            label: 'Per-File Limit',
            value: formatBucketLimit(selectedBucket.max_file_size_bytes),
            hint: selectedBucket.max_file_size_bytes > 0
                ? 'Session uploads reject files above the bucket ceiling before streaming starts.'
                : 'Leave the limit empty when you want storage policy to stay open-ended.',
        },
        {
            label: 'Bucket Quota',
            value: formatBucketLimit(selectedBucket.max_total_size_bytes),
            hint: selectedBucket.max_total_size_bytes > 0
                ? `Current usage ${formatSize(selectedBucket.total_size)} (${Math.round(selectedBucket.usage_ratio_pct ?? 0)}%).`
                : 'Optional total-capacity ceiling for self-hosted installs.',
        },
    ];

    const openBucketDialog = (mode: BucketDialogMode, bucket: StorageBucket = selectedBucket) => {
        if (mode === 'edit') {
            setSelectedBucketName(bucket.name);
        }
        setBucketDialogMode(mode);
        setBucketForm(mode === 'edit'
            ? {
                name: bucket.name,
                isPublic: bucket.public,
                isRLS: bucket.rls_enabled,
                rlsRule: bucket.rls_rule || DEFAULT_RLS_RULE,
                maxFileSizeMB: bucket.max_file_size_bytes > 0 ? (bucket.max_file_size_bytes / (1024 * 1024)).toString() : '',
                maxTotalSizeMB: bucket.max_total_size_bytes > 0 ? (bucket.max_total_size_bytes / (1024 * 1024)).toString() : '',
                lifecycleDeleteAfterDays: bucket.lifecycle_delete_after_days > 0 ? bucket.lifecycle_delete_after_days.toString() : '',
            }
            : EMPTY_BUCKET_FORM);
    };

    const closeBucketDialog = () => {
        if (isSavingBucket) return;
        setBucketDialogMode(null);
        setBucketForm(EMPTY_BUCKET_FORM);
    };

    const handleBucketSave = async () => {
        const trimmedName = bucketForm.name.trim().toLowerCase();
        if (!trimmedName) return showToast('Bucket name is required', 'error');
        const maxFileSizeBytes = parseMaxFileSizeMB(bucketForm.maxFileSizeMB);
        if (maxFileSizeBytes === null) return showToast('Max file size must be a valid number of MB', 'error');
        const maxTotalSizeBytes = parseMaxFileSizeMB(bucketForm.maxTotalSizeMB);
        if (maxTotalSizeBytes === null) return showToast('Bucket quota must be a valid number of MB', 'error');
        const lifecycleDeleteAfterDays = parsePositiveInt(bucketForm.lifecycleDeleteAfterDays);
        if (lifecycleDeleteAfterDays === null) return showToast('Lifecycle retention must be a valid number of days', 'error');

        setIsSavingBucket(true);
        try {
            const isEdit = bucketDialogMode === 'edit';
            const response = await fetchWithAuth(isEdit
                ? `/api/files/buckets/${encodeURIComponent(selectedBucket.name)}`
                : '/api/files/buckets', {
                method: isEdit ? 'PATCH' : 'POST',
                body: JSON.stringify({
                    name: trimmedName,
                    public: bucketForm.isPublic,
                    rls_enabled: bucketForm.isRLS,
                    rls_rule: bucketForm.isRLS ? bucketForm.rlsRule.trim() || DEFAULT_RLS_RULE : 'true',
                    max_file_size_bytes: maxFileSizeBytes,
                    max_total_size_bytes: maxTotalSizeBytes,
                    lifecycle_delete_after_days: lifecycleDeleteAfterDays,
                }),
            });
            if (!response.ok) throw new Error(await extractError(response, `Failed to ${isEdit ? 'update' : 'create'} bucket`));
            const payload = await response.json().catch(() => null) as StorageBucket | null;
            await fetchBuckets(payload?.name ?? (isEdit ? selectedBucket.name : trimmedName));
            closeBucketDialog();
            showToast(isEdit ? 'Bucket updated' : 'Bucket created', 'success');
        } catch (error) {
            console.error(error);
            showToast(error instanceof Error ? error.message : 'Failed to save bucket', 'error');
        } finally {
            setIsSavingBucket(false);
        }
    };

    const createUploadSession = useCallback(async (file: File): Promise<StorageUploadSession> => {
        const response = await fetchWithAuth('/api/files/uploads/session', {
            method: 'POST',
            body: JSON.stringify({
                bucket: selectedBucket.name,
                filename: file.name,
                content_type: file.type || 'application/octet-stream',
                size: file.size,
            }),
        });
        if (!response.ok) throw new Error(await extractError(response, `Failed to prepare upload for ${file.name}`));
        return await response.json() as StorageUploadSession;
    }, [selectedBucket.name]);

    const createMultipartUploadSession = useCallback(async (file: File): Promise<MultipartUploadSession> => {
        const response = await fetchWithAuth('/api/files/uploads/multipart/session', {
            method: 'POST',
            body: JSON.stringify({
                bucket: selectedBucket.name,
                filename: file.name,
                content_type: file.type || 'application/octet-stream',
                size: file.size,
            }),
        });
        if (!response.ok) throw new Error(await extractError(response, `Failed to prepare multipart upload for ${file.name}`));
        return await response.json() as MultipartUploadSession;
    }, [selectedBucket.name]);

    const uploadViaStreamSession = useCallback(async (file: File) => {
        const session = await createUploadSession(file);
        const response = await fetchWithAuth(session.upload_url, {
            method: 'PUT',
            headers: {
                'Content-Type': session.content_type || file.type || 'application/octet-stream',
                'X-Ozy-Upload-Token': session.upload_token,
            },
            body: file,
        });
        if (!response.ok) throw new Error(await extractError(response, `Failed to upload ${file.name}`));
        return await response.json().catch(() => null);
    }, [createUploadSession]);

    const uploadViaMultipartSession = useCallback(async (file: File) => {
        const session = await createMultipartUploadSession(file);
        for (let partNumber = 1; partNumber <= session.total_parts; partNumber += 1) {
            const start = (partNumber - 1) * session.chunk_size_bytes;
            const end = Math.min(start + session.chunk_size_bytes, file.size);
            const chunk = file.slice(start, end);
            setUploadSummary(`${file.name} / chunk ${partNumber}/${session.total_parts}`);
            const response = await fetchWithAuth(`/api/files/uploads/multipart/${encodeURIComponent(session.session_id)}/parts/${partNumber}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/octet-stream',
                },
                body: chunk,
            });
            if (!response.ok) throw new Error(await extractError(response, `Failed to upload chunk ${partNumber} of ${file.name}`));
        }

        const completeResponse = await fetchWithAuth(`/api/files/uploads/multipart/${encodeURIComponent(session.session_id)}/complete`, {
            method: 'POST',
            body: JSON.stringify({}),
        });
        if (!completeResponse.ok) throw new Error(await extractError(completeResponse, `Failed to finalize multipart upload for ${file.name}`));
        return await completeResponse.json().catch(() => null);
    }, [createMultipartUploadSession]);

    const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFiles = Array.from(event.target.files ?? []);
        if (selectedFiles.length === 0) return;

        setIsUploading(true);
        setUploadSummary(selectedFiles.length === 1 ? selectedFiles[0].name : `${selectedFiles.length} files`);
        try {
            for (const file of selectedFiles) {
                if (file.size >= MULTIPART_THRESHOLD_BYTES) {
                    await uploadViaMultipartSession(file);
                } else {
                    await uploadViaStreamSession(file);
                }
            }
            await Promise.all([fetchFiles(selectedBucket.name), fetchBuckets(selectedBucket.name)]);
            showToast(selectedFiles.length === 1 ? 'File uploaded' : `${selectedFiles.length} files uploaded`, 'success');
        } catch (error) {
            console.error(error);
            showToast(error instanceof Error ? error.message : 'Failed to upload file', 'error');
        } finally {
            setIsUploading(false);
            setUploadSummary('');
            event.target.value = '';
        }
    };

    const handleLifecycleSweep = async () => {
        if (selectedBucket.lifecycle_delete_after_days <= 0) {
            showToast('Configure retention days first to run lifecycle cleanup', 'warning');
            return;
        }
        setIsSweepingLifecycle(true);
        try {
            const response = await fetchWithAuth(`/api/files/buckets/${encodeURIComponent(selectedBucket.name)}/lifecycle/sweep`, { method: 'POST', body: JSON.stringify({}) });
            if (!response.ok) throw new Error(await extractError(response, 'Failed to run lifecycle cleanup'));
            const payload = await response.json().catch(() => null) as { deleted_objects?: number; reclaimed_size_human?: string } | null;
            await Promise.all([fetchFiles(selectedBucket.name), fetchBuckets(selectedBucket.name)]);
            showToast(`Lifecycle cleanup removed ${payload?.deleted_objects ?? 0} object(s)${payload?.reclaimed_size_human ? ` / ${payload.reclaimed_size_human}` : ''}`, 'success');
        } catch (error) {
            console.error(error);
            showToast(error instanceof Error ? error.message : 'Failed to run lifecycle cleanup', 'error');
        } finally {
            setIsSweepingLifecycle(false);
        }
    };

    const handleOpenFile = async (file: StorageObject) => {
        if (selectedBucket.public && !selectedBucket.rls_enabled) {
            window.open(file.download_url, '_blank', 'noopener,noreferrer');
            return;
        }

        try {
            const response = await fetchWithAuth(file.download_url);
            if (!response.ok) throw new Error(await extractError(response, 'Failed to open file'));
            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            const popup = window.open(objectUrl, '_blank', 'noopener,noreferrer');
            if (!popup) {
                const anchor = document.createElement('a');
                anchor.href = objectUrl;
                anchor.download = file.name;
                anchor.click();
            }
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
        } catch (error) {
            console.error(error);
            showToast(error instanceof Error ? error.message : 'Failed to open file', 'error');
        }
    };

    const handleDeleteBucket = async () => {
        if (!bucketPendingDelete) return;
        setIsDeletingBucket(true);
        try {
            const response = await fetchWithAuth(`/api/files/buckets/${encodeURIComponent(bucketPendingDelete.name)}`, { method: 'DELETE' });
            if (!response.ok) throw new Error(await extractError(response, 'Failed to delete bucket'));
            setBucketPendingDelete(null);
            await fetchBuckets('default');
            showToast('Bucket deleted', 'success');
        } catch (error) {
            console.error(error);
            showToast(error instanceof Error ? error.message : 'Failed to delete bucket', 'error');
        } finally {
            setIsDeletingBucket(false);
        }
    };

    const handleDeleteFile = async () => {
        if (!filePendingDelete) return;
        setIsDeletingFile(true);
        try {
            const response = await fetchWithAuth(`/api/files/${encodeURIComponent(selectedBucket.name)}/${encodeURIComponent(filePendingDelete.storage_key)}`, { method: 'DELETE' });
            if (!response.ok) throw new Error(await extractError(response, 'Failed to delete object'));
            setFilePendingDelete(null);
            await Promise.all([fetchFiles(selectedBucket.name), fetchBuckets(selectedBucket.name)]);
            showToast('Object deleted', 'success');
        } catch (error) {
            console.error(error);
            showToast(error instanceof Error ? error.message : 'Failed to delete object', 'error');
        } finally {
            setIsDeletingFile(false);
        }
    };

    return (
        <div className="flex h-full overflow-hidden bg-[#171717]">
            <div className="flex w-72 flex-col border-r border-[#2e2e2e] bg-[#0c0c0c] p-6">
                <div className="mb-8 flex items-center justify-between">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Buckets</p>
                        <p className="mt-2 text-xs text-zinc-600">Create, inspect and manage storage namespaces.</p>
                    </div>
                    <button type="button" onClick={() => openBucketDialog('create')} aria-label="Create bucket" title="Create bucket" className="rounded-xl border border-primary/20 bg-primary/10 p-2 text-primary transition-colors hover:bg-primary/15">
                        <Plus size={16} />
                    </button>
                </div>
                <div className="space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                    {loadingBuckets ? <div className="rounded-3xl border border-[#202020] bg-[#111111] p-5 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-600">Syncing buckets...</div> : buckets.map((bucket) => (
                        <div key={bucket.id} className={`rounded-[24px] border p-4 transition-all ${selectedBucketName === bucket.name ? 'border-primary/20 bg-primary/10' : 'border-transparent bg-[#111111] hover:border-[#2e2e2e]'}`}>
                            <button type="button" onClick={() => setSelectedBucketName(bucket.name)} className="w-full text-left">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex min-w-0 items-start gap-3">
                                        <div className={`mt-0.5 flex h-11 w-11 items-center justify-center rounded-2xl border ${selectedBucketName === bucket.name ? 'border-primary/20 bg-primary/10 text-primary' : 'border-zinc-800 bg-[#0c0c0c] text-zinc-500'}`}>
                                            <HardDrive size={18} />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-black text-white">{bucket.name}</p>
                                            <p className="mt-1 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{bucket.public ? 'Public' : 'Private'} / {bucket.object_count} objects</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 text-zinc-500">{bucket.public ? <Globe size={13} /> : <Lock size={13} />}{bucket.rls_enabled ? <Shield size={13} className="text-primary" /> : null}</div>
                                </div>
                            </button>
                            <div className="mt-4 flex items-center justify-between gap-3">
                                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-600">{formatSize(bucket.total_size)}</span>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => openBucketDialog('edit', bucket)}
                                        className="rounded-lg border border-zinc-800 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-zinc-400 transition-colors hover:border-primary/30 hover:text-primary"
                                    >
                                        Edit
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSelectedBucketName(bucket.name);
                                            setBucketPendingDelete(bucket);
                                        }}
                                        disabled={bucket.name === 'default'}
                                        className="rounded-lg border border-red-500/20 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-red-300 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex flex-1 flex-col overflow-hidden">
                <div className="border-b border-[#2e2e2e] bg-[#171717] px-8 py-8">
                    <ModulePageHero
                        eyebrow="Storage"
                        title={selectedBucket.name}
                        description="Choose a bucket, upload files, and control access with public visibility plus optional RLS. The right panel stays focused on the current bucket so file operations feel predictable."
                        icon={FolderOpen}
                        pills={storageHeroPills}
                        stats={storageHeroStats}
                        actions={
                            <>
                                <button type="button" onClick={() => { void fetchBuckets(selectedBucket.name); void fetchFiles(selectedBucket.name); }} className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-zinc-300 transition-colors hover:border-primary/30 hover:text-primary"><RefreshCw size={14} />Refresh</button>
                                <button type="button" onClick={() => openBucketDialog('edit')} className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-zinc-300 transition-colors hover:border-primary/30 hover:text-primary"><Settings size={14} />Edit bucket</button>
                                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-[10px] font-black uppercase tracking-widest text-black transition-colors hover:bg-[#E6E600] disabled:cursor-not-allowed disabled:opacity-60"><Upload size={14} />{isUploading ? 'Uploading...' : 'Upload file'}</button>
                                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleUpload} />
                            </>
                        }
                    />
                </div>
                <div className="grid flex-1 gap-8 overflow-y-auto px-8 py-8 custom-scrollbar xl:grid-cols-[1.25fr_0.75fr]">
                    <div className="space-y-6">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-[#0c0c0c] px-3 py-2.5">
                                <Search size={14} className="text-zinc-600" />
                                <input type="text" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search objects by name or MIME type..." className="w-72 bg-transparent text-xs font-bold text-zinc-100 outline-none placeholder:text-zinc-700" />
                                {searchQuery.trim() ? (
                                    <button type="button" onClick={() => setSearchQuery('')} className="rounded-md p-1 text-zinc-600 transition-colors hover:text-zinc-100">
                                        <Plus className="rotate-45" size={12} />
                                    </button>
                                ) : null}
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-600">
                                    {filteredFiles.length} match{filteredFiles.length === 1 ? '' : 'es'}
                                </span>
                                <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-[#0c0c0c] p-1">
                                <button type="button" onClick={() => setViewMode('grid')} className={`rounded-lg p-2 transition-colors ${viewMode === 'grid' ? 'bg-primary text-black' : 'text-zinc-600 hover:text-zinc-200'}`}><LayoutGrid size={16} /></button>
                                <button type="button" onClick={() => setViewMode('list')} className={`rounded-lg p-2 transition-colors ${viewMode === 'list' ? 'bg-primary text-black' : 'text-zinc-600 hover:text-zinc-200'}`}><List size={16} /></button>
                                </div>
                            </div>
                        </div>
                        <div className="rounded-2xl border border-[#2e2e2e] bg-[#111111] px-5 py-4">
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Upload Runtime</p>
                            <p className="mt-2 text-sm text-zinc-300">
                                Files stream through signed same-origin sessions, and uploads above 64 MB switch to resumable multipart chunks before assembly.
                            </p>
                            <p className="mt-2 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-600">
                                {isUploading ? `Uploading ${uploadSummary}` : `Per-file limit: ${formatBucketLimit(selectedBucket.max_file_size_bytes)}`}
                            </p>
                        </div>

                        {loadingFiles ? (
                            <div className="flex h-72 flex-col items-center justify-center gap-4 rounded-[28px] border border-[#2e2e2e] bg-[#111111]">
                                <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600">Syncing bucket objects...</p>
                            </div>
                        ) : filteredFiles.length === 0 ? (
                            <div className="flex h-72 flex-col items-center justify-center gap-4 rounded-[28px] border-2 border-dashed border-zinc-900 bg-[#111111]/70">
                                <FolderOpen size={44} className="text-zinc-800" />
                                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">{searchQuery.trim() ? 'No objects match this search' : 'This bucket is empty'}</p>
                                <p className="text-[11px] text-zinc-600">{searchQuery.trim() ? 'Try a different filename or clear the filter.' : 'Upload your first object to start using this bucket.'}</p>
                                <button type="button" onClick={() => searchQuery.trim() ? setSearchQuery('') : fileInputRef.current?.click()} disabled={isUploading} className="rounded-xl bg-primary px-5 py-2.5 text-[10px] font-black uppercase tracking-widest text-black transition-colors hover:bg-[#E6E600] disabled:cursor-not-allowed disabled:opacity-60">{searchQuery.trim() ? 'Clear search' : isUploading ? 'Uploading...' : 'Upload object'}</button>
                            </div>
                        ) : viewMode === 'list' ? (
                            <div className="overflow-hidden rounded-[28px] border border-[#2e2e2e] bg-[#111111]">
                                <div className="grid grid-cols-[1.7fr_0.8fr_0.7fr_0.9fr] gap-4 border-b border-[#2e2e2e] px-6 py-4 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500"><span>Object</span><span>Type</span><span>Size</span><span>Actions</span></div>
                                {filteredFiles.map((file) => (
                                    <div key={file.id} className="grid grid-cols-[1.7fr_0.8fr_0.7fr_0.9fr] items-center gap-4 border-b border-[#1c1c1c] px-6 py-4 last:border-b-0">
                                        <div className="flex min-w-0 items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-primary">{file.content_type.startsWith('image/') ? <ImageIcon size={18} /> : <FileIcon size={18} />}</div><div className="min-w-0"><p className="truncate text-sm font-bold text-white">{file.name}</p><p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-600">{formatDate(file.created_at)}</p></div></div>
                                        <span className="text-xs text-zinc-400">{file.content_type || 'binary'}</span>
                                        <span className="text-xs font-bold text-zinc-200">{formatSize(file.size)}</span>
                                        <div className="flex items-center gap-2">
                                            <button type="button" onClick={() => void handleOpenFile(file)} className="rounded-xl border border-zinc-800 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-zinc-300 transition-colors hover:border-primary/30 hover:text-primary">Open</button>
                                            <button type="button" onClick={() => setFilePendingDelete(file)} className="rounded-xl border border-red-500/20 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-red-300 transition-colors hover:bg-red-500/10">Delete</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                                {filteredFiles.map((file) => (
                                    <div key={file.id} className="rounded-[30px] border border-[#2e2e2e] bg-[#111111] p-6 transition-all hover:border-primary/25">
                                        <div className="mb-6 flex items-start justify-between gap-4">
                                            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">{file.content_type.startsWith('image/') ? <ImageIcon size={22} /> : <FileIcon size={22} />}</div>
                                            <div className="rounded-full border border-zinc-800 px-3 py-1 text-[9px] font-black uppercase tracking-[0.18em] text-zinc-500">{file.content_type || 'binary'}</div>
                                        </div>
                                        <h3 className="truncate text-lg font-black text-white">{file.name}</h3>
                                        <p className="mt-2 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-600">{formatSize(file.size)} / {formatDate(file.created_at)}</p>
                                        <div className="mt-8 flex items-center justify-between gap-3">
                                            <button type="button" onClick={() => void handleOpenFile(file)} className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-200 transition-colors hover:border-primary/30 hover:text-primary"><Download size={14} />Open</button>
                                            <button type="button" onClick={() => setFilePendingDelete(file)} className="inline-flex items-center gap-2 rounded-xl border border-red-500/20 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-red-300 transition-colors hover:bg-red-500/10"><Trash2 size={14} />Delete</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="space-y-6">
                        <div className="rounded-[28px] border border-[#2e2e2e] bg-[#111111] p-7">
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Bucket Policies</p>
                            <div className="mt-5 grid gap-4">
                                <div className="rounded-3xl border border-[#2e2e2e] bg-[#0c0c0c] p-5"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Read Access</p><p className="mt-2 text-lg font-black text-white">{selectedBucket.public ? 'Public' : 'Authenticated only'}</p><p className="mt-2 text-sm text-zinc-500">{selectedBucket.public ? 'Anon reads work when RLS does not narrow access.' : 'Objects require a user session or service role key.'}</p></div>
                                <div className="rounded-3xl border border-[#2e2e2e] bg-[#0c0c0c] p-5"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">RLS Rule</p><code className="mt-3 block overflow-x-auto rounded-2xl border border-zinc-800 bg-[#070707] px-4 py-4 text-xs text-primary">{selectedBucket.rls_enabled ? selectedBucket.rls_rule : 'true'}</code></div>
                                <div className="rounded-3xl border border-[#2e2e2e] bg-[#0c0c0c] p-5"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Per-File Limit</p><p className="mt-2 text-lg font-black text-white">{formatBucketLimit(selectedBucket.max_file_size_bytes)}</p><p className="mt-2 text-sm text-zinc-500">Session uploads reject oversize files before the stream starts and keep the limit consistent across local or S3 backends.</p></div>
                                <div className="rounded-3xl border border-[#2e2e2e] bg-[#0c0c0c] p-5"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Bucket Quota</p><p className="mt-2 text-lg font-black text-white">{formatBucketLimit(selectedBucket.max_total_size_bytes)}</p><p className="mt-2 text-sm text-zinc-500">{selectedBucket.max_total_size_bytes > 0 ? `Current usage ${formatSize(selectedBucket.total_size)} / ${Math.round(selectedBucket.usage_ratio_pct ?? 0)}%` : 'Keep this empty when you do not want a total-capacity ceiling.'}</p></div>
                                <div className="rounded-3xl border border-[#2e2e2e] bg-[#0c0c0c] p-5"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Lifecycle Retention</p><p className="mt-2 text-lg font-black text-white">{selectedBucket.lifecycle_delete_after_days > 0 ? `${selectedBucket.lifecycle_delete_after_days} day${selectedBucket.lifecycle_delete_after_days === 1 ? '' : 's'}` : 'Disabled'}</p><p className="mt-2 text-sm text-zinc-500">Use retention to sweep stale objects from self-hosted buckets without manual cleanup.</p><button type="button" onClick={() => void handleLifecycleSweep()} disabled={isSweepingLifecycle || selectedBucket.lifecycle_delete_after_days <= 0} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-zinc-800 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-zinc-200 transition-colors hover:border-primary/30 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"><RefreshCw size={14} />{isSweepingLifecycle ? 'Sweeping...' : 'Run sweep'}</button></div>
                            </div>
                        </div>
                        <div className="rounded-[28px] border border-[#2e2e2e] bg-[#111111] p-7">
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Bucket Health</p>
                            <div className="mt-5 space-y-4">
                                <div className="rounded-3xl border border-[#202020] bg-[#0c0c0c] p-5"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Objects</p><p className="mt-2 text-2xl font-black text-white">{selectedBucket.object_count}</p></div>
                                <div className="rounded-3xl border border-[#202020] bg-[#0c0c0c] p-5"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Capacity</p><p className="mt-2 text-2xl font-black text-white">{formatSize(selectedBucket.total_size)}</p></div>
                                <div className="rounded-3xl border border-[#202020] bg-[#0c0c0c] p-5"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Quota Usage</p><p className="mt-2 text-2xl font-black text-white">{selectedBucket.max_total_size_bytes > 0 ? `${Math.round(selectedBucket.usage_ratio_pct ?? 0)}%` : 'Open'}</p></div>
                                <div className="rounded-3xl border border-red-500/20 bg-[linear-gradient(180deg,rgba(127,29,29,0.12),rgba(17,17,17,0.92))] p-5"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-red-300/80">Danger Zone</p><p className="mt-2 text-sm text-red-100/75">Delete the entire bucket and every object inside it.</p><button type="button" onClick={() => setBucketPendingDelete(selectedBucket)} disabled={selectedBucket.name === 'default'} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-red-500/30 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-red-100 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"><Trash2 size={14} />Delete bucket</button></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {bucketDialogMode ? (
                <div className="fixed inset-0 z-[70] flex items-center justify-center p-6">
                    <div className="absolute inset-0 ozy-overlay-backdrop backdrop-blur-md" onClick={closeBucketDialog} />
                    <div className="ozy-dialog-panel relative w-full max-w-lg overflow-hidden">
                        <div className="flex items-center justify-between border-b border-[#2e2e2e] bg-[#171717] px-8 py-6"><div><h3 className="text-xl font-black tracking-tight text-white">{bucketDialogMode === 'create' ? 'Create bucket' : 'Edit bucket'}</h3><p className="mt-1 text-[10px] font-black uppercase tracking-widest text-zinc-500">{bucketDialogMode === 'create' ? 'Provision a new storage namespace' : 'Adjust visibility and policy enforcement'}</p></div><button type="button" onClick={closeBucketDialog} className="text-zinc-500 transition-colors hover:text-white"><Plus className="rotate-45" size={18} /></button></div>
                        <div className="space-y-5 p-8">
                            <div className="space-y-2"><label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Bucket Name</label><input autoFocus={bucketDialogMode === 'create'} type="text" value={bucketForm.name} onChange={(event) => setBucketForm((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. customer-assets" disabled={bucketDialogMode === 'edit'} className="w-full rounded-xl border border-zinc-800 bg-[#0c0c0c] px-4 py-3 text-sm text-white focus:border-primary/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60" /></div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Per-file limit (MB)</label>
                                <input type="number" min="0" step="1" value={bucketForm.maxFileSizeMB} onChange={(event) => setBucketForm((current) => ({ ...current, maxFileSizeMB: event.target.value }))} placeholder="Leave empty for unlimited" className="w-full rounded-xl border border-zinc-800 bg-[#0c0c0c] px-4 py-3 text-sm text-white focus:border-primary/50 focus:outline-none" />
                                <p className="text-[11px] leading-relaxed text-zinc-500">Use this to cap each uploaded file. The limit applies before streaming starts, even when storage runs on S3.</p>
                            </div>
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Bucket quota (MB)</label>
                                    <input type="number" min="0" step="1" value={bucketForm.maxTotalSizeMB} onChange={(event) => setBucketForm((current) => ({ ...current, maxTotalSizeMB: event.target.value }))} placeholder="Leave empty for unlimited" className="w-full rounded-xl border border-zinc-800 bg-[#0c0c0c] px-4 py-3 text-sm text-white focus:border-primary/50 focus:outline-none" />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Lifecycle retention (days)</label>
                                    <input type="number" min="0" step="1" value={bucketForm.lifecycleDeleteAfterDays} onChange={(event) => setBucketForm((current) => ({ ...current, lifecycleDeleteAfterDays: event.target.value }))} placeholder="0 disables cleanup" className="w-full rounded-xl border border-zinc-800 bg-[#0c0c0c] px-4 py-3 text-sm text-white focus:border-primary/50 focus:outline-none" />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                <button type="button" onClick={() => setBucketForm((current) => ({ ...current, isPublic: !current.isPublic }))} className={`rounded-2xl border px-4 py-4 text-left transition-all ${bucketForm.isPublic ? 'border-primary/30 bg-primary/10 text-primary' : 'border-zinc-800 bg-zinc-900/40 text-zinc-400'}`}><p className="text-[10px] font-black uppercase tracking-widest">Public Access</p><p className="mt-2 text-[11px] leading-relaxed text-white/80">Allow anonymous reads when RLS does not narrow access.</p></button>
                                <button type="button" onClick={() => setBucketForm((current) => ({ ...current, isRLS: !current.isRLS }))} className={`rounded-2xl border px-4 py-4 text-left transition-all ${bucketForm.isRLS ? 'border-primary/30 bg-primary/10 text-primary' : 'border-zinc-800 bg-zinc-900/40 text-zinc-400'}`}><p className="text-[10px] font-black uppercase tracking-widest">RLS Policy</p><p className="mt-2 text-[11px] leading-relaxed text-white/80">Filter reads and deletes with a Supabase-style rule.</p></button>
                            </div>
                            {bucketForm.isRLS ? <textarea value={bucketForm.rlsRule} onChange={(event) => setBucketForm((current) => ({ ...current, rlsRule: event.target.value }))} className="min-h-[120px] w-full rounded-2xl border border-zinc-800 bg-[#0c0c0c] px-4 py-3 font-mono text-xs text-zinc-200 focus:border-primary/50 focus:outline-none" /> : <div className="rounded-2xl border border-zinc-800 bg-[#0c0c0c] px-4 py-4 text-[11px] leading-relaxed text-zinc-500">With RLS disabled, OzyBase uses `true` and enforces only public/private visibility plus authenticated uploads.</div>}
                        </div>
                        <div className="flex items-center justify-end gap-3 border-t border-[#2e2e2e] bg-[#111111]/85 px-8 py-5"><button type="button" onClick={closeBucketDialog} className="px-5 py-2.5 text-[10px] font-black uppercase tracking-widest text-zinc-500 transition-colors hover:text-white">Cancel</button><button type="button" onClick={() => void handleBucketSave()} disabled={isSavingBucket} className="rounded-xl bg-primary px-6 py-2.5 text-[10px] font-black uppercase tracking-widest text-black transition-all hover:bg-[#E6E600] disabled:opacity-60">{isSavingBucket ? 'Saving...' : bucketDialogMode === 'create' ? 'Create bucket' : 'Save changes'}</button></div>
                    </div>
                </div>
            ) : null}

            <ConfirmModal isOpen={bucketPendingDelete !== null} onClose={() => !isDeletingBucket && setBucketPendingDelete(null)} onConfirm={() => handleDeleteBucket()} title="Delete Bucket" message={bucketPendingDelete ? `Delete bucket "${bucketPendingDelete.name}" and remove its ${bucketPendingDelete.object_count} stored object(s)?` : ''} confirmText={isDeletingBucket ? 'Deleting...' : 'Delete bucket'} type="danger" confirmDisabled={isDeletingBucket} closeOnConfirm={false} />
            <ConfirmModal isOpen={filePendingDelete !== null} onClose={() => !isDeletingFile && setFilePendingDelete(null)} onConfirm={() => handleDeleteFile()} title="Delete Object" message={filePendingDelete ? `Remove "${filePendingDelete.name}" from bucket "${selectedBucket.name}"?` : ''} confirmText={isDeletingFile ? 'Deleting...' : 'Delete object'} type="danger" confirmDisabled={isDeletingFile} closeOnConfirm={false} />
            {toast ? <BrandedToast tone={toast.type} message={toast.message} onClose={() => setToast(null)} /> : null}
        </div>
    );
};

export default StorageManager;
