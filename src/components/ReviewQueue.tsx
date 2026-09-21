import { useState } from "react";
import type { LedgerApi } from "../hooks/useLedger";
import {
  PENDING_REASON_TEXT,
  fmtDateTime,
  fmtSpeed,
  msToLocalInput,
} from "../rules/engine";
import type { ResultRecord } from "../rules/types";
import { Badge, Empty, Field, Panel } from "./ui";

function reasonText(r: ResultRecord): string {
  if (r.outcome.status !== "pending" || r.outcome.reason == null) return "";
  return PENDING_REASON_TEXT[r.outcome.reason];
}

function RevisionTrail({ r }: { r: ResultRecord }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rev-trail">
      <button className="link-btn" onClick={() => setOpen((v) => !v)}>
        {open ? "收起" : "查看"}重算轨迹（{r.revisions.length}）
      </button>
      {open ? (
        <ol className="rev-list">
          {r.revisions.map((v, i) => (
            <li key={i}>
              <small>{fmtDateTime(v.at)}</small>
              <span>{v.label}</span>
              <em>
                {v.before ? `${v.before.status}${v.before.reason ? "/" + v.before.reason : ""}` : "（新建）"}
                {" → "}
                {v.after.status}
                {v.after.reason ? "/" + v.after.reason : ""}
                {v.after.status === "valid" && v.after.speed != null
                  ? ` · ${fmtSpeed(v.after.speed)}`
                  : ""}
              </em>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

export default function ReviewQueue({
  api,
  notify,
  goCalibrate,
}: {
  api: LedgerApi;
  notify: (text: string, tone?: "ok" | "err") => void;
  goCalibrate: (ringCode: string) => void;
}) {
  const { state } = api;
  const [noteId, setNoteId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const archived = state.results.filter((r) => r.outcome.status === "archived");
  const pending = state.results
    .filter((r) => r.outcome.status === "pending")
    .sort((a, b) => {
      const sa = state.sessions.get(a.sessionId)?.releasedAt ?? 0;
      const sb = state.sessions.get(b.sessionId)?.releasedAt ?? 0;
      return sb - sa;
    });

  const saveNote = (id: string) => {
    api.annotateResult(id, note.trim());
    notify("复核备注已保存", "ok");
    setNoteId(null);
    setNote("");
  };

  return (
    <div className="stack">
      <Panel
        title="待复核队列"
        subtitle="环停用 / 无在役环 / 校准缺失 / 超72小时 / 时间矛盾：不计排行与未归巢"
      >
        {pending.length === 0 ? (
          <Empty>队列已清空，所有成绩都已有效或留档</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>场次</th>
                <th>足环号</th>
                <th>绑定环</th>
                <th>归巢时间</th>
                <th>待复核原因</th>
                <th>处理</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((r) => {
                const p = state.pigeons.get(r.pigeonId);
                const s = state.sessions.get(r.sessionId);
                const reason = r.outcome.reason;
                return (
                  <tr key={r.id} className="row-pending">
                    <td>{s?.name}</td>
                    <td>{p?.band}</td>
                    <td>{r.outcome.ringCode ?? "无环"}</td>
                    <td>{r.arrivedAt ? fmtDateTime(r.arrivedAt) : "未归巢"}</td>
                    <td>
                      <Badge tone="warn">{reasonText(r)}</Badge>
                      {r.note ? <small className="row-note">备注：{r.note}</small> : null}
                      <RevisionTrail r={r} />
                    </td>
                    <td>
                      <div className="btn-col">
                        {reason === "CAL_MISSING" || reason === "CAL_STALE" ? (
                          r.outcome.ringCode ? (
                            <button
                              className="primary small"
                              onClick={() => goCalibrate(r.outcome.ringCode!)}
                            >
                              去校准该环
                            </button>
                          ) : null
                        ) : null}
                        {noteId === r.id ? (
                          <span className="inline-note">
                            <input
                              value={note}
                              placeholder="复核意见"
                              onChange={(e) => setNote(e.target.value)}
                            />
                            <button className="small" onClick={() => saveNote(r.id)}>
                              保存
                            </button>
                            <button className="small" onClick={() => setNoteId(null)}>
                              取消
                            </button>
                          </span>
                        ) : (
                          <button
                            className="small"
                            onClick={() => {
                              setNoteId(r.id);
                              setNote(r.note);
                            }}
                          >
                            {r.note ? "改复核备注" : "加复核备注"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="留档成绩" subtitle="换环前的旧成绩：永久留档，不回排行、不计未归巢">
        {archived.length === 0 ? (
          <Empty>暂无留档成绩</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>场次</th>
                <th>足环号</th>
                <th>旧环</th>
                <th>归巢时间</th>
                <th>当时速度（参考）</th>
              </tr>
            </thead>
            <tbody>
              {archived.map((r) => (
                <tr key={r.id}>
                  <td>{state.sessions.get(r.sessionId)?.name}</td>
                  <td>{state.pigeons.get(r.pigeonId)?.band}</td>
                  <td>{r.boundRingCode}</td>
                  <td>{r.arrivedAt ? fmtDateTime(r.arrivedAt) : "未归巢"}</td>
                  <td>{fmtSpeed(r.outcome.speed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

export function SessionCorrectButton({
  api,
  sessionId,
  notify,
}: {
  api: LedgerApi;
  sessionId: string;
  notify: (text: string, tone?: "ok" | "err") => void;
}) {
  const { state } = api;
  const s = state.sessions.get(sessionId);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: s?.name ?? "",
    site: s?.site ?? "",
    distanceM: String(s?.distanceM ?? ""),
    weather: s?.weather ?? "",
    releasedAt: s ? msToLocalInput(s.releasedAt) : "",
  });
  if (!s) return null;

  const submit = () => {
    const d = Number(form.distanceM);
    if (!form.releasedAt || Number.isNaN(d) || d <= 0) {
      notify("请补全放飞时间和有效距离", "err");
      return;
    }
    api.correctSession(sessionId, {
      name: form.name,
      site: form.site,
      distanceM: d,
      weather: form.weather,
      releasedAt: new Date(form.releasedAt).getTime(),
    });
    notify("场次已更正，绑定成绩立即失效并重算", "ok");
    setOpen(false);
  };

  return (
    <>
      <button className="small" onClick={() => setOpen(true)}>
        更正场次
      </button>
      {open ? (
        <div className="modal-mask" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="heading">
              <div>
                <p>更正训放场次</p>
                <h2>{s.name}</h2>
              </div>
              <button onClick={() => setOpen(false)}>关闭</button>
            </div>
            <div className="form-grid">
              <Field label="站名">
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="地点">
                <input value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })} />
              </Field>
              <Field label="放飞距离（米）">
                <input
                  type="number"
                  value={form.distanceM}
                  onChange={(e) => setForm({ ...form, distanceM: e.target.value })}
                />
              </Field>
              <Field label="天气">
                <input
                  value={form.weather}
                  onChange={(e) => setForm({ ...form, weather: e.target.value })}
                />
              </Field>
              <Field label="放飞时间">
                <input
                  type="datetime-local"
                  value={form.releasedAt}
                  onChange={(e) => setForm({ ...form, releasedAt: e.target.value })}
                />
              </Field>
            </div>
            <div className="btn-row">
              <button className="primary" onClick={submit}>
                提交更正并重算
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
