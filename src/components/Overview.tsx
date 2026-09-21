import { useMemo, useState } from "react";
import type { LedgerApi } from "../hooks/useLedger";
import {
  fmtDateTime,
  fmtSpeed,
  missingResults,
  pendingResults,
  rankedResults,
} from "../rules/engine";
import { CAL_FRESH_MS } from "../rules/engine";
import type { Pigeon, ResultRecord, RingIssue } from "../rules/types";
import { Badge, Empty, Panel } from "./ui";

function statusBadge(r: ResultRecord) {
  if (r.outcome.status === "valid")
    return r.arrivedAt == null ? (
      <Badge tone="warn">未归巢（在役有效）</Badge>
    ) : (
      <Badge tone="ok">有效成绩</Badge>
    );
  if (r.outcome.status === "archived") return <Badge tone="muted">已留档（换环）</Badge>;
  return <Badge tone="warn">待复核</Badge>;
}

function PigeonArchive({
  api,
  pigeon,
  onClose,
}: {
  api: LedgerApi;
  pigeon: Pigeon;
  onClose: () => void;
}) {
  const { state } = api;
  const issues = state.issues.filter((i) => i.pigeonId === pigeon.id);
  const results = state.results
    .filter((r) => r.pigeonId === pigeon.id)
    .sort((a, b) => b.createdAt - a.createdAt);
  const now = Date.now();

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="heading">
          <div>
            <p>单羽赛鸽档案</p>
            <h2>
              {pigeon.band} · {pigeon.bloodline}
            </h2>
          </div>
          <button onClick={onClose}>关闭</button>
        </div>

        <h3>电子环履历（同一时间仅一枚在役）</h3>
        {issues.length === 0 ? (
          <Empty>暂无发环记录</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>电子环</th>
                <th>发放时间</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {issues
                .slice()
                .sort((a, b) => a.issuedAt - b.issuedAt)
                .map((i: RingIssue) => (
                  <tr key={i.ringCode}>
                    <td>{i.ringCode}</td>
                    <td>{fmtDateTime(i.issuedAt)}</td>
                    <td>
                      {i.deactivatedAt == null ? (
                        <Badge tone="ok">在役</Badge>
                      ) : (
                        <>
                          <Badge tone="muted">
                            停用于 {fmtDateTime(i.deactivatedAt)}
                          </Badge>
                          {i.deactivateReason ? (
                            <small className="row-note">{i.deactivateReason}</small>
                          ) : null}
                        </>
                      )}
                      {i.corrected ? <Badge tone="info">发放已更正</Badge> : null}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}

        <h3>校准履历</h3>
        {(() => {
          const cals = state.calibrations
            .filter((c) => issues.some((i) => i.ringCode === c.ringCode))
            .sort((a, b) => b.calibratedAt - a.calibratedAt);
          if (cals.length === 0) return <Empty>暂无校准记录</Empty>;
          return (
            <table className="table">
              <thead>
                <tr>
                  <th>电子环</th>
                  <th>校准时间</th>
                  <th>钟差(秒)</th>
                  <th>备注</th>
                </tr>
              </thead>
              <tbody>
                {cals.map((c) => (
                  <tr key={c.id}>
                    <td>{c.ringCode}</td>
                    <td>{fmtDateTime(c.calibratedAt)}</td>
                    <td>{c.offsetSec > 0 ? `+${c.offsetSec}` : c.offsetSec}</td>
                    <td>
                      {c.note || "—"}
                      {c.corrected ? <Badge tone="info">已更正</Badge> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          );
        })()}

        <h3>历史成绩（换环旧成绩留档）</h3>
        {results.length === 0 ? (
          <Empty>暂无训放成绩</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>场次</th>
                <th>绑定环</th>
                <th>归巢时间</th>
                <th>速度</th>
                <th>状态</th>
                <th>重算</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => {
                const s = state.sessions.get(r.sessionId);
                return (
                  <tr key={r.id}>
                    <td>{s?.name ?? "—"}</td>
                    <td>{r.boundRingCode ?? "无环"}</td>
                    <td>{r.arrivedAt ? fmtDateTime(r.arrivedAt) : "未归巢"}</td>
                    <td>{fmtSpeed(r.outcome.speed)}</td>
                    <td>{statusBadge(r)}</td>
                    <td>{r.revisions.length} 次</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="row-note">
          最近一次校准须在放飞前 {Math.round(CAL_FRESH_MS / 3600000)} 小时内，当前 {fmtDateTime(now)}。
        </p>
      </div>
    </div>
  );
}

export default function Overview({ api }: { api: LedgerApi }) {
  const { state } = api;
  const [bloodline, setBloodline] = useState<string>("全部");
  const [openId, setOpenId] = useState<string | null>(null);

  const bloodlines = useMemo(
    () => ["全部", ...Array.from(new Set([...state.pigeons.values()].map((p) => p.bloodline)))],
    [state.pigeons]
  );

  const ranked = rankedResults(state).slice(0, 5);
  const missing = missingResults(state);
  const pending = pendingResults(state);
  const activeRings = state.issues.filter((i) => i.deactivatedAt == null).length;
  const arrived = state.results.filter(
    (r) => r.outcome.status === "valid" && r.arrivedAt != null
  ).length;
  const validTotal = state.results.filter((r) => r.outcome.status === "valid").length;
  const homingRate = validTotal ? Math.round((arrived / validTotal) * 100) : 0;
  const avgSpeed =
    arrived > 0
      ? Math.round(
          rankedResults(state).reduce((sum, r) => sum + (r.outcome.speed ?? 0), 0) /
            rankedResults(state).length
        )
      : null;

  const pigeons = [...state.pigeons.values()].filter(
    (p) => bloodline === "全部" || p.bloodline === bloodline
  );

  return (
    <div className="stack">
      <section className="metrics">
        <article>
          <small>有效归巢率</small>
          <strong>{homingRate}%</strong>
          <em>仅计在役环+有效校准</em>
        </article>
        <article>
          <small>平均速度</small>
          <strong>{avgSpeed ?? "—"}</strong>
          <em>m/min，排行成绩</em>
        </article>
        <article>
          <small>未归巢（有效）</small>
          <strong>{missing.length}</strong>
          <em>待复核不计入</em>
        </article>
        <article>
          <small>在役电子环 / 待复核</small>
          <strong>
            {activeRings} / {pending.length}
          </strong>
          <em>一羽一环</em>
        </article>
      </section>

      <Panel
        title="鸽棚总览"
        subtitle="赛鸽档案"
        actions={
          <div className="chips">
            {bloodlines.map((b) => (
              <button
                key={b}
                className={b === bloodline ? "chip-on" : ""}
                onClick={() => setBloodline(b)}
              >
                {b}
              </button>
            ))}
          </div>
        }
      >
        <div className="loft-grid">
          {pigeons.map((p) => {
            const active = state.issues.find(
              (i) => i.pigeonId === p.id && i.deactivatedAt == null
            );
            const rs = state.results.filter((r) => r.pigeonId === p.id);
            const best = rankedResults(state).find((r) => r.pigeonId === p.id);
            return (
              <article key={p.id} className="loft-card">
                <h3>{p.band}</h3>
                <p className="row-note">
                  {p.bloodline} · {p.role}
                </p>
                <p>
                  在役环：
                  {active ? (
                    <Badge tone="ok">{active.ringCode}</Badge>
                  ) : (
                    <Badge tone="warn">无在役环</Badge>
                  )}
                </p>
                <p>
                  训放 {rs.length} 次 · 最佳 {fmtSpeed(best?.outcome.speed ?? null)}
                </p>
                <button className="link-btn" onClick={() => setOpenId(p.id)}>
                  查看档案
                </button>
              </article>
            );
          })}
        </div>
      </Panel>

      <div className="two-col">
        <Panel title="成绩排行（全部场次 Top5）" subtitle="仅有效成绩">
          {ranked.length === 0 ? (
            <Empty>暂无有效排行成绩</Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>足环号</th>
                  <th>场次</th>
                  <th>速度</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((r, idx) => (
                  <tr key={r.id}>
                    <td>{idx + 1}</td>
                    <td>{state.pigeons.get(r.pigeonId)?.band}</td>
                    <td>{state.sessions.get(r.sessionId)?.name}</td>
                    <td>{fmtSpeed(r.outcome.speed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="未归巢提醒" subtitle="环与校准均有效才计入">
          {missing.length === 0 ? (
            <Empty>没有有效未归巢记录</Empty>
          ) : (
            <ul className="plain-list">
              {missing.map((r) => (
                <li key={r.id}>
                  <b>{state.pigeons.get(r.pigeonId)?.band}</b>
                  <span>
                    {state.sessions.get(r.sessionId)?.name} · 放飞{" "}
                    {fmtDateTime(state.sessions.get(r.sessionId)!.releasedAt)}
                  </span>
                  <Badge tone="warn">未归巢</Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {openId ? (
        <PigeonArchive
          api={api}
          pigeon={state.pigeons.get(openId)!}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </div>
  );
}
