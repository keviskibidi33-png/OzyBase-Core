import React, { useEffect, useState } from "react";
import { Check, Copy, Database, Key, Loader2, X } from "lucide-react";
import { fetchWithAuth } from "../utils/api";

interface ConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ConnectionInfo {
  database?: string;
  host?: string;
  port?: string;
  user?: string;
  api_url?: string;
  direct_uri_template?: string;
  pooler_uri_template?: string;
}

const ConnectionModal: React.FC<ConnectionModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<"connection" | "api">(
    "connection",
  );
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState<ConnectionInfo | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setLoading(true);
    fetchWithAuth("/api/project/connection")
      .then((res) => res.json())
      .then((data) => setConnection(data))
      .catch((error) =>
        console.error("Failed to fetch project connection:", error),
      )
      .finally(() => setLoading(false));
  }, [isOpen]);

  const copyValue = async (value: string, key: string) => {
    if (!value) {
      return;
    }
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1200);
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="absolute inset-0 ozy-overlay-backdrop backdrop-blur-md"
        onClick={onClose}
      />
      <div className="ozy-dialog-panel w-full max-w-4xl max-h-[85vh]">
        <div className="px-6 py-4 border-b border-[#2e2e2e] flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-white uppercase tracking-tight">
              Connect to your project
            </h2>
            <p className="text-xs text-zinc-500 mt-1">
              Safe connection metadata only. Passwords and project secret keys
              are never exposed here.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-zinc-500 hover:text-white transition-colors rounded-lg hover:bg-zinc-800"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-3 border-b border-[#2e2e2e] flex gap-2">
          {[
            ["connection", "Connection"],
            ["api", "API"],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setActiveTab(id as "connection" | "api")}
              className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${activeTab === id ? "bg-primary text-black" : "text-zinc-500 hover:text-white hover:bg-zinc-800"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="p-6 overflow-y-auto max-h-[60vh] custom-scrollbar">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-primary" size={32} />
            </div>
          ) : activeTab === "connection" ? (
            <div className="space-y-6">
              {[
                ["Direct URI", connection?.direct_uri_template || "", "direct"],
                ["Pooler URI", connection?.pooler_uri_template || "", "pooler"],
              ].map(([label, value, key]) => (
                <div
                  key={key}
                  className="bg-[#111111] p-4 rounded-xl border border-[#2e2e2e]"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">
                        {label}
                      </p>
                      <code className="text-xs text-zinc-300 break-all">
                        {value}
                      </code>
                    </div>
                    <button
                      onClick={() => void copyValue(value, key)}
                      className="p-2 bg-[#1a1a1a] rounded-lg border border-[#2e2e2e] hover:border-primary/50 transition-all text-zinc-400 hover:text-white shrink-0"
                    >
                      {copied === key ? (
                        <Check size={14} className="text-green-500" />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                  </div>
                </div>
              ))}

              <div className="bg-[#111111] rounded-xl border border-[#2e2e2e] overflow-hidden">
                <table className="w-full">
                  <tbody className="divide-y divide-[#2e2e2e]/50 text-xs">
                    {[
                      ["Database", connection?.database || ""],
                      ["Host", connection?.host || ""],
                      ["Port", connection?.port || ""],
                      ["User", connection?.user || ""],
                    ].map(([label, value]) => (
                      <tr key={label} className="hover:bg-zinc-900/30">
                        <td className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest w-28">
                          {label}
                        </td>
                        <td className="px-4 py-3 text-zinc-300 font-mono">
                          {value}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => void copyValue(value, label)}
                            className="p-1 text-zinc-600 hover:text-white"
                          >
                            {copied === label ? (
                              <Check size={12} className="text-green-500" />
                            ) : (
                              <Copy size={12} />
                            )}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="bg-[#111111] p-4 rounded-xl border border-[#2e2e2e]">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">
                      API URL
                    </p>
                    <code className="text-xs text-zinc-300 break-all">
                      {connection?.api_url}
                    </code>
                  </div>
                  <button
                    onClick={() =>
                      void copyValue(connection?.api_url || "", "api-url")
                    }
                    className="p-2 bg-[#1a1a1a] rounded-lg border border-[#2e2e2e] hover:border-primary/50 transition-all text-zinc-400 hover:text-white shrink-0"
                  >
                    {copied === "api-url" ? (
                      <Check size={14} className="text-green-500" />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                </div>
              </div>

              <div className="bg-[#111111] p-4 rounded-xl border border-[#2e2e2e]">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">
                      Current Session Token
                    </p>
                    <code className="text-xs text-zinc-300 break-all">
                      {localStorage.getItem("ozy_token") ||
                        "No active session token"}
                    </code>
                  </div>
                  <button
                    onClick={() =>
                      void copyValue(
                        localStorage.getItem("ozy_token") || "",
                        "session-token",
                      )
                    }
                    className="p-2 bg-[#1a1a1a] rounded-lg border border-[#2e2e2e] hover:border-primary/50 transition-all text-zinc-400 hover:text-white shrink-0"
                  >
                    {copied === "session-token" ? (
                      <Check size={14} className="text-green-500" />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                </div>
              </div>

              <div className="bg-[#111111] p-4 rounded-xl border border-[#2e2e2e]">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500">
                    <Key size={16} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white mb-1">
                      Project Keys
                    </h3>
                    <p className="text-xs text-zinc-500 leading-relaxed">
                      Publishable and secret keys are managed from Settings
                      after the quick admin verification step. Raw database
                      passwords remain intentionally hidden from the UI.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[#2e2e2e] bg-[#111111] flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <Database size={12} />
            {connection?.database || "project"}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[#2e2e2e] hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-bold uppercase tracking-widest transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConnectionModal;
