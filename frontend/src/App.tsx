import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import Layout from './components/Layout';
import Login from './components/Login';
import { fetchWithAuth } from './utils/api';
import { getViewMeta } from './viewRegistry';

const lazyAny = (loader: () => Promise<{ default: React.ComponentType<any> }>): React.ComponentType<any> => (
    lazy(loader) as React.ComponentType<any>
);

const TableEditor = lazyAny(() => import('./components/TableEditor'));
const Overview = lazyAny(() => import('./components/Overview'));
const SqlTerminal = lazyAny(() => import('./components/SqlTerminal'));
const AuthManager = lazyAny(() => import('./components/AuthManager'));
const StorageManager = lazyAny(() => import('./components/StorageManager'));
const EdgeFunctions = lazyAny(() => import('./components/EdgeFunctions'));
const RealtimeInspector = lazyAny(() => import('./components/RealtimeInspector'));
const Advisors = lazyAny(() => import('./components/Advisors'));
const Observability = lazyAny(() => import('./components/Observability'));
const LogsAnalytics = lazyAny(() => import('./components/LogsAnalytics'));
const SchemaVisualizer = lazyAny(() => import('./components/SchemaVisualizer'));
const Settings = lazyAny(() => import('./components/Settings'));
const ApiDocs = lazyAny(() => import('./components/ApiDocs'));
const Integrations = lazyAny(() => import('./components/Integrations'));
const SecurityManager = lazyAny(() => import('./components/SecurityManager'));
const SecurityDashboard = lazyAny(() => import('./components/SecurityDashboard'));
const PermissionManager = lazyAny(() => import('./components/PermissionManager'));
const NotificationSettings = lazyAny(() => import('./components/NotificationSettings'));
const TwoFactorAuth = lazyAny(() => import('./components/TwoFactorAuth'));
const IntegrationsManager = lazyAny(() => import('./components/IntegrationsManager'));
const AuthProvidersView = lazyAny(() => import('./components/AuthProvidersView'));
const EmailTemplatesView = lazyAny(() => import('./components/EmailTemplatesView'));
const AuthSettingsView = lazyAny(() => import('./components/AuthSettingsView'));
const SetupWizard = lazyAny(() => import('./components/SetupWizard'));
const FirewallManager = lazyAny(() => import('./components/FirewallManager'));
const WorkspaceManager = lazyAny(() => import('./components/WorkspaceManager'));
const WorkspaceSettings = lazyAny(() => import('./components/WorkspaceSettings'));

const isLikelyJWT = (value: any) => /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);

function App() {
    const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('ozy_token'));
    const [isSystemInitialized, setIsSystemInitialized] = useState(true);
    const [checkingSystem, setCheckingSystem] = useState(true);
    const [selectedView, setSelectedView] = useState('overview');
    const [selectedTable, setSelectedTable] = useState<string | null>(null);
    const [tables, setTables] = useState<any[]>([]);
    const [workspaceId, setWorkspaceId] = useState(localStorage.getItem('ozy_workspace_id'));

    const loadTables = useCallback(() => {
        fetchWithAuth('/api/collections')
            .then((res) => res.json())
            .then((data) => setTables(Array.isArray(data) ? data : []))
            .catch((err) => console.error('Failed to load tables', err));
    }, []);

    const checkSystemStatus = useCallback(async () => {
        try {
            const res = await fetch('/api/system/status');
            if (res.ok) {
                const data = await res.json();
                setIsSystemInitialized(data.initialized);
            }
        } catch (e) {
            console.error('Failed to check system status', e);
        } finally {
            setCheckingSystem(false);
        }
    }, []);

    useEffect(() => {
        void checkSystemStatus();
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
            }).finally(() => {
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

        clearTokenFromURL();
    }, []);

    const handleTableSelect = useCallback((tableName: string | null) => {
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
        return <SetupWizard onComplete={(token: string | null) => {
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
        const viewMeta = getViewMeta(selectedView);
        const props = viewMeta.props || {};

        switch (viewMeta.component) {
            case 'TableEditor':
                return <TableEditor tableName={selectedView === 'table' ? selectedTable : null} onTableSelect={handleTableSelect} allTables={tables} />;
            case 'SchemaVisualizer':
                return <SchemaVisualizer viewMode={selectedTable === '__visualizer_system__' ? 'system' : 'user'} />;
            case 'Overview':
                return <Overview onTableSelect={handleTableSelect} onViewSelect={setSelectedView} />;
            case 'SqlTerminal':
                return <SqlTerminal />;
            case 'AuthManager':
                return <AuthManager view={String(props.view || 'users')} onViewSelect={setSelectedView} />;
            case 'AuthProvidersView':
                return <AuthProvidersView />;
            case 'TwoFactorAuth':
                return <TwoFactorAuth />;
            case 'EmailTemplatesView':
                return <EmailTemplatesView />;
            case 'AuthSettingsView':
                return <AuthSettingsView />;
            case 'StorageManager':
                return <StorageManager view={props.view} />;
            case 'EdgeFunctions':
                return <EdgeFunctions view={props.view} />;
            case 'RealtimeInspector':
                return <RealtimeInspector view={props.view} />;
            case 'Advisors':
                return <Advisors />;
            case 'Observability':
                return <Observability onViewSelect={setSelectedView} />;
            case 'LogsAnalytics':
                return <LogsAnalytics view={props.view} />;
            case 'PermissionManager':
                return <PermissionManager />;
            case 'SecurityDashboard':
                return <SecurityDashboard />;
            case 'SecurityManager':
                return <SecurityManager />;
            case 'FirewallManager':
                return <FirewallManager />;
            case 'NotificationSettings':
                return <NotificationSettings />;
            case 'Settings':
                return <Settings view={String(props.view || 'general')} onViewSelect={setSelectedView} />;
            case 'ApiDocs':
                return <ApiDocs page={props.page} />;
            case 'Integrations':
                return <Integrations page={String(props.page || 'wrappers')} />;
            case 'IntegrationsManager':
                return <IntegrationsManager />;
            case 'WorkspaceManager':
                return <WorkspaceManager onWorkspaceChange={(id: string) => setWorkspaceId(id)} onViewSelect={setSelectedView} view={String(props.view || 'wm_overview')} />;
            case 'WorkspaceSettings':
                return <WorkspaceSettings workspaceId={workspaceId} onViewSelect={setSelectedView} onWorkspaceChange={(id: string) => setWorkspaceId(id)} view={String(props.view || 'ws_general')} />;
            default:
                return <Overview onTableSelect={handleTableSelect} onViewSelect={setSelectedView} />;
        }
    };

    return (
        <Layout
            selectedView={selectedView}
            selectedTable={selectedTable}
            workspaceId={workspaceId}
            onTableSelect={handleTableSelect}
            tables={tables}
            refreshTables={loadTables}
            onWorkspaceChange={(id: string) => setWorkspaceId(id)}
            onMenuViewSelect={(view: string) => {
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
