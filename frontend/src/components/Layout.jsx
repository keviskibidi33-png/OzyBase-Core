import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
    LayoutGrid,
    Table2,
    Code,
    Database,
    Lock,
    FolderOpen,
    Zap,
    Activity,
    FileText,
    ShieldCheck,
    Settings,
    Bell,
    HelpCircle,
    ChevronDown,
    ChevronRight,
    Search,
    BarChart,
    Home,
    Terminal,
    Users,
    Key,
    PanelLeftClose,
    PanelLeftOpen,
    LogOut,
    Plus,
    X,
    MousePointer2,
    Lightbulb,
    Telescope,
    List,
    User,
    Pin,
    PinOff,
    Shield,
    Globe,
    ShieldAlert,
    Cpu,
    History,
    CreditCard,
    Server,
    Check,
    Trash2,
    ShieldBan,
    AlertTriangle,
    Briefcase
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

import CreateTableModal from './CreateTableModal';
import ConnectionModal from './ConnectionModal';
import NotificationCenter from './NotificationCenter';
import AutoFixModal from './AutoFixModal';
import ConfirmModal from './ConfirmModal';
import WorkspaceSwitcher from './WorkspaceSwitcher';
const PRIMARY_NAV = [
    { id: 'overview', icon: Home, label: 'Home' },
    { id: 'tables', icon: Table2, label: 'Table Editor' },
    { id: 'database', icon: Database, label: 'Database' },
    { id: 'sql', icon: Terminal, label: 'SQL Editor' },
    { type: 'separator' },
    { id: 'auth', icon: Lock, label: 'Authentication' },
    { id: 'storage', icon: FolderOpen, label: 'Storage' },
    { id: 'edge', icon: Zap, label: 'Edge Functions' },
    { id: 'realtime', icon: MousePointer2, label: 'Realtime' },
    { type: 'separator' },
    { id: 'advisors', icon: Lightbulb, label: 'Advisors' },
    { id: 'observability', icon: Telescope, label: 'Observability' },
    { id: 'logs', icon: List, label: 'Logs' },
    { id: 'docs', icon: FileText, label: 'API Docs' },
    { id: 'integrations', icon: LayoutGrid, label: 'Integrations' },
];

const SUBMENUS = {
    auth: [
        { id: 'users', name: 'Users', icon: Users },
        { id: 'providers', name: 'Providers', icon: Key },
        { id: 'policies', name: 'Permissions', icon: Shield },
        { id: 'two_factor', name: '2FA Settings', icon: ShieldCheck },
        { id: 'security', name: 'Security Hub', icon: ShieldAlert },
        { id: 'security_policies', name: 'Geo-Fencing', icon: Globe },
        { id: 'firewall', name: 'IP Firewall', icon: ShieldBan },
        { id: 'security_notifications', name: 'Alert Notifications', icon: Bell },
        { id: 'integrations', name: 'Integrations & SIEM', icon: Activity },
        { id: 'templates', name: 'Email Templates', icon: FileText },
        { id: 'auth_settings', name: 'Auth Settings', icon: Settings }
    ],
    storage: [
        { id: 'buckets', name: 'Buckets', icon: FolderOpen },
        { id: 'storage_policies', name: 'Policies', icon: Shield },
        { id: 'usage', name: 'Usage', icon: Activity },
        { id: 'storage_settings', name: 'Settings', icon: Settings }
    ],
    edge: [
        { id: 'functions', name: 'Functions', icon: Code },
        { id: 'deployments', name: 'Deployments', icon: Zap },
        { id: 'secrets', name: 'Env Variables', icon: Key },
        { id: 'edge_logs', name: 'Edge Logs', icon: List }
    ],
    realtime: [
        { id: 'inspector', name: 'Inspector', icon: Search },
        { id: 'channels', name: 'Channels', icon: Activity },
        { id: 'config', name: 'Configuration', icon: Settings }
    ],
    logs: [
        { id: 'explorer', name: 'Log Explorer', icon: Search },
        { id: 'live', name: 'Live Tail', icon: Activity },
        { id: 'alerts', name: 'Security Alerts', icon: Bell },
        { id: 'metrics', name: 'Traffic Analysis', icon: BarChart }
    ],
    docs: [
        { id: 'intro', name: 'Getting Started', icon: Home },
        { id: 'auth_api', name: 'Authentication', icon: Lock },
        { id: 'db_api', name: 'Database & SQL', icon: Database },
        { id: 'storage_api', name: 'Storage', icon: FolderOpen },
        { id: 'realtime_api', name: 'Realtime', icon: MousePointer2 },
        { id: 'edge_api', name: 'Edge Functions', icon: Zap },
        { id: 'sdk', name: 'Client SDKs', icon: Code }
    ],
    settings: [
        { id: 'general', name: 'General', icon: Settings },
        { id: 'infrastructure', name: 'Infrastructure', icon: Server },
        { id: 'billing', name: 'Billing', icon: CreditCard },
        { id: 'api_keys', name: 'API Keys', icon: Key }
    ],
    integrations: [
        { id: 'wrappers', name: 'Wrappers', icon: Globe },
        { id: 'webhooks', name: 'Webhooks', icon: Zap },
        { id: 'cron', name: 'Cron Jobs', icon: History },
        { id: 'extensions', name: 'PG Extensions', icon: Cpu },
        { id: 'vault', name: 'Vault', icon: Shield },
        { id: 'graphql', name: 'GraphQL', icon: Code }
    ],
    workspace_settings: [
        { id: 'ws_general', name: 'General', icon: Settings },
        { id: 'ws_members', name: 'Team Members', icon: Users },
        { id: 'ws_danger', name: 'Danger Zone', icon: AlertTriangle }
    ],
    workspaces: [
        { id: 'wm_overview', name: 'My Projects', icon: Briefcase },
        { id: 'wm_shared', name: 'Shared with me', icon: Users },
        { id: 'wm_templates', name: 'Templates', icon: LayoutGrid }
    ]
};

