import React, { useState, useEffect, useCallback } from 'react';
import {
    Activity,
    Search,
    Filter,
    Trash2,
    Play,
    Pause,
    Radio,
    Terminal,
    ArrowRight,
    Wifi,
    Settings,
    Zap,
    RefreshCw,
    Database
} from 'lucide-react';

interface RealtimeInspectorProps {
    view?: 'inspector' | 'config' | 'configuration';
}

const normalizeRealtimeView = (view?: string) => {
    if (view === 'config') {
        return 'configuration';
    }
    if (view === 'configuration' || view === 'inspector') {
        return view;
    }
    return 'inspector';
};

const RealtimeInspector: React.FC<RealtimeInspectorProps> = ({ view = 'inspector' }) => {
    const [events, setEvents] = useState<any[]>([]);
    const [isListening, setIsListening] = useState(true);
    const [selectedEvent, setSelectedEvent] = useState<any>(null);
    const [activeTab, setActiveTab] = useState(normalizeRealtimeView(view));
    const [collections, setCollections] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [diagnosticStatus, setDiagnosticStatus] = useState<any>(null);

    useEffect(() => {
        setActiveTab(normalizeRealtimeView(view));
    }, [view]);

    const fetchCollections = useCallback(async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('ozy_token');
            const res = await fetch('/api/collections', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            setCollections(data.filter((c: any) => !c.is_system));
        } catch (e) { console.error(e); }
        setLoading(false);
    }, []);

    useEffect(() => {
        let eventSource: EventSource | null = null;
        if (isListening && activeTab === 'inspector') {
            const es = new EventSource('/api/realtime');
            eventSource = es;
            es.onmessage = (event: any) => {
                try {
                    const newEvent = JSON.parse(event.data);
                    const eventWithId = {
                        ...newEvent,
                        id: Date.now() + Math.random(),
                        time: new Date().toLocaleTimeString()
                    };
                    setEvents((prev: any) => [eventWithId, ...prev].slice(0, 50));
                    if (!selectedEvent) setSelectedEvent(eventWithId);
                } catch (e) { console.error("Event parse error", e); }
            };
            es.onerror = (err: any) => {
                console.error("SSE Error:", err);
                es.close();
            };
        }
        return () => {
            if (eventSource) eventSource.close();
        };
    }, [isListening, activeTab, selectedEvent]);

    useEffect(() => {
        if (activeTab === 'configuration') {
            Promise.resolve().then(() => fetchCollections());
        }
    }, [activeTab, fetchCollections]);

    const toggleRealtime = async (name: any, currentStatus: any) => {
        try {
            const token = localStorage.getItem('ozy_token');
            await fetch('/api/collections/realtime', {
                method: 'PATCH',
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name, enabled: !currentStatus })
            });
            fetchCollections(); // Refresh
        } catch (e) { console.error(e); }
    };

    const runDiagnostic = async () => {
        setDiagnosticStatus('Running...');
        try {
            const token = localStorage.getItem('ozy_token');
            // Try to find a table to insert into
            const targetTable = collections.find((c: any) => c.realtime_enabled)?.name || 'users';
            
            // We'll use the generic SQL execution endpoint for a quick diagnostic insert
            const res = await fetch('/api/sql', {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    sql: `INSERT INTO ${targetTable} (created_at) VALUES (NOW()) -- DIAGNOSTIC EVENT` 
                })
            });
            
            if (res.ok) {
                setDiagnosticStatus('Event triggered! Switch to Inspector.');
                setTimeout(() => setDiagnosticStatus(null), 5000);
            } else {
                setDiagnosticStatus('Failed. Table might not exist.');
            }
        } catch (e: any) { 
            setDiagnosticStatus('Error: ' + e.message);
        }
    };

    const renderTabs = () => (
        <div className="flex px-6 pt-4 gap-8">
            {['inspector', 'configuration'].map((tab: any) => (
                <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`pb-3 text-[10px] font-black uppercase tracking-[0.2em] transition-all relative ${activeTab === tab ? 'text-primary' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                    {tab}
                    {activeTab === tab && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary animate-in fade-in zoom-in duration-300" />}
                </button>
            ))}
        </div>
    );

    return (
        <div className="flex flex-col h-full bg-[#111111] animate-in fade-in duration-500">
            {/* Header / Tabs */}
            <div className="bg-[#1a1a1a] border-b border-[#2e2e2e]">
                {renderTabs()}
            </div>

            {/* Control Bar */}
            <div className="h-14 border-b border-[#2e2e2e] bg-[#141414] flex items-center justify-between px-6">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 px-3 py-1 bg-zinc-900 border border-zinc-800 rounded-lg shadow-inner">
                        <Wifi size={14} className={isListening ? "text-primary animate-pulse" : "text-zinc-600"} />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                            {isListening ? 'Streaming Active' : 'Stream Paused'}
                        </span>
                    </div>
                    {activeTab === 'inspector' && (
                        <>
                            <div className="h-4 w-[1px] bg-[#2e2e2e]" />
                            <button
                                onClick={() => setIsListening(!isListening)}
                                className={`flex items-center gap-2 px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${isListening ? 'bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20' : 'bg-primary text-black'}`}
                            >
                                {isListening ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
                                {isListening ? 'Stop Listening' : 'Start Listening'}
                            </button>
                            <button
                                onClick={() => setEvents([])}
                                className="flex items-center gap-2 px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-white"
                            >
                                Clear Feed
                            </button>
                        </>
                    )}
                </div>

                <div className="flex items-center gap-3">
                    {activeTab === 'configuration' && (
                        <button 
                            onClick={runDiagnostic}
                            className={`flex items-center gap-2 px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${diagnosticStatus?.includes('Error') ? 'bg-red-500 text-white' : 'bg-indigo-500 text-white hover:bg-indigo-600 shadow-lg shadow-indigo-500/20'}`}
                        >
                            <Zap size={12} fill="currentColor" />
                            {diagnosticStatus || 'Run Realtime Diagnostic'}
                        </button>
                    )}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={14} />
                        <input
                            type="text"
                            placeholder="Filter events..."
                            className="bg-[#0c0c0c] border border-[#2e2e2e] rounded-lg pl-9 pr-4 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-primary/50 w-64 transition-all"
                        />
                    </div>
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
                {activeTab === 'inspector' ? (
                    <>
                        {/* Event Feed */}
                        <div className="w-1/2 border-r border-[#2e2e2e] flex flex-col bg-[#111111]">
                            <div className="px-4 py-2 border-b border-[#2e2e2e] bg-[#141414] text-[9px] font-black text-zinc-600 uppercase tracking-widest">
                                Live Event Log
                            </div>
                            <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                                {events.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-full opacity-30 gap-3 grayscale">
                                        <Radio size={32} />
                                        <span className="text-[10px] uppercase font-black tracking-widest">Waiting for events...</span>
                                    </div>
                                ) : (
                                    events.map((ev: any) => (
                                        <div
                                            key={ev.id}
                                            onClick={() => setSelectedEvent(ev)}
                                            className={`group flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${selectedEvent?.id === ev.id ? 'bg-primary/5 border-primary/20' : 'bg-zinc-900/30 border-transparent hover:border-zinc-800 hover:bg-zinc-800/40'}`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-[8px] tracking-tighter ${ev.action === 'INSERT' ? 'bg-green-500/10 text-green-500 border border-green-500/20' :
                                                    ev.action === 'UPDATE' ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' :
                                                        'bg-red-500/10 text-red-500 border border-red-500/20'
                                                    }`}>
                                                    {ev.action}
                                                </div>
                                                <div>
                                                    <p className="text-[11px] font-bold text-zinc-300 flex items-center gap-1.5">
                                                        {ev.table} <ArrowRight size={10} className="text-zinc-700" /> <span className="text-zinc-500 uppercase text-[9px]">OzyBase-Core</span>
                                                    </p>
                                                    <p className="text-[9px] font-mono text-zinc-600 leading-none mt-1">{ev.time}</p>
                                                </div>
                                            </div>
                                            <div className="text-[10px] font-mono text-zinc-700 group-hover:text-primary transition-colors">
                                                #{Math.floor(ev.id % 9999)}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* Event Detail / Inspection */}
                        <div className="w-1/2 flex flex-col bg-[#0c0c0c]">
                            <div className="px-4 py-2 border-b border-[#2e2e2e] bg-[#141414] text-[9px] font-black text-zinc-600 uppercase tracking-widest flex items-center justify-between">
                                <span>Event Payload Inspector</span>
                                <div className="flex gap-2">
                                    <span className={`w-2 h-2 rounded-full ${selectedEvent ? 'bg-primary' : 'bg-zinc-800'}`} />
                                    <span className="w-2 h-2 rounded-full bg-zinc-800" />
                                    <span className="w-2 h-2 rounded-full bg-zinc-800" />
                                </div>
                            </div>
                            <div className="flex-1 p-6 overflow-auto custom-scrollbar">
                                {selectedEvent ? (
                                    <>
                                        <div className="bg-[#111111] rounded-2xl border border-[#2e2e2e] overflow-hidden shadow-2xl">
                                            <div className="px-4 py-2 bg-[#1a1a1a] border-b border-[#2e2e2e] flex items-center gap-2">
                                                <Terminal size={14} className="text-zinc-500" />
                                                <span className="text-[10px] font-mono text-zinc-400">JSON Payload</span>
                                            </div>
                                            <pre className="p-6 text-xs text-primary font-mono leading-relaxed overflow-x-auto">
                                                {JSON.stringify(selectedEvent.record, null, 4)}
                                            </pre>
                                        </div>

                                        <div className="mt-8 space-y-4">
                                            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600 ml-1">Event Metadata</h4>
                                            <div className="grid grid-cols-2 gap-4">
                                                {[
                                                    { k: 'Source', v: 'PostgreSQL Notify' },
                                                    { k: 'Table', v: selectedEvent.table },
                                                    { k: 'Action', v: selectedEvent.action },
                                                    { k: 'Timestamp', v: selectedEvent.time }
                                                ].map((item: any, i: any) => (
                                                    <div key={i} className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-3">
                                                        <p className="text-[8px] font-bold text-zinc-600 uppercase mb-1">{item.k}</p>
                                                        <p className="text-xs font-bold text-zinc-300 uppercase tracking-tight">{item.v}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <div className="h-full flex flex-col items-center justify-center opacity-20 grayscale gap-4">
                                        <Activity size={48} />
                                        <span className="text-xs font-black uppercase tracking-[0.3em]">Select an event to inspect</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 p-8 bg-[#111111] overflow-y-auto custom-scrollbar">
                        <div className="max-w-4xl mx-auto">
                            <div className="flex items-center gap-4 mb-8">
                                <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl text-indigo-500">
                                    <Settings size={24} />
                                </div>
                                <div>
                                    <h2 className="text-xl font-black text-white italic tracking-tighter">Realtime Streaming Engine</h2>
                                    <p className="text-[10px] text-zinc-600 font-black uppercase tracking-widest mt-0.5">Manage which tables broadcast events to clients</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-4">
                                {loading ? (
                                    <div className="flex items-center justify-center py-20">
                                        <RefreshCw size={24} className="text-zinc-600 animate-spin" />
                                    </div>
                                ) : collections.map((col: any) => (
                                    <div key={col.name} className="bg-[#171717] border border-[#2e2e2e] rounded-2xl p-6 flex items-center justify-between group hover:border-primary/20 transition-all">
                                        <div className="flex items-center gap-6">
                                            <div className={`p-4 rounded-xl bg-[#111111] border border-zinc-900 ${col.realtime_enabled ? 'text-primary' : 'text-zinc-700'}`}>
                                                <Database size={24} />
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-black text-white uppercase tracking-tight">{col.name}</span>
                                                    {col.realtime_enabled && <span className="px-1.5 py-0.5 bg-green-500/10 text-green-500 border border-green-500/20 rounded text-[8px] font-black uppercase tracking-widest">Active</span>}
                                                </div>
                                                <p className="text-[9px] text-zinc-600 font-bold uppercase tracking-widest mt-1">
                                                    {col.schema?.length || 0} Columns â€¢ Public Schema â€¢ tr_notify_{col.name}
                                                </p>
                                            </div>
                                        </div>
                                        
                                        <button 
                                            onClick={() => toggleRealtime(col.name, col.realtime_enabled)}
                                            className={`relative w-12 h-6 rounded-full transition-all duration-300 ${col.realtime_enabled ? 'bg-primary' : 'bg-zinc-800'}`}
                                        >
                                            <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-300 ${col.realtime_enabled ? 'translate-x-6' : 'translate-x-0'}`} />
                                        </button>
                                    </div>
                                ))}
                            </div>

                            <div className="mt-12 p-6 bg-indigo-500/5 border border-indigo-500/20 rounded-3xl">
                                <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400 mb-2">High Functional configuration</h4>
                                <p className="text-[11px] text-zinc-400 leading-relaxed mb-6">
                                    Enabling Realtime for a table attaches a native PostgreSQL trigger that broadcasts every 
                                    <b> INSERT</b>, <b>UPDATE</b>, and <b>DELETE</b> via OzyBase PubSub. This operation is 
                                    instantaneous and requires no server restart.
                                </p>
                                <div className="flex gap-4">
                                    <div className="flex-1 bg-[#111111] border border-zinc-800 rounded-xl p-4">
                                        <p className="text-[8px] font-black text-zinc-600 uppercase mb-1">Active Streams</p>
                                        <p className="text-xl font-black text-white italic">{collections.filter((c: any) => c.realtime_enabled).length}</p>
                                    </div>
                                    <div className="flex-1 bg-[#111111] border border-zinc-800 rounded-xl p-4">
                                        <p className="text-[8px] font-black text-zinc-600 uppercase mb-1">Engine Latency</p>
                                        <p className="text-xl font-black text-white italic">~1.2ms</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default RealtimeInspector;
