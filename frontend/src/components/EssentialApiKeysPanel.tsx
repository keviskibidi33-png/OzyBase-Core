import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  TerminalSquare,
  X,
} from "lucide-react";
import { fetchWithAuth } from "../utils/api";
import ConfirmModal from "./ConfirmModal";
import { BrandedToast, type BrandedToastTone } from "./OverlayPrimitives";

type EssentialRole = "anon" | "service_role";

interface EssentialKeySummary {
  id: string;
  role: EssentialRole;
  label: string;
  prefix: string;
  key_version: number;
  is_active: boolean;
  created_at: string;
  last_used_at?: string | null;
}

interface EssentialKeysResponse {
  keys?: EssentialKeySummary[];
}

interface MCPConfig {
  runtime: string;
  tools_url: string;
  invoke_url: string;
  auth_header: string;
  tool_count: number;
  sample_tools: string;
  sample_invoke: string;
}

interface RevealedKeyPayload {
  id: string;
  role: EssentialRole;
  label: string;
  key: string;
  prefix: string;
  key_version: number;
  created_at: string;
  last_used_at?: string | null;
  warning?: string;
  mcp?: MCPConfig;
}

interface ToastState {
  message: string;
  tone: BrandedToastTone;
  title?: string;
}

const KEY_ORDER: EssentialRole[] = ["anon", "service_role"];

const FALLBACK_LABELS: Record<EssentialRole, string> = {
  anon: "Publishable key",
  service_role: "Secret key",
};

interface RolePresentation {
  label: string;
  eyebrow: string;
  badge: string;
  description: string;
  valueLabel: string;
  valuePlaceholder: string;
  accentClass: string;
  badgeClass: string;
  actionClass: string;
  noteClass: string;
  warningTitle: string;
  warningBody: string;
  rotateTitle: string;
  rotateMessage: string;
}

const ROLE_PRESENTATION: Record<EssentialRole, RolePresentation> = {
  anon: {
    label: "Publishable key",
    eyebrow: "Client/Public",
    badge: "Browser safe with RLS",
    description:
      "Use this key in browser apps, mobile clients and public SDKs. It should stay constrained by RLS and never be used for server-level administration.",
    valueLabel: "Current Key",
    valuePlaceholder:
      "Locked. Verify the current admin password to reveal this publishable key.",
    accentClass: "bg-gradient-to-br from-sky-500/14 via-sky-500/4 to-transparent",
    badgeClass: "bg-sky-500/10 border-sky-500/20 text-sky-300",
    actionClass:
      "bg-sky-500/12 border-sky-500/25 text-sky-100 hover:bg-sky-500/18",
    noteClass: "border-sky-500/20 bg-sky-500/8 text-sky-100/95",
    warningTitle: "Public client profile",
    warningBody:
      "Ship this key only to clients that should respect public-facing policies. Rotation cuts over immediately, so deployed apps must switch to the new publishable key.",
    rotateTitle: "Rotate Publishable Key",
    rotateMessage:
      "This will issue a fresh publishable key and the previous key will stop working immediately for browser and public clients.",
  },
  service_role: {
    label: "Secret key",
    eyebrow: "Server/Admin",
    badge: "Server only",
    description:
      "Use this key only in trusted servers, internal automation and MCP clients. Never embed it in browsers, mobile bundles or public repositories.",
    valueLabel: "Current Secret",
    valuePlaceholder:
      "Locked. Verify the current admin password to reveal this secret key.",
    accentClass:
      "bg-gradient-to-br from-amber-500/16 via-amber-500/5 to-transparent",
    badgeClass: "bg-amber-500/10 border-amber-500/25 text-amber-300",
    actionClass:
      "bg-amber-500/12 border-amber-500/25 text-amber-50 hover:bg-amber-500/18",
    noteClass:
      "border-amber-500/25 bg-gradient-to-br from-amber-500/14 via-[#1b1406] to-[#0e0e0e] text-amber-50",
    warningTitle: "Never expose this key",
    warningBody:
      "This secret unlocks MCP, automation and admin-grade workloads. Keep it on servers only. Rotation immediately cuts off existing secret-key traffic until consumers deploy the new secret.",
    rotateTitle: "Rotate Secret Key",
    rotateMessage:
      "This will issue a fresh secret key and the previous secret will stop working immediately for MCP and server workloads.",
  },
};

