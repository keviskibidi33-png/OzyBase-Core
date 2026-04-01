import type { LucideIcon } from 'lucide-react';
import {
    Activity,
    Bell,
    Briefcase,
    Code,
    Cpu,
    CreditCard,
    Database,
    FileText,
    FolderOpen,
    Globe,
    History,
    Home,
    Key,
    LayoutGrid,
    Lightbulb,
    List,
    Lock,
    MousePointer2,
    Search,
    Server,
    Settings,
    Shield,
    ShieldAlert,
    ShieldBan,
    ShieldCheck,
    Table2,
    Telescope,
    Terminal,
    Users,
    Zap,
} from 'lucide-react';

type ComponentName =
    | 'Overview'
    | 'TableEditor'
    | 'SchemaVisualizer'
    | 'SqlTerminal'
    | 'AuthManager'
    | 'AuthProvidersView'
    | 'TwoFactorAuth'
    | 'EmailTemplatesView'
    | 'AuthSettingsView'
    | 'StorageManager'
    | 'EdgeFunctions'
    | 'RealtimeInspector'
    | 'Advisors'
    | 'Observability'
    | 'LogsAnalytics'
    | 'PermissionManager'
    | 'SecurityDashboard'
    | 'SecurityManager'
    | 'FirewallManager'
    | 'NotificationSettings'
    | 'Settings'
    | 'ApiDocs'
    | 'Integrations'
    | 'IntegrationsManager'
    | 'WorkspaceManager'
    | 'WorkspaceSettings';

export interface ViewMeta {
    id: string;
    group: string;
    label: string;
    component: ComponentName;
    props?: Record<string, unknown>;
    supportsExplorer: boolean;
}

export interface NavItem {
    id?: string;
    label?: string;
    icon?: LucideIcon;
    type?: 'separator';
}

export interface SubmenuItem {
    id: string;
    name: string;
    icon: LucideIcon;
}

