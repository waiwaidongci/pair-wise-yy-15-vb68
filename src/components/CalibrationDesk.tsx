import { useEffect, useState } from "react";
import type { LedgerApi } from "../hooks/useLedger";
import {
  CAL_FRESH_MS,
  fmtDateTime,
  msToLocalInput,
} from "../rules/engine";
import { Badge, Empty, Field, Panel } from "./ui";

export default function CalibrationDesk({
  api,
  notify,
  prefillRing,
  consumePrefill,
}: {
  api: LedgerApi;
  notify: (text: string, tone?: "ok" | "err") => void;
  prefillRing?: string | null;
  consumePrefill?: () => void;
}) {
  const { state } = api;
  const [ringCode, setRingCode] = useState("");
  const [at, setAt] = useState(msToLocalInput(Date.now()));
  const [offset, setOffset] = useState("0");
  const [note, setNote] = useState("");

  const [fixId, setFixId] = useState<string | null>(null);
  const [fixAt, setFixAt] = useState("");
  const [fixOffset, setFixOffset] = useState("0");
  const [fixNote, setFixNote] = useState("");

  useEffect(() => {
    if (prefillRing) {
      setRingCode(prefillRing);
      setAt(msToLocalInput(Date.now()));
      consumePrefill?.();
    }
  }, [prefillRing, consumePrefill]);

  const submit = () => {
    try {
      const off = Number(offset);
      if (!ringCode.trim()) throw new Error("请选择电子环");
      if (!at) throw new Error("请填写校准时间");
      if (Number.isNaN(off)) throw new Error("钟差需为整数秒");
      api.recordCalibration(ringCode.trim(), new Date(at).getTime(), off, note.trim());
      notify("校准记录成功，待复核成绩已按新校准自动重算", "ok");
      setNote("");
    } catch (e) {
      notify((e as Error).message, "err");
    }
  };

  const submitFix = () => {
    if (!fixId) return;
    try {
      api.correctCalibration(
        fixId,
        new Date(fixAt).getTime(),
        Number(fixOffset),
        fixNote.trim()
      );
      notify("校准已更正，关联成绩立即失效并重算", "ok");
      setFixId(null);
    } catch (e) {
      notify((e as Error).message, "err");
    }
  };

  const activeIssues = state.issues.filter((i) => i.deactivatedAt == null);

  const groups = activeIssues.map((i) => {
    const p = state.pigeons.get(i.pigeonId);
    const cals = state.calibrations
      .filter((c) => c.ringCode === i.ringCode)
      .sort((a, b) => b.calibratedAt - a.calibratedAt);
    const latest = cals[0] ?? null;
    const age = latest ? Date.now() - latest.calibratedAt : null;
    return { issue: i, pigeon: p, cals, latest, age };
  });

  return (
    <div className="stack">
      <Panel title="登记校准" subtitle="校准台 · 成绩只认放飞前最近一次校准（72 小时内）">
        <div className="form-grid">
          <Field label="电子环（在役）">
            <select value={ringCode} onChange={(e) => setRingCode(e.target.value)}>
              <option value="">请选择</option>
              {groups.map(({ issue, pigeon, age }) => (
                <option key={issue.ringCode} value={issue.ringCode}>
                  {issue.ringCode} · {pigeon?.band}
                  {age != null && age <= CAL_FRESH_MS ? "（校准新鲜）" : "（需校准）"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="校准时间">
            <input
              type="datetime-local"
              value={at}
              onChange={(e) => setAt(e.target.value)}
            />
          </Field>
          <Field label="环钟钟差（秒，正=偏快）">
            <input
              type="number"
              value={offset}
              onChange={(e) => setOffset(e.target.value)}
            />
          </Field>
          <Field label="备注">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="如 赛前基准校" />
          </Field>
        </div>
        <div className="btn-row">
          <button className="primary" onClick={submit}>
            保存校准
          </button>
        </div>
      </Panel>

      <Panel title="在役环校准状态" subtitle={`校准有效期 ${CAL_FRESH_MS / 3600000} 小时`}>
        {groups.length === 0 ? (
          <Empty>暂处在役电子环</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>电子环</th>
                <th>赛鸽</th>
                <th>最近校准</th>
                <th>已历时</th>
                <th>校准次数</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(({ issue, pigeon, cals, latest, age }) => {
                const fresh = age != null && age <= CAL_FRESH_MS;
                return (
                  <tr key={issue.ringCode}>
                    <td>
                      <b>{issue.ringCode}</b>
                    </td>
                    <td>{pigeon ? `${pigeon.band}（${pigeon.bloodline}）` : "—"}</td>
                    <td>
                      {latest ? (
                        <>
                          {fmtDateTime(latest.calibratedAt)}
                          {latest.corrected ? <Badge tone="info">已更正</Badge> : null}
                        </>
                      ) : (
                        <Badge tone="warn">从未校准</Badge>
                      )}
                    </td>
                    <td>
                      {age == null ? (
                        "—"
                      ) : fresh ? (
                        <Badge tone="ok">{fmtAge(age)}</Badge>
                      ) : (
                        <Badge tone="warn">{fmtAge(age)}（超72h）</Badge>
                      )}
                    </td>
                    <td>{cals.length}</td>
                    <td>
                      {latest ? (
                        <button
                          className="link-btn"
                          onClick={() => {
                            setFixId(latest.id);
                            setFixAt(msToLocalInput(latest.calibratedAt));
                            setFixOffset(String(latest.offsetSec));
                            setFixNote(latest.note);
                          }}
                        >
                          更正最近校准
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>

      {fixId ? (
        <div className="modal-mask" onClick={() => setFixId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="heading">
              <div>
                <p>更正校准记录</p>
                <h2>{fixId}</h2>
              </div>
              <button onClick={() => setFixId(null)}>关闭</button>
            </div>
            <div className="form-stack">
              <Field label="校准时间">
                <input
                  type="datetime-local"
                  value={fixAt}
                  onChange={(e) => setFixAt(e.target.value)}
                />
              </Field>
              <Field label="钟差（秒）">
                <input
                  type="number"
                  value={fixOffset}
                  onChange={(e) => setFixOffset(e.target.value)}
                />
              </Field>
              <Field label="备注">
                <input value={fixNote} onChange={(e) => setFixNote(e.target.value)} />
              </Field>
              <div className="btn-row">
                <button className="primary" onClick={submitFix}>
                  提交更正并重算
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function fmtAge(ms: number): string {
  const h = Math.floor(ms / 3600000);
  if (h < 24) return `${h} 小时`;
  return `${(h / 24).toFixed(1)} 天`;
}
