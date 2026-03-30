import React, { useState, useEffect } from 'react';
import { BookOpen, FileText, Code, Shield, Database, FolderOpen, Zap, MousePointer2, Copy, Check, Loader2, ChevronRight, Hash, Key, ToggleLeft, Calendar, Type, FileJson, Search, Lock, Globe } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

const ApiDocs = ({ page = 'intro' }: any) => {
    const [schema, setSchema] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [copied, setCopied] = useState<any>(null);
    const [tableSearch, setTableSearch] = useState('');

    useEffect(() => {
        const fetchSchema = async () => {
            try {
                const res = await fetchWithAuth('/api/collections/visualize');
                const data = await res.json();
                setSchema(data);
            } catch (error) {
                console.error(error);
            } finally {
                setLoading(false);
            }
        };
        fetchSchema();
    }, []);

    const copyToClipboard = (text: any, id: any) => {
        navigator.clipboard.writeText(text);
        setCopied(id);
        setTimeout(() => setCopied(null), 2000);
    };

    const getColumnIcon = (type: any) => {
        const t = (type || '').toLowerCase();
        if (t.includes('uuid')) return <Key size={14} className="text-yellow-500" />;
        if (t.includes('int') || t.includes('num')) return <Hash size={14} className="text-blue-400" />;
        if (t.includes('bool')) return <ToggleLeft size={14} className="text-green-400" />;
        if (t.includes('time') || t.includes('date')) return <Calendar size={14} className="text-purple-400" />;
        if (t.includes('json')) return <FileJson size={14} className="text-orange-400" />;
        return <Type size={14} className="text-zinc-400" />;
    };

    const getContent = () => {
        if (loading) return (
            <div className="flex flex-col items-center justify-center h-64 text-zinc-500 gap-4">
                <Loader2 className="animate-spin text-primary" size={32} />
                <span className="text-[10px] font-black uppercase tracking-widest">Compiling Documentation...</span>
            </div>
        );

        if (page === 'db_api') {
            return (
                <div className="space-y-12">
                    <div className="p-8 bg-[#111111] border border-[#2e2e2e] rounded-3xl">
                        <h2 className="text-2xl font-black text-white mb-4 uppercase tracking-tighter italic">Database REST API</h2>
                        <p className="text-zinc-400 mb-6 leading-relaxed">
                            OzyBase automatically generates a full RESTful API for every table in your database.
                            Endpoints are protected by Row Level Security and API Keys.
                        </p>
                        <div className="relative max-w-md">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={14} />
                            <input
                                type="text"
                                placeholder="Search tables (e.g. users, products)..."
                                value={tableSearch}
                                onChange={(e: any) => setTableSearch(e.target.value)}
                                className="w-full bg-[#0c0c0c] border border-[#2e2e2e] rounded-xl pl-10 pr-4 py-2.5 text-xs text-white focus:outline-none focus:border-primary/50 transition-all font-medium"
                            />
                        </div>
                    </div>

                    {schema?.tables?.filter((t: any) => t.name.toLowerCase().includes(tableSearch.toLowerCase())).map((table: any) => (
                        <div key={table.name} className="space-y-6">
                            <div className="flex items-center gap-3 border-b border-[#2e2e2e] pb-4">
                                <Database className="text-primary" size={20} />
                                <h3 className="text-xl font-black text-white uppercase tracking-tight">{table.name}</h3>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                <div className="space-y-6">
                                    <div>
                                        <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-4">Columns & Types</h4>
                                        <div className="bg-[#111111] border border-[#2e2e2e] rounded-2xl overflow-hidden">
                                            {table.columns.map((col: any, i: any) => (
                                                <div key={i} className={`flex items-center justify-between px-4 py-3 text-xs border-b border-[#2e2e2e] last:border-0 hover:bg-zinc-900/50 transition-colors`}>
                                                    <div className="flex items-center gap-3">
                                                        {getColumnIcon(col.type)}
                                                        <span className="font-mono text-zinc-200">{col.name}</span>
                                                    </div>
                                                    <span className="text-[10px] font-mono text-zinc-600 uppercase">{col.type}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-6">
                                    <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-4">Usage Example</h4>

                                    {/* GET Example */}
                                    <div className="bg-[#0c0c0c] border border-[#2e2e2e] rounded-2xl overflow-hidden">
                                        <div className="px-4 py-2 bg-[#1a1a1a] border-b border-[#2e2e2e] flex items-center justify-between">
                                            <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">GET List</span>
                                            <button onClick={() => copyToClipboard(`curl -X GET 'https://api.ozybase.io/api/tables/${table.name}'`, `get-${table.name}`)} className="text-zinc-500 hover:text-white transition-colors">
                                                {copied === `get-${table.name}` ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                                            </button>
                                        </div>
                                        <div className="p-4 overflow-x-auto">
                                            <pre className="text-[11px] font-mono text-blue-400">
                                                <code>GET /api/tables/{table.name}</code>
                                            </pre>
                                        </div>
                                    </div>

                                    {/* POST Example */}
                                    <div className="bg-[#0c0c0c] border border-[#2e2e2e] rounded-2xl overflow-hidden">
                                        <div className="px-4 py-2 bg-[#1a1a1a] border-b border-[#2e2e2e] flex items-center justify-between">
                                            <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Insert Row</span>
                                            <button onClick={() => copyToClipboard(`fetch('/api/tables/${table.name}', { method: 'POST', body: JSON.stringify({...}) })`, `post-${table.name}`)} className="text-zinc-500 hover:text-white transition-colors">
                                                {copied === `post-${table.name}` ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                                            </button>
                                        </div>
                                        <div className="p-4 overflow-x-auto">
                                            <pre className="text-[11px] font-mono text-green-400">
                                                <code>POST /api/tables/{table.name}</code>
                                            </pre>
                                            <pre className="text-[10px] font-mono text-zinc-500 mt-2">
                                                {`{
  ${table.columns.slice(0, 2).map((c: any) => `"${c.name}": "value"`).join(',\n  ')}
}`}
                                            </pre>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            );
        }

        switch (page) {
            case 'intro':
                return (
                    <div className="space-y-6">
                        <div className="p-8 bg-[#111111] border border-[#2e2e2e] rounded-3xl">
                            <h2 className="text-2xl font-black text-white mb-4 uppercase tracking-tighter italic">Introduction</h2>
                            <p className="text-zinc-400 mb-6 leading-relaxed">
                                Welcome to the OzyBase API documentation. OzyBase provides a complete backend-as-a-service
                                interface including database management, authentication, storage, and edge functions.
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="p-6 bg-[#171717] rounded-2xl border border-[#2e2e2e] hover:border-primary/50 transition-all group">
                                    <div className="w-10 h-10 bg-primary/10 border border-primary/20 rounded-xl flex items-center justify-center mb-4 text-primary group-hover:scale-110 transition-transform">
                                        <Zap size={20} />
                                    </div>
                                    <h3 className="text-sm font-bold text-white mb-2">REST API</h3>
                                    <p className="text-xs text-zinc-500 leading-relaxed">Auto-generated endpoints for all your tables with full CRUD support and query filtering.</p>
                                </div>
                                <div className="p-6 bg-[#171717] rounded-2xl border border-[#2e2e2e] hover:border-primary/50 transition-all group">
                                    <div className="w-10 h-10 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-center justify-center mb-4 text-blue-500 group-hover:scale-110 transition-transform">
                                        <MousePointer2 size={20} />
                                    </div>
                                    <h3 className="text-sm font-bold text-white mb-2">Realtime</h3>
                                    <p className="text-xs text-zinc-500 leading-relaxed">Subscribe to database changes via WebSocket. Instant updates for any table.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            case 'auth_api':
                return (
                    <div className="space-y-8 animate-in fade-in duration-500">
                        <div className="p-8 bg-[#111111] border border-[#2e2e2e] rounded-3xl">
                            <h2 className="text-2xl font-black text-white mb-4 uppercase tracking-tighter italic">Authentication API</h2>
                            <p className="text-zinc-400 mb-6 leading-relaxed">
                                OzyBase uses JWT (JSON Web Tokens) for secure, stateless authentication. 
                                Tokens are valid for 72 hours and include the user's ID and role.
                            </p>

                            <div className="grid grid-cols-1 gap-6">
                                {/* JWT Info */}
                                <div className="p-6 bg-primary/5 border border-primary/20 rounded-2xl">
                                    <div className="flex items-center gap-2 mb-3">
                                        <Lock size={16} className="text-primary" />
                                        <h4 className="text-[10px] font-black text-white uppercase tracking-widest">JWT Structure</h4>
                                    </div>
                                    <div className="font-mono text-[10px] text-zinc-400 space-y-1">
                                        <p>{"{"}</p>
                                        <p className="pl-4">"user_id": "uuid-v4",</p>
                                        <p className="pl-4">"role": "user | admin",</p>
                                        <p className="pl-4">"exp": 1700000000</p>
                                        <p>{"}"}</p>
                                    </div>
                                </div>

                                {/* Main Endpoints */}
                                <div className="space-y-4">
                                    <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Core Endpoints</h4>
                                    
                                    <div className="space-y-3">
                                        {/* Login */}
                                        <div className="p-4 bg-[#0c0c0c] rounded-xl border border-[#2e2e2e] group hover:border-green-500/30 transition-all">
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-3">
                                                    <span className="bg-green-500/20 text-green-500 text-[9px] font-black px-2 py-0.5 rounded">POST</span>
                                                    <code className="text-zinc-200 text-xs font-mono font-bold">/api/auth/login</code>
                                                </div>
                                                <button onClick={() => copyToClipboard(`curl -X POST /api/auth/login -d '{"email":"..","password":".."}'`, 'auth-login')} className="text-zinc-600 hover:text-white transition-colors">
                                                    {copied === 'auth-login' ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                                                </button>
                                            </div>
                                            <p className="text-[11px] text-zinc-500">Authenticate user and receive a JWT token.</p>
                                        </div>

                                        {/* Reset Password */}
                                        <div className="p-4 bg-[#0c0c0c] rounded-xl border border-[#2e2e2e] group hover:border-blue-500/30 transition-all">
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-3">
                                                    <span className="bg-blue-500/20 text-blue-500 text-[9px] font-black px-2 py-0.5 rounded">POST</span>
                                                    <code className="text-zinc-200 text-xs font-mono font-bold">/api/auth/reset-password</code>
                                                </div>
                                            </div>
                                            <p className="text-[11px] text-zinc-500">Request a recovery token via email. Tokens expire in 1 hour.</p>
                                        </div>

                                        {/* OAuth */}
                                        <div className="p-4 bg-[#0c0c0c] rounded-xl border border-[#2e2e2e] group hover:border-orange-500/30 transition-all">
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-3">
                                                    <span className="bg-orange-500/20 text-orange-500 text-[9px] font-black px-2 py-0.5 rounded">GET</span>
                                                    <code className="text-zinc-200 text-xs font-mono font-bold">/api/auth/:provider</code>
                                                </div>
                                            </div>
                                            <p className="text-[11px] text-zinc-500">Redirect to OAuth provider (Google, GitHub, Discord). Handles automatic user creation.</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            case 'storage_api':
                return (
                    <div className="space-y-8 animate-in fade-in duration-500">
                        <div className="p-8 bg-[#111111] border border-[#2e2e2e] rounded-3xl">
                            <h2 className="text-2xl font-black text-white mb-4 uppercase tracking-tighter italic">Storage API</h2>
                            <p className="text-zinc-400 mb-6 leading-relaxed">
                                Manage large files like images, videos, and documents. OzyBase supports 
                                **Public Buckets** for static assets and **Private Buckets** with fine-grained RLS policies.
                            </p>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                                <div className="p-6 bg-green-500/5 border border-green-500/20 rounded-2xl">
                                    <div className="flex items-center gap-2 mb-3">
                                        <Globe size={16} className="text-green-500" />
                                        <h4 className="text-[10px] font-black text-white uppercase tracking-widest">Public Access</h4>
                                    </div>
                                    <p className="text-xs text-zinc-500 leading-relaxed">Files in public buckets can be accessed directly via URL without authentication.</p>
                                </div>
                                <div className="p-6 bg-red-500/5 border border-red-500/20 rounded-2xl">
                                    <div className="flex items-center gap-2 mb-3">
                                        <Shield size={16} className="text-red-500" />
                                        <h4 className="text-[10px] font-black text-white uppercase tracking-widest">RLS Protected</h4>
                                    </div>
                                    <p className="text-xs text-zinc-500 leading-relaxed">Enable RLS to restrict file access to specific users (e.g., `auth.uid() == owner_id`).</p>
                                </div>
                            </div>

                            <div className="space-y-8">
                                {/* Bucket Management */}
                                <div>
                                    <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-4">Bucket Management</h4>
                                    <div className="space-y-3">
                                        <div className="p-4 bg-[#0c0c0c] rounded-xl border border-[#2e2e2e]">
                                            <div className="flex items-center gap-3 mb-2">
                                                <span className="bg-blue-500/20 text-blue-500 text-[9px] font-black px-2 py-0.5 rounded">GET</span>
                                                <code className="text-zinc-200 text-xs font-mono font-bold">/api/files/buckets</code>
                                            </div>
                                            <p className="text-[11px] text-zinc-500">List all storage buckets and their configurations.</p>
                                        </div>
                                        <div className="p-4 bg-[#0c0c0c] rounded-xl border border-[#2e2e2e]">
                                            <div className="flex items-center gap-3 mb-2">
                                                <span className="bg-green-500/20 text-green-500 text-[9px] font-black px-2 py-0.5 rounded">POST</span>
                                                <code className="text-zinc-200 text-xs font-mono font-bold">/api/files/buckets</code>
                                            </div>
                                            <div className="bg-black/40 p-3 rounded-lg mt-3 font-mono text-[10px] text-zinc-500 italic">
                                                {"{ \"name\": \"avatars\", \"public\": true, \"rls_enabled\": false }"}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* File Operations */}
                                <div>
                                    <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-4">File Operations</h4>
                                    <div className="bg-black/40 border border-[#2e2e2e] rounded-2xl overflow-hidden shadow-2xl">
                                        <div className="px-4 py-3 bg-[#1a1a1a] border-b border-[#2e2e2e] flex items-center justify-between">
                                            <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Upload File (cURL)</span>
                                            <button onClick={() => copyToClipboard(`curl -X POST /api/files?bucket=avatars \\\n  -F "file=@/path/to/image.png" \\\n  -H "Authorization: Bearer YOUR_TOKEN"`, 'storage-upload')} className="text-zinc-600 hover:text-white transition-colors">
                                                {copied === 'storage-upload' ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                                            </button>
                                        </div>
                                        <div className="p-5 overflow-x-auto">
                                            <pre className="text-[11px] font-mono leading-relaxed">
                                                <code className="text-primary">POST</code> <code className="text-zinc-300">/api/files?bucket=avatars</code><br/>
                                                <br/>
                                                <code className="text-zinc-500"># Form Data Payload</code><br/>
                                                <code className="text-white">file: </code> <code className="text-green-400">[BINARY_FILE]</code><br/>
                                                <br/>
                                                <code className="text-zinc-500"># Response</code><br/>
                                                <code className="text-white">{"{ \"id\": \"...\", \"url\": \"/api/files/my-avatar.png\" }"}</code>
                                            </pre>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            case 'realtime_api':
                return (
                    <div className="space-y-8 animate-in fade-in duration-500">
                        <div className="p-8 bg-[#111111] border border-[#2e2e2e] rounded-3xl">
                            <h2 className="text-2xl font-black text-white mb-4 uppercase tracking-tighter italic">Realtime API</h2>
                            <p className="text-zinc-400 mb-6 leading-relaxed">
                                Subscribe to database changes in real-time using Server-Sent Events (SSE). 
                                No complex WebSocket handshakes required - just a simple, persistent connection.
                            </p>
                            
                            <div className="p-6 bg-[#0c0c0c] rounded-2xl border border-[#2e2e2e] mb-8">
                                <div className="flex items-center gap-3 mb-4">
                                    <span className="bg-blue-500/20 text-blue-500 text-[10px] font-black px-2 py-0.5 rounded uppercase">Endpoint</span>
                                    <code className="text-primary font-mono text-sm tracking-tight text-zinc-300">GET /api/realtime</code>
                                </div>
                                <p className="text-xs text-zinc-500 mb-6 font-medium">OzyBase broadcasts `INSERT`, `UPDATE`, and `DELETE` events for all tables automatically.</p>
                                
                                <div className="space-y-4">
                                    <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Client Implementation (JS)</h4>
                                    <div className="bg-black/40 border border-[#2e2e2e] rounded-xl overflow-hidden shadow-2xl">
                                        <div className="px-4 py-2 bg-[#1a1a1a] border-b border-[#2e2e2e] flex items-center justify-between">
                                            <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">example.js</span>
                                            <button onClick={() => copyToClipboard(`const source = new EventSource('/api/realtime');\n\nsource.onmessage = (event) => {\n  const payload = JSON.parse(event.data);\n  console.log('Update in table:', payload.table, payload.data);\n};`, 'sse-js')} className="text-zinc-500 hover:text-white transition-colors">
                                                {copied === 'sse-js' ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                                            </button>
                                        </div>
                                        <div className="p-4 overflow-x-auto">
                                            <pre className="text-[11px] font-mono leading-relaxed">
                                                <code className="text-blue-400">const</code> <code className="text-white">source = </code> <code className="text-blue-400">new</code> <code className="text-yellow-400">EventSource</code>( <code className="text-green-400">'/api/realtime'</code> );<br/>
                                                <br/>
                                                <code className="text-white">source.</code><code className="text-yellow-400">onmessage</code> <code className="text-white">= (event) ={'>'} {'{'}</code><br/>
                                                <code className="text-zinc-500">  // Payload format: {"{ table: string, data: any }"}</code><br/>
                                                <code className="text-blue-400">  const</code> <code className="text-white">payload = JSON.</code><code className="text-yellow-400">parse</code>(event.data);<br/>
                                                <code className="text-white">  console.</code><code className="text-yellow-400">log</code>(<code className="text-green-400">'Table:'</code>, payload.table, payload.data);<br/>
                                                <code className="text-white">{'}'};</code>
                                            </pre>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            case 'edge_api':
                return (
                    <div className="space-y-8 animate-in fade-in duration-500">
                        <div className="p-8 bg-[#111111] border border-[#2e2e2e] rounded-3xl">
                            <h2 className="text-2xl font-black text-white mb-4 uppercase tracking-tighter italic">Edge Functions</h2>
                            <p className="text-zinc-400 mb-6 leading-relaxed">
                                Deploy server-side JavaScript logic that runs instantly in our isolated Goja runtime. 
                                Perfect for complex data validation, third-party integrations, or private workflows.
                            </p>

                            <div className="grid grid-cols-1 gap-6">
                                <div className="p-6 bg-[#0c0c0c] rounded-2xl border border-[#2e2e2e]">
                                    <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-4">Runtime Environment</h4>
                                    <ul className="space-y-3">
                                        <li className="flex items-start gap-3">
                                            <div className="w-5 h-5 bg-primary/10 rounded flex items-center justify-center border border-primary/20 mt-0.5 shrink-0">
                                                <Zap size={10} className="text-primary" />
                                            </div>
                                            <div className="text-xs">
                                                <p className="text-zinc-200 font-bold mb-1 italic uppercase tracking-tighter">Global context</p>
                                                <p className="text-zinc-500">The request body is globally available as `body` object.</p>
                                            </div>
                                        </li>
                                        <li className="flex items-start gap-3">
                                            <div className="w-5 h-5 bg-blue-500/10 rounded flex items-center justify-center border border-blue-500/20 mt-0.5 shrink-0">
                                                <Database size={10} className="text-blue-500" />
                                            </div>
                                            <div className="text-xs">
                                                <p className="text-zinc-200 font-bold mb-1 italic uppercase tracking-tighter">DB Access</p>
                                                <p className="text-zinc-500">Run queries using `ozy.query(sql, ...args)`.</p>
                                            </div>
                                        </li>
                                    </ul>
                                </div>

                                <div className="space-y-4">
                                    <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Example Script</h4>
                                    <div className="bg-black/40 border border-[#2e2e2e] rounded-2xl overflow-hidden shadow-2xl">
                                        <div className="px-4 py-3 bg-[#1a1a1a] border-b border-[#2e2e2e] flex items-center justify-between">
                                            <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">validate_order.js</span>
                                            <button onClick={() => copyToClipboard(`// Fetch current stock from DB\nconst items = ozy.query("SELECT * FROM products WHERE id = $1", body.product_id);\n\nif (items && items.length > 0 && items[0].stock > 0) {\n  return { success: true, message: "Stock confirmed" };\n} else {\n  throw new Error("Out of stock");\n}`, 'edge-js')} className="text-zinc-500 hover:text-white transition-colors">
                                                {copied === 'edge-js' ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                                            </button>
                                        </div>
                                        <div className="p-5 overflow-x-auto">
                                            <pre className="text-[11px] font-mono leading-relaxed">
                                                <code className="text-zinc-500">// Fetch current stock from DB</code><br/>
                                                <code className="text-blue-400">const</code> <code className="text-white">items = ozy.</code><code className="text-yellow-400">query</code>(<code className="text-green-400">"SELECT * FROM products WHERE id = $1"</code>, body.product_id);<br/>
                                                <br/>
                                                <code className="text-blue-400">if</code> (items && items.length {'>'} <code className="text-orange-400">0</code> && items[<code className="text-orange-400">0</code>].stock {'>'} <code className="text-orange-400">0</code>) {'{'}<br/>
                                                <code className="text-blue-400">  return</code> {'{'} success: <code className="text-blue-400">true</code>, message: <code className="text-green-400">"Stock confirmed"</code> {'}'};<br/>
                                                {'}'} <code className="text-blue-400">else</code> {'{'}<br/>
                                                <code className="text-blue-400">  throw new</code> <code className="text-yellow-400">Error</code>(<code className="text-green-400">"Out of stock"</code>);<br/>
                                                {'}'}
                                            </pre>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            case 'sdk':
                return (
                    <div className="space-y-8 animate-in fade-in duration-500">
                        <div className="p-8 bg-[#111111] border border-[#2e2e2e] rounded-3xl">
                            <h2 className="text-2xl font-black text-white mb-4 uppercase tracking-tighter italic">Client SDKs</h2>
                            <p className="text-zinc-400 mb-8 leading-relaxed">
                                Use our lightweight JS pattern to interact with OzyBase in seconds. 
                                We prioritize simplicity and performance over heavy libraries.
                            </p>

                            <div className="space-y-6">
                                <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Base OzyClient Pattern</h4>
                                <div className="bg-black/40 border border-[#2e2e2e] rounded-2xl overflow-hidden shadow-2xl">
                                    <div className="px-4 py-3 bg-[#1a1a1a] border-b border-[#2e2e2e] flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-red-500" />
                                            <div className="w-2 h-2 rounded-full bg-yellow-500" />
                                            <div className="w-2 h-2 rounded-full bg-green-500" />
                                            <span className="ml-2 text-[9px] font-black uppercase tracking-widest text-zinc-600">OzyClient.js</span>
                                        </div>
                                        <button onClick={() => copyToClipboard(`class OzyClient {\n  constructor(url, token) {\n    this.url = url;\n    this.token = token;\n  }\n\n  async table(name) {\n    const res = await fetch(\`\${this.url}/api/tables/\${name}\`, {\n      headers: { 'Authorization': \`Bearer \${this.token}\` }\n    });\n    return res.json();\n  }\n}`, 'sdk-js')} className="text-zinc-500 hover:text-white transition-colors">
                                            {copied === 'sdk-js' ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                                        </button>
                                    </div>
                                    <div className="p-5 overflow-x-auto">
                                        <pre className="text-[11px] font-mono leading-relaxed">
                                            <code className="text-blue-400">class</code> <code className="text-yellow-400">OzyClient</code> {'{'}<br/>
                                            <code className="text-blue-400">  constructor</code>(url, key) {'{'}<br/>
                                            <code className="text-blue-400">    this</code>.url = url;<br/>
                                            <code className="text-blue-400">    this</code>.key = key;<br/>
                                            <code className="text-white">  {'}'}</code><br/>
                                            <br/>
                                            <code className="text-blue-400">  async</code> <code className="text-yellow-400">from</code>(table) {'{'}<br/>
                                            <code className="text-blue-400">    const</code> res = <code className="text-blue-400">await</code> <code className="text-yellow-400">fetch</code>(`$<code className="text-white">{'{this.url}'}</code>/api/tables/$<code className="text-white">{'{table}'}</code>`, {'{'}<br/>
                                            <code className="text-white">      headers: {'{'} </code> <code className="text-green-400">'X-Ozy-API-Key'</code>: <code className="text-blue-400">this</code>.key <code className="text-white">{'}'}</code><br/>
                                            <code className="text-white">    {'}'}</code>);<br/>
                                            <code className="text-blue-400">    return</code> res.<code className="text-yellow-400">json</code>();<br/>
                                            <code className="text-white">  {'}'}</code><br/>
                                            <code className="text-white">{'}'}</code><br/>
                                            <br/>
                                            <code className="text-zinc-500">// Usage</code><br/>
                                            <code className="text-blue-400">const</code> <code className="text-white">ozy = </code> <code className="text-blue-400">new</code> <code className="text-yellow-400">OzyClient</code>(<code className="text-green-400">'https://api.ozy.io'</code>, <code className="text-green-400">'YOUR_KEY'</code>);<br/>
                                            <code className="text-blue-400">const</code> <code className="text-white">{'{ data }'} = </code> <code className="text-blue-400">await</code> ozy.<code className="text-yellow-400">from</code>(<code className="text-green-400">'users'</code>);
                                        </pre>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            default:
                return (
                    <div className="flex flex-col items-center justify-center min-h-[50vh] text-zinc-500">
                        <FileText size={48} className="mb-4 opacity-20" />
                        <h2 className="text-xl font-black uppercase tracking-widest opacity-50">Documentation</h2>
                        <p className="text-xs font-mono mt-2">Select a topic from the sidebar</p>
                    </div>
                );
        }
    };

    return (
        <div className="flex flex-col h-full bg-[#171717] animate-in fade-in duration-500 overflow-hidden">
            {/* Header */}
            <div className="px-8 py-10 border-b border-[#2e2e2e] bg-[#1a1a1a]">
                <div className="flex items-center gap-6">
                    <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center border border-primary/20">
                        <BookOpen className="text-primary" size={28} />
                    </div>
                    <div>
                        <h1 className="text-3xl font-black text-white uppercase tracking-tighter italic">API Documentation</h1>
                        <p className="text-zinc-500 text-sm font-medium uppercase tracking-[0.2em] text-[10px] mt-1 flex items-center gap-2">
                            <Code size={12} className="text-blue-500" />
                            Auto-Generated Reference v1.0
                        </p>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="p-8 flex-1 overflow-auto custom-scrollbar bg-[#0c0c0c]">
                <div className="max-w-6xl mx-auto">
                    {getContent()}
                </div>
            </div>
        </div>
    );
};

export default ApiDocs;

