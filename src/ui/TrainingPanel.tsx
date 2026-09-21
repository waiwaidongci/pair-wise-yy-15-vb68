import { useState } from "react";
import { ledger } from "../ledger/store";
import { calcSpeed, PENDING_REASON_TEXT } from "../domain/rules";
import type { ResultRow } from "../domain/types";
import { useLedger, fmtDateTime, fmtFull, toLocalInputValue } from "./useLedger";
import { Badge, Field, SectionTitle } from "./components";

function StatusBadge({ row }: { row: ResultRow }) {
  if (row.status === "valid")
    return row.returnedAt === null ? <Badge tone="warn">未归巢</Badge> : <Badge tone="ok">有效</Badge>;
  if (row.status === "archived") return <Badge tone="muted">旧环留档</Badge>;
  if (row.resolvedAt) return <Badge tone="accent">已复核确认</Badge>;
  return <Badge tone="warn">待复核</Badge>;
}

function ReturnForm({ row, sessionId }: { row: ResultRow; sessionId: string }) {
  const state = useLedger();
  const session = state.sessions.get(sessionId)!;
  const [at, setAt] = useState(toLocalInputValue(Date.now()));
  const [manualSpeed, setManualSpeed] = useState("");
  const speed = manualSpeed
    ? Number(manualSpeed)
    : calcSpeed(session.distanceM, session.releaseAt, new Date(at).getTime());

  return (
    <div className="return-form">
      <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
      <input
        type="number"
        placeholder="速度(m/min)，留空自动算"
        value={manualSpeed}
        onChange={(e) => setManualSpeed(e.target.value)}
      />
      <button
        className="mini primary"
        disabled={!at || speed <= 0}
        onClick={() =>
          ledger.recordReturn({
            resultId: row.id,
            returnedAt: new Date(at).getTime(),
            speed: speed > 0 ? Math.round(speed * 10) / 10 : null,
          })
        }
      >
        登记归巢
      </button>
      <span className="hint">预计均速 {speed > 0 ? speed.toFixed(1) : "—"} m/min</span>
    </div>
  );
}

