import { useState } from "react";
import { ledger } from "../ledger/store";
import { fmtDateTime } from "./useLedger";
import { SectionTitle } from "./components";

const EVENT_TEXT: Record<string, string> = {
  "pigeon-registered": "赛鸽建档",
  "ring-issued": "电子环发放",
  "ring-replaced": "换环（旧环退役留档）",
  "ring-voided": "电子环停用",
  "ring-corrected": "发放记录更正",
  "calibration-checked": "读写器校准",
  "calibration-corrected": "校准记录更正",
  "batch-created": "训放批次建立",
  "result-recorded": "成绩登记",
  "return-recorded": "归巢登记",
  "review-resolved": "复核确认",
};

export function LedgerPanel() {
  const events = ledger.getEvents().slice().reverse();
  const [filter, setFilter] = useState("全部");
  const types = ["全部", ...Array.from(new Set(events.map((e) => e.type)))];
  const shown = filter === "全部" ? events : events.filter((e) => e.type === filter);

  return (
    <section className="panel">
      <SectionTitle
        kicker="台账（只追加事件）"
        title={`事件流水 · 共 ${events.length} 条`}
        extra={
          <div className="ledger-actions">
            <button
              onClick={() => {
                if (window.confirm("重置为演示台账？当前改动将被清除。")) ledger.reset();
              }}
            >
              重置演示数据
            </button>
          </div>
        }
      />
      <div className="chips">
        {types.map((t) => (
          <button key={t} className={filter === t ? "chip-on" : ""} onClick={() => setFilter(t)}>
            {EVENT_TEXT[t] ?? t}
          </button>
        ))}
      </div>
      <div className="event-log">
        {shown.map((e) => (
          <div key={e.seq} className="event-row">
            <span className="event-seq">#{e.seq}</span>
            <span className="event-time">{fmtDateTime(e.at)}</span>
            <span className="event-type">{EVENT_TEXT[e.type] ?? e.type}</span>
            <code className="event-payload">{summarize(e)}</code>
          </div>
        ))}
      </div>
      <p className="hint">刷新页面后从该流水重新折叠：环档案、复核队列与成绩排行保持一致。</p>
    </section>
  );
}

function summarize(e: ReturnType<typeof ledger.getEvents>[number]): string {
  const pick = (obj: object) =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries(obj).filter(([k]) => !["type", "seq", "at"].includes(k))
      )
    );
  return pick(e);
}
