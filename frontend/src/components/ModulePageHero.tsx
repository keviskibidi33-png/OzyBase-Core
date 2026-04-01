import React from "react";
import type { LucideIcon } from "lucide-react";

type HeroTone = "neutral" | "accent" | "success" | "warning" | "danger";

interface HeroPill {
  label: string;
  tone?: HeroTone;
}

interface HeroStat {
  label: string;
  value: string;
  hint?: string;
}

interface ModulePageHeroProps {
  eyebrow: string;
  title: string;
  description: string;
  descriptionLabel?: string;
  icon?: LucideIcon;
  pills?: readonly HeroPill[];
  stats?: readonly HeroStat[];
  actions?: React.ReactNode;
  className?: string;
}

const PILL_TONE_CLASS: Record<HeroTone, string> = {
  neutral: "border-zinc-800 bg-[#101010] text-zinc-300",
  accent: "border-primary/20 bg-primary/10 text-primary",
  success: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
  warning: "border-amber-500/20 bg-amber-500/10 text-amber-300",
  danger: "border-red-500/20 bg-red-500/10 text-red-300",
};

const ModulePageHero: React.FC<ModulePageHeroProps> = ({
  eyebrow,
  title,
  description,
  descriptionLabel = "Quick brief",
  icon: Icon,
  pills = [],
  stats = [],
  actions,
  className = "",
}) => {
  const hasDescription = description.trim().length > 0;
  const showAside = hasDescription || Boolean(actions);

  return (
    <section
      className={`relative overflow-hidden rounded-[32px] border border-[#2e2e2e] bg-[radial-gradient(circle_at_top_right,rgba(254,254,0,0.08),transparent_42%),linear-gradient(180deg,rgba(23,23,23,0.96),rgba(12,12,12,0.98))] shadow-2xl ${className}`.trim()}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="relative p-6 md:p-8">
        <div
          className={`grid gap-6 ${
            showAside
              ? "xl:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] xl:items-start"
              : ""
          }`}
        >
          <div className="min-w-0">
            <div className="flex items-start gap-4">
              {Icon ? (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-[0_0_30px_rgba(254,254,0,0.08)]">
                  <Icon size={24} />
                </div>
              ) : null}
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-zinc-500">
                  {eyebrow}
                </p>
                <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">
                  {title}
                </h1>
              </div>
            </div>

            {pills.length > 0 ? (
              <div className="mt-5 flex flex-wrap gap-2">
                {pills.map((pill) => (
                  <span
                    key={pill.label}
                    className={`rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] ${
                      PILL_TONE_CLASS[pill.tone || "neutral"]
                    }`}
                  >
                    {pill.label}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          {showAside ? (
            <aside className="flex min-w-0 flex-col gap-3 xl:items-stretch">
              {actions ? (
                <div className="flex flex-wrap items-center gap-3 xl:justify-end">
                  {actions}
                </div>
              ) : null}

              {hasDescription ? (
                <div className="rounded-[24px] border border-primary/15 bg-[#0d0d0d]/95 p-5 shadow-[inset_0_1px_0_rgba(254,254,0,0.08)]">
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-primary/80">
                    {descriptionLabel}
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-zinc-300">
                    {description}
                  </p>
                </div>
              ) : null}
            </aside>
          ) : null}
        </div>

        {stats.length > 0 ? (
          <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-2xl border border-[#2e2e2e] bg-[#0d0d0d]/90 p-4"
              >
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
                  {stat.label}
                </p>
                <p className="mt-2 text-lg font-black text-white">{stat.value}</p>
                {stat.hint ? (
                  <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                    {stat.hint}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
};

export default ModulePageHero;
