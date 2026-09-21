import { useMemo, useState } from "react";
import type { LedgerApi } from "../hooks/useLedger";
import {
  fmtDateTime,
  fmtSpeed,
  missingResults,
  rankedResults,
} from "../rules/engine";
import type { TrainingSession } from "../rules/types";
import { Badge, Empty, Field, Panel } from "./ui";
import { SessionCorrectButton } from "./ReviewQueue";

function NewSessionForm({
  api,
  notify,
}: {
  api: LedgerApi;
  notify: (text: string, tone?: "ok" | "err") => void;
}) {
  const [form, setForm] = useState({
    name: "",
    site: "",
    distanceM: "120000",
    weather: "晴",
    releasedAt: "",
  });
  const submit = () => {
    const d = Number(form.distanceM);
    if (!form.name || !form.releasedAt || Number.isNaN(d) || d <= 0) {
      notify("请补全站名、放飞时间和有效距离", "err");
      return;
    }
    api.scheduleSession({
      name: form.name,
      site: form.site,
      distanceM: d,
      weather: form.weather,
      releasedAt: new Date(form.releasedAt).getTime(),
    });
    notify("训放场次已建立", "ok");
    setForm({ name: "", site: "", distanceM: "120000", weather: "晴", releasedAt: "" });
  };
  return (
    <Panel title="建立训放场次" subtitle="训放成绩复核台">
      <div className="form-grid">
        <Field label="站名">
          <input value={form.name} placeholder="如 第4站 安阳" onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="放飞地点">
          <input value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })} />
        </Field>
        <Field label="放飞距离（米）">
          <input type="number" value={form.distanceM} onChange={(e) => setForm({ ...form, distanceM: e.target.value })} />
        </Field>
        <Field label="天气">
          <input value={form.weather} onChange={(e) => setForm({ ...form, weather: e.target.value })} />
        </Field>
        <Field label="放飞时间">
          <input type="datetime-local" value={form.releasedAt} onChange={(e) => setForm({ ...form, releasedAt: e.target.value })} />
        </Field>
      </div>
      <div className="btn-row">
        <button className="primary" onClick={submit}>
          建立场次
        </button>
      </div>
    </Panel>
  );
}

function RecordResultForm({
  api,
  session,
  notify,
}: {
  api: LedgerApi;
  session: TrainingSession;
  notify: (text: string, tone?: "ok" | "err") => void;
}) {
  const { state } = api;
  const [pigeonId, setPigeonId] = useState("");
  const [arrived, setArrived] = useState("");
  const [missing, setMissing] = useState(false);

  const recorded = new Set(
    state.results.filter((r) => r.sessionId === session.id).map((r) => r.pigeonId)
  );
  const candidates = [...state.pigeons.values()].filter((p) => !recorded.has(p.id));

  const submit = () => {
    if (!pigeonId) return notify("请选择赛鸽", "err");
    try {
      const arrivedAt = missing
        ? null
        : arrived
          ? new Date(arrived).getTime()
          : null;
      api.recordResult(session.id, pigeonId, arrivedAt);
      notify(
        missing
          ? "已登记未归巢，系统将按在役环与校准判定是否有效"
          : arrivedAt == null
            ? "已登记（未填归巢时间，视为未归巢）"
            : "成绩已登记并完成绑定评定",
        "ok"
      );
      setPigeonId("");
      setArrived("");
      setMissing(false);
    } catch (e) {
      notify((e as Error).message, "err");
    }
  };

  return (
    <div className="record-form">
      <div className="form-grid">
        <Field label="赛鸽">
          <select value={pigeonId} onChange={(e) => setPigeonId(e.target.value)}>
            <option value="">请选择</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.band}（{p.bloodline}）
              </option>
            ))}
          </select>
        </Field>
        <Field label={`归巢时间（放飞 ${fmtDateTime(session.releasedAt)}）`}>
          <input
            type="datetime-local"
            disabled={missing}
            value={arrived}
            onChange={(e) => setArrived(e.target.value)}
          />
        </Field>
        <Field label="仍在飞行 / 未归巢">
          <label className="check">
            <input type="checkbox" checked={missing} onChange={(e) => setMissing(e.target.checked)} />
            <span>暂不填归巢时间，按未归巢登记</span>
          </label>
        </Field>
      </div>
      <div className="btn-row">
        <button className="primary" onClick={submit}>
          登记成绩
        </button>
      </div>
      <p className="row-note">
        登记时自动绑定该羽放飞当刻的在役环与最近一次校准；环停用、校准缺失或超过 72 小时，一律进待复核。
      </p>
    </div>
  );
}

