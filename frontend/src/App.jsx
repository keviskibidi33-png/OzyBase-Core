import React, { useState, useEffect, lazy, Suspense, useCallback } from 'react'
import Layout from './components/Layout'
import Login from './components/Login'
import { fetchWithAuth } from './utils/api'

// Dynamic imports for bundle optimization (bundle-dynamic-imports)
const TableEditor = lazy(() => import('./components/TableEditor'));
const Overview = lazy(() => import('./components/Overview'));
const SqlTerminal = lazy(() => import('./components/SqlTerminal'));
const AuthManager = lazy(() => import('./components/AuthManager'));
const StorageManager = lazy(() => import('./components/StorageManager'));
const EdgeFunctions = lazy(() => import('./components/EdgeFunctions'));
const RealtimeInspector = lazy(() => import('./components/RealtimeInspector'));
const Advisors = lazy(() => import('./components/Advisors'));
const Observability = lazy(() => import('./components/Observability'));
const LogsAnalytics = lazy(() => import('./components/LogsAnalytics'));
const SchemaVisualizer = lazy(() => import('./components/SchemaVisualizer'));
const Settings = lazy(() => import('./components/Settings'));
const ApiDocs = lazy(() => import('./components/ApiDocs'));
const Integrations = lazy(() => import('./components/Integrations'));
const SecurityManager = lazy(() => import('./components/SecurityManager'));
const SecurityDashboard = lazy(() => import('./components/SecurityDashboard'));
const PermissionManager = lazy(() => import('./components/PermissionManager'));
const NotificationSettings = lazy(() => import('./components/NotificationSettings'));
const TwoFactorAuth = lazy(() => import('./components/TwoFactorAuth'));
const IntegrationsManager = lazy(() => import('./components/IntegrationsManager'));
const SetupWizard = lazy(() => import('./components/SetupWizard'));
const FirewallManager = lazy(() => import('./components/FirewallManager'));
const WorkspaceManager = lazy(() => import('./components/WorkspaceManager'));
const WorkspaceSettings = lazy(() => import('./components/WorkspaceSettings'));

const isLikelyJWT = (value) => /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);

