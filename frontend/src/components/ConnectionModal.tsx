import React, { useState, useEffect, useMemo } from 'react';
import { fetchWithAuth } from '../utils/api';
import {
    X,
    Copy,
    Check,
    Database,
    Key,
    Lock,
    ExternalLink,
    Code,
    Smartphone,
    Layers,
    AlertTriangle,
    Loader2
} from 'lucide-react';

type FrameworkType = 'nextjs' | 'react' | 'node';
type MobileType = 'flutter' | 'react_native';
type OrmType = 'prisma' | 'drizzle' | 'sequelize';

const ConnectionModal = ({ isOpen, onClose }: any) => {
    const [activeTab, setActiveTab] = useState('connection');
    const [connectionType, setConnectionType] = useState('uri');
    const [connectionSource, setConnectionSource] = useState('primary');
    const [connectionMethod, setConnectionMethod] = useState('direct');
    const [frameworkType, setFrameworkType] = useState<FrameworkType>('nextjs');
    const [mobileType, setMobileType] = useState<MobileType>('flutter');
    const [ormType, setOrmType] = useState<OrmType>('prisma');
    const [showPassword, setShowPassword] = useState(false);
    const [copied, setCopied] = useState<any>(null);
    const [projectInfo, setProjectInfo] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!isOpen) return;

        queueMicrotask(() => {
            setShowPassword(false);
            setLoading(true);
        });

        let cancelled = false;

        fetchWithAuth('/api/project/info')
            .then((res: any) => res.json())
            .then((data: any) => {
                if (cancelled) return;
                setProjectInfo(data);
                setLoading(false);
            })
            .catch((err: any) => {
                if (cancelled) return;
                console.error('Failed to fetch project info:', err);
                setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [isOpen]);

    const effectiveConnectionSource = connectionSource === 'replica' && !(projectInfo?.read_replica_host) ? 'primary' : connectionSource;
    const effectiveConnectionMethod = (connectionMethod === 'session' || connectionMethod === 'transaction') && !(projectInfo?.pooler_host)
        ? 'direct'
        : connectionMethod;

    const connectionInfo = useMemo(() => {
        const host = projectInfo?.host || 'localhost';
        const port = projectInfo?.port || '5432';
        const database = projectInfo?.database || 'ozybase';
        const user = projectInfo?.user || 'postgres';
        const sslmode = projectInfo?.ssl_mode || 'disable';
        const rawPassword = projectInfo?.password || '';

        const replicaHost = projectInfo?.read_replica_host || '';
        const replicaPort = projectInfo?.read_replica_port || port;
        const replicaMode = projectInfo?.read_replica_ssl_mode || sslmode;

        const poolerHost = projectInfo?.pooler_host || '';
        const poolerPort = projectInfo?.pooler_port || '6543';
        const poolerTxPort = projectInfo?.pooler_tx_port || poolerPort;

        const hasReplica = replicaHost !== '';
        const hasPooler = poolerHost !== '';

        const sourceHost = effectiveConnectionSource === 'replica' && hasReplica ? replicaHost : host;
        const sourcePort = effectiveConnectionSource === 'replica' && hasReplica ? replicaPort : port;
        const sourceSSLMode = effectiveConnectionSource === 'replica' && hasReplica ? replicaMode : sslmode;

        const methodHost = effectiveConnectionMethod === 'direct' ? sourceHost : (hasPooler ? poolerHost : sourceHost);
        const methodPort = effectiveConnectionMethod === 'session' ? (hasPooler ? poolerPort : sourcePort) :
            effectiveConnectionMethod === 'transaction' ? (hasPooler ? poolerTxPort : sourcePort) :
                sourcePort;

        const uriPassword = showPassword && rawPassword ? rawPassword : '[YOUR-PASSWORD]';
        const uri = `postgresql://${user}:${uriPassword}@${methodHost}:${methodPort}/${database}?sslmode=${sourceSSLMode}`;
        const paramsText = [
            `host=${methodHost}`,
            `port=${methodPort}`,
            `database=${database}`,
            `user=${user}`,
            `password=${showPassword && rawPassword ? rawPassword : '[YOUR-PASSWORD]'}`,
            `sslmode=${sourceSSLMode}`,
            `source=${effectiveConnectionSource}`,
            `method=${effectiveConnectionMethod}`,
        ].join('\n');
        const jdbc = `jdbc:postgresql://${methodHost}:${methodPort}/${database}?sslmode=${sourceSSLMode}&user=${encodeURIComponent(user)}&password=${encodeURIComponent(showPassword && rawPassword ? rawPassword : '[YOUR-PASSWORD]')}`;

        return {
            host: methodHost,
            port: methodPort,
            database,
            user,
            sslmode: sourceSSLMode,
            password: rawPassword,
            passwordDisplay: showPassword ? (rawPassword || '[YOUR-PASSWORD]') : '************',
            uri,
            paramsText,
            jdbc,
            apiUrl: projectInfo?.api_url || window.location.origin,
            sessionToken: localStorage.getItem('ozy_token') || 'Not available',
            serviceKey: projectInfo?.service_role_key || 'Contact admin for service role key',
            canViewSecrets: !!projectInfo?.can_view_secrets,
            internalOnlyHost: !!projectInfo?.internal_only_host,
            hasReplica,
            hasPooler
        };
    }, [projectInfo, showPassword, effectiveConnectionSource, effectiveConnectionMethod]);

    const frameworkSnippets = useMemo(() => {
        const apiUrl = connectionInfo.apiUrl;
        const token = connectionInfo.sessionToken;

        return {
            nextjs: `const API_URL = '${apiUrl}';\n\nexport async function getRows() {\n  const res = await fetch(\`${apiUrl}/api/collections/products/records\`, {\n    headers: {\n      Authorization: \`Bearer ${token}\`,\n      'Content-Type': 'application/json',\n    },\n    cache: 'no-store',\n  });\n  if (!res.ok) throw new Error('Failed request');\n  return res.json();\n}`,
            react: `const API_URL = '${apiUrl}';\nconst TOKEN = '${token}';\n\nexport async function createRow(payload) {\n  const res = await fetch(\`${apiUrl}/api/collections/products/records\`, {\n    method: 'POST',\n    headers: {\n      Authorization: \`Bearer ${token}\`,\n      'Content-Type': 'application/json',\n    },\n    body: JSON.stringify(payload),\n  });\n  return res.json();\n}`,
            node: `import express from 'express';\n\nconst app = express();\napp.use(express.json());\n\napp.get('/products', async (_req, res) => {\n  const r = await fetch('${apiUrl}/api/collections/products/records', {\n    headers: { Authorization: 'Bearer ${token}' },\n  });\n  res.json(await r.json());\n});\n\napp.listen(3000);`
        };
    }, [connectionInfo.apiUrl, connectionInfo.sessionToken]);

    const mobileSnippets = useMemo(() => {
        const apiUrl = connectionInfo.apiUrl;
        const token = connectionInfo.sessionToken;

        return {
            flutter: `import 'package:http/http.dart' as http;\n\nFuture<String> getProducts() async {\n  final res = await http.get(\n    Uri.parse('${apiUrl}/api/collections/products/records'),\n    headers: { 'Authorization': 'Bearer ${token}' },\n  );\n  return res.body;\n}`,
            react_native: `const API_URL = '${apiUrl}';\nconst TOKEN = '${token}';\n\nexport async function fetchProducts() {\n  const res = await fetch(\`${apiUrl}/api/collections/products/records\`, {\n    headers: { Authorization: \`Bearer ${token}\` },\n  });\n  return res.json();\n}`
        };
    }, [connectionInfo.apiUrl, connectionInfo.sessionToken]);

    const ormSnippets = useMemo(() => {
        const dbUrl = connectionInfo.uri;

        return {
            prisma: `# .env\nDATABASE_URL="${dbUrl}"\n\n# schema.prisma\ndatasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}`,
            drizzle: `import { drizzle } from 'drizzle-orm/node-postgres';\nimport { Pool } from 'pg';\n\nconst pool = new Pool({ connectionString: '${dbUrl}' });\nexport const db = drizzle(pool);`,
            sequelize: `import { Sequelize } from 'sequelize';\n\nexport const sequelize = new Sequelize('${dbUrl}', {\n  dialect: 'postgres',\n  logging: false,\n});`
        };
    }, [connectionInfo.uri]);

    const handleCopy = (text: any, key: any) => {
        navigator.clipboard.writeText(text);
        setCopied(key);
        setTimeout(() => setCopied(null), 2000);
    };

    if (!isOpen) return null;

    const tabs = [
        { id: 'connection', label: 'Connection String', icon: Database },
        { id: 'frameworks', label: 'App Frameworks', icon: Code },
        { id: 'mobile', label: 'Mobile Frameworks', icon: Smartphone },
        { id: 'orms', label: 'ORMs', icon: Layers },
        { id: 'api', label: 'API Keys', icon: Key },
    ];

    const renderedConnectionString = connectionType === 'jdbc' ? connectionInfo.jdbc : connectionType === 'params' ? connectionInfo.paramsText : connectionInfo.uri;

    const renderCodeCard = (title: any, snippet: any, copyKey: any) => (
        <div className="bg-[#111111] border border-[#2e2e2e] rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#2e2e2e] flex items-center justify-between">
                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">{title}</p>
                <button
                    onClick={() => handleCopy(snippet, copyKey)}
                    className="p-2 bg-[#1a1a1a] rounded-lg border border-[#2e2e2e] hover:border-primary/50 transition-all"
                >
                    {copied === copyKey ? <Check size={14} className="text-green-500" /> : <Copy size={14} className="text-zinc-400" />}
                </button>
            </div>
            <pre className="p-4 text-xs text-zinc-300 font-mono overflow-x-auto custom-scrollbar whitespace-pre-wrap">{snippet}</pre>
        </div>
    );

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm modal-overlay-enter" onClick={onClose} />

            <div className="relative bg-[#1a1a1a] border border-[#2e2e2e] rounded-2xl shadow-2xl w-full max-w-5xl max-h-[85vh] overflow-hidden modal-panel-enter">
                <div className="px-6 py-4 border-b border-[#2e2e2e] flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-black text-white uppercase tracking-tight">Connect to your project</h2>
                        <p className="text-xs text-zinc-500 mt-1">
                            Get the connection strings and environment variables for <span className="text-primary font-bold">{connectionInfo.database}</span>
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 text-zinc-500 hover:text-white transition-colors rounded-lg hover:bg-zinc-800">
                        <X size={20} />
                    </button>
                </div>

                <div className="px-6 py-3 border-b border-[#2e2e2e] flex gap-1 overflow-x-auto">
                    {tabs.map((tab: any) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest whitespace-nowrap transition-all ${activeTab === tab.id ? 'bg-primary text-black' : 'text-zinc-500 hover:text-white hover:bg-zinc-800'}`}
                        >
                            <tab.icon size={14} />
                            {tab.label}
                        </button>
                    ))}
                </div>

                <div className="p-6 overflow-y-auto max-h-[60vh] custom-scrollbar">
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="animate-spin text-primary" size={32} />
                        </div>
                    ) : (
                        <>
                            {activeTab === 'connection' && (
                                <div className="space-y-6">
                                    <div className="flex gap-2 items-center flex-wrap">
                                        <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Type</span>
                                        <select
                                            value={connectionType}
                                            onChange={(e: any) => setConnectionType(e.target.value)}
                                            className="bg-[#111111] border border-[#2e2e2e] rounded-lg px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-primary/50"
                                        >
                                            <option value="uri">URI</option>
                                            <option value="params">Parameters</option>
                                            <option value="jdbc">JDBC</option>
                                        </select>

                                        <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest ml-4">Source</span>
                                        <select
                                            value={connectionSource}
                                            onChange={(e: any) => setConnectionSource(e.target.value)}
                                            className="bg-[#111111] border border-[#2e2e2e] rounded-lg px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-primary/50"
                                        >
                                            <option value="primary">Primary Database</option>
                                            <option value="replica" disabled={!connectionInfo.hasReplica}>Read Replica{!connectionInfo.hasReplica ? ' (Unavailable)' : ''}</option>
                                        </select>

                                        <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest ml-4">Method</span>
                                        <select
                                            value={connectionMethod}
                                            onChange={(e: any) => setConnectionMethod(e.target.value)}
                                            className="bg-[#111111] border border-[#2e2e2e] rounded-lg px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-primary/50"
                                        >
                                            <option value="direct">Direct connection</option>
                                            <option value="session" disabled={!connectionInfo.hasPooler}>Session pooler{!connectionInfo.hasPooler ? ' (Unavailable)' : ''}</option>
                                            <option value="transaction" disabled={!connectionInfo.hasPooler}>Transaction pooler{!connectionInfo.hasPooler ? ' (Unavailable)' : ''}</option>
                                        </select>
                                    </div>

                                    {(!connectionInfo.hasReplica || !connectionInfo.hasPooler) && (
                                        <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3">
                                            {!connectionInfo.hasReplica && (
                                                <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
                                                    Read replica unavailable. Configure DB_READ_REPLICA_HOST and DB_READ_REPLICA_PORT.
                                                </p>
                                            )}
                                            {!connectionInfo.hasPooler && (
                                                <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mt-1">
                                                    Pooler unavailable. Configure DB_POOLER_HOST and DB_POOLER_PORT.
                                                </p>
                                            )}
                                        </div>
                                    )}

                                    <div className="space-y-4">
                                        <div>
                                            <div className="flex items-center justify-between mb-2">
                                                <h3 className="text-sm font-bold text-white">{effectiveConnectionMethod === 'direct' ? 'Direct connection' : effectiveConnectionMethod === 'session' ? 'Session pooler' : 'Transaction pooler'}</h3>
                                                <span className="text-[9px] font-black uppercase tracking-widest text-green-500 bg-green-500/10 px-2 py-1 rounded border border-green-500/20">Active</span>
                                            </div>
                                            <p className="text-xs text-zinc-500 mb-3">Use this connection in your backend services or server runtime.</p>
                                            {connectionInfo.password && (
                                                <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                                                    Credentials loaded from environment variables
                                                </p>
                                            )}
                                        </div>

                                        <div className="bg-[#111111] p-4 rounded-xl border border-[#2e2e2e] font-mono text-sm text-zinc-400 flex items-center justify-between group">
                                            <code className="break-all text-xs whitespace-pre-wrap">{renderedConnectionString}</code>
                                            <button
                                                onClick={() => handleCopy(renderedConnectionString, 'connectionString')}
                                                className="ml-4 p-2 bg-[#1a1a1a] rounded-lg border border-[#2e2e2e] hover:border-primary/50 transition-all text-zinc-400 hover:text-white shrink-0"
                                            >
                                                {copied === 'connectionString' ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                                            </button>
                                        </div>

                                        {connectionInfo.internalOnlyHost && effectiveConnectionMethod === 'direct' && (
                                            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex items-start gap-3">
                                                <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
                                                <p className="text-[10px] text-amber-500 font-bold uppercase tracking-wider leading-relaxed">
                                                    Internal host detected ({connectionInfo.host}). For external apps configure DB_PUBLIC_HOST and DB_PUBLIC_PORT.
                                                </p>
                                            </div>
                                        )}

                                        <div className="mt-6">
                                            <button className="text-xs font-bold text-zinc-400 hover:text-white transition-colors flex items-center gap-2">
                                                <span>View parameters</span>
                                            </button>

                                            <div className="mt-3 bg-[#111111] rounded-xl border border-[#2e2e2e] overflow-hidden">
                                                <table className="w-full">
                                                    <tbody className="divide-y divide-[#2e2e2e]/50 text-xs">
                                                        {[
                                                            { label: 'Host', value: connectionInfo.host },
                                                            { label: 'Port', value: connectionInfo.port },
                                                            { label: 'Database', value: connectionInfo.database },
                                                            { label: 'User', value: connectionInfo.user },
                                                            { label: 'SSL Mode', value: connectionInfo.sslmode },
                                                            { label: 'Source', value: effectiveConnectionSource },
                                                            { label: 'Method', value: effectiveConnectionMethod },
                                                        ].map((row: any) => (
                                                            <tr key={row.label} className="hover:bg-zinc-900/30">
                                                                <td className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest w-28">{row.label}</td>
                                                                <td className="px-4 py-3 text-zinc-300 font-mono">{row.value}</td>
                                                                <td className="px-4 py-3 text-right">
                                                                    <button onClick={() => handleCopy(String(row.value), row.label)} className="p-1 text-zinc-600 hover:text-white">
                                                                        {copied === row.label ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                        <tr className="hover:bg-zinc-900/30">
                                                            <td className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest">Password</td>
                                                            <td className="px-4 py-3 text-zinc-300 font-mono">{connectionInfo.passwordDisplay}</td>
                                                            <td className="px-4 py-3 text-right flex gap-1 justify-end">
                                                                <button onClick={() => setShowPassword(!showPassword)} className="p-1 text-zinc-600 hover:text-white">
                                                                    {showPassword ? <Lock size={12} /> : <Key size={12} />}
                                                                </button>
                                                                <button onClick={() => handleCopy(connectionInfo.password || '[YOUR-PASSWORD]', 'password')} className="p-1 text-zinc-600 hover:text-white">
                                                                    {copied === 'password' ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    </tbody>
                                                </table>
                                            </div>
                                            {!connectionInfo.password && (
                                                <p className="mt-3 text-[10px] text-amber-500 font-bold uppercase tracking-wider">
                                                    Real password not available in runtime env. Set DB_PASSWORD or DATABASE_URL with password.
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'frameworks' && (
                                <div className="space-y-4">
                                    <div className="flex items-center gap-3">
                                        <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Framework</span>
                                        <select value={frameworkType} onChange={(e: any) => setFrameworkType(e.target.value)} className="bg-[#111111] border border-[#2e2e2e] rounded-lg px-3 py-1.5 text-xs text-zinc-300">
                                            <option value="nextjs">Next.js</option>
                                            <option value="react">React</option>
                                            <option value="node">Node API</option>
                                        </select>
                                    </div>
                                    {renderCodeCard('Framework Snippet', frameworkSnippets[frameworkType], 'frameworkSnippet')}
                                </div>
                            )}

                            {activeTab === 'mobile' && (
                                <div className="space-y-4">
                                    <div className="flex items-center gap-3">
                                        <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Mobile</span>
                                        <select value={mobileType} onChange={(e: any) => setMobileType(e.target.value)} className="bg-[#111111] border border-[#2e2e2e] rounded-lg px-3 py-1.5 text-xs text-zinc-300">
                                            <option value="flutter">Flutter</option>
                                            <option value="react_native">React Native</option>
                                        </select>
                                    </div>
                                    {renderCodeCard('Mobile Snippet', mobileSnippets[mobileType], 'mobileSnippet')}
                                </div>
                            )}

                            {activeTab === 'orms' && (
                                <div className="space-y-4">
                                    <div className="flex items-center gap-3">
                                        <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">ORM</span>
                                        <select value={ormType} onChange={(e: any) => setOrmType(e.target.value)} className="bg-[#111111] border border-[#2e2e2e] rounded-lg px-3 py-1.5 text-xs text-zinc-300">
                                            <option value="prisma">Prisma</option>
                                            <option value="drizzle">Drizzle</option>
                                            <option value="sequelize">Sequelize</option>
                                        </select>
                                    </div>
                                    {renderCodeCard('ORM Snippet', ormSnippets[ormType], 'ormSnippet')}
                                </div>
                            )}

                            {activeTab === 'api' && (
                                <div className="space-y-6">
                                    <div className="space-y-4">
                                        <div>
                                            <h3 className="text-sm font-bold text-white mb-1">API URL</h3>
                                            <p className="text-xs text-zinc-500 mb-3">Use this URL to access your OzyBase API endpoints.</p>
                                            <div className="bg-[#111111] p-4 rounded-xl border border-[#2e2e2e] font-mono text-xs text-zinc-400 flex items-center justify-between">
                                                <code>{connectionInfo.apiUrl}</code>
                                                <button onClick={() => handleCopy(connectionInfo.apiUrl, 'apiUrl')} className="ml-4 p-2 bg-[#1a1a1a] rounded-lg border border-[#2e2e2e] hover:border-primary/50 transition-all">
                                                    {copied === 'apiUrl' ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                                                </button>
                                            </div>
                                        </div>

                                        <div>
                                            <h3 className="text-sm font-bold text-white mb-1">Current Session Token</h3>
                                            <p className="text-xs text-zinc-500 mb-3">Your current authentication token. Use this for API requests.</p>
                                            <div className="bg-[#111111] p-4 rounded-xl border border-[#2e2e2e] font-mono text-xs text-zinc-400 flex items-center justify-between gap-3">
                                                <code className="break-all whitespace-pre-wrap flex-1">{connectionInfo.sessionToken}</code>
                                                <button onClick={() => handleCopy(connectionInfo.sessionToken, 'sessionToken')} className="ml-4 p-2 bg-[#1a1a1a] rounded-lg border border-[#2e2e2e] hover:border-primary/50 transition-all">
                                                    {copied === 'sessionToken' ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                                                </button>
                                            </div>
                                        </div>

                                        <div>
                                            <h3 className="text-sm font-bold text-white mb-1">Service Role Key</h3>
                                            <p className="text-xs text-zinc-500 mb-3">This key has full access to your data. Keep it secret and never expose it in client-side code.</p>
                                            <div className="bg-[#111111] p-4 rounded-xl border border-red-500/20 font-mono text-xs text-zinc-400 flex items-center justify-between">
                                                <code className="truncate">{connectionInfo.serviceKey}</code>
                                                {connectionInfo.canViewSecrets && connectionInfo.serviceKey !== 'Contact admin for service role key' && (
                                                    <button onClick={() => handleCopy(connectionInfo.serviceKey, 'serviceKey')} className="ml-4 p-2 bg-[#1a1a1a] rounded-lg border border-[#2e2e2e] hover:border-primary/50 transition-all">
                                                        {copied === 'serviceKey' ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>

                <div className="px-6 py-4 border-t border-[#2e2e2e] bg-[#111111] flex items-center justify-between">
                    <a href="https://docs.ozybase.dev/connect/postgres" target="_blank" rel="noreferrer" className="text-xs text-zinc-500 hover:text-primary transition-colors flex items-center gap-2">
                        <ExternalLink size={12} />
                        Learn how to connect to your Postgres databases
                    </a>
                    <button onClick={onClose} className="px-4 py-2 bg-[#2e2e2e] hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-bold uppercase tracking-widest transition-all">
                        Close
                    </button>
                </div>
            </div>

            <style
                dangerouslySetInnerHTML={{
                    __html: `
                    @keyframes modalOverlayIn {
                        from { opacity: 0; }
                        to { opacity: 1; }
                    }
                    @keyframes modalPanelIn {
                        from {
                            opacity: 0;
                            transform: translateY(14px) scale(0.98);
                        }
                        to {
                            opacity: 1;
                            transform: translateY(0) scale(1);
                        }
                    }
                    .modal-overlay-enter {
                        animation: modalOverlayIn 180ms ease-out;
                    }
                    .modal-panel-enter {
                        animation: modalPanelIn 220ms cubic-bezier(0.22, 1, 0.36, 1);
                    }
                    .custom-scrollbar::-webkit-scrollbar {
                        width: 6px;
                    }
                    .custom-scrollbar::-webkit-scrollbar-track {
                        background: transparent;
                    }
                    .custom-scrollbar::-webkit-scrollbar-thumb {
                        background: #2e2e2e;
                        border-radius: 10px;
                    }
                `,
                }}
            />
        </div>
    );
};

export default ConnectionModal;

