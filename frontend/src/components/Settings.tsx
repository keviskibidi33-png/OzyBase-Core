import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  CreditCard,
  Info,
  Key,
  Loader2,
  Server,
  Settings as SettingsIcon,
} from "lucide-react";
import { fetchWithAuth } from "../utils/api";
import EssentialApiKeysPanel from "./EssentialApiKeysPanel";
import ModulePageHero from "./ModulePageHero";

const MENU_ITEMS = [
  { id: "general", name: "General", icon: SettingsIcon },
  { id: "infrastructure", name: "Infrastructure", icon: Server },
  { id: "billing", name: "Billing", icon: CreditCard },
  { id: "api_keys", name: "API Keys", icon: Key },
];

interface SettingsProps {
  view?: string;
  onViewSelect?: (view: string) => void;
}

interface ProjectInfo {
  database?: string;
  version?: string;
  production?: ProductionReadiness;
}

interface ProductionReadiness {
  status?: string;
  launch_ready?: boolean;
  mvp_ready?: boolean;
  saas_ready?: boolean;
  profile?: string;
  deployment_mode?: string;
  storage_runtime?: string;
  realtime_runtime?: string;
  strict_security?: boolean;
  managed_secrets?: boolean;
  https_site_url?: boolean;
  placeholder_domains?: boolean;
  smtp_configured?: boolean;
  pooler_configured?: boolean;
  warnings?: string[];
}

interface ConnectionInfo {
  host?: string;
  port?: string;
  database?: string;
  user?: string;
  api_url?: string;
  direct_uri_template?: string;
  pooler_uri_template?: string;
  app_version?: string;
  git_commit?: string;
}

const formatDeploymentProfile = (profile?: string) => {
  switch (profile) {
    case "azure_cloud":
      return "Private Cloud";
    case "install_to_play":
      return "Install to Play";
    case "custom":
      return "Custom Runtime";
    case "self_host":
    default:
      return "Self-host";
  }
};

const formatRuntimeLabel = (value?: string) => {
  switch (value) {
    case "s3":
      return "S3 Compatible";
    case "redis":
      return "Redis Cluster";
    case "local":
      return "Local Node";
    default:
      return value || "unknown";
  }
};

