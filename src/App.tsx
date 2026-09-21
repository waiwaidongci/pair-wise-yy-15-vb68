import { useCallback, useState } from "react";
import "./styles.css";
import { useLedger } from "./hooks/useLedger";
import { pendingResults } from "./rules/engine";
import Overview from "./components/Overview";
import IssueDesk from "./components/IssueDesk";
import CalibrationDesk from "./components/CalibrationDesk";
import TrainingDesk from "./components/TrainingDesk";
import ReviewQueue from "./components/ReviewQueue";
import RulesLedger from "./components/RulesLedger";
import { Toast } from "./components/ui";

type Tab = "overview" | "issue" | "cal" | "training" | "review" | "rules";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "鸽棚总览" },
  { key: "issue", label: "发环台" },
  { key: "cal", label: "校准台" },
  { key: "training", label: "训放成绩" },
  { key: "review", label: "复核台" },
  { key: "rules", label: "规则与台账" },
];

function App() {
  const api = useLedger();
  const [tab, setTab] = useState<Tab>("overview");
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "err" } | null>(
    null
  );
  const [calPrefill, setCalPrefill] = useState<string | null>(null);

  const notify = useCallback((text: string, tone: "ok" | "err" = "ok") => {
    setToast({ text, tone });
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const goCalibrate = useCallback((ringCode: string) => {
    setCalPrefill(ringCode);
    setTab("cal");
  }, []);

  const pendingCount = pendingResults(api.state).length;

  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62014 · 电子环发放与成绩复核台 · Port 62014</p>
        <h1>赛鸽训放 · 电子环复核台</h1>
        <span>
          每羽同一时间只认一枚在役电子环；成绩绑定当次在役环与最近一次（72
          小时内）校准。环停用、校准缺失或过期只进待复核；更正即重算，换环旧成绩留档。规则、台账、页面分层，刷新后一致。
        </span>
      </section>

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? "tab-on" : ""}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key === "review" && pendingCount > 0 ? (
              <span className="tab-count">{pendingCount}</span>
            ) : null}
          </button>
        ))}
      </nav>

      {tab === "overview" ? <Overview api={api} /> : null}
      {tab === "issue" ? <IssueDesk api={api} notify={notify} /> : null}
      {tab === "cal" ? (
        <CalibrationDesk
          api={api}
          notify={notify}
          prefillRing={calPrefill}
          consumePrefill={() => setCalPrefill(null)}
        />
      ) : null}
      {tab === "training" ? <TrainingDesk api={api} notify={notify} /> : null}
      {tab === "review" ? (
        <ReviewQueue api={api} notify={notify} goCalibrate={goCalibrate} />
      ) : null}
      {tab === "rules" ? <RulesLedger api={api} notify={notify} /> : null}

      <Toast text={toast?.text ?? null} tone={toast?.tone ?? "ok"} />
    </main>
  );
}

export default App;
