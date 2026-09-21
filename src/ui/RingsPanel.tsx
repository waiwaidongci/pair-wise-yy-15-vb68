import { useState } from "react";
import { ledger } from "../ledger/store";
import { CALIB_TTL_MS, PENDING_REASON_TEXT } from "../domain/rules";
import type { IssueOutcome, Pigeon } from "../domain/types";
import { useLedger, fmtAge, fmtDateTime, toLocalInputValue } from "./useLedger";
import { Badge, Field, SectionTitle } from "./components";

function latestCalibFor(state: ReturnType<typeof useLedger>, pigeonId: string, anchor: number) {
  let best: { id: string; calibratedAt: number; offsetMs: number; readerId: string; superseded?: boolean } | undefined;
  for (const c of state.calibrations.values()) {
    if (c.pigeonId !== pigeonId || c.superseded) continue;
    if (c.calibratedAt <= anchor && (!best || c.calibratedAt > best.calibratedAt)) best = c;
  }
  return best;
}

function RingCorrection({ ringId, onDone }: { ringId: string; onDone: () => void }) {
  const state = useLedger();
  const ring = state.rings.get(ringId)!;
  const [issuedAt, setIssuedAt] = useState(toLocalInputValue(ring.issuedAt));
  const [note, setNote] = useState(ring.note);
  const [reason, setReason] = useState("");

  return (
    <div className="inline-form">
      <Field label="更正后发环时间">
        <input type="datetime-local" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
      </Field>
      <Field label="更正后备注">
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Field label="更正原因（必填）">
        <input placeholder="如：发环时间登记错误" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div className="inline-actions">
        <button
          className="primary"
          disabled={!reason || !issuedAt}
          onClick={() => {
            ledger.correctRing({ ringId, issuedAt: new Date(issuedAt).getTime(), note, reason });
            onDone();
          }}
        >
          提交更正并重算成绩
        </button>
        <button onClick={onDone}>取消</button>
      </div>
      <p className="hint">更正后关联成绩立即失效并重新判定，可能转入待复核。</p>
    </div>
  );
}

function CalibCorrection({ calibId, onDone }: { calibId: string; onDone: () => void }) {
  const state = useLedger();
  const c = state.calibrations.get(calibId)!;
  const [at, setAt] = useState(toLocalInputValue(c.calibratedAt));
  const [offset, setOffset] = useState(String(c.offsetMs));
  const [reader, setReader] = useState(c.readerId);
  const [note, setNote] = useState(c.note);
  const [reason, setReason] = useState("");

  return (
    <div className="inline-form">
      <Field label="更正后校准时间">
        <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
      </Field>
      <Field label="读写器钟差(ms)">
        <input type="number" value={offset} onChange={(e) => setOffset(e.target.value)} />
      </Field>
      <Field label="读写器编号">
        <input value={reader} onChange={(e) => setReader(e.target.value)} />
      </Field>
      <Field label="校准备注">
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Field label="更正原因（必填）">
        <input placeholder="如：钟差符号录反" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div className="inline-actions">
        <button
          className="primary"
          disabled={!reason || !at}
          onClick={() => {
            ledger.correctCalibration({
              calibrationId: calibId,
              readerId: reader,
              calibratedAt: new Date(at).getTime(),
              offsetMs: Number(offset) || 0,
              note,
              reason,
            });
            onDone();
          }}
        >
          补登更正并重算成绩
        </button>
        <button onClick={onDone}>取消</button>
      </div>
    </div>
  );
}