const Settings: React.FC<SettingsProps> = ({
  view = "general",
  onViewSelect,
}) => {
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null);
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  const currentView = useMemo(
    () => (MENU_ITEMS.some((item) => item.id === view) ? view : "general"),
    [view],
  );

  const copyValue = async (value: string | undefined, key: string) => {
    if (!value) {
      return;
    }
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1500);
  };

  const loadProjectData = async () => {
    setLoading(true);
    try {
      const [infoRes, connectionRes] = await Promise.all([
        fetchWithAuth("/api/project/info"),
        fetchWithAuth("/api/project/connection"),
      ]);
      const info = await infoRes.json();
      const connection = await connectionRes.json();
      setProjectInfo(info);
      setConnectionInfo(connection);
    } catch (error) {
      console.error("Failed to load project settings:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProjectData();
  }, []);

  const renderGeneral = () => (
    <div className="space-y-8 animate-in fade-in duration-300">
      <ModulePageHero
        eyebrow="Settings"
        title="General Settings"
        description="Review safe project metadata and readiness signals before exposing this instance to real traffic. This page keeps operational facts visible without surfacing dead controls."
        icon={SettingsIcon}
        pills={[
          {
            label: formatDeploymentProfile(projectInfo?.production?.profile),
            tone: "accent",
          },
          {
            label: projectInfo?.production?.launch_ready
              ? "launch ready"
              : "action required",
            tone: projectInfo?.production?.launch_ready ? "success" : "warning",
          },
          {
            label: projectInfo?.production?.strict_security
              ? "strict security on"
              : "security review needed",
            tone: projectInfo?.production?.strict_security
              ? "success"
              : "warning",
          },
        ]}
        stats={[
          {
            label: "Project ID",
            value: projectInfo?.database || "unknown",
            hint: "Useful for support, logs, and client configuration.",
          },
          {
            label: "Runtime Mode",
            value:
              projectInfo?.production?.deployment_mode === "external_postgres"
                ? "External Postgres"
                : "Embedded Postgres",
            hint: "Move to external Postgres when the project starts serving real traffic.",
          },
          {
            label: "Email Delivery",
            value: projectInfo?.production?.smtp_configured
              ? "SMTP ready"
              : "Console mailer",
            hint: "Customer-facing auth flows should use a real SMTP provider.",
          },
        ]}
      />

      <div className="bg-[#171717]/50 border border-[#2e2e2e] rounded-3xl overflow-hidden shadow-2xl">
        <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          {[
            {
              label: "Project ID",
              value: projectInfo?.database || "unknown",
              copyKey: "project-id",
            },
            {
              label: "Postgres Version",
              value: projectInfo?.version || "unknown",
            },
            {
              label: "App Version",
              value: connectionInfo?.app_version || "dev",
            },
            {
              label: "Git Commit",
              value: connectionInfo?.git_commit || "unknown",
            },
          ].map((item) => (
            <div
              key={item.label}
              className="bg-[#0c0c0c] border border-[#2e2e2e] rounded-2xl p-5"
            >
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">
                {item.label}
              </p>
              <div className="flex items-center justify-between gap-4">
                <code className="text-sm text-white break-all">
                  {item.value}
                </code>
                {item.copyKey && (
                  <button
                    onClick={() => void copyValue(item.value, item.copyKey)}
                    className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-white transition-colors"
                  >
                    {copied === item.copyKey ? (
                      <Check size={14} className="text-green-500" />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="px-8 py-5 border-t border-[#2e2e2e] bg-[#111111]/40">
          <div className="flex items-start gap-4">
            <Info size={16} className="text-primary mt-0.5" />
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Self-hosted mode does not expose mutable project lifecycle
              controls in the dashboard. Unsupported actions such as restart,
              pause or domain management are intentionally hidden.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-[#171717]/50 border border-[#2e2e2e] rounded-3xl overflow-hidden shadow-2xl">
        <div className="px-8 py-6 border-b border-[#2e2e2e] flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-black text-white uppercase tracking-tight">
              Production Readiness
            </h3>
            <p className="text-[11px] text-zinc-500 mt-1">
              Runtime checks for install-to-play, real-app MVPs, and more
              demanding SaaS deployments.
            </p>
          </div>
          <div
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] ${
              projectInfo?.production?.launch_ready
                ? "border-green-500/30 bg-green-500/10 text-green-400"
                : "border-amber-500/30 bg-amber-500/10 text-amber-300"
            }`}
          >
            {projectInfo?.production?.launch_ready ? "Launch Ready" : "Action Required"}
          </div>
        </div>

        <div className="p-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[
              {
                label: "Target Profile",
                value: formatDeploymentProfile(projectInfo?.production?.profile),
                ok: !!projectInfo?.production?.profile,
              },
              {
                label: "Database Runtime",
                value:
                  projectInfo?.production?.deployment_mode === "external_postgres"
                    ? "External Postgres"
                    : "Embedded Postgres",
                ok:
                  projectInfo?.production?.profile === "self_host" ||
                  projectInfo?.production?.profile === "install_to_play"
                    ? true
                    : projectInfo?.production?.deployment_mode === "external_postgres",
              },
              {
                label: "Connection Pooler",
                value: projectInfo?.production?.pooler_configured
                  ? "Configured"
                  : "Missing",
                ok:
                  projectInfo?.production?.profile === "self_host" ||
                  projectInfo?.production?.profile === "install_to_play"
                    ? true
                    : projectInfo?.production?.pooler_configured,
              },
              {
                label: "Storage Runtime",
                value: formatRuntimeLabel(projectInfo?.production?.storage_runtime),
                ok:
                  projectInfo?.production?.saas_ready === true
                    ? projectInfo?.production?.storage_runtime !== "local"
                    : true,
              },
              {
                label: "Realtime Broker",
                value: formatRuntimeLabel(projectInfo?.production?.realtime_runtime),
                ok:
                  projectInfo?.production?.saas_ready === true
                    ? projectInfo?.production?.realtime_runtime !== "local"
                    : true,
              },
              {
                label: "Strict Security",
                value: projectInfo?.production?.strict_security ? "Enabled" : "Disabled",
                ok: projectInfo?.production?.strict_security,
              },
              {
                label: "Managed Secrets",
                value: projectInfo?.production?.managed_secrets
                  ? "Static"
                  : "Auto-generated",
                ok: projectInfo?.production?.managed_secrets,
              },
              {
                label: "HTTPS Site URL",
                value: projectInfo?.production?.https_site_url ? "HTTPS" : "HTTP or missing",
                ok: projectInfo?.production?.https_site_url,
              },
              {
                label: "Transactional Email",
                value: projectInfo?.production?.smtp_configured
                  ? "SMTP ready"
                  : "Console mailer",
                ok:
                  projectInfo?.production?.profile === "self_host"
                    ? true
                    : projectInfo?.production?.smtp_configured,
              },
            ].map((item) => (
              <div
                key={item.label}
                className="bg-[#0c0c0c] border border-[#2e2e2e] rounded-2xl p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">
                      {item.label}
                    </p>
                    <p className="text-sm font-semibold text-white">{item.value}</p>
                  </div>
                  <div
                    className={`mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full border ${
                      item.ok
                        ? "border-green-500/30 bg-green-500/10 text-green-400"
                        : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                    }`}
                  >
                    {item.ok ? <Check size={14} /> : <AlertTriangle size={14} />}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {projectInfo?.production?.warnings &&
            projectInfo.production.warnings.length > 0 && (
              <div className="bg-[#0c0c0c] border border-amber-500/20 rounded-2xl p-5">
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-300 mb-3">
                  Readiness Gaps
                </p>
                <div className="space-y-2">
                  {projectInfo.production.warnings.map((warning) => (
                    <div
                      key={warning}
                      className="flex items-start gap-3 text-xs text-zinc-300"
                    >
                      <AlertTriangle size={14} className="mt-0.5 text-amber-300 shrink-0" />
                      <span>{warning}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          <div className="bg-[#0c0c0c] border border-[#2e2e2e] rounded-2xl p-5">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-3">
              Workload Track
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              {[
                {
                  label: "Install / Single Node",
                  detail: "Best for demos, internal tools, and low-friction deployments on one node.",
                  active: projectInfo?.production?.launch_ready,
                },
                {
                  label: "MVP / Real Apps",
                  detail: "Use external Postgres, HTTPS, managed secrets, and SMTP for customer-facing apps.",
                  active: projectInfo?.production?.mvp_ready,
                },
                {
                  label: "SaaS / Multi-Instance",
                  detail: "Add pooler, shared object storage, and distributed realtime before calling it cloud-grade.",
                  active: projectInfo?.production?.saas_ready,
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className={`rounded-2xl border p-4 ${
                    item.active
                      ? "border-primary/40 bg-primary/10 text-white"
                      : "border-[#2e2e2e] bg-[#111111] text-zinc-400"
                  }`}
                >
                  <p className="text-[10px] font-black uppercase tracking-widest mb-2">
                    {item.label}
                  </p>
                  <p className="leading-relaxed">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderInfrastructure = () => (
    <div className="space-y-8 animate-in fade-in duration-300">
      <ModulePageHero
        eyebrow="Settings"
        title="Infrastructure"
        description="Copy the connection endpoints your applications actually need. Passwords and project secrets stay hidden here so the screen remains safe to share during operations."
        icon={Server}
        pills={[
          {
            label: connectionInfo?.api_url ? "api endpoint ready" : "api endpoint missing",
            tone: connectionInfo?.api_url ? "success" : "warning",
          },
          {
            label: connectionInfo?.pooler_uri_template ? "pooler configured" : "pooler optional",
            tone: connectionInfo?.pooler_uri_template ? "accent" : "neutral",
          },
          {
            label: projectInfo?.production?.https_site_url ? "https configured" : "https pending",
            tone: projectInfo?.production?.https_site_url ? "success" : "warning",
          },
        ]}
        stats={[
          {
            label: "API URL",
            value: connectionInfo?.api_url || "not available",
            hint: "Frontend clients and admin tools should target this endpoint.",
          },
          {
            label: "Direct URI",
            value: connectionInfo?.direct_uri_template ? "Available" : "Missing",
            hint: "Use the direct URI for trusted backends and migrations.",
          },
          {
            label: "Pooler URI",
            value: connectionInfo?.pooler_uri_template ? "Available" : "Missing",
            hint: "Use a pooler when connection fan-out starts growing.",
          },
        ]}
      />

      <div className="bg-[#171717]/50 border border-[#2e2e2e] rounded-3xl overflow-hidden shadow-2xl">
        <div className="p-8 space-y-6">
          {[
            {
              label: "Direct URI",
              value: connectionInfo?.direct_uri_template,
              copyKey: "direct-uri",
            },
            {
              label: "Pooler URI",
              value: connectionInfo?.pooler_uri_template,
              copyKey: "pooler-uri",
              hint: connectionInfo?.pooler_uri_template
                ? undefined
                : "Set DB_POOLER_URL when using PgBouncer, Supavisor, or Azure connection pooling.",
            },
            {
              label: "API URL",
              value: connectionInfo?.api_url,
              copyKey: "api-url",
            },
          ].map((item) => (
            <div
              key={item.label}
              className="bg-[#0c0c0c] border border-[#2e2e2e] rounded-2xl p-5"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">
                    {item.label}
                  </p>
                  <code className="text-xs text-zinc-300 break-all">
                    {item.value || "not available"}
                  </code>
                  {item.hint && (
                    <p className="text-[11px] text-zinc-500 mt-2 max-w-2xl">
                      {item.hint}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => void copyValue(item.value, item.copyKey)}
                  className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-white transition-colors"
                >
                  {copied === item.copyKey ? (
                    <Check size={14} className="text-green-500" />
                  ) : (
                    <Copy size={14} />
                  )}
                </button>
              </div>
            </div>
          ))}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              ["Host", connectionInfo?.host],
              ["Port", connectionInfo?.port],
              ["Database", connectionInfo?.database],
              ["User", connectionInfo?.user],
            ].map(([label, value]) => (
              <div
                key={label}
                className="bg-[#0c0c0c] border border-[#2e2e2e] rounded-2xl p-5"
              >
                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">
                  {label}
                </p>
                <div className="flex items-center justify-between gap-4">
                  <code className="text-sm text-white break-all">
                    {value || "unknown"}
                  </code>
                  <button
                    onClick={() =>
                      void copyValue(
                        typeof value === "string" ? value : undefined,
                        String(label),
                      )
                    }
                    className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-white transition-colors"
                  >
                    {copied === label ? (
                      <Check size={14} className="text-green-500" />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const renderBilling = () => (
    <div className="space-y-8 animate-in fade-in duration-300">
      <ModulePageHero
        eyebrow="Settings"
        title="Billing"
        description="Self-hosted deployments do not attach a managed billing layer inside the dashboard. This section exists to explain that choice clearly instead of presenting controls that do nothing."
        icon={CreditCard}
        pills={[
          { label: "self-hosted billing", tone: "accent" },
          { label: "no managed invoices", tone: "neutral" },
          { label: "bring your own infra", tone: "neutral" },
        ]}
        stats={[
          {
            label: "Current Model",
            value: "External cost management",
            hint: "Cloud bills, object storage, and SMTP spend stay with your own providers.",
          },
          {
            label: "In-Dashboard Controls",
            value: "Informational only",
            hint: "OzyBase avoids dead billing actions when you are running self-hosted.",
          },
          {
            label: "Best For",
            value: "Operators and indie teams",
            hint: "Simple enough for small teams while still clear for enterprise handoff.",
          },
        ]}
      />
      <div className="bg-[#171717]/50 border border-[#2e2e2e] rounded-3xl p-8 shadow-2xl">
        <div className="flex items-start gap-4">
          <CreditCard size={18} className="text-primary mt-0.5" />
          <div>
            <h3 className="text-sm font-black text-white uppercase tracking-widest">
              No managed billing provider attached
            </h3>
            <p className="text-[11px] text-zinc-500 leading-relaxed mt-2">
              Resource planning, cloud invoices and external load balancer costs
              remain managed outside OzyBase in this deployment model. This
              section stays informational instead of exposing dead controls.
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  const renderApiKeys = () => <EssentialApiKeysPanel />;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-[#111111]">
        <Loader2 size={28} className="text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full bg-[#111111] animate-in fade-in duration-500 overflow-hidden">
      <div className="w-64 border-r border-[#2e2e2e] bg-[#0c0c0c] flex flex-col flex-shrink-0">
        <div className="px-6 py-6 font-black text-white uppercase tracking-tighter text-lg border-b border-[#2e2e2e]">
          Settings
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2 py-8">
          {MENU_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => onViewSelect?.(item.id)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-all group ${
                currentView === item.id
                  ? "bg-zinc-900 border border-zinc-800 text-primary font-bold"
                  : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900/40 border border-transparent"
              }`}
            >
              <div className="flex items-center gap-3">
                <item.icon
                  size={14}
                  className={
                    currentView === item.id
                      ? "text-primary"
                      : "text-zinc-700 group-hover:text-zinc-400"
                  }
                />
                <span className="tracking-tight">{item.name}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar bg-[#111111]">
        <div className="max-w-5xl mx-auto py-12 px-12">
          {currentView === "general" && renderGeneral()}
          {currentView === "infrastructure" && renderInfrastructure()}
          {currentView === "billing" && renderBilling()}
          {currentView === "api_keys" && renderApiKeys()}
        </div>
      </div>
    </div>
  );
};

export default Settings;