export const VIEW_REGISTRY: Record<string, ViewMeta> = {
    overview: { id: 'overview', group: 'overview', label: 'Home', component: 'Overview', supportsExplorer: false },
    tables: { id: 'tables', group: 'tables', label: 'Table Editor', component: 'TableEditor', supportsExplorer: true },
    table: { id: 'table', group: 'tables', label: 'Table Editor', component: 'TableEditor', supportsExplorer: true },
    visualizer: { id: 'visualizer', group: 'database', label: 'Schema Visualizer', component: 'SchemaVisualizer', supportsExplorer: true },
    sql: { id: 'sql', group: 'sql', label: 'SQL Editor', component: 'SqlTerminal', supportsExplorer: false },

    auth: { id: 'auth', group: 'auth', label: 'Authentication', component: 'AuthManager', props: { view: 'users' }, supportsExplorer: true },
    users: { id: 'users', group: 'auth', label: 'Users', component: 'AuthManager', props: { view: 'users' }, supportsExplorer: true },
    providers: { id: 'providers', group: 'auth', label: 'Providers', component: 'AuthProvidersView', supportsExplorer: true },
    policies: { id: 'policies', group: 'auth', label: 'Permissions', component: 'PermissionManager', supportsExplorer: true },
    two_factor: { id: 'two_factor', group: 'auth', label: '2FA Settings', component: 'TwoFactorAuth', supportsExplorer: true },
    security: { id: 'security', group: 'auth', label: 'Security Hub', component: 'SecurityDashboard', supportsExplorer: true },
    security_policies: { id: 'security_policies', group: 'auth', label: 'Geo-Fencing', component: 'SecurityManager', supportsExplorer: true },
    firewall: { id: 'firewall', group: 'auth', label: 'IP Firewall', component: 'FirewallManager', supportsExplorer: true },
    security_notifications: { id: 'security_notifications', group: 'auth', label: 'Alert Notifications', component: 'NotificationSettings', supportsExplorer: true },
    auth_integrations: { id: 'auth_integrations', group: 'auth', label: 'Integrations & SIEM', component: 'IntegrationsManager', supportsExplorer: true },
    templates: { id: 'templates', group: 'auth', label: 'Email Templates', component: 'EmailTemplatesView', supportsExplorer: true },
    auth_settings: { id: 'auth_settings', group: 'auth', label: 'Auth Settings', component: 'AuthSettingsView', supportsExplorer: true },

    storage: { id: 'storage', group: 'storage', label: 'Storage', component: 'StorageManager', props: { view: 'buckets' }, supportsExplorer: true },
    buckets: { id: 'buckets', group: 'storage', label: 'Buckets', component: 'StorageManager', props: { view: 'buckets' }, supportsExplorer: true },

    edge: { id: 'edge', group: 'edge', label: 'Edge Functions', component: 'EdgeFunctions', props: { view: 'functions' }, supportsExplorer: true },
    functions: { id: 'functions', group: 'edge', label: 'Functions', component: 'EdgeFunctions', props: { view: 'functions' }, supportsExplorer: true },

    realtime: { id: 'realtime', group: 'realtime', label: 'Realtime', component: 'RealtimeInspector', props: { view: 'inspector' }, supportsExplorer: true },
    inspector: { id: 'inspector', group: 'realtime', label: 'Inspector', component: 'RealtimeInspector', props: { view: 'inspector' }, supportsExplorer: true },
    config: { id: 'config', group: 'realtime', label: 'Configuration', component: 'RealtimeInspector', props: { view: 'config' }, supportsExplorer: true },

    advisors: { id: 'advisors', group: 'advisors', label: 'Advisors', component: 'Advisors', supportsExplorer: false },
    observability: { id: 'observability', group: 'observability', label: 'Observability', component: 'Observability', supportsExplorer: false },

    logs: { id: 'logs', group: 'logs', label: 'Logs', component: 'LogsAnalytics', props: { view: 'explorer' }, supportsExplorer: true },
    explorer: { id: 'explorer', group: 'logs', label: 'Log Explorer', component: 'LogsAnalytics', props: { view: 'explorer' }, supportsExplorer: true },
    live: { id: 'live', group: 'logs', label: 'Live Tail', component: 'LogsAnalytics', props: { view: 'live' }, supportsExplorer: true },
    alerts: { id: 'alerts', group: 'logs', label: 'Security Alerts', component: 'LogsAnalytics', props: { view: 'alerts' }, supportsExplorer: true },
    metrics: { id: 'metrics', group: 'logs', label: 'Traffic Analysis', component: 'LogsAnalytics', props: { view: 'metrics' }, supportsExplorer: true },

    docs: { id: 'docs', group: 'docs', label: 'API Docs', component: 'ApiDocs', props: { page: 'intro' }, supportsExplorer: true },
    intro: { id: 'intro', group: 'docs', label: 'Getting Started', component: 'ApiDocs', props: { page: 'intro' }, supportsExplorer: true },
    auth_api: { id: 'auth_api', group: 'docs', label: 'Authentication', component: 'ApiDocs', props: { page: 'auth_api' }, supportsExplorer: true },
    db_api: { id: 'db_api', group: 'docs', label: 'Database & SQL', component: 'ApiDocs', props: { page: 'db_api' }, supportsExplorer: true },
    storage_api: { id: 'storage_api', group: 'docs', label: 'Storage', component: 'ApiDocs', props: { page: 'storage_api' }, supportsExplorer: true },
    realtime_api: { id: 'realtime_api', group: 'docs', label: 'Realtime', component: 'ApiDocs', props: { page: 'realtime_api' }, supportsExplorer: true },
    edge_api: { id: 'edge_api', group: 'docs', label: 'Edge Functions', component: 'ApiDocs', props: { page: 'edge_api' }, supportsExplorer: true },
    sdk: { id: 'sdk', group: 'docs', label: 'Client SDKs', component: 'ApiDocs', props: { page: 'sdk' }, supportsExplorer: true },

    integrations: { id: 'integrations', group: 'integrations', label: 'Integrations', component: 'Integrations', props: { page: 'wrappers' }, supportsExplorer: true },
    wrappers: { id: 'wrappers', group: 'integrations', label: 'Wrappers', component: 'Integrations', props: { page: 'wrappers' }, supportsExplorer: true },
    webhooks: { id: 'webhooks', group: 'integrations', label: 'Webhooks', component: 'Integrations', props: { page: 'webhooks' }, supportsExplorer: true },
    cron: { id: 'cron', group: 'integrations', label: 'Cron Jobs', component: 'Integrations', props: { page: 'cron' }, supportsExplorer: true },
    extensions: { id: 'extensions', group: 'integrations', label: 'PG Extensions', component: 'Integrations', props: { page: 'extensions' }, supportsExplorer: true },
    vault: { id: 'vault', group: 'integrations', label: 'Vault', component: 'Integrations', props: { page: 'vault' }, supportsExplorer: true },
    graphql: { id: 'graphql', group: 'integrations', label: 'GraphQL', component: 'Integrations', props: { page: 'graphql' }, supportsExplorer: true },

    settings: { id: 'settings', group: 'settings', label: 'Settings', component: 'Settings', props: { view: 'general' }, supportsExplorer: false },
    general: { id: 'general', group: 'settings', label: 'General', component: 'Settings', props: { view: 'general' }, supportsExplorer: false },
    infrastructure: { id: 'infrastructure', group: 'settings', label: 'Infrastructure', component: 'Settings', props: { view: 'infrastructure' }, supportsExplorer: false },
    billing: { id: 'billing', group: 'settings', label: 'Billing', component: 'Settings', props: { view: 'billing' }, supportsExplorer: false },
    api_keys: { id: 'api_keys', group: 'settings', label: 'API Keys', component: 'Settings', props: { view: 'api_keys' }, supportsExplorer: false },
    mcp_gateway: { id: 'mcp_gateway', group: 'settings', label: 'MCP Gateway', component: 'Settings', props: { view: 'mcp_gateway' }, supportsExplorer: false },

    workspaces: { id: 'workspaces', group: 'workspaces', label: 'Projects', component: 'WorkspaceManager', props: { view: 'wm_overview' }, supportsExplorer: true },
    wm_overview: { id: 'wm_overview', group: 'workspaces', label: 'My Projects', component: 'WorkspaceManager', props: { view: 'wm_overview' }, supportsExplorer: true },
    wm_shared: { id: 'wm_shared', group: 'workspaces', label: 'Shared With Me', component: 'WorkspaceManager', props: { view: 'wm_shared' }, supportsExplorer: true },
    wm_templates: { id: 'wm_templates', group: 'workspaces', label: 'Templates', component: 'WorkspaceManager', props: { view: 'wm_templates' }, supportsExplorer: true },

    workspace_settings: { id: 'workspace_settings', group: 'workspace_settings', label: 'Project Settings', component: 'WorkspaceSettings', props: { view: 'ws_general' }, supportsExplorer: true },
    ws_general: { id: 'ws_general', group: 'workspace_settings', label: 'General', component: 'WorkspaceSettings', props: { view: 'ws_general' }, supportsExplorer: true },
    ws_members: { id: 'ws_members', group: 'workspace_settings', label: 'Team Members', component: 'WorkspaceSettings', props: { view: 'ws_members' }, supportsExplorer: true },
    ws_danger: { id: 'ws_danger', group: 'workspace_settings', label: 'Danger Zone', component: 'WorkspaceSettings', props: { view: 'ws_danger' }, supportsExplorer: true },
};