function App() {
    const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('ozy_token'));
    const [isSystemInitialized, setIsSystemInitialized] = useState(true);
    const [checkingSystem, setCheckingSystem] = useState(true);
    const [selectedView, setSelectedView] = useState('overview');
    const [selectedTable, setSelectedTable] = useState(null);
    const [tables, setTables] = useState([]);
    const [workspaceId, setWorkspaceId] = useState(localStorage.getItem('ozy_workspace_id'));

    const loadTables = useCallback(() => {
        fetchWithAuth('/api/collections')
            .then(res => res.json())
            .then(data => setTables(Array.isArray(data) ? data : []))
            .catch(err => console.error("Failed to load tables", err));
    }, []);

    const checkSystemStatus = useCallback(async () => {
        try {
            const res = await fetch('/api/system/status');
            if (res.ok) {
                const data = await res.json();
                setIsSystemInitialized(data.initialized);
            }
        } catch (e) {
            console.error("Failed to check system status", e);
        } finally {
            setCheckingSystem(false);
        }
    }, []);

    useEffect(() => {
        checkSystemStatus();
        if (isAuthenticated) {
            loadTables();
        }
    }, [isAuthenticated, workspaceId, loadTables, checkSystemStatus]);

    useEffect(() => {
        const url = new URL(window.location.href);
        const token = url.searchParams.get('token');
        if (!token) return;

        const clearTokenFromURL = () => {
            url.searchParams.delete('token');
            const search = url.searchParams.toString();
            const cleanURL = `${url.pathname}${search ? `?${search}` : ''}${url.hash}`;
            window.history.replaceState({}, document.title, cleanURL);
        };

        const pathname = window.location.pathname;

        if (pathname === '/reset-password') {
            sessionStorage.setItem('ozy_reset_token', token);
            clearTokenFromURL();
            return;
        }

        if (pathname === '/verify-email') {
            clearTokenFromURL();
            fetch('/api/auth/verify-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token }),
            })
                .finally(() => {
                    window.history.replaceState({}, document.title, '/');
                });
            return;
        }

        const isCallback = pathname === '/oauth/callback' || pathname.startsWith('/auth/callback');
        if (isCallback && isLikelyJWT(token)) {
            localStorage.setItem('ozy_token', token);
            clearTokenFromURL();
            setIsAuthenticated(true);
            return;
        }

        // Ignore arbitrary query-string tokens to prevent session fixation and token misuse.
        clearTokenFromURL();
    }, []);

    const handleTableSelect = useCallback((tableName) => {
        setSelectedTable(tableName);
        if (tableName === '__visualizer__' || tableName === '__visualizer_system__') {
            setSelectedView('visualizer');
        } else if (tableName) {
            setSelectedView('table');
        }
    }, []);

    if (checkingSystem) {
        return <div className="h-screen w-screen flex items-center justify-center bg-black text-white">Loading OzyBase...</div>;
    }

    if (!isSystemInitialized) {
        return <SetupWizard onComplete={(token) => {
            if (token) {
                localStorage.setItem('ozy_token', token);
                setIsAuthenticated(true);
            }
            setIsSystemInitialized(true);
        }} />;
    }

    if (!isAuthenticated) {
        return <Login onLoginSuccess={() => setIsAuthenticated(true)} />;
    }

    const renderView = () => {
        switch (selectedView) {
            case 'table': return <TableEditor tableName={selectedTable} onTableSelect={handleTableSelect} allTables={tables} />;
            case 'tables': return <TableEditor tableName={null} onTableSelect={handleTableSelect} allTables={tables} />;
            case 'visualizer': return <SchemaVisualizer viewMode={selectedTable === '__visualizer_system__' ? 'system' : 'user'} />;
            case 'overview': return <Overview onTableSelect={handleTableSelect} onViewSelect={setSelectedView} />;
            case 'sql': return <SqlTerminal />;
            case 'auth':
            case 'users':
            case 'providers':
            case 'two_factor':
            case 'templates':
                return <AuthManager view={selectedView === 'auth' ? 'users' : selectedView} />;
            case 'storage':
            case 'buckets':
            case 'storage_policies':
            case 'usage':
            case 'storage_settings':
                {
                    const view = selectedView === 'storage' ? 'buckets' : (selectedView === 'storage_policies' ? 'policies' : (selectedView === 'storage_settings' ? 'settings' : selectedView));
                    return <StorageManager view={view} />;
                }
            case 'edge':
            case 'functions':
            case 'deployments':
            case 'secrets':
            case 'edge_logs':
                {
                    const view = selectedView === 'edge' ? 'functions' : (selectedView === 'edge_logs' ? 'logs' : selectedView);
                    return <EdgeFunctions view={view} />;
                }
            case 'realtime':
            case 'inspector':
            case 'channels':
            case 'config':
                return <RealtimeInspector view={selectedView === 'realtime' ? 'inspector' : selectedView} />;
            case 'advisors': return <Advisors />;
            case 'observability': return <Observability onViewSelect={setSelectedView} />;
            case 'logs':
            case 'explorer':
            case 'live':
            case 'alerts':
            case 'metrics':
                return <LogsAnalytics view={selectedView === 'logs' ? 'explorer' : selectedView} />;
            case 'policies': return <PermissionManager />;
            case 'security': return <SecurityDashboard />;
            case 'security_policies': return <SecurityManager />;
            case 'firewall': return <FirewallManager />;
            case 'security_notifications': return <NotificationSettings />;
            case 'auth_settings': return <Settings />;
            case 'settings':
            case 'general':
            case 'infrastructure':
            case 'billing':
            case 'api_keys':
                return <Settings view={selectedView === 'settings' ? 'general' : selectedView} />;
            case 'docs':
            case 'intro':
            case 'auth_api':
            case 'db_api':
            case 'storage_api':
            case 'realtime_api':
            case 'edge_api':
            case 'sdk':
                return <ApiDocs page={selectedView === 'docs' ? 'intro' : selectedView} />;
            case 'integrations':
            case 'wrappers':
            case 'webhooks':
            case 'cron':
            case 'extensions':
            case 'vault':
            case 'graphql':
                return <Integrations page={selectedView === 'integrations' ? 'wrappers' : selectedView} />;
            case 'workspaces':
            case 'wm_overview':
            case 'wm_shared':
            case 'wm_templates':
                return <WorkspaceManager onWorkspaceChange={(id) => setWorkspaceId(id)} onViewSelect={setSelectedView} view={selectedView.startsWith('wm_') ? selectedView : 'wm_overview'} />;
            case 'workspace_settings':
            case 'ws_general':
            case 'ws_members':
            case 'ws_danger':
                return <WorkspaceSettings workspaceId={workspaceId} view={selectedView.startsWith('ws_') ? selectedView : 'ws_general'} />;
            default: return <Overview onTableSelect={handleTableSelect} />;
        }
    };

    return (
        <Layout
            selectedView={selectedView}
            selectedTable={selectedTable}
            onTableSelect={handleTableSelect}
            tables={tables}
            refreshTables={loadTables}
            onWorkspaceChange={(id) => setWorkspaceId(id)}
            onMenuViewSelect={(view) => {
                setSelectedView(view);
                setSelectedTable(null);
            }}
        >
            <Suspense fallback={
                <div className="h-full w-full flex items-center justify-center bg-transparent">
                    <div className="flex flex-col items-center gap-2">
                        <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                        <span className="text-[10px] font-black text-zinc-700 uppercase tracking-widest">Loading Module...</span>
                    </div>
                </div>
            }>
                {renderView()}
            </Suspense>
        </Layout>
    );
}

export default App;