const formatTimestamp = (value?: string | null) => {
  if (!value) {
    return "Never";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const formatRotationTimestamp = (value?: string | null, version?: number) => {
  if (!value) {
    return "Unknown";
  }
  if ((version || 1) <= 1) {
    return "Not rotated yet";
  }
  return formatTimestamp(value);
};

const EssentialApiKeysPanel: React.FC = () => {
  const [keysLoading, setKeysLoading] = useState(true);
  const [keysByRole, setKeysByRole] = useState<
    Record<EssentialRole, EssentialKeySummary | null>
  >({
    anon: null,
    service_role: null,
  });
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpStatus, setMcpStatus] = useState<{
    runtime: string;
    count: number;
  } | null>(null);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verificationToken, setVerificationToken] = useState<string | null>(
    null,
  );
  const [verifiedUntil, setVerifiedUntil] = useState<string | null>(null);
  const [revealedByRole, setRevealedByRole] = useState<
    Partial<Record<EssentialRole, RevealedKeyPayload>>
  >({});
  const [loadingRole, setLoadingRole] = useState<EssentialRole | null>(null);
  const [rotatingRole, setRotatingRole] = useState<EssentialRole | null>(null);
  const [pendingRotateRole, setPendingRotateRole] =
    useState<EssentialRole | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const isVerified = Boolean(
    verificationToken &&
    verifiedUntil &&
    new Date(verifiedUntil).getTime() > Date.now(),
  );

  const setFeedback = (
    message: string,
    tone: BrandedToastTone,
    title?: string,
  ) => {
    setToast({ message, tone, title });
    window.setTimeout(() => setToast(null), 3200);
  };

  const copyValue = async (value: string | undefined, key: string) => {
    if (!value) {
      return;
    }
    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(null), 1500);
  };

  const loadKeys = async () => {
    setKeysLoading(true);
    try {
      const res = await fetchWithAuth("/api/project/keys/essential");
      const payload = (await res.json()) as EssentialKeysResponse;
      const next: Record<EssentialRole, EssentialKeySummary | null> = {
        anon: null,
        service_role: null,
      };
      for (const item of Array.isArray(payload.keys) ? payload.keys : []) {
        next[item.role] = item;
      }
      setKeysByRole(next);
    } catch (error) {
      console.error("Failed to load essential API keys:", error);
      setKeysByRole({ anon: null, service_role: null });
      setFeedback(
        "The dashboard could not load the essential project keys.",
        "error",
        "API Keys",
      );
    } finally {
      setKeysLoading(false);
    }
  };

  const loadMCPStatus = async () => {
    setMcpLoading(true);
    try {
      const res = await fetchWithAuth("/api/project/mcp/tools");
      const payload = (await res.json()) as {
        runtime?: string;
        count?: number;
      };
      if (!res.ok) {
        throw new Error("Failed to load MCP tools");
      }
      setMcpStatus({
        runtime: payload.runtime || "native",
        count: Number(payload.count || 0),
      });
    } catch (error) {
      console.error("Failed to load MCP status:", error);
      setMcpStatus(null);
    } finally {
      setMcpLoading(false);
    }
  };

  useEffect(() => {
    void Promise.all([loadKeys(), loadMCPStatus()]);
  }, []);

  const ensureVerified = () => {
    if (isVerified) {
      return true;
    }
    setShowVerifyModal(true);
    return false;
  };

  const handleVerify = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setVerifying(true);
    try {
      const res = await fetchWithAuth("/api/project/keys/essential/verify", {
        method: "POST",
        body: JSON.stringify({ password: adminPassword }),
      });
      const payload = (await res.json()) as {
        error?: string;
        verification_token?: string;
        verified_until?: string;
      };
      if (!res.ok || !payload.verification_token) {
        setFeedback(
          payload.error || "The current admin password was rejected.",
          "error",
          "Verification",
        );
        return;
      }
      setVerificationToken(payload.verification_token);
      setVerifiedUntil(payload.verified_until || null);
      setAdminPassword("");
      setShowVerifyModal(false);
      setFeedback(
        "Admin verification confirmed. You can reveal or rotate the essential keys now.",
        "success",
        "Verification",
      );
    } catch (error) {
      console.error("Failed to verify admin password:", error);
      setFeedback(
        "The dashboard could not verify the admin password.",
        "error",
        "Verification",
      );
    } finally {
      setVerifying(false);
    }
  };

  const revealKey = async (role: EssentialRole) => {
    if (!ensureVerified() || !verificationToken) {
      return;
    }
    setLoadingRole(role);
    try {
      const res = await fetchWithAuth(
        `/api/project/keys/essential/${role}/reveal`,
        {
          method: "POST",
          body: JSON.stringify({ verification_token: verificationToken }),
        },
      );
      const payload = (await res.json()) as RevealedKeyPayload & {
        error?: string;
      };
      if (!res.ok || !payload.key) {
        if (res.status === 401) {
          setVerificationToken(null);
          setVerifiedUntil(null);
        }
        setFeedback(
          payload.error || "The key could not be revealed.",
          "error",
          "API Keys",
        );
        return;
      }
      setRevealedByRole((current) => ({ ...current, [role]: payload }));
    } catch (error) {
      console.error("Failed to reveal essential API key:", error);
      setFeedback(
        "The key could not be revealed right now.",
        "error",
        "API Keys",
      );
    } finally {
      setLoadingRole(null);
    }
  };

  const rotateKey = async (role: EssentialRole) => {
    if (!ensureVerified() || !verificationToken) {
      return;
    }
    setRotatingRole(role);
    try {
      const res = await fetchWithAuth(
        `/api/project/keys/essential/${role}/rotate`,
        {
          method: "POST",
          body: JSON.stringify({
            verification_token: verificationToken,
            reason: "dashboard_rotation",
          }),
        },
      );
      const payload = (await res.json()) as RevealedKeyPayload & {
        error?: string;
      };
      if (!res.ok || !payload.key) {
        if (res.status === 401) {
          setVerificationToken(null);
          setVerifiedUntil(null);
        }
        setFeedback(
          payload.error || "The key rotation failed.",
          "error",
          "Rotation",
        );
        return;
      }
      setRevealedByRole((current) => ({ ...current, [role]: payload }));
      await loadKeys();
      setFeedback(
        payload.warning || "The essential key rotated successfully.",
        "success",
        "Rotation",
      );
    } catch (error) {
      console.error("Failed to rotate essential API key:", error);
      setFeedback("The key rotation failed.", "error", "Rotation");
    } finally {
      setPendingRotateRole(null);
      setRotatingRole(null);
    }
  };

  const serviceRoleReveal = revealedByRole.service_role;
  const serviceRoleMCP = serviceRoleReveal?.mcp;

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <div>
        <h2 className="text-2xl font-black text-white italic tracking-tighter uppercase mb-2">
          API Keys
        </h2>
        <p className="text-zinc-500 text-sm font-medium">
          The project keeps exactly two essential keys: one publishable key for
          client traffic and one secret key for trusted servers, MCP and
          automation. They are generated by the backend, revealed only after
          admin re-verification, and rotation disables the previous key
          immediately.
        </p>
      </div>

      <div className="bg-[#171717]/60 border border-[#2e2e2e] rounded-3xl p-6 shadow-2xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center">
              <ShieldCheck size={18} />
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-black uppercase tracking-widest text-primary">
                Verified reveal flow
              </p>
              <h3 className="text-lg font-black text-white tracking-tight">
                Essential key vault
              </h3>
              <p className="text-[11px] text-zinc-500 leading-relaxed max-w-2xl">
                Manual key creation was retired. Reveal and rotate only the
                current publishable and secret keys after confirming the
                current admin password.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => void loadKeys()}
              className="px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-white transition-all flex items-center gap-2"
            >
              {keysLoading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              Refresh
            </button>
            <button
              onClick={() => setShowVerifyModal(true)}
              data-testid="verify-admin-button"
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 ${
                isVerified
                  ? "bg-primary text-black"
                  : "bg-zinc-900 border border-zinc-800 text-zinc-200 hover:border-primary/40"
              }`}
            >
              <LockKeyhole size={12} />
              {isVerified ? "Verified" : "Verify Admin"}
            </button>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-[#2e2e2e] bg-[#101010]/90 px-4 py-3 flex flex-wrap items-center gap-4 text-[11px] text-zinc-400">
          <span className="font-black uppercase tracking-widest text-zinc-500">
            Session
          </span>
          <span>
            {isVerified
              ? `Unlocked until ${formatTimestamp(verifiedUntil)}`
              : "Locked until the current admin password is confirmed."}
          </span>
          <span className="text-zinc-600">
            Current session tokens are not project keys and never replace the
            publishable or secret key.
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {KEY_ORDER.map((role) => {
          const summary = keysByRole[role];
          const revealed = revealedByRole[role];
          const roleMeta = ROLE_PRESENTATION[role];
          const label = roleMeta.label || summary?.label || FALLBACK_LABELS[role];
          const isBusy = loadingRole === role || rotatingRole === role;
          const keyVersion =
            summary?.key_version || revealed?.key_version || 1;
          const createdAt = summary?.created_at || revealed?.created_at;

          return (
            <div
              key={role}
              data-testid={`essential-key-card-${role}`}
              className="relative bg-[#171717]/50 border border-[#2e2e2e] rounded-3xl overflow-hidden shadow-2xl"
            >
              <div className={`absolute inset-x-0 top-0 h-24 pointer-events-none ${roleMeta.accentClass}`} />
              <div className="px-6 py-5 border-b border-[#2e2e2e] bg-[#111111]/50 flex items-start justify-between gap-4 relative">
                <div className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                    {roleMeta.eyebrow}
                  </p>
                  <h3 className="text-lg font-black text-white tracking-tight">
                    {label}
                  </h3>
                  <p className="text-[11px] text-zinc-500 leading-relaxed">
                    {roleMeta.description}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <div
                    className={`px-3 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest ${roleMeta.badgeClass}`}
                  >
                    {roleMeta.badge}
                  </div>
                  <div className="px-3 py-2 rounded-xl border border-zinc-800 bg-[#0e0e0e]/90 text-[10px] font-black uppercase tracking-widest text-zinc-300">
                    v{keyVersion}
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-[#0d0d0d] border border-[#2e2e2e] rounded-2xl p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">
                      Key Prefix
                    </p>
                    <code className="text-sm text-white">
                      {summary?.prefix || revealed?.prefix || "Unavailable"}
                    </code>
                    <p className="mt-2 text-[10px] text-zinc-500">
                      Visible identifier only.
                    </p>
                  </div>
                  <div className="bg-[#0d0d0d] border border-[#2e2e2e] rounded-2xl p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">
                      Last Rotated
                    </p>
                    <p className="text-sm text-white">
                      {formatRotationTimestamp(createdAt, keyVersion)}
                    </p>
                    <p className="mt-2 text-[10px] text-zinc-500">
                      {keyVersion > 1
                        ? `Version v${keyVersion} is active now.`
                        : `Initial issue ${formatTimestamp(createdAt)}.`}
                    </p>
                  </div>
                  <div className="bg-[#0d0d0d] border border-[#2e2e2e] rounded-2xl p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">
                      Last Used
                    </p>
                    <p className="text-sm text-white">
                      {formatTimestamp(
                        summary?.last_used_at || revealed?.last_used_at,
                      )}
                    </p>
                    <p className="mt-2 text-[10px] text-zinc-500">
                      Updated after authenticated traffic.
                    </p>
                  </div>
                  <div className="bg-[#0d0d0d] border border-[#2e2e2e] rounded-2xl p-4 sm:col-span-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">
                      {roleMeta.valueLabel}
                    </p>
                    <div className="flex items-center justify-between gap-4">
                      <code
                        data-testid={`essential-key-secret-${role}`}
                        className="text-xs text-white break-all"
                      >
                        {revealed?.key || roleMeta.valuePlaceholder}
                      </code>
                      <button
                        onClick={() => {
                          if (revealed?.key) {
                            setRevealedByRole((current) => ({
                              ...current,
                              [role]: undefined,
                            }));
                            return;
                          }
                          void revealKey(role);
                        }}
                        disabled={isBusy}
                        data-testid={`essential-key-reveal-${role}`}
                        className={`px-4 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 disabled:opacity-60 ${roleMeta.actionClass}`}
                      >
                        {isBusy && loadingRole === role ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : revealed?.key ? (
                          <EyeOff size={12} />
                        ) : (
                          <Eye size={12} />
                        )}
                        {revealed?.key ? "Hide" : "Reveal"}
                      </button>
                    </div>
                  </div>
                </div>

                <div className={`rounded-2xl border px-4 py-4 ${roleMeta.noteClass}`}>
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-2xl border border-white/10 bg-black/20 flex items-center justify-center shrink-0">
                      {role === "service_role" ? (
                        <AlertTriangle size={16} />
                      ) : (
                        <ShieldCheck size={16} />
                      )}
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-black uppercase tracking-widest">
                        {roleMeta.warningTitle}
                      </p>
                      <p className="text-[11px] leading-relaxed opacity-80">
                        {roleMeta.warningBody}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() =>
                      void copyValue(revealed?.key, `${role}-secret`)
                    }
                    disabled={!revealed?.key}
                    data-testid={`essential-key-copy-${role}`}
                    className={`px-4 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-all ${roleMeta.actionClass}`}
                  >
                    {copiedKey === `${role}-secret` ? (
                      <Check size={12} />
                    ) : (
                      <Copy size={12} />
                    )}
                    {copiedKey === `${role}-secret` ? "Copied" : "Copy"}
                  </button>
                  <button
                    onClick={() => {
                      if (!ensureVerified()) {
                        return;
                      }
                      setPendingRotateRole(role);
                    }}
                    disabled={isBusy}
                    data-testid={`essential-key-rotate-${role}`}
                    className="px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-[10px] font-black uppercase tracking-widest text-zinc-300 hover:text-white transition-all flex items-center gap-2 disabled:opacity-60"
                  >
                    {rotatingRole === role ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <RotateCcw size={12} />
                    )}
                    Rotate
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-[#171717]/50 border border-[#2e2e2e] rounded-3xl overflow-hidden shadow-2xl">
        <div className="px-6 py-5 border-b border-[#2e2e2e] bg-[#111111]/50 flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">
              AI + Automation
            </p>
            <h3 className="text-lg font-black text-white tracking-tight">
              MCP Gateway
            </h3>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Native MCP tools are exposed by the backend. Use the active
              secret key to let an AI client inspect collections, create schema
              and run deterministic NLQ operations.
            </p>
          </div>
          <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest">
            {mcpLoading ? (
              <span className="text-zinc-500 flex items-center gap-2">
                <Loader2 size={12} className="animate-spin" /> Loading
              </span>
            ) : (
              <span className="text-primary flex items-center gap-2">
                <TerminalSquare size={12} />{" "}
                {mcpStatus
                  ? `${mcpStatus.runtime} / ${mcpStatus.count} tools`
                  : "Unavailable"}
              </span>
            )}
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="rounded-2xl border border-amber-500/25 bg-gradient-to-r from-amber-500/12 via-[#17110a] to-[#0f0f0f] px-5 py-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl border border-amber-500/20 bg-black/20 text-amber-300 flex items-center justify-center shrink-0">
                <AlertTriangle size={16} />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-300">
                  Secret key only
                </p>
                <p className="text-[11px] leading-relaxed text-zinc-300">
                  MCP access is intended for trusted AI agents and server-side
                  automation. Keep this configuration out of browser bundles
                  and public repositories.
                </p>
              </div>
            </div>
          </div>
          {!serviceRoleMCP ? (
            <div className="rounded-2xl border border-dashed border-[#343434] bg-[#101010] px-5 py-6 text-sm text-zinc-500">
              Reveal the active secret key to generate copyable MCP commands
              and production-ready invoke snippets.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-[#0d0d0d] border border-[#2e2e2e] rounded-2xl p-5">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">
                    Tools Endpoint
                  </p>
                  <code className="text-xs text-white break-all">
                    {serviceRoleMCP.tools_url}
                  </code>
                  <button
                    onClick={() =>
                      void copyValue(serviceRoleMCP.tools_url, "mcp-tools")
                    }
                    className="mt-4 px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-[10px] font-black uppercase tracking-widest text-zinc-300 hover:text-white transition-all flex items-center gap-2"
                  >
                    {copiedKey === "mcp-tools" ? (
                      <Check size={12} />
                    ) : (
                      <Copy size={12} />
                    )}
                    Copy URL
                  </button>
                </div>
                <div className="bg-[#0d0d0d] border border-[#2e2e2e] rounded-2xl p-5">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">
                    Invoke Endpoint
                  </p>
                  <code className="text-xs text-white break-all">
                    {serviceRoleMCP.invoke_url}
                  </code>
                  <button
                    onClick={() =>
                      void copyValue(serviceRoleMCP.invoke_url, "mcp-invoke")
                    }
                    className="mt-4 px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-[10px] font-black uppercase tracking-widest text-zinc-300 hover:text-white transition-all flex items-center gap-2"
                  >
                    {copiedKey === "mcp-invoke" ? (
                      <Check size={12} />
                    ) : (
                      <Copy size={12} />
                    )}
                    Copy URL
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="bg-[#0d0d0d] border border-[#2e2e2e] rounded-2xl p-5 space-y-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                    Discovery Command
                  </p>
                  <code className="block text-xs text-white whitespace-pre-wrap break-all">
                    {serviceRoleMCP.sample_tools}
                  </code>
                  <button
                    onClick={() =>
                      void copyValue(
                        serviceRoleMCP.sample_tools,
                        "mcp-sample-tools",
                      )
                    }
                    className="px-4 py-2 rounded-xl bg-primary text-black text-[10px] font-black uppercase tracking-widest flex items-center gap-2"
                  >
                    {copiedKey === "mcp-sample-tools" ? (
                      <Check size={12} />
                    ) : (
                      <Copy size={12} />
                    )}
                    Copy Command
                  </button>
                </div>
                <div className="bg-[#0d0d0d] border border-[#2e2e2e] rounded-2xl p-5 space-y-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                    Invoke Command
                  </p>
                  <code className="block text-xs text-white whitespace-pre-wrap break-all">
                    {serviceRoleMCP.sample_invoke}
                  </code>
                  <button
                    onClick={() =>
                      void copyValue(
                        serviceRoleMCP.sample_invoke,
                        "mcp-sample-invoke",
                      )
                    }
                    className="px-4 py-2 rounded-xl bg-primary text-black text-[10px] font-black uppercase tracking-widest flex items-center gap-2"
                  >
                    {copiedKey === "mcp-sample-invoke" ? (
                      <Check size={12} />
                    ) : (
                      <Copy size={12} />
                    )}
                    Copy Command
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {showVerifyModal && (
        <div
          className="fixed inset-0 z-[220] flex items-center justify-center p-4"
          onClick={(event) =>
            event.target === event.currentTarget && setShowVerifyModal(false)
          }
        >
          <div className="absolute inset-0 ozy-overlay-backdrop backdrop-blur-md" />
          <div className="ozy-dialog-panel w-full max-w-md relative">
            <div className="px-6 py-5 border-b border-[#2e2e2e] bg-[#171717]/90 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center">
                  <LockKeyhole size={16} />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-primary">
                    Quick Admin Check
                  </p>
                  <h3 className="text-sm font-black text-white uppercase tracking-widest">
                    Confirm current password
                  </h3>
                </div>
              </div>
              <button
                onClick={() => setShowVerifyModal(false)}
                className="text-zinc-500 hover:text-white transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleVerify} className="p-6 space-y-5">
              <p className="text-sm text-zinc-400 leading-relaxed">
                The dashboard only reveals or rotates the essential project keys
                after a short admin re-verification window.
              </p>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                  Admin Password
                </label>
                <input
                  type="password"
                  autoFocus
                  required
                  value={adminPassword}
                  onChange={(event) => setAdminPassword(event.target.value)}
                  data-testid="verify-admin-password"
                  placeholder="Re-enter the current admin password"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:border-primary/40"
                />
              </div>
              <div className="rounded-2xl border border-[#2e2e2e] bg-[#111111]/80 px-4 py-4 text-[11px] text-zinc-500 leading-relaxed">
                Successful verification unlocks reveal and rotation for a short
                window without exposing the publishable or secret key by
                default.
              </div>
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowVerifyModal(false)}
                  className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-zinc-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={verifying}
                  data-testid="verify-admin-submit"
                  className="px-5 py-2 rounded-xl bg-primary text-black text-[10px] font-black uppercase tracking-widest flex items-center gap-2 disabled:opacity-60"
                >
                  {verifying ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <ShieldCheck size={12} />
                  )}
                  {verifying ? "Verifying" : "Unlock"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={pendingRotateRole !== null}
        onClose={() => setPendingRotateRole(null)}
        onConfirm={() =>
          pendingRotateRole ? rotateKey(pendingRotateRole) : Promise.resolve()
        }
        title={
          pendingRotateRole
            ? ROLE_PRESENTATION[pendingRotateRole].rotateTitle
            : "Rotate Key"
        }
        message={
          pendingRotateRole
            ? ROLE_PRESENTATION[pendingRotateRole].rotateMessage
            : "This will issue a fresh project key and immediately disable the previous one."
        }
        confirmText={rotatingRole ? "Rotating" : "Rotate Now"}
        type="danger"
        closeOnConfirm={false}
      />

      {toast && (
        <BrandedToast
          message={toast.message}
          tone={toast.tone}
          title={toast.title}
          onClose={() => setToast(null)}
          position="bottom-right"
          durationMs={3200}
        />
      )}
    </div>
  );
};

export default EssentialApiKeysPanel;