function SessionCard({ sessionId }: { sessionId: string }) {
  const state = useLedger();
  const s = state.sessionViews.get(sessionId)!;
  const [openReturn, setOpenReturn] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  return (
    <article className="session-card">
      <header>
        <div>
          <h3>
            {s.site} · {s.distanceM / 1000}km
          </h3>
          <p className="muted">
            开笼 {fmtDateTime(s.releaseAt)} · {s.weather}
          </p>
        </div>
        <div className="session-stats">
          <span>
            有效归巢 <b>{s.returnedCount}</b>
          </span>
          <span>
            未归巢 <b className={s.unreturnedCount ? "warn-text" : ""}>{s.unreturnedCount}</b>
          </span>
          <span>
            待复核 <b className={s.pendingCount ? "warn-text" : ""}>{s.pendingCount}</b>
          </span>
        </div>
      </header>

      <table className="rank-table">
        <thead>
          <tr>
            <th>名次</th>
            <th>赛鸽</th>
            <th>电子环</th>
            <th>归巢时间</th>
            <th>均速 m/min</th>
            <th>状态 / 复核原因</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {s.results
            .filter((r) => showArchived || r.status !== "archived")
            .sort((a, b) => {
              if (a.status === "valid" && b.status !== "valid") return -1;
              if (b.status === "valid" && a.status !== "valid") return 1;
              return (a.returnedAt ?? Infinity) - (b.returnedAt ?? Infinity);
            })
            .map((r) => {
              const pigeon = state.pigeons.get(r.pigeonId);
              const ring = r.ringId ? state.rings.get(r.ringId) : undefined;
              return (
                <tr key={r.id} className={`row-${r.status}`}>
                  <td>{r.rank ? <b className="rank-no">#{r.rank}</b> : "—"}</td>
                  <td>
                    {pigeon?.band ?? r.pigeonId}
                    <span className="muted"> {pigeon?.bloodline}</span>
                  </td>
                  <td>{ring?.code ?? "—"}</td>
                  <td>{r.returnedAt ? fmtDateTime(r.returnedAt) : "—"}</td>
                  <td>{r.status === "valid" && r.speed !== null ? r.speed.toFixed(1) : "—"}</td>
                  <td>
                    <StatusBadge row={r} />
                    {r.status === "pending" && r.pendingReason && (
                      <span className="reason-text">{PENDING_REASON_TEXT[r.pendingReason]}</span>
                    )}
                    {r.status === "pending" && r.invalidation && (
                      <span className="reason-text">
                        {r.invalidation.kind === "issue" ? "发放记录更正触发重算" : "校准更正触发重算"} ·{" "}
                        {r.invalidation.note}
                      </span>
                    )}
                  </td>
                  <td>
                    {r.status === "valid" && r.returnedAt === null && (
                      <>
                        <button className="mini" onClick={() => setOpenReturn(openReturn === r.id ? null : r.id)}>
                          登记归巢
                        </button>
                        {openReturn === r.id && <ReturnForm row={r} sessionId={s.id} />}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
      <button className="mini" onClick={() => setShowArchived((v) => !v)}>
        {showArchived ? "隐藏" : "查看"}换环留档成绩（{s.results.filter((r) => r.status === "archived").length}）
      </button>
    </article>
  );
}

export function TrainingPanel({ now }: { now: number }) {
  const state = useLedger();
  const [site, setSite] = useState("");
  const [distance, setDistance] = useState("80");
  const [weather, setWeather] = useState("晴");
  const [releaseAt, setReleaseAt] = useState(toLocalInputValue(now));
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const sessions = [...state.sessionViews.values()].sort((a, b) => b.releaseAt - a.releaseAt);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className="panel">
      <SectionTitle kicker="训放成绩台" title="批次 · 排行 · 未归巢提醒" />

      <details className="add-pigeon">
        <summary>+ 新建训放批次并选鸽开笼</summary>
        <div className="inline-form">
          <div className="form-row">
            <Field label="训放地点">
              <input value={site} onChange={(e) => setSite(e.target.value)} placeholder="80km 南站" />
            </Field>
            <Field label="放飞距离(km)">
              <input type="number" value={distance} onChange={(e) => setDistance(e.target.value)} />
            </Field>
            <Field label="天气">
              <input value={weather} onChange={(e) => setWeather(e.target.value)} />
            </Field>
            <Field label="开笼时间">
              <input
                type="datetime-local"
                value={releaseAt}
                max={fmtFull(now)}
                onChange={(e) => setReleaseAt(e.target.value)}
              />
            </Field>
          </div>
          <div className="pick-list">
            {[...state.pigeons.values()].map((p) => {
              const active = ledger.getActiveRing(p.id);
              return (
                <label key={p.id} className={`pick ${selected.has(p.id) ? "pick-on" : ""}`}>
                  <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                  <span>{p.band}</span>
                  {active ? <Badge tone="ok">{active.code}</Badge> : <Badge tone="danger">无在役环</Badge>}
                </label>
              );
            })}
          </div>
          <button
            className="primary"
            disabled={!site.trim() || !distance || selected.size === 0 || !releaseAt}
            onClick={() => {
              ledger.createBatch({
                site: site.trim(),
                distanceM: Math.round(Number(distance) * 1000),
                weather,
                releaseAt: new Date(releaseAt).getTime(),
                pigeonIds: [...selected],
              });
              setSite("");
              setSelected(new Set());
            }}
          >
            开笼建批（{selected.size} 羽）
          </button>
          <p className="hint">
            每羽成绩绑定当次在役环与开笼前最近一次校准；环停用、校准缺失或超过 72 小时者只进待复核，不计排行和未归巢。
          </p>
        </div>
      </details>

      <div className="session-list">
        {sessions.map((s) => (
          <SessionCard key={s.id} sessionId={s.id} />
        ))}
      </div>
    </section>
  );
}