function PigeonCard({ pigeon, now }: { pigeon: Pigeon; now: number }) {
  const state = useLedger();
  const rings = [...state.rings.values()].filter((r) => r.pigeonId === pigeon.id);
  const active = rings.find((r) => r.status === "active");
  const calibs = [...state.calibrations.values()]
    .filter((c) => c.pigeonId === pigeon.id)
    .sort((a, b) => b.calibratedAt - a.calibratedAt);
  const [showIssue, setShowIssue] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [showCalib, setShowCalib] = useState(false);
  const [correctRing, setCorrectRing] = useState<string | null>(null);
  const [correctCalib, setCorrectCalib] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [code, setCode] = useState(`CHN-E${String(Math.floor(1000 + Math.random() * 9000))}`);
  const [note, setNote] = useState("");
  const [newCode, setNewCode] = useState("");
  const [replaceNote, setReplaceNote] = useState("");
  const [offset, setOffset] = useState("0");
  const [reader, setReader] = useState("RW-棚01");
  const [calibNote, setCalibNote] = useState("");

  const anchor = now;
  const latest = latestCalibFor(state, pigeon.id, anchor);
  const fresh = latest && anchor - latest.calibratedAt <= CALIB_TTL_MS;

  async function doIssue(concurrent = false) {
    setBusy(true);
    setNotice(null);
    try {
      const calls: Promise<IssueOutcome>[] = [
        ledger.issueRing({ pigeonId: pigeon.id, code: code.trim(), note }),
      ];
      if (concurrent) {
        // 同一瞬间再发一次（甚至换个环号），应沿用首次结果
        calls.push(ledger.issueRing({ pigeonId: pigeon.id, code: `${code.trim()}-DUP`, note: "并发重复请求" }));
      }
      const [first, second] = await Promise.all(calls);
      setNotice(
        second
          ? `首单 ${first.deduped ? "沿用" : "新建"} ${first.code}；并发单${second.deduped ? "已合并沿用首次结果" : "异常"}。`
          : first.deduped
            ? first.notice ?? "沿用首次发环结果。"
            : `发环成功：${first.code}`
      );
      setShowIssue(false);
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="pigeon-card">
      <header>
        <div>
          <h3>{pigeon.band}</h3>
          <p className="muted">
            {pigeon.id} · {pigeon.bloodline} · {pigeon.health}
          </p>
        </div>
        <div className="badge-row">
          {active ? <Badge tone="ok">在役 {active.code}</Badge> : <Badge tone="danger">无在役环</Badge>}
          {latest ? (
            fresh ? (
              <Badge tone="ok">校准有效</Badge>
            ) : (
              <Badge tone="warn">校准超72h</Badge>
            )
          ) : (
            <Badge tone="muted">无校准</Badge>
          )}
        </div>
      </header>

      <dl className="kv">
        <dt>在役环发环时间</dt>
        <dd>{active ? `${fmtDateTime(active.issuedAt)}（${fmtAge(active.issuedAt, now)}）` : "—"}</dd>
        <dt>最近一次校准</dt>
        <dd>
          {latest
            ? `${fmtDateTime(latest.calibratedAt)} · 钟差 ${latest.offsetMs}ms · ${latest.readerId}`
            : "缺失"}
        </dd>
      </dl>

      {rings.length > 1 && (
        <details className="history">
          <summary>环档案（{rings.length} 枚）</summary>
          {rings
            .slice()
            .sort((a, b) => b.issuedAt - a.issuedAt)
            .map((r) => (
              <div key={r.id} className="ledger-line">
                <Badge tone={r.status === "active" ? "ok" : r.retireReason === "void" ? "danger" : "muted"}>
                  {r.status === "active" ? "在役" : r.retireReason === "void" ? "停用" : "换环退役"}
                </Badge>
                <span>
                  <b>{r.code}</b> · {fmtDateTime(r.issuedAt)}
                  {r.replacedBy ? ` → 继任 ${state.rings.get(r.replacedBy)?.code ?? r.replacedBy}` : ""}
                  {r.correctedAt ? <em> · 已于 {fmtDateTime(r.correctedAt)} 更正</em> : ""}
                </span>
                {r.status === "active" && (
                  <button className="mini" onClick={() => setCorrectRing(correctRing === r.id ? null : r.id)}>
                    更正发放
                  </button>
                )}
              </div>
            ))}
        </details>
      )}

      {active && rings.length === 1 && (
        <div className="row-actions">
          <button className="mini" onClick={() => setCorrectRing(correctRing === active.id ? null : active.id)}>
            更正发放记录
          </button>
        </div>
      )}
      {correctRing && <RingCorrection ringId={correctRing} onDone={() => setCorrectRing(null)} />}

      {calibs.length > 0 && (
        <details className="history">
          <summary>校准记录（{calibs.length} 条）</summary>
          {calibs.map((c) => (
            <div key={c.id} className="ledger-line">
              <Badge tone={c.superseded ? "muted" : "accent"}>{c.superseded ? "已作废" : "有效"}</Badge>
              <span>
                <b>{fmtDateTime(c.calibratedAt)}</b> · {c.readerId} · 钟差 {c.offsetMs}ms · {c.note}
              </span>
              {!c.superseded && (
                <button className="mini" onClick={() => setCorrectCalib(correctCalib === c.id ? null : c.id)}>
                  更正校准
                </button>
              )}
            </div>
          ))}
        </details>
      )}
      {correctCalib && <CalibCorrection calibId={correctCalib} onDone={() => setCorrectCalib(null)} />}

      <div className="card-actions">
        {!active && (
          <button className="mini" onClick={() => setShowIssue((v) => !v)}>
            发放电子环
          </button>
        )}
        {active && (
          <>
            <button className="mini" onClick={() => setShowReplace((v) => !v)}>
              换环
            </button>
            <button
              className="mini danger-btn"
              onClick={() => {
                const note = window.prompt("停用原因（关联在役成绩将进入待复核）", "环体故障");
                if (note) ledger.voidRing({ ringId: active.id, note });
              }}
            >
              停用环
            </button>
            <button className="mini" onClick={() => setShowCalib((v) => !v)}>
              新增校准
            </button>
          </>
        )}
      </div>

      {showIssue && !active && (
        <div className="inline-form">
          <Field label="电子环号（全局唯一）">
            <input value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field label="备注">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="如：补发" />
          </Field>
          <div className="inline-actions">
            <button className="primary" disabled={busy || !code.trim()} onClick={() => doIssue(false)}>
              {busy ? "发环写入中…" : "确认发环"}
            </button>
            <button disabled={busy} onClick={() => doIssue(true)} title="同一瞬间提交两单发环请求">
              模拟并发发环
            </button>
          </div>
          <p className="hint">每羽同一时间只认一枚在役环；重复或并发发环沿用首次结果。</p>
        </div>
      )}

      {showReplace && active && (
        <div className="inline-form">
          <Field label="新电子环号">
            <input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="CHN-E0000" />
          </Field>
          <Field label="换环原因">
            <input value={replaceNote} onChange={(e) => setReplaceNote(e.target.value)} />
          </Field>
          <div className="inline-actions">
            <button
              className="primary"
              disabled={!newCode.trim()}
              onClick={() => {
                try {
                  ledger.replaceRing({ pigeonId: pigeon.id, newCode: newCode.trim(), note: replaceNote });
                  setShowReplace(false);
                  setNewCode("");
                  setReplaceNote("");
                } catch (err) {
                  setNotice((err as Error).message);
                }
              }}
            >
              确认换环（旧成绩留档）
            </button>
          </div>
        </div>
      )}

      {showCalib && active && (
        <div className="inline-form">
          <div className="form-row">
            <Field label="读写器编号">
              <input value={reader} onChange={(e) => setReader(e.target.value)} />
            </Field>
            <Field label="钟差(ms)">
              <input type="number" value={offset} onChange={(e) => setOffset(e.target.value)} />
            </Field>
          </div>
          <Field label="备注">
            <input value={calibNote} onChange={(e) => setCalibNote(e.target.value)} />
          </Field>
          <div className="inline-actions">
            <button
              className="primary"
              onClick={() => {
                ledger.calibrate({
                  pigeonId: pigeon.id,
                  readerId: reader,
                  offsetMs: Number(offset) || 0,
                  note: calibNote,
                });
                setShowCalib(false);
              }}
            >
              记录校准（时间取当前）
            </button>
          </div>
        </div>
      )}

      {notice && <p className="notice">{notice}</p>}
    </article>
  );
}

export function RingsPanel({ now }: { now: number }) {
  const state = useLedger();
  const [band, setBand] = useState("");
  const [bloodline, setBloodline] = useState("");
  const [health, setHealth] = useState("健康");
  const [bloodFilter, setBloodFilter] = useState<string>("全部");

  const bloodlines = ["全部", ...new Set([...state.pigeons.values()].map((p) => p.bloodline))];
  const pigeons = [...state.pigeons.values()].filter(
    (p) => bloodFilter === "全部" || p.bloodline === bloodFilter
  );

  return (
    <section className="panel">
      <SectionTitle kicker="电子环发放台" title="环档案 · 一羽一环在役" />

      <div className="chips">
        {bloodlines.map((b) => (
          <button key={b} className={bloodFilter === b ? "chip-on" : ""} onClick={() => setBloodFilter(b)}>
            {b}
          </button>
        ))}
      </div>

      <details className="add-pigeon">
        <summary>+ 新增赛鸽档案</summary>
        <div className="inline-form">
          <div className="form-row">
            <Field label="统一足环号">
              <input value={band} onChange={(e) => setBand(e.target.value)} placeholder="CHN-24-000000" />
            </Field>
            <Field label="血统">
              <input value={bloodline} onChange={(e) => setBloodline(e.target.value)} placeholder="詹森系" />
            </Field>
            <Field label="健康状态">
              <input value={health} onChange={(e) => setHealth(e.target.value)} />
            </Field>
          </div>
          <button
            className="primary"
            disabled={!band.trim() || !bloodline.trim()}
            onClick={() => {
              ledger.registerPigeon({ band: band.trim(), bloodline: bloodline.trim(), health });
              setBand("");
              setBloodline("");
            }}
          >
            建立档案
          </button>
        </div>
      </details>

      <div className="pigeon-grid">
        {pigeons.map((p) => (
          <PigeonCard key={p.id} pigeon={p} now={now} />
        ))}
      </div>

      <p className="hint rule-note">
        {PENDING_REASON_TEXT["ring-missing"]} / 停用 / 校准缺失或超 72 小时的成绩只进待复核，不计排行与未归巢；
        更正发放或校准记录会令关联成绩立即失效并重算；换环后旧成绩留档。
      </p>
    </section>
  );
}
