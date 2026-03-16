import React, { useState, useEffect } from 'react';
import {
    Settings as SettingsIcon,
    Shield,
    Key,
    Database,
    Lock,
    FolderOpen,
    Zap,
    CreditCard,
    Activity,
    Globe,
    ExternalLink,
    Copy,
    RefreshCw,
    Pause,
    Play,
    Trash2,
    Info
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

const Settings = () => {
    const [activeTab, setActiveTab] = useState('general');
    const [projectInfo, setProjectInfo] = useState<any>(null);
    const [showPassword, setShowPassword] = useState(false);
    const [projectName, setProjectName] = useState('');

    useEffect(() => {
        fetchWithAuth('/api/project/info')
            .then((res: any) => res.json())
            .then((data: any) => {
                setProjectInfo(data);
                setProjectName(data.database || 'ozybase');
            })
            .catch((err: any) => console.error('Failed to fetch project info:', err));
    }, []);

    const projectId = projectInfo?.database || 'ozybase';

    // Connection info from real API data
    const connectionPassword = projectInfo?.can_view_secrets
        ? (projectInfo?.password || '[set in DATABASE_URL]')
        : '[REDACTED]';
    const connectionInfo = {
        host: projectInfo?.host || 'localhost',
        port: projectInfo?.port || '5432',
        database: projectInfo?.database || 'ozybase',
        user: projectInfo?.user || 'postgres',
        password: connectionPassword,
        uri: `postgresql://${projectInfo?.user || 'postgres'}:${connectionPassword}@${projectInfo?.host || 'localhost'}:${projectInfo?.port || '5432'}/${projectInfo?.database || 'ozybase'}?sslmode=${projectInfo?.ssl_mode || 'disable'}`,
        poolerUri: projectInfo?.pooler_host
            ? `postgresql://${projectInfo?.user || 'postgres'}:${connectionPassword}@${projectInfo.pooler_host}:${projectInfo?.pooler_port || '6543'}/${projectInfo?.database || 'ozybase'}?sslmode=${projectInfo?.ssl_mode || 'disable'}`
            : 'Pooler not configured for this deployment'
    };

    const menuSections = [
        {
            title: 'PROJECT SETTINGS',
            items: [
                { id: 'general', name: 'General', icon: SettingsIcon },
                { id: 'database', name: 'Database', icon: Database },
                { id: 'compute', name: 'Compute and Disk', icon: Database },
                { id: 'infrastructure', name: 'Infrastructure', icon: Shield },
                { id: 'integrations', name: 'Integrations', icon: Zap },
                { id: 'data-api', name: 'Data API', icon: Globe },
                { id: 'api-keys', name: 'API Keys', icon: Key },
                { id: 'jwt-keys', name: 'JWT Keys', icon: Lock },
                { id: 'log-drains', name: 'Log Drains', icon: Activity },
                { id: 'add-ons', name: 'Add Ons', icon: Globe },
                { id: 'vault', name: 'Vault', icon: Lock, beta: true },
            ]
        },
        {
            title: 'CONFIGURATION',
            items: [
                { id: 'db-config', name: 'Database', icon: Database, external: true },
                { id: 'auth-config', name: 'Authentication', icon: Lock, external: true },
                { id: 'storage-config', name: 'Storage', icon: FolderOpen, external: true },
                { id: 'edge-config', name: 'Edge Functions', icon: Zap, external: true },
            ]
        },
        {
            title: 'BILLING',
            items: [
                { id: 'subscription', name: 'Subscription', icon: CreditCard, external: true },
                { id: 'usage', name: 'Usage', icon: Activity, external: true },
            ]
        }
    ];

    const renderGeneral = () => (
        <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div>
                <h2 className="text-2xl font-black text-white italic tracking-tighter uppercase mb-2">Project Settings</h2>
                <p className="text-zinc-500 text-sm font-medium">Configure general options, domains, transfers, and project lifecycle.</p>
            </div>

            {/* General Settings Card */}
            <div className="bg-[#171717]/50 border border-[#2e2e2e] rounded-3xl overflow-hidden shadow-2xl">
                <div className="p-8 space-y-8">
                    <h3 className="text-sm font-black text-white uppercase tracking-widest border-l-4 border-primary pl-4">General settings</h3>

                    <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                            <div>
                                <p className="text-xs font-black text-zinc-300 uppercase tracking-widest">Project name</p>
                                <p className="text-[10px] text-zinc-600 uppercase font-black tracking-widest mt-1">Displayed throughout the dashboard.</p>
                            </div>
                            <div className="md:col-span-2">
                                <input
                                    type="text"
                                    value={projectName}
                                    onChange={(e: any) => setProjectName(e.target.value)}
                                    className="w-full bg-[#0c0c0c] border border-[#2e2e2e] rounded-xl px-4 py-3 text-sm text-zinc-200 focus:outline-none focus:border-primary/50 transition-all font-mono"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                            <div>
                                <p className="text-xs font-black text-zinc-300 uppercase tracking-widest">Project ID</p>
                                <p className="text-[10px] text-zinc-600 uppercase font-black tracking-widest mt-1">Reference used in APIs and URLs.</p>
                            </div>
                            <div className="md:col-span-2 flex gap-3">
                                <input
                                    type="text"
                                    readOnly
                                    value={projectId}
                                    className="flex-1 bg-[#0c0c0c] border border-[#2e2e2e] rounded-xl px-4 py-3 text-sm text-zinc-500 focus:outline-none font-mono"
                                />
                                <button className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl px-4 py-3 text-zinc-400 hover:text-white transition-all flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
                                    <Copy size={14} />
                                    Copy
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="px-8 py-4 bg-[#111111]/50 border-t border-[#2e2e2e] flex justify-end">
                    <button className="bg-primary hover:bg-[#E6E600] text-black px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all shadow-[0_0_20px_rgba(254,254,0,0.1)]">
                        Save changes
                    </button>
                </div>
            </div>

            {/* Project Availability Card */}
            <div className="bg-[#171717]/50 border border-[#2e2e2e] rounded-3xl overflow-hidden shadow-2xl">
                <div className="p-8 space-y-8">
                    <h3 className="text-sm font-black text-white uppercase tracking-widest border-l-4 border-primary pl-4">Project availability</h3>
                    <p className="text-[11px] text-zinc-600 uppercase font-black tracking-widest -mt-4">Restart or pause your project when performing maintenance.</p>

                    <div className="space-y-8">
                        <div className="flex items-center justify-between p-6 bg-[#0c0c0c] border border-[#2e2e2e] rounded-2xl">
                            <div>
                                <p className="text-xs font-black text-zinc-200 uppercase tracking-widest">Restart project</p>
                                <p className="text-[10px] text-zinc-600 uppercase font-black tracking-widest mt-1">Your project will not be available for a few minutes.</p>
                            </div>
                            <button className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl px-4 py-2 text-zinc-400 hover:text-white transition-all flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
                                <RefreshCw size={14} />
                                Restart project
                            </button>
                        </div>

                        <div className="flex items-center justify-between p-6 bg-[#0c0c0c] border border-[#2e2e2e] rounded-2xl">
                            <div>
                                <p className="text-xs font-black text-zinc-200 uppercase tracking-widest">Pause project</p>
                                <p className="text-[10px] text-zinc-600 uppercase font-black tracking-widest mt-1">Your project will not be accessible while it is paused.</p>
                            </div>
                            <button className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl px-4 py-2 text-zinc-400 hover:text-white transition-all flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
                                <Pause size={14} />
                                Pause project
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Project Usage Warning */}
            <div className="bg-[#111111] border border-[#2e2e2e] rounded-3xl p-8 flex items-center justify-between">
                <div className="flex items-center gap-6">
                    <div className="w-12 h-12 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-center text-zinc-500">
                        <Activity size={24} />
                    </div>
                    <div>
                        <p className="text-xs font-black text-white uppercase tracking-widest">Project usage statistics have been moved</p>
                        <p className="text-[10px] text-zinc-600 uppercase font-black tracking-widest mt-1">You may view your project's usage under your organization's settings</p>
                    </div>
                </div>
                <button className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl px-4 py-2 text-zinc-400 hover:text-white transition-all text-[10px] font-black uppercase tracking-widest">
                    View project usage
                </button>
            </div>

            {/* Custom Domains Hero */}
            <div className="pt-8">
                <h2 className="text-xl font-black text-white italic tracking-tighter uppercase mb-2">Custom Domains</h2>
                <div className="bg-[#171717] border-2 border-dashed border-[#2e2e2e] rounded-3xl p-12 flex flex-col items-center justify-center text-center">
                    <Globe size={48} className="text-zinc-800 mb-6" />
                    <p className="text-sm font-bold text-zinc-400 mb-2">Set up a custom domain for your project</p>
                    <p className="text-[10px] text-zinc-600 uppercase font-bold tracking-widest max-w-sm mb-8">Establish a professional presence with your own domain name on the OzyBase edge network.</p>
                    <button className="bg-primary text-black px-8 py-3 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-[#E6E600] transition-all">
                        Configure Custom Domain
                    </button>
                </div>
            </div>
        </div>
    );

    const renderDatabase = () => (
        <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div>
                <h2 className="text-2xl font-black text-white italic tracking-tighter uppercase mb-2">Database Settings</h2>
                <p className="text-zinc-500 text-sm font-medium">Connection strings and environment variables for your app.</p>
            </div>

            {/* Connection String Card */}
            <div className="bg-[#171717]/50 border border-[#2e2e2e] rounded-3xl overflow-hidden shadow-2xl">
                <div className="p-8 space-y-8">
                    <h3 className="text-sm font-black text-white uppercase tracking-widest border-l-4 border-primary pl-4">Connection String</h3>

                    {/* Tabs */}
                    <div className="flex gap-2 border-b border-[#2e2e2e] pb-4">
                        {['URI', 'Parameters', 'JDBC', 'Pooler'].map((tab: any, i: any) => (
                            <button key={tab} className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all ${i === 0 ? 'bg-primary text-black' : 'bg-[#1a1a1a] text-zinc-500 hover:text-white border border-[#2e2e2e]'}`}>
                                {tab}
                            </button>
                        ))}
                    </div>

                    {/* Direct Connection */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs font-black text-zinc-200 uppercase tracking-widest">Direct connection</p>
                                <p className="text-[10px] text-zinc-600 font-bold tracking-widest mt-1">Ideal for applications with persistent and long-lived connections.</p>
                            </div>
                            <span className="text-[9px] font-black uppercase tracking-widest text-green-500 bg-green-500/10 px-2 py-1 rounded border border-green-500/20">Active</span>
                        </div>

                        <div className="bg-[#0c0c0c] p-4 rounded-xl border border-[#2e2e2e] font-mono text-xs text-zinc-400 flex items-center justify-between">
                            <span className="break-all">{connectionInfo.uri}</span>
                            <button className="ml-4 p-2 bg-[#1a1a1a] rounded-lg border border-[#2e2e2e] hover:border-zinc-500 transition-all text-zinc-400 hover:text-white">
                                <Copy size={14} />
                            </button>
                        </div>
                    </div>

                    {/* Connection Parameters Table */}
                    <div className="space-y-4">
                        <p className="text-xs font-black text-zinc-200 uppercase tracking-widest">View parameters</p>
                        <div className="bg-[#0c0c0c] rounded-xl border border-[#2e2e2e] overflow-hidden">
                            <table className="w-full">
                                <tbody className="divide-y divide-[#2e2e2e]/50">
                                    <tr className="hover:bg-zinc-900/30">
                                        <td className="px-4 py-3 text-xs font-bold text-zinc-500 uppercase tracking-widest w-32">Host</td>
                                        <td className="px-4 py-3 text-xs text-zinc-300 font-mono">{connectionInfo.host}</td>
                                        <td className="px-4 py-3 text-right">
                                            <button className="p-1 text-zinc-600 hover:text-white"><Copy size={12} /></button>
                                        </td>
                                    </tr>
                                    <tr className="hover:bg-zinc-900/30">
                                        <td className="px-4 py-3 text-xs font-bold text-zinc-500 uppercase tracking-widest">Port</td>
                                        <td className="px-4 py-3 text-xs text-zinc-300 font-mono">{connectionInfo.port}</td>
                                        <td className="px-4 py-3 text-right">
                                            <button className="p-1 text-zinc-600 hover:text-white"><Copy size={12} /></button>
                                        </td>
                                    </tr>
                                    <tr className="hover:bg-zinc-900/30">
                                        <td className="px-4 py-3 text-xs font-bold text-zinc-500 uppercase tracking-widest">Database</td>
                                        <td className="px-4 py-3 text-xs text-zinc-300 font-mono">{connectionInfo.database}</td>
                                        <td className="px-4 py-3 text-right">
                                            <button className="p-1 text-zinc-600 hover:text-white"><Copy size={12} /></button>
                                        </td>
                                    </tr>
                                    <tr className="hover:bg-zinc-900/30">
                                        <td className="px-4 py-3 text-xs font-bold text-zinc-500 uppercase tracking-widest">User</td>
                                        <td className="px-4 py-3 text-xs text-zinc-300 font-mono">{connectionInfo.user}</td>
                                        <td className="px-4 py-3 text-right">
                                            <button className="p-1 text-zinc-600 hover:text-white"><Copy size={12} /></button>
                                        </td>
                                    </tr>
                                    <tr className="hover:bg-zinc-900/30">
                                        <td className="px-4 py-3 text-xs font-bold text-zinc-500 uppercase tracking-widest">Password</td>
                                        <td className="px-4 py-3 text-xs text-zinc-300 font-mono">
                                            {showPassword ? connectionInfo.password : 'â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢'}
                                        </td>
                                        <td className="px-4 py-3 text-right flex gap-1 justify-end">
                                            <button onClick={() => setShowPassword(!showPassword)} className="p-1 text-zinc-600 hover:text-white">
                                                {showPassword ? <Lock size={12} /> : <Key size={12} />}
                                            </button>
                                            <button className="p-1 text-zinc-600 hover:text-white"><Copy size={12} /></button>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>

            {/* Session Pooler Card */}
            <div className="bg-[#171717]/50 border border-[#2e2e2e] rounded-3xl overflow-hidden shadow-2xl">
                <div className="p-8 space-y-6">
                    <h3 className="text-sm font-black text-white uppercase tracking-widest border-l-4 border-blue-500 pl-4">Session Pooler</h3>
                    <p className="text-[11px] text-zinc-600 font-bold tracking-widest -mt-2">
                        {projectInfo?.pooler_host
                            ? 'For serverless functions and short-lived connections. Connects via the configured pooler port.'
                            : 'No pooler endpoint is configured for this deployment.'}
                    </p>

                    <div className="bg-[#0c0c0c] p-4 rounded-xl border border-[#2e2e2e] font-mono text-xs text-zinc-400 flex items-center justify-between">
                        <span className="break-all">{connectionInfo.poolerUri}</span>
                        <button className="ml-4 p-2 bg-[#1a1a1a] rounded-lg border border-[#2e2e2e] hover:border-zinc-500 transition-all text-zinc-400 hover:text-white">
                            <Copy size={14} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Reset Password Card */}
            <div className="bg-[#111111] border border-[#2e2e2e] rounded-3xl p-8 flex items-center justify-between">
                <div className="flex items-center gap-6">
                    <div className="w-12 h-12 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center justify-center text-red-500">
                        <Lock size={24} />
                    </div>
                    <div>
                        <p className="text-xs font-black text-white uppercase tracking-widest">Reset your database password</p>
                        <p className="text-[10px] text-zinc-600 uppercase font-black tracking-widest mt-1">You may reset your database password in your project's Database Settings</p>
                    </div>
                </div>
                <button className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2 text-red-500 hover:bg-red-500/20 transition-all text-[10px] font-black uppercase tracking-widest">
                    Reset Password
                </button>
            </div>
        </div>
    );

    return (
        <div className="flex h-full bg-[#111111] animate-in fade-in duration-500 overflow-hidden">
            {/* Sidebar Navigation */}
            <div className="w-64 border-r border-[#2e2e2e] bg-[#0c0c0c] flex flex-col flex-shrink-0">
                <div className="px-6 py-6 font-black text-white italic uppercase italic tracking-tighter text-lg border-b border-[#2e2e2e]">
                    Settings
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-8 py-8">
                    {menuSections.map((sec: any, idx: any) => (
                        <div key={idx}>
                            <h4 className="px-3 mb-4 text-[9px] font-black text-zinc-600 uppercase tracking-[0.2em]">{sec.title}</h4>
                            <div className="space-y-1">
                                {sec.items.map((item: any) => (
                                    <button
                                        key={item.id}
                                        onClick={() => !item.external && setActiveTab(item.id)}
                                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-all group ${activeTab === item.id
                                            ? 'bg-zinc-900 border border-zinc-800 text-primary font-bold'
                                            : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900/40 border border-transparent'
                                            }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <item.icon size={14} className={activeTab === item.id ? 'text-primary' : 'text-zinc-700 group-hover:text-zinc-400'} />
                                            <span className="tracking-tight">{item.name}</span>
                                        </div>
                                        {item.beta && (
                                            <span className="bg-primary/10 text-primary border border-primary/20 text-[8px] font-black uppercase px-1.5 py-0.5 rounded leading-none">Beta</span>
                                        )}
                                        {item.external && (
                                            <ArrowUpRight size={10} className="text-zinc-800" />
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto custom-scrollbar bg-[#111111]">
                <div className="max-w-4xl mx-auto py-12 px-12">
                    {activeTab === 'general' ? renderGeneral() :
                        activeTab === 'database' ? renderDatabase() : (
                            <div className="flex flex-col items-center justify-center h-[60vh] text-center">
                                <div className="w-20 h-20 bg-zinc-900 border border-zinc-800 rounded-3xl flex items-center justify-center text-zinc-800 mb-6">
                                    <SettingsIcon size={40} className="animate-spin-slow" />
                                </div>
                                <h3 className="text-xl font-black text-zinc-600 italic tracking-tighter uppercase mb-2">Module Under Construction</h3>
                                <p className="text-xs text-zinc-700 font-bold uppercase tracking-widest max-w-xs leading-relaxed">
                                    This settings sub-module is being provisioned across our global edge network.
                                </p>
                            </div>
                        )}
                </div>
            </div>

            <style dangerouslySetInnerHTML={{
                __html: `
                .animate-spin-slow {
                    animation: spin 8s linear infinite;
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}} />
        </div>
    );
};

const ArrowUpRight = ({ size, className }: any) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
    >
        <path d="M7 17l10-10" /><path d="M7 7h10v10" />
    </svg>
);

export default Settings;

