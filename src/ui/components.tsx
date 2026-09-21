import type { ReactNode } from "react";

export function Badge({ tone, children }: { tone: "ok" | "warn" | "muted" | "accent" | "danger"; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function SectionTitle({ kicker, title, extra }: { kicker: string; title: string; extra?: ReactNode }) {
  return (
    <div className="heading">
      <div>
        <p>{kicker}</p>
        <h2>{title}</h2>
      </div>
      {extra}
    </div>
  );
}
