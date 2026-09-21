import { useState } from "react";
import type { LedgerApi } from "../hooks/useLedger";
import { activeRingFor, fmtDateTime, msToLocalInput } from "../rules/engine";
import type { RingIssue } from "../rules/types";
import { Badge, Empty, Field, Panel } from "./ui";

export default function IssueDesk({
  api,
  notify,
}: {
  api: LedgerApi;
  notify: (text: string, tone?: "ok" | "err") => void;
}) {
  const { state } = api;
  const [pigeonId, setPigeonId] = useState("");
  const [ringCode, setRingCode] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [stopCode, setStopCode] = useState("");
  const [stopReason, setStopReason] = useState("");
  const [newRingCode, setNewRingCode] = useState("");

  const [fixIssue, setFixIssue] = useState<RingIssue | null>(null);
  const [fixPigeonId, setFixPigeonId] = useState("");
  const [fixAt, setFixAt] = useState("");

  const pigeons = [...state.pigeons.values()];

  const submit = async (burst = false) => {
    if (!pigeonId) return notify("请先选择赛鸽", "err");
    if (!ringCode.trim()) return notify("请输入电子环号", "err");
    const code = ringCode.trim();
    const key = `${pigeonId}::${code}`;
    setBusyKey(key);
    try {
      // burst 演示并发：同一瞬间发两笔，第二笔沿用首次结果
      if (burst) {
        const [a, b] = await Promise.all([
          api.issueRing(pigeonId, code),
          api.issueRing(pigeonId, code),
        ]);
        notify(
          a.kind === "issued" && b.kind === "reused"
            ? `并发两笔：首次发放成功，第二笔沿用首次结果（一羽一环未被破坏）`
            : `发环结果：${a.kind === "issued" ? "首次发放" : "沿用首次"} / ${b.kind === "issued" ? "首次发放" : "沿用首次"}`,
          "ok"
        );
      } else {
        const res = await api.issueRing(pigeonId, code);
        notify(
          res.kind === "issued"
            ? `电子环 ${code} 发放成功`
            : `该环在役记录已存在，沿用首次发放结果`,
          "ok"
        );
      }
      setRingCode("");
    } catch (e) {
      notify((e as Error).message, "err");
    } finally {
      setBusyKey(null);
    }
  };

  const doStop = () => {
    try {
      if (newRingCode.trim()) {
        api.replaceRing(stopCode.trim(), newRingCode.trim(), stopReason.trim());
        notify(`换环完成：${stopCode} 停用，${newRingCode.trim()} 上岗；旧成绩留档`, "ok");
        setNewRingCode("");
      } else {
        api.deactivateRing(stopCode.trim(), stopReason.trim());
        notify(`电子环 ${stopCode} 已停用，关联成绩立即失效并重算`, "ok");
      }
      setStopCode("");
      setStopReason("");
    } catch (e) {
      notify((e as Error).message, "err");
    }
  };

  const doCorrect = () => {
    if (!fixIssue || !fixPigeonId || !fixAt) return;
    try {
      api.correctIssuance(fixIssue.ringCode, fixPigeonId, new Date(fixAt).getTime());
      notify(`发放记录已更正，关联成绩立即失效并重算`, "ok");
      setFixIssue(null);
      setFixPigeonId("");
      setFixAt("");
    } catch (e) {
      notify((e as Error).message, "err");
    }
  };

  const rows = state.issues
    .slice()
    .sort((a, b) =>
      a.deactivatedAt == null && b.deactivatedAt != null
        ? -1
        : b.deactivatedAt == null && a.deactivatedAt != null
          ? 1
          : b.issuedAt - a.issuedAt
    );

  return (
    <div className="stack">
      <div className="two-col">
        <Panel title="发放电子环" subtitle="发环台 · 每羽同时仅认一枚在役环">
          <div className="form-stack">
            <Field label="赛鸽（足环号）">
              <select value={pigeonId} onChange={(e) => setPigeonId(e.target.value)}>
                <option value="">请选择</option>
                {pigeons.map((p) => {
                  const active = activeRingFor(state.issues, p.id);
                  return (
                    <option key={p.id} value={p.id}>
                      {p.band}（{p.bloodline}）
                      {active ? ` · 在役 ${active.ringCode}` : " · 无在役环"}
                    </option>
                  );
                })}
              </select>
            </Field>
            <Field label="电子环号">
              <input
                value={ringCode}
                placeholder="如 E-2026-01"
                onChange={(e) => setRingCode(e.target.value)}
              />
            </Field>
            <div className="btn-row">
              <button
                className="primary"
                disabled={busyKey != null}
                onClick={() => submit(false)}
              >
                {busyKey ? "发环写入中…" : "发环"}
              </button>
              <button disabled={busyKey != null} onClick={() => submit(true)}>
                模拟并发双发（幂等演示）
              </button>
            </div>
            <p className="row-note">
              重复点击或并发请求共用同一发环流程，全部沿用首次结果；已有在役环时拒绝发放。
            </p>
          </div>
        </Panel>

        <Panel title="停用 / 换环" subtitle="停用即时联动成绩">
          <div className="form-stack">
            <Field label="要停用的电子环号">
              <input
                value={stopCode}
                placeholder="如 E-4550"
                onChange={(e) => setStopCode(e.target.value)}
              />
            </Field>
            <Field label="停用原因">
              <input
                value={stopReason}
                placeholder="如 环体损坏退役"
                onChange={(e) => setStopReason(e.target.value)}
              />
            </Field>
            <Field label="新电子环号（留空=仅停用不补发；填写=换环）">
              <input
                value={newRingCode}
                placeholder="换环时填写，旧成绩留档"
                onChange={(e) => setNewRingCode(e.target.value)}
              />
            </Field>
            <div className="btn-row">
              <button onClick={doStop}>
                {newRingCode.trim() ? "停用并换环" : "停用该环"}
              </button>
            </div>
            <p className="row-note">
              停用后无新环接替：关联成绩进待复核；同刻有新环接替：按换环处理，旧成绩永久留档。
            </p>
          </div>
        </Panel>
      </div>

      <Panel title="电子环台账" subtitle="环档案 · 刷新后一致">
        {rows.length === 0 ? (
          <Empty>暂无电子环</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>电子环</th>
                <th>绑定赛鸽</th>
                <th>发放时间</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => {
                const p = state.pigeons.get(i.pigeonId);
                return (
                  <tr key={i.ringCode}>
                    <td>
                      <b>{i.ringCode}</b>
                      {i.corrected ? <Badge tone="info">发放已更正</Badge> : null}
                    </td>
                    <td>{p ? `${p.band}（${p.bloodline}）` : "未绑定"}</td>
                    <td>{fmtDateTime(i.issuedAt)}</td>
                    <td>
                      {i.deactivatedAt == null ? (
                        <Badge tone="ok">在役</Badge>
                      ) : (
                        <>
                          <Badge tone="muted">已停用</Badge>
                          <small className="row-note">
                            {fmtDateTime(i.deactivatedAt)} · {i.deactivateReason}
                          </small>
                        </>
                      )}
                    </td>
                    <td>
                      <button
                        className="link-btn"
                        onClick={() => {
                          setFixIssue(i);
                          setFixPigeonId(i.pigeonId);
                          setFixAt(msToLocalInput(i.issuedAt));
                        }}
                      >
                        更正发放
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>

      {fixIssue ? (
        <div className="modal-mask" onClick={() => setFixIssue(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="heading">
              <div>
                <p>更正发放记录</p>
                <h2>{fixIssue.ringCode}</h2>
              </div>
              <button onClick={() => setFixIssue(null)}>关闭</button>
            </div>
            <p className="row-note">
              更正后所有关联成绩立即失效并按新档案重算；时间区间不得与该羽其它在役环重叠。
            </p>
            <div className="form-stack">
              <Field label="改绑赛鸽">
                <select
                  value={fixPigeonId}
                  onChange={(e) => setFixPigeonId(e.target.value)}
                >
                  {pigeons.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.band}（{p.bloodline}）
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="发放时间">
                <input
                  type="datetime-local"
                  value={fixAt}
                  onChange={(e) => setFixAt(e.target.value)}
                />
              </Field>
              <div className="btn-row">
                <button className="primary" onClick={doCorrect}>
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
