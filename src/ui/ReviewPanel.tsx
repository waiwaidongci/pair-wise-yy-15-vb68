import { useState } from "react";
import { ledger } from "../ledger/store";
import { CALIB_TTL_MS, PENDING_REASON_TEXT } from "../domain/rules";
import { useLedger, fmtDateTime, fmtAge } from "./useLedger";
import { Badge, SectionTitle } from "./components";

function sessionLabel(state: ReturnType<typeof useLedger>, sessionId: string): string {
  const s = state.sessions.get(sessionId);
  return s ? `${s.site}（${fmtDateTime(s.releaseAt)} 开笼）` : sessionId;
}

function PendingQueue() {
  const state = useLedger();
  const pending = state.results
    .filter((r) => r.status === "pending" && !r.resolvedAt)
    .sort((a, b) => b.recordedAt - a.recordedAt);
  const resolved = state.results.filter((r) => r.status === "pending" && r.resolvedAt);

  return (
    <div>
      <div className="queue-head">
        <h3>待复核队列（{pending.length}）</h3>
        <p className="muted">只归集、不排行；当在役环或校准补齐/更正后，队列自动重算。</p>
      </div>
      {pending.length === 0 && <p className="hint">队列已清空。</p>}
      <div className="queue">
        {pending.map((r) => {
          const p = state.pigeons.get(r.pigeonId);
          const ring = r.ringId ? state.rings.get(r.ringId) : undefined;
          const session = state.sessions.get(r.sessionId);
          return (
            <article key={r.id} className="queue-item">
              <div className="queue-main">
                <h4>{p?.band ?? r.pigeonId}</h4>
                <p className="muted">
                  {p?.bloodline} · {session && sessionLabel(state, r.sessionId)}
                </p>
                <p>
                  <Badge tone="warn">{r.pendingReason ? PENDING_REASON_TEXT[r.pendingReason] : "待复核"}</Badge>
                  {r.invalidation && (
                    <span className="reason-text">
                      {r.invalidation.kind === "issue" ? "发放记录已更正" : "校准记录已更正"}，成绩于{" "}
                      {fmtDateTime(r.invalidation.at)} 失效并重算
                    </span>
                  )}
                </p>
                <p className="muted small">
                  登记环：{ring?.code ?? "无"} · 归巢：
                  {r.returnedAt ? fmtDateTime(r.returnedAt) : "未归巢"}
                </p>
              </div>
              <div className="queue-side">
                <button
                  className="mini"
                  onClick={() => {
                    const note = window.prompt("复核确认说明（该条标记已确认并出队，仍不计排行）", "人工核验通过，留待下一批次观察");
                    if (note) ledger.resolveReview({ resultId: r.id, note });
                  }}
                >
                  复核确认出队
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {resolved.length > 0 && (
        <details className="history">
          <summary>已复核确认（{resolved.length}）</summary>
          {resolved.map((r) => (
            <div key={r.id} className="ledger-line">
              <Badge tone="accent">已确认</Badge>
              <span>
                {state.pigeons.get(r.pigeonId)?.band} · {sessionLabel(state, r.sessionId)} · 确认于{" "}
                {fmtDateTime(r.resolvedAt!)}
              </span>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

function PigeonProfile({ pigeonId, now }: { pigeonId: string; now: number }) {
  const state = useLedger();
  const p = state.pigeons.get(pigeonId);
  if (!p) return null;
  const rows = ledger.getPigeonResults(pigeonId);
  const rings = [...state.rings.values()].filter((r) => r.pigeonId === pigeonId);
  const active = rings.find((r) => r.status === "active");
  const calibs = [...state.calibrations.values()]
    .filter((c) => c.pigeonId === pigeonId && !c.superseded)
    .sort((a, b) => b.calibratedAt - a.calibratedAt);
  const latestCalib = calibs[0];
  const fresh = latestCalib && now - latestCalib.calibratedAt <= CALIB_TTL_MS;

  return (
    <article className="profile-card">
      <header>
        <div>
          <h3>{p.band}</h3>
          <p className="muted">
            {p.id} · {p.bloodline} · {p.health}
          </p>
        </div>
        <div className="badge-row">
          {active ? <Badge tone="ok">在役 {active.code}</Badge> : <Badge tone="danger">无在役环</Badge>}
          {latestCalib ? (
            fresh ? (
              <Badge tone="ok">校准 {fmtAge(latestCalib.calibratedAt, now)}</Badge>
            ) : (
              <Badge tone="warn">校准超72h</Badge>
            )
          ) : (
            <Badge tone="muted">无校准</Badge>
          )}
        </div>
      </header>

      <h4>历史成绩</h4>
      <table className="rank-table compact">
        <thead>
          <tr>
            <th>批次</th>
            <th>环</th>
            <th>归巢</th>
            <th>均速</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const ring = r.ringId ? state.rings.get(r.ringId) : undefined;
            const s = state.sessions.get(r.sessionId);
            return (
              <tr key={r.id} className={`row-${r.status}`}>
                <td>{s ? `${s.site}` : r.sessionId}</td>
                <td>{ring?.code ?? "—"}</td>
                <td>{r.returnedAt ? fmtDateTime(r.returnedAt) : r.status === "valid" ? "未归巢" : "—"}</td>
                <td>{r.status === "valid" && r.speed !== null ? `${r.speed.toFixed(1)}` : "—"}</td>
                <td>
                  {r.status === "valid" ? (
                    r.rank ? (
                      <Badge tone="ok">#{r.rank} 有效</Badge>
                    ) : (
                      <Badge tone="warn">未归巢</Badge>
                    )
                  ) : r.status === "archived" ? (
                    <Badge tone="muted">旧环留档</Badge>
                  ) : (
                    <Badge tone="warn">
                      待复核{r.pendingReason ? `·${PENDING_REASON_TEXT[r.pendingReason]}` : ""}
                    </Badge>
                  )}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                暂无训放记录
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </article>
  );
}

export function ReviewPanel({ now }: { now: number }) {
  const state = useLedger();
  const [bloodFilter, setBloodFilter] = useState("全部");
  const bloodlines = ["全部", ...new Set([...state.pigeons.values()].map((p) => p.bloodline))];
  const pigeons = [...state.pigeons.values()].filter(
    (p) => bloodFilter === "全部" || p.bloodline === bloodFilter
  );

  return (
    <div className="review-grid">
      <section className="panel">
        <SectionTitle kicker="成绩复核台" title="待复核队列" />
        <PendingQueue />
      </section>

      <section className="panel">
        <SectionTitle kicker="单羽赛鸽档案" title="环 · 校准 · 历史成绩" />
        <div className="chips">
          {bloodlines.map((b) => (
            <button key={b} className={bloodFilter === b ? "chip-on" : ""} onClick={() => setBloodFilter(b)}>
              {b}
            </button>
          ))}
        </div>
        <div className="profile-list">
          {pigeons.map((p) => (
            <PigeonProfile key={p.id} pigeonId={p.id} now={now} />
          ))}
        </div>
      </section>
    </div>
  );
}
