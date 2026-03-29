import React, { useEffect, useMemo, useState } from 'react';
import { Check, FileText, Loader2, RefreshCw, Save } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import ModuleScrollContainer from './ModuleScrollContainer';

interface EmailTemplate {
    type: string;
    subject: string;
    body: string;
    description: string;
}

const EmailTemplatesView: React.FC = () => {
    const [templates, setTemplates] = useState<EmailTemplate[]>([]);
    const [selectedType, setSelectedType] = useState('');
    const [form, setForm] = useState({ subject: '', body: '', description: '' });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    const selectedTemplate = useMemo(
        () => templates.find((template) => template.type === selectedType) || null,
        [templates, selectedType],
    );

    const loadTemplates = async () => {
        setLoading(true);
        try {
            const res = await fetchWithAuth('/api/auth/templates');
            const data = await res.json();
            const nextTemplates = Array.isArray(data) ? data : [];
            setTemplates(nextTemplates);
            if (nextTemplates.length > 0) {
                setSelectedType((current) => current || nextTemplates[0].type);
            }
        } catch (error) {
            console.error('Failed to load templates:', error);
            setTemplates([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadTemplates();
    }, []);

    useEffect(() => {
        if (!selectedTemplate) {
            return;
        }
        setForm({
            subject: selectedTemplate.subject || '',
            body: selectedTemplate.body || '',
            description: selectedTemplate.description || '',
        });
    }, [selectedTemplate]);

    const handleSave = async () => {
        if (!selectedType) {
            return;
        }
        setSaving(true);
        setSaved(false);
        try {
            const res = await fetchWithAuth(`/api/auth/templates/${selectedType}`, {
                method: 'PUT',
                body: JSON.stringify(form),
            });
            if (res.ok) {
                await loadTemplates();
                setSaved(true);
                window.setTimeout(() => setSaved(false), 1500);
            }
        } catch (error) {
            console.error('Failed to update template:', error);
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModuleScrollContainer width="6xl" innerClassName="animate-in fade-in duration-500">
            <div className="flex items-center justify-between border-b border-[#2e2e2e] pb-6">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-primary/10 rounded-2xl border border-primary/20">
                        <FileText className="text-primary" size={24} />
                    </div>
                    <div>
                        <h1 className="text-3xl font-black text-white uppercase tracking-tighter italic">Email Templates</h1>
                        <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest mt-1">
                            Persisted delivery templates used by auth and workspace flows
                        </p>
                    </div>
                </div>
                <button
                    onClick={() => void loadTemplates()}
                    className="flex items-center gap-2 px-5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-white transition-all"
                >
                    <RefreshCw size={14} />
                    Refresh
                </button>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader2 size={28} className="text-primary animate-spin" />
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
                    <div className="bg-[#111111] border border-[#2e2e2e] rounded-3xl p-3 space-y-2">
                        {templates.map((template) => (
                            <button
                                key={template.type}
                                onClick={() => setSelectedType(template.type)}
                                className={`w-full text-left px-4 py-3 rounded-2xl transition-all border ${selectedType === template.type ? 'bg-primary/10 border-primary/20 text-white' : 'bg-zinc-900/30 border-transparent text-zinc-500 hover:text-white hover:bg-zinc-900'}`}
                            >
                                <p className="text-xs font-black uppercase tracking-widest">{template.type.replaceAll('_', ' ')}</p>
                                <p className="text-[10px] mt-1 leading-relaxed">{template.description}</p>
                            </button>
                        ))}
                    </div>

                    <div className="bg-[#111111] border border-[#2e2e2e] rounded-3xl overflow-hidden">
                        {selectedTemplate ? (
                            <>
                                <div className="px-8 py-6 border-b border-[#2e2e2e] bg-[#171717]">
                                    <h2 className="text-xl font-black text-white uppercase tracking-tight">{selectedTemplate.type.replaceAll('_', ' ')}</h2>
                                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mt-1">
                                        Supported placeholders: app_name, action_link, token, workspace_name, inviter_email, alert_type, details
                                    </p>
                                </div>

                                <div className="p-8 space-y-6">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Description</label>
                                        <input
                                            value={form.description}
                                            onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                                            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary/50"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Subject</label>
                                        <input
                                            value={form.subject}
                                            onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))}
                                            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary/50"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Body</label>
                                        <textarea
                                            value={form.body}
                                            onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))}
                                            className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 text-sm text-white focus:outline-none focus:border-primary/50 min-h-[280px] font-mono"
                                        />
                                    </div>
                                </div>

                                <div className="px-8 py-5 border-t border-[#2e2e2e] bg-[#171717] flex justify-end">
                                    <button
                                        onClick={() => void handleSave()}
                                        disabled={saving}
                                        className="px-6 py-3 bg-primary text-black rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-60 flex items-center gap-2"
                                    >
                                        {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Save size={14} />}
                                        {saving ? 'Saving' : saved ? 'Saved' : 'Save Template'}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div className="p-10 text-zinc-500">No templates available.</div>
                        )}
                    </div>
                </div>
            )}
        </ModuleScrollContainer>
    );
};

export default EmailTemplatesView;