const Layout = ({ children, selectedView, selectedTable, onTableSelect, onMenuViewSelect, tables = [], refreshTables, onWorkspaceChange }) => {
    const [dbStatus, setDbStatus] = useState('Checking...');
    const [user] = useState(() => {
        const storedUser = localStorage.getItem('ozy_user');
        return storedUser ? JSON.parse(storedUser) : null;
    });
    const [isSidebarPinned, setIsSidebarPinned] = useState(false);
    const [isSidebarHovered, setIsSidebarHovered] = useState(false);
    const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
    const [isCreateTableModalOpen, setIsCreateTableModalOpen] = useState(false);
    const [isConnectionModalOpen, setIsConnectionModalOpen] = useState(false);
    const [schemas, setSchemas] = useState(['public']);
    const [selectedSchema, setSelectedSchema] = useState('public');
    const [isSchemaDropdownOpen, setIsSchemaDropdownOpen] = useState(false);
    const [healthIssues, setHealthIssues] = useState([]);
    const [isNotificationOpen, setIsNotificationOpen] = useState(false);
    const [selectedFixIssue, setSelectedFixIssue] = useState(null);
    const [isAutoFixModalOpen, setIsAutoFixModalOpen] = useState(false);
    const [isBannerDismissed, setIsBannerDismissed] = useState(false);
    const [toast, setToast] = useState(null);
    const [confirmDeleteTable, setConfirmDeleteTable] = useState(null);
    const [explorerSearchTerm, setExplorerSearchTerm] = useState('');
    const [docsFilter, setDocsFilter] = useState('all');
    const [isSystemTablesExpanded, setIsSystemTablesExpanded] = useState(false);

    const notificationRef = useRef(null);
    const userDropdownRef = useRef(null);

    // Derived state (js-combine-iterations)
    const safeHealthIssues = useMemo(() => Array.isArray(healthIssues) ? healthIssues : [], [healthIssues]);

    // Pre-calculate and memoize filtered table lists for performance (js-combine-iterations)
    const { filteredUserTables, filteredSystemTables } = useMemo(() => {
        const lowerSearch = explorerSearchTerm.toLowerCase();
        const user = [];
        const system = [];

        tables.forEach(t => {
            const isSystem = t.is_system || t.name?.startsWith('_v_') || t.name?.startsWith('_ozy_');
            const matchesSearch = t.name?.toLowerCase().includes(lowerSearch);

            if (matchesSearch) {
                if (isSystem) system.push(t);
                else user.push(t);
            }
        });

        return { filteredUserTables: user, filteredSystemTables: system };
    }, [tables, explorerSearchTerm]);

    const showToast = React.useCallback((message, type = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 5000);
    }, []);

    const handleDeleteTable = React.useCallback((tableName, e) => {
        e.stopPropagation();
        setConfirmDeleteTable(tableName);
    }, []);

    const confirmTableDeletion = React.useCallback(async () => {
        const tableName = confirmDeleteTable;
        try {
            const res = await fetchWithAuth(`/api/collections/${tableName}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                showToast(`Table "${tableName}" deleted successfully`, 'success');
                refreshTables();
                if (selectedTable === tableName) {
                    onTableSelect(null);
                }
            } else {
                showToast('Failed to delete table', 'error');
            }
        } catch (err) {
            console.error(err);
            showToast('Network error', 'error');
        }
    }, [confirmDeleteTable, refreshTables, selectedTable, onTableSelect, showToast]);

    useEffect(() => {
        // Status check
        fetchWithAuth('/api/health')
            .then(res => res.json())
            .then(data => setDbStatus(data.database === 'connected' ? 'Connected' : 'Degraded'))
            .catch(() => setDbStatus('Disconnected'));


        // Load tables
        refreshTables();

        // Load schemas
        fetchWithAuth('/api/collections/schemas')
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) {
                    setSchemas(data);
                } else {
                    setSchemas(['public']);
                }
            })
            .catch(err => {
                console.error("Failed to load schemas", err);
                setSchemas(['public']);
            });

        // Load health issues
        const fetchHealth = () => {
            fetchWithAuth('/api/project/health')
                .then(res => res.json())
                .then(data => setHealthIssues(Array.isArray(data) ? data : []))
                .catch(err => console.error("Failed to fetch health info", err));
        };

        fetchHealth();
        const healthInterval = setInterval(fetchHealth, 10000); // Check every 10s

        // Re-show banner every 10 minutes if still not fixed
        const bannerReminderInterval = setInterval(() => {
            setIsBannerDismissed(false);
        }, 10 * 60 * 1000);

        return () => {
            clearInterval(healthInterval);
            clearInterval(bannerReminderInterval);
        };
    }, [refreshTables]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (notificationRef.current && !notificationRef.current.contains(event.target)) {
                setIsNotificationOpen(false);
            }
            if (userDropdownRef.current && !userDropdownRef.current.contains(event.target)) {
                setIsUserDropdownOpen(false);
            }
        };

        if (isNotificationOpen || isUserDropdownOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isNotificationOpen, isUserDropdownOpen]);

    const handleApplyFix = React.useCallback(async (issue) => {
        try {
            const res = await fetchWithAuth('/api/project/health/fix', {
                method: 'POST',
                body: JSON.stringify({
                    type: issue.type,
                    issue: issue.title
                })
            });
            if (res.ok) {
                showToast(`Applied fix for: ${issue.title}`, 'success');
                // Refresh health after fix
                fetchWithAuth('/api/project/health')
                    .then(res => res.json())
                    .then(data => setHealthIssues(Array.isArray(data) ? data : []));
            } else {
                const errData = await res.json();
                showToast(errData.error || "Failed to apply fix", 'error');
            }
        } catch (error) {
            console.error(error);
            showToast('Network error or server unavailable', 'error');
        }
    }, [showToast]);

    const handleLogout = React.useCallback(() => {
        localStorage.removeItem('ozy_token');
        localStorage.removeItem('ozy_user');
        window.location.reload();
    }, []);



    const isExpanded = isSidebarPinned || isSidebarHovered;

    // --- Explorer Sidebar Submodules Content ---
    const renderExplorerContent = () => {
        let currentModule = selectedView;
        if (selectedView === 'table') currentModule = 'tables';
        if (selectedView === 'visualizer') currentModule = 'database';
        
        // Fix persistence for sub-views
        if (['users', 'providers', 'policies', 'two_factor', 'security', 'security_policies', 'firewall', 'security_notifications', 'templates', 'auth_settings'].includes(selectedView)) currentModule = 'auth';
        if (['buckets', 'storage_policies', 'usage', 'storage_settings'].includes(selectedView)) currentModule = 'storage';
        if (['functions', 'deployments', 'secrets', 'edge_logs'].includes(selectedView)) currentModule = 'edge';
        if (['inspector', 'channels', 'config'].includes(selectedView)) currentModule = 'realtime';
        if (['explorer', 'live', 'alerts', 'metrics'].includes(selectedView)) currentModule = 'logs';
        if (['intro', 'auth_api', 'db_api', 'storage_api', 'realtime_api', 'edge_api', 'sdk'].includes(selectedView)) currentModule = 'docs';
        if (['wrappers', 'webhooks', 'cron', 'extensions', 'vault', 'graphql'].includes(selectedView)) currentModule = 'integrations';
        if (['general', 'infrastructure', 'billing', 'api_keys'].includes(selectedView)) currentModule = 'settings';
        if (['ws_general', 'ws_members', 'ws_danger'].includes(selectedView)) currentModule = 'workspace_settings';
        if (['wm_overview', 'wm_shared', 'wm_templates'].includes(selectedView)) currentModule = 'workspaces';

        const activeSubmenu = SUBMENUS[currentModule] || [
            { id: 'general', name: 'Dashboard', icon: LayoutGrid },
            { id: 'status', name: 'System Status', icon: Activity }
        ];


        if (currentModule === 'sql') {
            return (
                <div className="space-y-6">
                    <div>
                        <div className="mb-4 px-2">
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-[#111111] border border-[#2e2e2e] rounded-md group focus-within:border-zinc-500 transition-colors">
                                <Search size={12} className="text-zinc-600 group-focus-within:text-white" />
                                <input
                                    type="text"
                                    placeholder="Search queries..."
                                    className="bg-transparent border-none text-xs text-white placeholder:text-zinc-600 focus:outline-none w-full"
                                />
                                <button className="text-zinc-600 hover:text-white"><Plus size={14} /></button>
                            </div>
                        </div>

                        <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 text-center">
                            <div className="w-10 h-10 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-3">
                                <Terminal size={18} className="text-zinc-600" />
                            </div>
                            <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest mb-1">No Saved Queries</p>
                            <p className="text-[9px] text-zinc-700">Run a query and save it for later.</p>
                        </div>
                    </div>

                    <div className="px-3 mt-auto">
                        <button className="w-full py-2 bg-[#1a1a1a] border border-[#2e2e2e] rounded text-[10px] font-bold text-zinc-400 hover:text-white hover:border-zinc-500 transition-all">
                            View running queries
                        </button>
                    </div>
                </div>
            );
        }

        if (currentModule === 'tables') {
            return (
                <div className="space-y-6">
                    <div>
                        <div className="mb-4 px-2 relative">
                            {/* Schema Selector */}
                            <button
                                onClick={() => setIsSchemaDropdownOpen(!isSchemaDropdownOpen)}
                                className="w-full flex items-center justify-between px-3 py-2 bg-[#171717] border border-[#2e2e2e] hover:border-zinc-500 text-zinc-300 rounded-lg transition-all text-xs font-bold mb-2 group"
                            >
                                <span className="flex items-center gap-2">
                                    <span className="text-zinc-500 font-normal">schema</span>
                                    {selectedSchema}
                                </span>
                                <ChevronDown size={14} className={`text-zinc-500 transition-transform ${isSchemaDropdownOpen ? 'rotate-180' : ''}`} />
                            </button>

                            {isSchemaDropdownOpen && (
                                <div className="absolute top-full left-2 right-2 z-50 bg-[#1a1a1a] border border-[#2e2e2e] rounded-lg shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                                    <div className="p-2 border-b border-[#2e2e2e]">
                                        <div className="flex items-center gap-2 px-2 py-1 bg-[#111111] rounded border border-[#2e2e2e]">
                                            <Search size={12} className="text-zinc-500" />
                                            <input
                                                type="text"
                                                placeholder="Find schema..."
                                                className="bg-transparent border-none text-xs text-white placeholder:text-zinc-600 focus:outline-none w-full"
                                                autoFocus
                                            />
                                        </div>
                                    </div>
                                    <div className="max-h-48 overflow-y-auto custom-scrollbar p-1">
                                        {schemas.map(s => (
                                            <button
                                                key={s}
                                                onClick={() => {
                                                    setSelectedSchema(s);
                                                    setIsSchemaDropdownOpen(false);
                                                }}
                                                className={`w-full text-left px-3 py-1.5 text-xs rounded-md flex items-center justify-between group ${selectedSchema === s ? 'bg-primary/10 text-primary font-bold' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}
                                            >
                                                {s}
                                                {selectedSchema === s && <Check size={12} />}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <button
                                onClick={() => setIsCreateTableModalOpen(true)}
                                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-[#171717] border border-[#2e2e2e] hover:border-zinc-500 hover:bg-zinc-800 text-zinc-300 hover:text-white rounded-lg transition-all text-xs font-bold uppercase tracking-wide group shadow-sm"
                            >
                                <Plus size={14} className="text-zinc-500 group-hover:text-primary transition-colors" />
                                New table
                            </button>
                        </div>

                        <div className="px-3 mb-2">
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-[#0a0a0a] border border-[#2e2e2e] rounded-lg group focus-within:border-primary/50 transition-all">
                                <Search size={12} className="text-zinc-600 group-focus-within:text-primary" />
                                <input
                                    type="text"
                                    placeholder="Filter tables..."
                                    value={explorerSearchTerm}
                                    onChange={(e) => setExplorerSearchTerm(e.target.value)}
                                    className="bg-transparent border-none text-[10px] text-zinc-300 placeholder:text-zinc-700 focus:outline-none w-full uppercase font-bold tracking-widest"
                                />
                                {explorerSearchTerm && (
                                    <button onClick={() => setExplorerSearchTerm('')} className="text-zinc-700 hover:text-white">
                                        <X size={10} />
                                    </button>
                                )}
                            </div>
                        </div>


                        <div className="space-y-4">
                            <div>
                                <div className="flex items-center justify-between px-3 mb-2">
                                    <h4 className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.2em]">User Tables ({filteredUserTables.length})</h4>
                                </div>
                                <div className="space-y-0.5">
                                    {filteredUserTables.map((t) => (
                                        <button
                                            key={t.name}
                                            onClick={() => onTableSelect(t.name)}
                                            className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-xs transition-all group ${selectedTable === t.name
                                                ? 'bg-zinc-900 text-primary font-bold border border-[#2e2e2e]/50 shadow-xl'
                                                : 'text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900/40 border border-transparent'
                                                }`}
                                        >
                                            <div className="flex items-center gap-3 truncate">
                                                <Table2 size={14} className={selectedTable === t.name ? 'text-primary' : 'text-zinc-800 group-hover:text-zinc-500'} />
                                                <span className="truncate">{t.name}</span>
                                                {t.realtime_enabled && (
                                                    <div className="flex items-center" title="Realtime Enabled">
                                                        <Wifi size={10} className="text-primary animate-pulse" />
                                                    </div>
                                                )}
                                            </div>
                                            <div
                                                onClick={(e) => handleDeleteTable(t.name, e)}
                                                className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 hover:bg-zinc-800 rounded transition-all"
                                            >
                                                <Trash2 size={12} />
                                            </div>
                                        </button>
                                    ))}
                                    {filteredUserTables.length === 0 && (
                                        <p className="px-3 py-4 text-[10px] text-zinc-600 italic uppercase">No user tables yet</p>
                                    )}
                                </div>
                            </div>

                            <div className="border-t border-[#2e2e2e] pt-4">
                                <button
                                    onClick={() => setIsSystemTablesExpanded(!isSystemTablesExpanded)}
                                    className="w-full flex items-center justify-between px-3 mb-2 group"
                                >
                                    <h4 className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.2em] group-hover:text-zinc-400 transition-colors flex items-center gap-2">
                                        {isSystemTablesExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                                        System Tables ({filteredSystemTables.length})
                                    </h4>
                                </button>

                                {isSystemTablesExpanded && (
                                    <div className="space-y-0.5 animate-in slide-in-from-top-1 duration-200">
                                        {filteredSystemTables.map((t) => (
                                            <button
                                                key={t.name}
                                                onClick={() => onTableSelect(t.name)}
                                                className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-xs transition-all group ${selectedTable === t.name
                                                    ? 'bg-zinc-900 text-primary font-bold border border-[#2e2e2e]/50 shadow-xl'
                                                    : 'text-zinc-600/60 hover:text-zinc-300 hover:bg-zinc-900/40 border border-transparent'
                                                    }`}
                                            >
                                                <div className="flex items-center gap-3 truncate">
                                                    <Lock size={12} className={selectedTable === t.name ? 'text-primary' : 'text-zinc-800 group-hover:text-zinc-500'} />
                                                    <span className="truncate font-mono opacity-80">{t.name}</span>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        if (currentModule === 'database') {
            return (
                <div className="space-y-6">
                    <div>
                        <div className="flex items-center justify-between px-3 mb-2 pt-0">
                            <h4 className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.2em]">Database Management</h4>
                        </div>

                        <div className="space-y-0.5 mb-4">
                            <button
                                onClick={() => onTableSelect('__visualizer__')}
                                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs transition-all group ${selectedTable === '__visualizer__'
                                    ? 'bg-zinc-900 text-primary font-bold border border-[#2e2e2e]/50 shadow-xl'
                                    : 'text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900/40 border border-transparent'
                                    }`}
                            >
                                <LayoutGrid size={14} className={selectedTable === '__visualizer__' ? 'text-primary' : 'text-zinc-800 group-hover:text-zinc-500'} />
                                <span className="truncate">Schema Visualizer</span>
                            </button>
                            <button
                                onClick={() => onTableSelect('__visualizer_system__')}
                                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs transition-all group ${selectedTable === '__visualizer_system__'
                                    ? 'bg-amber-900/20 text-amber-500 font-bold border border-amber-500/20 shadow-xl'
                                    : 'text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900/40 border border-transparent'
                                    }`}
                            >
                                <Lock size={14} className={selectedTable === '__visualizer_system__' ? 'text-amber-500' : 'text-zinc-800 group-hover:text-zinc-500'} />
                                <span className="truncate">System Schemas</span>
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        if (currentModule === 'docs') {
            const filteredDocs = activeSubmenu.filter(item => {
                const matchesSearch = item.name.toLowerCase().includes(explorerSearchTerm.toLowerCase());
                const matchesFilter = docsFilter === 'all' ||
                    (docsFilter === 'core' && ['intro', 'sdk'].includes(item.id)) ||
                    (docsFilter === 'apis' && item.id.includes('_api'));
                return matchesSearch && matchesFilter;
            });

            return (
                <div className="space-y-6 animate-in fade-in duration-300">
                    <div className="px-2 space-y-4">
                        <div className="relative group">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within:text-primary transition-colors" size={12} />
                            <input
                                type="text"
                                placeholder="Search documentation..."
                                value={explorerSearchTerm}
                                onChange={(e) => setExplorerSearchTerm(e.target.value)}
                                className="w-full bg-[#111111] border border-[#2e2e2e] rounded-lg pl-9 pr-4 py-2 text-[10px] text-white placeholder:text-zinc-700 focus:outline-none focus:border-primary/50 transition-all"
                            />
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                            {['all', 'core', 'apis'].map((f) => (
                                <button
                                    key={f}
                                    onClick={() => setDocsFilter(f)}
                                    className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest border transition-all ${docsFilter === f ? 'bg-primary text-black border-primary' : 'bg-transparent border-zinc-800 text-zinc-600 hover:text-zinc-400'}`}
                                >
                                    {f}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <h4 className="px-3 mb-4 text-[9px] font-black text-zinc-600 uppercase tracking-[0.2em]">
                            Documentation Sections
                        </h4>
                        <div className="space-y-0.5">
                            {filteredDocs.length > 0 ? (
                                filteredDocs.map((item) => (
                                    <button
                                        key={item.id}
                                        onClick={() => onMenuViewSelect(item.id)}
                                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs transition-all group ${selectedView === item.id ? 'bg-zinc-900 text-primary font-bold' : 'text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900/40'}`}
                                    >
                                        <item.icon size={14} className="text-zinc-800 group-hover:text-zinc-500" />
                                        <span className="truncate font-medium">{item.name}</span>
                                    </button>
                                ))
                            ) : (
                                <div className="px-3 py-10 text-center space-y-2">
                                    <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-700">
                                        <Search size={14} />
                                    </div>
                                    <p className="text-[9px] text-zinc-700 font-bold uppercase tracking-widest">No results found</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            );
        }

        return (
            <div className="space-y-6 animate-in fade-in duration-300">
                <div>
                    <h4 className="px-3 mb-4 text-[9px] font-black text-zinc-600 uppercase tracking-[0.2em]">
                        {currentModule === 'docs' ? 'Documentation' : `${currentModule.replace('_', ' ')} Management`}
                    </h4>
                    <div className="space-y-0.5">
                        {activeSubmenu.map((item) => (
                            <button
                                key={item.id}
                                onClick={() => onMenuViewSelect(item.id)}
                                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs transition-all group ${selectedView === item.id ? 'bg-zinc-900 text-primary font-bold' : 'text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900/40'}`}
                            >
                                <item.icon size={14} className="text-zinc-800 group-hover:text-zinc-500" />
                                <span className="truncate font-medium">{item.name}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        );
    };


    return (
        <div className="flex h-screen bg-[#171717] overflow-hidden text-zinc-400 font-sans selection:bg-primary selection:text-black">
            {/* Primary Sidebar (Expandable) */}
            <div
                onMouseEnter={() => setIsSidebarHovered(true)}
                onMouseLeave={() => setIsSidebarHovered(false)}
                className={`bg-[#111111] border-r border-[#2e2e2e] flex flex-col py-4 flex-shrink-0 z-50 transition-all duration-300 ease-in-out ${isExpanded ? 'w-64' : 'w-14'
                    }`}
            >
                <div className="px-3 mb-8 flex items-center h-8">
                    <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(254,254,0,0.2)] cursor-pointer hover:scale-105 transition-transform shrink-0 overflow-hidden border border-zinc-800"
                        onClick={() => onMenuViewSelect('overview')}
                    >
                        <img src="/logo.jpg" alt="OzyBase" className="w-full h-full object-cover" />
                    </div>
                    {isExpanded && (
                        <span className="ml-3 font-black text-white italic tracking-tighter text-xl uppercase animate-in fade-in duration-300 truncate">OzyBase</span>
                    )}
                </div>

                <WorkspaceSwitcher 
                    isExpanded={isExpanded}
                    onWorkspaceChange={onWorkspaceChange} 
                    onViewSelect={onMenuViewSelect} 
                />

                <div className="flex-1 flex flex-col gap-1 w-full overflow-y-auto scrollbar-hide px-2">
                    {PRIMARY_NAV.map((item, i) => {
                        if (item.type === 'separator') return <div key={i} className="h-[1px] bg-[#2e2e2e] my-2 mx-2 shrink-0" />;

                        const isActive = (item.id === 'tables' && (selectedView === 'tables' || selectedView === 'table')) ||
                            (item.id === 'logs' && ['explorer', 'live', 'alerts', 'metrics'].includes(selectedView)) ||
                            (item.id === 'auth' && ['users', 'providers', 'policies', 'two_factor', 'security', 'security_policies', 'firewall', 'security_notifications', 'templates', 'auth_settings'].includes(selectedView)) ||
                            (item.id === 'storage' && ['buckets', 'storage_policies', 'usage', 'storage_settings'].includes(selectedView)) ||
                            (item.id === 'edge' && ['functions', 'deployments', 'secrets', 'edge_logs'].includes(selectedView)) ||
                            (item.id === 'realtime' && ['inspector', 'channels', 'config'].includes(selectedView)) ||
                            (selectedView === item.id);

                        return (
                            <button
                                key={item.id}
                                aria-label={item.label}
                                onClick={() => {
                                    if (item.id === 'tables' && tables.length > 0) {
                                        // Prioritize user tables over system tables
                                        const firstUserTable = tables.find(t => !(t.is_system || t.name?.startsWith('_v_') || t.name?.startsWith('_ozy_')));
                                        onTableSelect(firstUserTable ? firstUserTable.name : tables[0].name);
                                    } else if (item.id === 'database') {
                                        onTableSelect('__visualizer__');
                                    } else {
                                        onMenuViewSelect(item.id);
                                    }
                                }}
                                className={`flex items-center w-full p-2 rounded-xl transition-all group relative shrink-0 ${isActive ? 'text-primary bg-zinc-800 shadow-lg' : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900/40'
                                    }`}
                            >
                                <div className="w-6 flex justify-center shrink-0">
                                    <item.icon size={18} strokeWidth={isActive ? 2.5 : 2} />
                                </div>
                                {isExpanded && (
                                    <span className="ml-3 text-xs font-bold tracking-tight truncate animate-in slide-in-from-left-2 duration-300 uppercase">
                                        {item.label}
                                    </span>
                                )}
                                {isActive && (
                                    <div className="absolute left-0 top-2.5 bottom-2.5 w-[2px] bg-primary rounded-full shadow-[0_0_8px_rgba(254,254,0,0.6)]" />
                                )}
                            </button>
                        );
                    })}
                </div>

                <div className="mt-auto flex flex-col gap-1 px-2 border-t border-[#2e2e2e] pt-4 shrink-0">
                    <button
                        onClick={() => onMenuViewSelect('settings')}
                        className={`flex items-center w-full p-2 transition-all rounded-xl ${selectedView === 'settings' ? 'text-primary bg-zinc-800' : 'text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900/40'
                            }`}
                    >
                        <div className="w-6 flex justify-center shrink-0">
                            <Settings size={18} />
                        </div>
                        {isExpanded && (
                            <span className="ml-3 text-xs font-bold tracking-tight truncate animate-in slide-in-from-left-2 duration-300 uppercase">Settings</span>
                        )}
                    </button>

                    <button
                        onClick={() => setIsSidebarPinned(!isSidebarPinned)}
                        className="flex items-center w-full p-2 text-zinc-600 hover:text-zinc-200 transition-colors"
                    >
                        <div className="w-6 flex justify-center shrink-0">
                            {isSidebarPinned ? <Pin size={18} className="text-primary fill-primary/20" /> : <PinOff size={18} />}
                        </div>
                        {isExpanded && (
                            <span className="ml-3 text-xs font-bold tracking-tight truncate animate-in slide-in-from-left-2 duration-300 uppercase">
                                {isSidebarPinned ? 'Unpin Sidebar' : 'Pin Sidebar'}
                            </span>
                        )}
                    </button>
                </div>
            </div>

            {/* Explorer Sidebar — only rendered for views that need it */}
            {!['overview', 'sql', 'settings', 'advisors', 'observability'].includes(selectedView) && (
            <div className="bg-[#0c0c0c] border-r border-[#2e2e2e] flex flex-col w-60">
                <div className="h-14 flex items-center px-4 border-b border-[#2e2e2e] flex-shrink-0">
                    <span className="font-black text-[10px] uppercase tracking-[0.25em] text-zinc-500 truncate">
                        Explorer
                    </span>
                </div>

                <div className="flex-1 overflow-y-auto py-6 px-3 custom-scrollbar">
                    {renderExplorerContent()}
                </div>

                <div className="p-4 border-t border-[#2e2e2e]">
                    <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-4 py-2 text-xs font-bold uppercase tracking-widest text-zinc-600 hover:text-red-500 transition-all rounded-xl hover:bg-red-500/5"
                    >
                        <LogOut size={14} />
                        Sign Out
                    </button>
                </div>
            </div>
            )}

            {/* Main Content Area */}
            <div key={selectedView} className={`flex-1 flex flex-col min-w-0 bg-[#0c0c0c] ${['overview', 'sql', 'settings', 'advisors', 'observability'].includes(selectedView) ? 'animate-in fade-in slide-in-from-left-2 duration-300' : ''}`}>
                <header className="h-14 border-b border-[#2e2e2e] bg-[#111111] flex items-center justify-between px-6 flex-shrink-0">
                    <div className="flex items-center gap-2 text-[11px] font-bold tracking-tight">
                        <span className="text-zinc-600 hover:text-zinc-400 cursor-pointer transition-colors uppercase tracking-[0.1em]">OzyBase</span>
                        <span className="text-zinc-800 text-lg font-thin">/</span>
                        <span className="text-[11px] font-black text-white uppercase tracking-wider">PROJECT</span>
                        <span className="text-zinc-800 text-lg font-thin">/</span>
                        <span className="bg-zinc-900 text-primary border border-primary/20 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest shadow-[0_0_10px_rgba(254,254,0,0.05)]">
                            {selectedTable || selectedView}
                        </span>
                    </div>

                    <div className="flex items-center gap-4">
                        <div
                            onClick={() => setIsConnectionModalOpen(true)}
                            className="flex items-center gap-2 px-3 py-1 bg-[#171717] rounded-full border border-[#2e2e2e] cursor-pointer hover:border-zinc-500 transition-all group"
                        >
                            <div className={`w-1.5 h-1.5 rounded-full ${dbStatus === 'Connected' ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.4)]' : 'bg-red-500'}`} />
                            <span className="text-[9px] font-black text-zinc-500 group-hover:text-zinc-300 uppercase tracking-[0.2em] transition-colors">{dbStatus}</span>
                        </div>

                        <div className="h-4 w-[1px] bg-[#2e2e2e] mx-1" />

                        <div className="relative" ref={notificationRef}>
                            <button
                                onClick={() => setIsNotificationOpen(!isNotificationOpen)}
                                className={`w-8 h-8 rounded-lg bg-zinc-900 border border-[#2e2e2e] flex items-center justify-center transition-all ${safeHealthIssues.length > 0
                                    ? safeHealthIssues.some(i => i.type === 'security')
                                        ? 'text-red-500 border-red-500/30 animate-security-pulse'
                                        : 'text-amber-500 border-amber-500/30 animate-notification-pulse'
                                    : 'text-zinc-500 hover:text-white hover:border-zinc-600'
                                    }`}
                            >
                                <Bell size={16} className={safeHealthIssues.some(i => i.type === 'security') ? 'animate-bounce' : ''} />
                                {safeHealthIssues.length > 0 && (
                                    <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-[#111111] flex items-center justify-center text-[7px] font-black text-white">
                                        {safeHealthIssues.length}
                                    </span>
                                )}
                            </button>

                            <NotificationCenter
                                isOpen={isNotificationOpen}
                                onClose={() => setIsNotificationOpen(false)}
                                issues={safeHealthIssues}
                                onIssueAction={(issue) => {
                                    setSelectedFixIssue(issue);
                                    setIsAutoFixModalOpen(true);
                                    setIsNotificationOpen(false);
                                }}
                                onViewLogs={() => {
                                    onMenuViewSelect('advisors');
                                    setIsNotificationOpen(false);
                                }}
                            />
                        </div>

                        <div className="relative" ref={userDropdownRef}>
                            <div
                                className="w-8 h-8 rounded-lg bg-zinc-900 border border-[#2e2e2e] flex items-center justify-center text-primary text-[10px] font-black cursor-pointer hover:border-primary/50 transition-all font-mono"
                                onClick={() => setIsUserDropdownOpen(!isUserDropdownOpen)}
                            >
                                {user?.email?.charAt(0).toUpperCase() || 'A'}
                            </div>

                            <div
                                className={`absolute top-10 right-0 w-48 bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl shadow-2xl z-[100] overflow-hidden origin-top-right transition-all duration-200 ${
                                    isUserDropdownOpen
                                        ? 'opacity-100 scale-100 translate-y-0 pointer-events-auto'
                                        : 'opacity-0 scale-95 -translate-y-2 pointer-events-none'
                                }`}
                                aria-hidden={!isUserDropdownOpen}
                            >
                                <div className="px-4 py-3 border-b border-[#2e2e2e] bg-[#111111]">
                                    <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Signed in as</p>
                                    <p className="text-xs font-bold text-white truncate">{user?.email}</p>
                                </div>
                                <div className="p-1">
                                    <button
                                        onClick={() => {
                                            onMenuViewSelect('settings');
                                            setIsUserDropdownOpen(false);
                                        }}
                                        className="w-full flex items-center gap-3 px-3 py-2 text-xs font-medium text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all rounded-lg"
                                    >
                                        <Settings size={14} /> Settings
                                    </button>
                                    <button
                                        onClick={handleLogout}
                                        className="w-full flex items-center gap-3 px-3 py-2 text-xs font-medium text-red-400 hover:text-red-500 hover:bg-red-500/5 transition-all rounded-lg"
                                    >
                                        <LogOut size={14} /> Sign Out
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </header>

                {safeHealthIssues.filter(i => i.type === 'security').length > 1 && !isBannerDismissed && (
                    <div className="bg-red-500/10 border-b border-red-500/20 px-6 py-2 flex items-center justify-between animate-in slide-in-from-top-full duration-500 shadow-[0_4px_12px_rgba(239,68,68,0.1)]">
                        <div className="flex items-center gap-3">
                            <Shield size={14} className="text-red-500 animate-pulse" />
                            <p className="text-[10px] font-black text-red-500 uppercase tracking-widest">
                                Critical Security Alert: {healthIssues.filter(i => i.type === 'security').length} tables missing Row Level Security
                            </p>
                        </div>
                        <div className="flex items-center gap-4">
                            <button
                                onClick={() => onMenuViewSelect('advisors')}
                                className="text-[9px] font-black bg-red-500 text-white px-3 py-1 rounded-md uppercase tracking-widest hover:bg-red-600 hover:scale-105 transition-all shadow-lg"
                            >
                                Fix Now
                            </button>
                            <button
                                onClick={() => setIsBannerDismissed(true)}
                                className="p-1 text-red-500/50 hover:text-red-500 transition-colors bg-red-500/5 hover:bg-red-500/10 rounded"
                                title="Dismiss for 10 minutes"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    </div>
                )}

                <main className="flex-1 overflow-hidden relative">
                    {children}
                </main>
            </div>

            <style dangerouslySetInnerHTML={{
                __html: `
                .custom-scrollbar::-webkit-scrollbar {
                    width: 4px;
                    height: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: #2e2e2e;
                    border-radius: 10px;
                }
                .scrollbar-hide::-webkit-scrollbar {
                    display: none;
                }
                .scrollbar-hide {
                    -ms-overflow-style: none;
                    scrollbar-width: none;
                }
            `}} />

            <CreateTableModal
                isOpen={isCreateTableModalOpen}
                onClose={() => setIsCreateTableModalOpen(false)}
                onMenuViewSelect={onMenuViewSelect}
                schema={selectedSchema}
                onTableCreated={() => {
                    refreshTables();
                }}
            />

            <ConnectionModal
                isOpen={isConnectionModalOpen}
                onClose={() => setIsConnectionModalOpen(false)}
            />

            {/* Standardized Global Toasts */}
            {toast && (
                <div className={`fixed top-6 right-6 z-[300] min-w-[320px] max-w-[400px] p-4 rounded-2xl shadow-2xl border animate-in slide-in-from-right duration-500 flex items-start gap-4 backdrop-blur-md ${toast.type === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-500 ring-1 ring-green-500/20' :
                    toast.type === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-500 ring-1 ring-red-500/20' :
                        'bg-amber-500/10 border-amber-500/20 text-amber-500 ring-1 ring-amber-500/20'
                    }`}>
                    <div className="mt-0.5">
                        {toast.type === 'success' && <Check size={18} className="animate-bounce" />}
                        {toast.type === 'error' && <AlertTriangle size={18} />}
                        {toast.type === 'warning' && <Shield size={18} />}
                    </div>
                    <div className="flex-1">
                        <p className="text-[10px] font-black uppercase tracking-widest leading-tight">{toast.type}</p>
                        <p className="text-[11px] font-medium mt-1 text-white/90 leading-relaxed">{toast.message}</p>
                    </div>
                    <button onClick={() => setToast(null)} className="opacity-40 hover:opacity-100 transition-opacity mt-0.5">
                        <X size={14} />
                    </button>
                    <div className="absolute bottom-0 left-0 h-0.5 bg-current opacity-30 animate-shrink-width" style={{ animationDuration: '5s', animationFillMode: 'forwards' }} />
                </div>
            )}

            <AutoFixModal
                isOpen={isAutoFixModalOpen}
                issue={selectedFixIssue}
                onClose={() => setIsAutoFixModalOpen(false)}
                onConfirm={handleApplyFix}
            />

            <ConfirmModal
                isOpen={!!confirmDeleteTable}
                onClose={() => setConfirmDeleteTable(null)}
                onConfirm={confirmTableDeletion}
                title="Delete Table"
                message={`Are you sure you want to delete table "${confirmDeleteTable}"? All data within this collection will be lost forever.`}
                confirmText="Burn Table"
            />
        </div>
    );
};

export default Layout;
