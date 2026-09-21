import type { ReactNode } from "react";

export function Panel({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="heading">
        <div>
          {subtitle ? <p>{subtitle}</p> : null}
          <h2>{title}</h2>
        </div>
        {actions ? <div className="heading-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Badge({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "muted" | "info";
  children: ReactNode;
}) {
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

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Toast({
  text,
  tone,
}: {
  text: string | null;
  tone: "ok" | "err";
}) {
  if (!text) return null;
  return <div className={`toast toast-${tone}`}>{text}</div>;
}