export const PRIMARY_NAV: NavItem[] = [
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

export const SUBMENUS: Record<string, SubmenuItem[]> = {
    auth: [
        { id: 'users', name: 'Users', icon: Users },
        { id: 'providers', name: 'Providers', icon: Key },
        { id: 'policies', name: 'Permissions', icon: Shield },
        { id: 'two_factor', name: '2FA Settings', icon: ShieldCheck },
        { id: 'security', name: 'Security Hub', icon: ShieldAlert },
        { id: 'security_policies', name: 'Geo-Fencing', icon: Globe },
        { id: 'firewall', name: 'IP Firewall', icon: ShieldBan },
        { id: 'security_notifications', name: 'Alert Notifications', icon: Bell },
        { id: 'auth_integrations', name: 'Integrations & SIEM', icon: Activity },
        { id: 'templates', name: 'Email Templates', icon: FileText },
        { id: 'auth_settings', name: 'Auth Settings', icon: Settings },
    ],
    storage: [
        { id: 'buckets', name: 'Buckets', icon: FolderOpen },
    ],
    edge: [
        { id: 'functions', name: 'Functions', icon: Code },
    ],
    realtime: [
        { id: 'inspector', name: 'Inspector', icon: Search },
        { id: 'config', name: 'Configuration', icon: Settings },
    ],
    logs: [
        { id: 'explorer', name: 'Log Explorer', icon: Search },
        { id: 'live', name: 'Live Tail', icon: Activity },
        { id: 'alerts', name: 'Security Alerts', icon: Bell },
        { id: 'metrics', name: 'Traffic Analysis', icon: Activity },
    ],
    docs: [
        { id: 'intro', name: 'Getting Started', icon: Home },
        { id: 'auth_api', name: 'Authentication', icon: Lock },
        { id: 'db_api', name: 'Database & SQL', icon: Database },
        { id: 'storage_api', name: 'Storage', icon: FolderOpen },
        { id: 'realtime_api', name: 'Realtime', icon: MousePointer2 },
        { id: 'edge_api', name: 'Edge Functions', icon: Zap },
        { id: 'sdk', name: 'Client SDKs', icon: Code },
    ],
    integrations: [
        { id: 'wrappers', name: 'Wrappers', icon: Globe },
        { id: 'webhooks', name: 'Webhooks', icon: Zap },
        { id: 'cron', name: 'Cron Jobs', icon: History },
        { id: 'extensions', name: 'PG Extensions', icon: Cpu },
        { id: 'vault', name: 'Vault', icon: Shield },
        { id: 'graphql', name: 'GraphQL', icon: Code },
    ],
    settings: [
        { id: 'general', name: 'General', icon: Settings },
        { id: 'infrastructure', name: 'Infrastructure', icon: Server },
        { id: 'billing', name: 'Billing', icon: CreditCard },
        { id: 'api_keys', name: 'API Keys', icon: Key },
        { id: 'mcp_gateway', name: 'MCP Gateway', icon: Terminal },
    ],
    workspaces: [
        { id: 'wm_overview', name: 'My Projects', icon: Briefcase },
        { id: 'wm_shared', name: 'Shared with me', icon: Users },
        { id: 'wm_templates', name: 'Templates', icon: LayoutGrid },
    ],
    workspace_settings: [
        { id: 'ws_general', name: 'General', icon: Settings },
        { id: 'ws_members', name: 'Team Members', icon: Users },
        { id: 'ws_danger', name: 'Danger Zone', icon: ShieldAlert },
    ],
};

export function getViewMeta(viewId: string): ViewMeta {
    return VIEW_REGISTRY[viewId] || VIEW_REGISTRY.overview;
}

export function getExplorerModule(viewId: string): string {
    if (viewId === 'visualizer') {
        return 'database';
    }
    return getViewMeta(viewId).group;
}

export function shouldShowExplorer(viewId: string): boolean {
    return getViewMeta(viewId).supportsExplorer;
}

export function getDefaultViewForSection(sectionId: string): string {
    const defaults: Record<string, string> = {
        auth: 'users',
        storage: 'buckets',
        edge: 'functions',
        realtime: 'inspector',
        logs: 'explorer',
        docs: 'intro',
        integrations: 'wrappers',
        settings: 'general',
        workspaces: 'wm_overview',
        workspace_settings: 'ws_general',
    };
    return defaults[sectionId] || sectionId;
}

export function isPrimaryNavActive(navId: string, selectedView: string): boolean {
    if (navId === 'database') {
        return selectedView === 'visualizer';
    }
    return getExplorerModule(selectedView) === navId || selectedView === navId;
}

export function getViewLabel(viewId: string): string {
    return getViewMeta(viewId).label;
}
