import type { LedgerApi } from "../hooks/useLedger";
import { fmtDateTime } from "../rules/engine";
import type { LedgerEvent } from "../rules/types";
import { Empty, Panel } from "./ui";

const RULES: { title: string; body: string }[] = [
  {
    title: "一羽一环",
    body: "每羽赛鸽同一时间只认一枚在役电子环。已有在役环时拒绝再发；重复点击或并发发环沿用首次结果，绝不产生第二枚在役环。",
  },
  {
    title: "成绩双重绑定",
    body: "训放成绩必须同时绑定当次在役电子环和放飞前最近一次校准。速度 = 放飞距离 ÷（归巢时间 − 放飞时间）。",
  },
  {
    title: "七十二小时有效期",
    body: "放飞时距最近校准超过 72 小时，或根本没有校准记录，成绩只进待复核：不参与排行，也不计入未归巢。",
  },
  {
    title: "停用即失效",
    body: "电子环停用后关联成绩立即失效并重算：无新环接替进待复核；有新环接替按换环处理，旧成绩永久留档（不回排行）。",
  },
  {
    title: "更正即重算",
    body: "更正发放记录或校准记录，所有关联成绩立即失效并按新台账重算；每次状态变化都在成绩的重算轨迹中留痕。",
  },
  {
    title: "台账单一事实源",
    body: "规则（纯函数）、台账（只追加事件）、页面（派生视图）分开承载。刷新页面从事件流重放，环档案、复核队列与成绩保持一致。",
  },
];

function eventSummary(ev: LedgerEvent): string {
  switch (ev.type) {
    case "PigeonRegistered":
      return `建档赛鸽 ${ev.pigeon.band}（${ev.pigeon.bloodline}）`;
    case "RingIssued":
      return `发环 ${ev.ringCode}`;
    case "RingDeactivated":
      return `停用 ${ev.ringCode}：${ev.reason}`;
    case "IssuanceCorrected":
      return `更正发放 ${ev.ringCode} → 改绑/改时 ${fmtDateTime(ev.issuedAt)}`;
    case "CalibrationRecorded":
      return `校准 ${ev.calibration.ringCode} @ ${fmtDateTime(ev.calibration.calibratedAt)}，钟差 ${ev.calibration.offsetSec}s`;
    case "CalibrationCorrected": {
      const at = fmtDateTime(ev.calibratedAt);
      return `更正校准 ${ev.calibrationId} @ ${at}`;
    }
    case "SessionScheduled":
      return `建立场次 ${ev.session.name}（${(ev.session.distanceM / 1000).toFixed(0)}km）`;
    case "SessionCorrected":
      return `更正场次 ${ev.name}`;
    case "ResultRecorded":
      return `登记成绩：环 ${ev.boundRingCode ?? "无环"}，${ev.arrivedAt ? fmtDateTime(ev.arrivedAt) : "未归巢"}`;
    case "ResultAnnotated":
      return `复核备注：${ev.note || "（清空）"}`;
  }
}

export default function RulesLedger({
  api,
  notify,
}: {
  api: LedgerApi;
  notify: (text: string, tone?: "ok" | "err") => void;
}) {
  const events = api.events.slice().reverse();

  return (
    <div className="stack">
      <Panel title="业务规则" subtitle="规则承载 · 全部判定均由纯规则引擎完成">
        <div className="rule-grid">
          {RULES.map((r, i) => (
            <article key={r.title} className="rule-card">
              <h3>
                {String(i + 1).padStart(2, "0")} · {r.title}
              </h3>
              <p>{r.body}</p>
            </article>
          ))}
        </div>
      </Panel>

      <Panel
        title="操作台账"
        subtitle={`只追加事件日志 · 共 ${api.events.length} 条（新的在上）`}
        actions={
          <button
            onClick={() => {
              if (window.confirm("确定重置为演示台账？当前所有事件将被清空。")) {
                api.reset();
                notify("已重置为演示台账", "ok");
              }
            }}
          >
            重置演示数据
          </button>
        }
      >
        {events.length === 0 ? (
          <Empty>台账为空</Empty>
        ) : (
          <ol className="ledger-list">
            {events.map((ev, idx) => (
              <li key={`${ev.type}-${ev.at}-${idx}`}>
                <span className="ledger-type">{ev.type}</span>
                <span className="ledger-summary">{eventSummary(ev)}</span>
                <small>{fmtDateTime(ev.at)}</small>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}
