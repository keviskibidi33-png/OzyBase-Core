import React, { useState, useEffect, useRef } from 'react';
import { Check, X, Calendar, Code2 } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

/**
 * InlineCellEditor - Supabase-style inline cell editor
 * Renders appropriate editor based on column type
 */
interface InlineCellEditorProps {
    value: unknown;
    columnName: string;
    columnType?: string | null;
    rowId: string | number;
    tableName: string;
    onSave: (value: unknown) => void;
    onCancel: () => void;
    isEditing: boolean;
}

const InlineCellEditor = ({
    value,
    columnName,
    columnType,
    rowId,
    tableName,
    onSave,
    onCancel,
    isEditing
}: InlineCellEditorProps) => {
    const [editValue, setEditValue] = useState<unknown>(value);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    const type = (columnType || 'text').toLowerCase();

    useEffect(() => {
        setEditValue(value);
        setError(null);
    }, [value, isEditing]);

    useEffect(() => {
        const focusTarget = textareaRef.current ?? inputRef.current;
        if (isEditing && focusTarget) {
            focusTarget.focus();
            if (inputRef.current && typeof inputRef.current.select === 'function') {
                inputRef.current.select();
            }
        }
    }, [isEditing]);

    const handleSave = async () => {
        if (editValue === value) {
            onCancel();
            return;
        }

        setIsSaving(true);
        setError(null);

        try {
            const res = await fetchWithAuth(`/api/tables/${tableName}/rows/${rowId}`, {
                method: 'PATCH',
                body: JSON.stringify({ [columnName]: editValue })
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || 'Failed to update');
            }

            onSave(editValue);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to update';
            setError(message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSave();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
        }
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        // Don't save if clicking on cancel button
        if (e.relatedTarget instanceof HTMLElement && e.relatedTarget.dataset?.action === 'cancel') {
            return;
        }
        handleSave();
    };

    // Read-only types (UUID, primary keys)
    if (type.includes('uuid') && columnName === 'id') {
            return (
                <span className="font-mono text-[11px] text-zinc-500 select-all cursor-text">
                    {String(value ?? '')}
                </span>
            );
        }

    // Non-editing display mode
    if (!isEditing) {
        // Boolean display
        if (type.includes('bool')) {
            return (
                <button
                    onClick={(e: any) => {
                        e.stopPropagation();
                        // Quick toggle for booleans
                        const newVal = !Boolean(value);
                        setEditValue(newVal);
                        fetchWithAuth(`/api/tables/${tableName}/rows/${rowId}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ [columnName]: newVal })
                        }).then((res: any) => {
                            if (res.ok) onSave(newVal);
                        });
                    }}
                    className="group/toggle flex items-center gap-2"
                >
                    <div className={`w-8 h-4 rounded-full relative transition-colors ${value ? 'bg-primary' : 'bg-zinc-700'}`}>
                        <div className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${value ? 'left-4 bg-black' : 'left-0.5 bg-zinc-400'}`} />
                    </div>
                    <span className={`text-[9px] font-black uppercase tracking-widest ${value ? 'text-primary' : 'text-zinc-600'}`}>
                        {value ? 'True' : 'False'}
                    </span>
                </button>
            );
        }

        // DateTime display
        if (type.includes('time') || type.includes('date')) {
            return (
                <span className="font-mono text-[10px] text-zinc-500">
                    {value ? new Date(String(value)).toLocaleString() : '-'}
                </span>
            );
        }

        // JSON display
        if (type.includes('json')) {
            return (
                <span className="font-mono text-[10px] text-zinc-500 truncate max-w-[200px]">
                    {typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')}
                </span>
            );
        }

        // Default text display
        return (
            <span className="text-zinc-400 group-hover:text-zinc-200 transition-colors truncate">
                {String(value ?? '')}
            </span>
        );
    }

    // Editing mode - Boolean toggle
    if (type.includes('bool')) {
        return (
            <div className="flex items-center gap-2">
                <button
                    onClick={() => setEditValue(!editValue)}
                    className={`w-10 h-5 rounded-full relative transition-colors ${editValue ? 'bg-primary' : 'bg-zinc-700'}`}
                >
                    <div className={`absolute top-1 w-3 h-3 rounded-full transition-all ${editValue ? 'left-6 bg-black' : 'left-1 bg-zinc-400'}`} />
                </button>
                <span className="text-xs text-zinc-400">{editValue ? 'True' : 'False'}</span>
                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="p-1 hover:bg-primary/20 text-primary rounded transition-colors"
                >
                    <Check size={12} />
                </button>
                <button
                    data-action="cancel"
                    onClick={onCancel}
                    className="p-1 hover:bg-red-500/20 text-red-500 rounded transition-colors"
                >
                    <X size={12} />
                </button>
            </div>
        );
    }

    // Editing mode - DateTime
    if (type.includes('time') || type.includes('date')) {
        return (
            <div className="flex items-center gap-1">
                <Calendar size={12} className="text-zinc-600 shrink-0" />
                <input
                    ref={inputRef}
                    type="datetime-local"
                    value={editValue ? new Date(String(editValue)).toISOString().slice(0, 16) : ''}
                    onChange={(e: any) => setEditValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={handleBlur}
                    disabled={isSaving}
                    className="bg-transparent border-none outline-none text-xs text-zinc-200 font-mono w-full"
                />
            </div>
        );
    }

    // Editing mode - Number
    if (type.includes('int') || type.includes('num') || type.includes('float') || type.includes('decimal')) {
        return (
            <input
                ref={inputRef}
                type="number"
                value={editValue === null || editValue === undefined ? '' : String(editValue)}
                onChange={(e: any) => setEditValue(e.target.value === '' ? null : Number(e.target.value))}
                onKeyDown={handleKeyDown}
                onBlur={handleBlur}
                disabled={isSaving}
                className="w-full bg-transparent border-none outline-none text-xs text-zinc-200 font-mono"
            />
        );
    }

    // Editing mode - JSON
    if (type.includes('json')) {
        return (
            <div className="flex items-center gap-1">
                <Code2 size={12} className="text-zinc-600 shrink-0" />
                <textarea
                    ref={textareaRef}
                    value={typeof editValue === 'object' ? JSON.stringify(editValue, null, 2) : String(editValue ?? '')}
                    onChange={(e: any) => {
                        try {
                            setEditValue(JSON.parse(e.target.value));
                        } catch {
                            setEditValue(e.target.value);
                        }
                    }}
                    onKeyDown={(e: any) => {
                        if (e.key === 'Escape') {
                            e.preventDefault();
                            onCancel();
                        }
                    }}
                    onBlur={handleBlur}
                    disabled={isSaving}
                    className="w-full bg-transparent border-none outline-none text-xs text-zinc-200 font-mono resize-none min-h-[60px]"
                />
            </div>
        );
    }

    // Editing mode - Default text input
    return (
        <input
            ref={inputRef}
            type="text"
            value={String(editValue ?? '')}
            onChange={(e: any) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            disabled={isSaving}
            className={`w-full bg-transparent border-none outline-none text-xs text-zinc-200 ${error ? 'text-red-400' : ''}`}
            placeholder="Enter value..."
        />
    );
};

export default InlineCellEditor;
