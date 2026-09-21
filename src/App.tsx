import { useMemo, useState } from "react";
import { useLedger, fmtAge } from "./ui/useLedger";
import { RingsPanel } from "./ui/RingsPanel";
import { TrainingPanel } from "./ui/TrainingPanel";
import { ReviewPanel } from "./ui/ReviewPanel";
import { LedgerPanel } from "./ui/LedgerPanel";

const RULES: Array<{ title: string; body: string }> = [
  {
    title: "一羽一环在役",
    body: "每羽赛鸽同一时间只认一枚在役电子环。重复或并发发环沿用首次结果；电子环号全局唯一。",
  },
  {
    title: "成绩绑定环与校准",
    body: "训放成绩必须绑定当次开笼时的在役环和开笼前最近一次校准。环停用、校准缺失或距开笼超过 72 小时，只进待复核，不计排行，也不计未归巢。",
  },
  {
    title: "更正即失效重算",
    body: "更正发放记录或校准记录，关联成绩立即失效并按新记录重新判定；新的有效环/校准可让成绩恢复有效。",
  },
  {
    title: "换环旧成绩留档",
    body: "换环后旧环退役、旧成绩永久留档，不再参与排行与未归巢统计；新批次成绩绑定新环。",
  },
  {
    title: "规则 / 台账 / 页面分离",
    body: "规则层为纯函数，台账层只追加事件并持久化，页面层只读派生视图；刷新后环档案、复核队列与成绩一致。",
  },
];

type Tab = "rings" | "training" | "review" | "ledger";

function App() {
  const state = useLedger();
  const [tab, setTab] = useState<Tab>("rings");
  const now = Date.now();

  const metrics = useMemo(() => {
    const activeRings = [...state.rings.values()].filter((r) => r.status === "active").length;
    const pending = state.results.filter((r) => r.status === "pending" && !r.resolvedAt).length;
    const unreturned = state.results.filter(
      (r) => r.status === "valid" && r.returnedAt === null
    ).length;
    const validReturned = state.results.filter(
      (r) => r.status === "valid" && r.speed !== null
    );
    const avgSpeed =
      validReturned.length > 0
        ? Math.round(
            (validReturned.reduce((sum, r) => sum + (r.speed ?? 0), 0) / validReturned.length) * 10
          ) / 10
        : 0;
    return { activeRings, pending, unreturned, avgSpeed, pigeons: state.pigeons.size };
  }, [state]);

  const latestEventAt = state.results.length
    ? Math.max(...state.results.map((r) => r.recordedAt))
    : now;

  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: "rings", label: "电子环发放台" },
    { id: "training", label: "训放成绩台" },
    { id: "review", label: "成绩复核台", count: metrics.pending },
    { id: "ledger", label: "规则与台账" },
  ];

  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62014 · 电子环发放与成绩复核台 · Port 62014</p>
        <h1>赛鸽电子环 · 训放成绩复核台</h1>
        <span>
          每羽同一时间只认一枚在役电子环，重复或并发发环沿用首次结果；成绩绑定当次在役环与最近一次校准，
          环停用、校准缺失或超 72 小时只进待复核。规则、台账与页面分开承载，刷新后数据一致。
        </span>
      </section>

      <section className="metrics">
        <article>
          <small>在棚赛鸽 / 在役环</small>
          <strong>
            {metrics.pigeons} <em>/ {metrics.activeRings}</em>
          </strong>
        </article>
        <article>
          <small>有效归巢平均速度</small>
          <strong>
            {metrics.avgSpeed} <em>m/min</em>
          </strong>
        </article>
        <article>
          <small>未归巢提醒（仅有效成绩）</small>
          <strong className={metrics.unreturned ? "warn-num" : ""}>{metrics.unreturned}</strong>
        </article>
        <article>
          <small>待复核队列</small>
          <strong className={metrics.pending ? "warn-num" : ""}>{metrics.pending}</strong>
        </article>
      </section>

      <nav className="tabs">
        {tabs.map((t) => (
          <button key={t.id} className={tab === t.id ? "tab-on" : ""} onClick={() => setTab(t.id)}>
            {t.label}
            {t.count ? <span className="tab-count">{t.count}</span> : null}
          </button>
        ))}
        <span className="ledger-fresh">台账最近更新 {fmtAge(latestEventAt, now)}</span>
      </nav>

      {tab === "rings" && <RingsPanel now={now} />}
      {tab === "training" && <TrainingPanel now={now} />}
      {tab === "review" && <ReviewPanel now={now} />}
      {tab === "ledger" && (
        <div className="rules-ledger">
          <section className="panel rules-panel">
            <div className="heading">
              <div>
                <p>规则承载（与台账、页面分离）</p>
                <h2>电子环与成绩复核规则</h2>
              </div>
            </div>
            <ol className="rule-list">
              {RULES.map((r, i) => (
                <li key={r.title}>
                  <b>
                    {i + 1}. {r.title}
                  </b>
                  <span>{r.body}</span>
                </li>
              ))}
            </ol>
          </section>
          <LedgerPanel />
        </div>
      )}
    </main>
  );
}

export default App;
