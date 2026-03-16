import React, { useState, useEffect } from 'react';
import { Shield, Globe, Check, X, AlertTriangle, Loader2, Info } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

interface GeoFencingPolicy {
    enabled: boolean;
    allowed_countries: string[];
}

interface SecurityPolicies {
    geo_fencing: GeoFencingPolicy;
    [key: string]: unknown;
}

type ToastType = 'success' | 'error';

interface ToastState {
    message: string;
    type: ToastType;
}

const SecurityManager = () => {
    const [policies, setPolicies] = useState<SecurityPolicies | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [newCountry, setNewCountry] = useState('');
    const [toast, setToast] = useState<ToastState | null>(null);

    const fetchPolicies = async () => {
        try {
            const res = await fetchWithAuth('/api/project/security/policies');
            const data: unknown = await res.json();
            if (
                data &&
                typeof data === 'object' &&
                'geo_fencing' in data &&
                typeof (data as { geo_fencing?: unknown }).geo_fencing === 'object'
            ) {
                setPolicies(data as SecurityPolicies);
            } else {
                setPolicies({ geo_fencing: { enabled: false, allowed_countries: [] } });
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPolicies();
    }, []);

    const savePolicy = async (type: string, config: GeoFencingPolicy) => {
        setSaving(true);
        try {
            const res = await fetchWithAuth('/api/project/security/policies', {
                method: 'POST',
                body: JSON.stringify({ type, config })
            });
            if (res.ok) {
                setToast({ message: 'Policy updated successfully', type: 'success' });
            }
        } catch (error) {
            console.error('Failed to update security policy', error);
            setToast({ message: 'Failed to update policy', type: 'error' });
        } finally {
            setSaving(false);
            setTimeout(() => setToast(null), 3000);
        }
    };

    const toggleGeoFencing = () => {
        if (!policies) return;
        const newPolicy = {
            ...policies.geo_fencing,
            enabled: !policies.geo_fencing.enabled
        };
        setPolicies({ ...policies, geo_fencing: newPolicy });
        savePolicy('geo_fencing', newPolicy);
    };

    const addCountry = () => {
        if (!policies) return;
        if (!newCountry || policies.geo_fencing.allowed_countries.includes(newCountry)) return;
        const newPolicy = {
            ...policies.geo_fencing,
            allowed_countries: [...policies.geo_fencing.allowed_countries, newCountry]
        };
        setPolicies({ ...policies, geo_fencing: newPolicy });
        savePolicy('geo_fencing', newPolicy);
        setNewCountry('');
    };

    const removeCountry = (country: string) => {
        if (!policies) return;
        const newPolicy = {
            ...policies.geo_fencing,
            allowed_countries: policies.geo_fencing.allowed_countries.filter((c: any) => c !== country)
        };
        setPolicies({ ...policies, geo_fencing: newPolicy });
        savePolicy('geo_fencing', newPolicy);
    };

    if (loading) return (
        <div className="flex items-center justify-center h-full text-zinc-500 gap-2">
            <Loader2 className="animate-spin" size={20} />
            <span className="text-xs font-black uppercase tracking-widest">Loading Security Policies...</span>
        </div>
    );

    if (!policies) {
        return null;
    }

    const geo = policies.geo_fencing;

    return (
        <div className="p-8 max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#2e2e2e] pb-6">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-primary/10 rounded-2xl border border-primary/20">
                        <Shield className="text-primary" size={24} />
                    </div>
                    <div>
                        <h1 className="text-3xl font-black text-white uppercase tracking-tighter italic">Security Alertas</h1>
                        <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest mt-1">Configure geo-fencing and access control policies</p>
                    </div>
                </div>
            </div>

            {/* Geo Fencing Card */}
            <div className={`p-8 rounded-3xl border transition-all duration-500 bg-[#111111] ${geo.enabled ? 'border-primary/30 shadow-[0_0_50px_rgba(254,254,0,0.05)]' : 'border-[#2e2e2e]'}`}>
                <div className="flex items-start justify-between mb-8">
                    <div className="flex gap-4">
                        <div className={`p-3 rounded-xl border ${geo.enabled ? 'bg-primary/20 border-primary/30 text-primary' : 'bg-zinc-800 border-zinc-700 text-zinc-500'}`}>
                            <Globe size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-white uppercase tracking-tight">Geo-Fencing Policy</h2>
                            <p className="text-zinc-500 text-xs mt-1">Restrict API access based on client's geographical location.</p>
                        </div>
                    </div>
                    <button
                        onClick={toggleGeoFencing}
                        disabled={saving}
                        className={`px-6 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${geo.enabled ? 'bg-primary text-black hover:scale-105' : 'bg-zinc-800 text-zinc-400 hover:text-white'}`}
                    >
                        {saving ? 'Saving...' : geo.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                </div>

                <div className="space-y-6">
                    <div className="bg-[#0c0c0c] border border-[#2e2e2e] p-6 rounded-2xl">
                        <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-4">Allowed Countries</label>

                        <div className="flex gap-2 mb-6">
                            <input
                                type="text"
                                placeholder="Enter country name (e.g. United States, Spain)..."
                                value={newCountry}
                                onChange={(e: any) => setNewCountry(e.target.value)}
                                className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-primary/50 transition-all"
                            />
                            <button
                                onClick={addCountry}
                                disabled={saving}
                                className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                            >
                                {saving ? 'Saving' : 'Add'}
                            </button>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {geo.allowed_countries.length === 0 ? (
                                <div className="w-full p-8 border-2 border-dashed border-zinc-800 rounded-2xl flex flex-col items-center justify-center text-zinc-600 gap-2">
                                    <Info size={24} />
                                    <p className="text-[10px] font-black uppercase tracking-widest">No countries allowed</p>
                                    <p className="text-[9px] lowercase italic font-medium">When enabled, ALL countries will be blocked. Addå°‘ãªãã¨ã‚‚ one country.</p>
                                </div>
                            ) : (
                                geo.allowed_countries.map((country: any) => (
                                    <div key={country} className="flex items-center gap-2 bg-primary/10 border border-primary/20 text-primary px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest group">
                                        {country}
                                        <button disabled={saving} onClick={() => removeCountry(country)} className="hover:text-red-500 transition-colors disabled:opacity-50">
                                            <X size={14} />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    <div className="flex items-start gap-3 p-4 bg-amber-500/5 border border-amber-500/10 rounded-xl">
                        <AlertTriangle className="text-amber-500 shrink-0" size={16} />
                        <p className="text-[10px] text-amber-500/80 leading-relaxed font-medium">
                            <span className="font-black uppercase tracking-widest mr-2">Pro Tip:</span>
                            Enabling geo-fencing will immediately start logging "Geographic Access Breaches" in your health advisor when unauthorized access is detected. These alerts are stored in the database for future audit.
                        </p>
                    </div>
                </div>
            </div>

            {/* Toast Notifications */}
            {toast && (
                <div className={`fixed bottom-8 right-8 px-6 py-3 rounded-xl border text-[10px] font-black uppercase tracking-widest flex items-center gap-3 animate-in slide-in-from-bottom duration-300 ${toast.type === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-500' : 'bg-red-500/10 border-red-500/20 text-red-500'}`}>
                    {toast.type === 'success' ? <Check size={14} /> : <AlertTriangle size={14} />}
                    {toast.message}
                </div>
            )}
        </div>
    );
};

export default SecurityManager;