export default function TrainingDesk({
  api,
  notify,
}: {
  api: LedgerApi;
  notify: (text: string, tone?: "ok" | "err") => void;
}) {
  const { state } = api;
  const sessions = useMemo(
    () => [...state.sessions.values()].sort((a, b) => b.releasedAt - a.releasedAt),
    [state.sessions]
  );
  const [selectedId, setSelectedId] = useState<string>(sessions[0]?.id ?? "");
  const session = state.sessions.get(selectedId) ?? sessions[0];

  const ranked = session ? rankedResults(state, session.id) : [];
  const missing = session ? missingResults(state, session.id) : [];
  const rows = session
    ? state.results
        .filter((r) => r.sessionId === session.id)
        .sort((a, b) => (a.arrivedAt ?? Infinity) - (b.arrivedAt ?? Infinity))
    : [];

  const validCount = rows.filter((r) => r.outcome.status === "valid").length;
  const arrivedCount = rows.filter(
    (r) => r.outcome.status === "valid" && r.arrivedAt != null
  ).length;

  return (
    <div className="stack">
      <NewSessionForm api={api} notify={notify} />

      <Panel
        title="场次成绩"
        subtitle="排行只取有效成绩"
        actions={
          <select
            className="session-select"
            value={session?.id ?? ""}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {fmtDateTime(s.releasedAt)}
              </option>
            ))}
          </select>
        }
      >
        {!session ? (
          <Empty>先建立一个训放场次</Empty>
        ) : (
          <>
            <div className="session-meta">
              <div>
                <strong>{session.name}</strong>
                <span>
                  {session.site} · {(session.distanceM / 1000).toFixed(0)}km · {session.weather}
                </span>
                <span>放飞 {fmtDateTime(session.releasedAt)}</span>
                <span>
                  有效归巢率 {validCount ? Math.round((arrivedCount / validCount) * 100) : 0}%
                </span>
              </div>
              <SessionCorrectButton api={api} sessionId={session.id} notify={notify} />
            </div>

            <RecordResultForm api={api} session={session} notify={notify} />

            <h3>成绩排行</h3>
            {ranked.length === 0 ? (
              <Empty>本场暂无有效归巢成绩</Empty>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>名次</th>
                    <th>足环号</th>
                    <th>绑定在役环</th>
                    <th>校准</th>
                    <th>归巢时间</th>
                    <th>速度</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((r, idx) => {
                    const p = state.pigeons.get(r.pigeonId);
                    const cal = state.calibrations.find(
                      (c) => c.id === r.outcome.calibrationId
                    );
                    return (
                      <tr key={r.id}>
                        <td>
                          <b>#{idx + 1}</b>
                        </td>
                        <td>{p?.band}</td>
                        <td>{r.outcome.ringCode}</td>
                        <td>
                          {cal ? (
                            <small className="row-note">
                              {fmtDateTime(cal.calibratedAt)}
                              {cal.corrected ? "（已更正）" : ""}
                            </small>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>{r.arrivedAt ? fmtDateTime(r.arrivedAt) : "—"}</td>
                        <td>
                          <b>{fmtSpeed(r.outcome.speed)}</b>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            <h3>本场全部登记（含待复核 / 留档）</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>足环号</th>
                  <th>绑定环</th>
                  <th>归巢</th>
                  <th>速度</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{state.pigeons.get(r.pigeonId)?.band}</td>
                    <td>{r.boundRingCode ?? "无环"}</td>
                    <td>{r.arrivedAt ? fmtDateTime(r.arrivedAt) : "未归巢"}</td>
                    <td>{fmtSpeed(r.outcome.speed)}</td>
                    <td>
                      {r.outcome.status === "valid" ? (
                        r.arrivedAt == null ? (
                          <Badge tone="warn">未归巢</Badge>
                        ) : (
                          <Badge tone="ok">有效</Badge>
                        )
                      ) : r.outcome.status === "archived" ? (
                        <Badge tone="muted">换环留档</Badge>
                      ) : (
                        <Badge tone="warn">待复核</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3>未归巢提醒（仅有效环+新鲜校准）</h3>
            {missing.length === 0 ? (
              <Empty>本场暂无有效未归巢记录</Empty>
            ) : (
              <ul className="plain-list">
                {missing.map((r) => (
                  <li key={r.id}>
                    <b>{state.pigeons.get(r.pigeonId)?.band}</b>
                    <span>{r.outcome.ringCode} 已超过放飞时刻尚未归巢</span>
                    <Badge tone="warn">未归巢</Badge>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
