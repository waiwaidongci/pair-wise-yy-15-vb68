import { buildSeedEvents } from "../src/ledger/seed";
import { fold } from "../src/rules/fold";
import { evaluateResult, activeRingFor, canIssue, latestCalibration, CAL_FRESH_MS } from "../src/rules/engine";
import type { LedgerEvent } from "../src/rules/types";

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

const NOW = Date.UTC(2026, 8, 21, 12, 0, 0);
const events = buildSeedEvents(NOW);
const state = fold(events);

const pigeonByBand = (band: string) => [...state.pigeons.values()].find((p) => p.band === band)!;
const resultsOf = (band: string) =>
  state.results.filter((r) => r.pigeonId === pigeonByBand(band).id);
const sessionByName = (name: string) => [...state.sessions.values()].find((s) => s.name.includes(name))!;

console.log("一羽一环：");
for (const p of state.pigeons.values()) {
  const active = state.issues.filter(
    (i) => i.pigeonId === p.id && i.deactivatedAt == null
  );
  assert(`${p.band} 在役环 ≤ 1`, active.length <= 1, `实际 ${active.length}`);
}
assert("在役环号全局不重复", new Set(state.issues.filter((i) => i.deactivatedAt == null).map((i) => i.ringCode)).size === state.issues.filter((i) => i.deactivatedAt == null).length);

console.log("发环校验：");
const p1 = pigeonByBand("CHN-24-001839");
assert("已有在役环 -> 拒绝再发", canIssue(state.issues, p1.id, "E-NEW", "req-x").ok === false);
assert("幂等 requestId -> 放行（沿用首次）", canIssue(state.issues, p1.id, "E-NEW", "seed-req-1").ok === true);
const p5 = pigeonByBand("CHN-24-004550");
assert("旧环退役无新环 -> 当前无在役", activeRingFor(state.issues, p5.id, NOW) === null);

console.log("种子成绩状态（s3 新乡）：");
const s3 = sessionByName("新乡");
const at3 = (band: string) => resultsOf(band).find((r) => r.sessionId === s3.id)!.outcome.status;
assert("p4 有效归巢且有速度", (() => { const r = resultsOf("CHN-24-003062").find((r) => r.sessionId === s3.id)!; return r.outcome.status === "valid" && r.outcome.speed != null; })());
assert("p1 有效", at3("CHN-24-001839") === "valid");
assert("p2 校准超72h -> 待复核 CAL_STALE", resultsOf("CHN-24-002114").find((r) => r.sessionId === s3.id)!.outcome.reason === "CAL_STALE");
assert("p6 从未校准 -> 待复核 CAL_MISSING", resultsOf("CHN-25-006608").find((r) => r.sessionId === s3.id)!.outcome.reason === "CAL_MISSING");
const p7r = resultsOf("CHN-24-007720").find((r) => r.sessionId === s3.id)!;
assert("p7 有效但未归巢（不算待复核）", p7r.outcome.status === "valid" && p7r.arrivedAt == null);

console.log("换环留档（p8）：");
const s1 = sessionByName("鹤壁");
const p8old = resultsOf("CHN-24-008813").find((r) => r.sessionId === s1.id)!;
assert("s1 旧环成绩 archived", p8old.outcome.status === "archived");
assert("留档成绩不回排行速度", p8old.outcome.speed === null);
const p8new = resultsOf("CHN-24-008813").find((r) => r.sessionId === s3.id)!;
assert("s3 新环成绩有效", p8new.outcome.status === "valid" && p8new.outcome.ringCode === "E-8813B");
// 留档后再发生校准事件也不复活
const afterCal = fold([
  ...events,
  {
    type: "CalibrationRecorded",
    at: NOW + 1000,
    calibration: { id: "x1", ringCode: "E-8813A", calibratedAt: NOW - 1000, offsetSec: 0, note: "", corrected: false, createdAt: NOW },
  },
]);
assert("旧成绩留档后补校准不复活", afterCal.results.find((r) => r.id === p8old.id)!.outcome.status === "archived");

console.log("环停用 -> 待复核（p5 s2）：");
const s2 = sessionByName("濮阳");
const p5r2 = resultsOf("CHN-24-004550").find((r) => r.sessionId === s2.id)!;
assert("p5 s2 待复核 RING_STOPPED", p5r2.outcome.status === "pending" && p5r2.outcome.reason === "RING_STOPPED");

console.log("更正校准 -> 立即失效重算：");
// 给 p6 补一条放飞前新鲜校准 -> CAL_MISSING 应变 valid
const fix6: LedgerEvent[] = [
  { type: "CalibrationRecorded", at: NOW, calibration: { id: "c6fix", ringCode: "E-6608", calibratedAt: s3.releasedAt - 3600000, offsetSec: 0, note: "补发校准", corrected: false, createdAt: NOW } },
];
const st6 = fold([...events, ...fix6]);
const p6fixed = st6.results.find((r) => r.pigeonId === pigeonByBand("CHN-25-006608").id && r.sessionId === s3.id)!;
assert("补校准后 p6 自动变有效", p6fixed.outcome.status === "valid");
const rev6 = p6fixed.revisions;
assert("重算轨迹含 校准重算", rev6.some((v) => v.label.includes("校准") && v.before?.status === "pending" && v.after.status === "valid"));

console.log("更正校准（改旧记录）-> 超72h 重新失效：");
// 找到 s3 时 p2 的最近校准 seed-cal-7（s2前），p2 s3 已是 CAL_STALE。
// 改为：把 p4 s3 的新鲜校准 cal-10 改成放飞前 4 天 -> p4 s3 应变 CAL_STALE
const cal10 = state.calibrations.find((c) => c.id === "seed-cal-10")!;
const st4 = fold([
  ...events,
  { type: "CalibrationCorrected", at: NOW, calibrationId: cal10.id, calibratedAt: s3.releasedAt - 4 * 86400000, offsetSec: 0, note: "改为旧校准" },
]);
const p4fixed = st4.results.find((r) => r.pigeonId === pigeonByBand("CHN-24-003062").id && r.sessionId === s3.id)!;
assert("p4 校准改旧 -> CAL_STALE", p4fixed.outcome.reason === "CAL_STALE");
assert("原 cal 标记 corrected", st4.calibrations.find((c) => c.id === cal10.id)!.corrected === true);

console.log("更正发放 -> 关联成绩 ISSUE_CORRECTED：");
const e3062 = state.issues.find((i) => i.ringCode === "E-3062")!;
const p6pigeon = pigeonByBand("CHN-25-006608");
const stI = fold([
  ...events,
  { type: "IssuanceCorrected", at: NOW, ringCode: "E-3062", pigeonId: p6pigeon.id, issuedAt: e3062.issuedAt },
]);
const p4after = stI.results.find((r) => r.pigeonId === pigeonByBand("CHN-24-003062").id && r.sessionId === s3.id)!;
assert("p4 成绩因发放更正进待复核", p4after.outcome.status === "pending" && p4after.outcome.reason === "ISSUE_CORRECTED");

console.log("排行/未归巢选择器：");
const ranked = state.results.filter((r) => r.sessionId === s3.id && r.outcome.status === "valid" && r.arrivedAt != null);
const speeds = ranked.map((r) => r.outcome.speed!);
assert("排行按速度降序", speeds.every((v, i) => i === 0 || speeds[i - 1] >= v));
assert("待复核与留档都不进排行", !ranked.some((r) => r.pigeonId === p5.id));
assert("未归巢仅有效（p7），p2/p6 不算", state.results.filter((r) => r.sessionId === s3.id && r.outcome.status === "valid" && r.arrivedAt == null).length === 1);

console.log("72h 边界：");
const age = latestCalibration(state, "E-1839", s3.releasedAt);
assert("p1 s3 校准年龄 ≤ 72h", age.ageMs != null && age.ageMs <= CAL_FRESH_MS);

console.log("刷新一致性（重放幂等）：");
const replay1 = fold(events);
const replay2 = fold(events);
assert("两次 fold 状态一致", JSON.stringify(strip(replay1)) === JSON.stringify(strip(replay2)));
function strip(s: typeof state) {
  return {
    issues: s.issues,
    calibrations: s.calibrations,
    results: s.results,
  };
}
// 增量 fold(单个新事件, base) == 全量 fold
const inc = fold(fix6, fold(events));
assert("增量 fold == 全量 fold（revision 一致）", JSON.stringify(strip(inc).results) === JSON.stringify(strip(st6).results));

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
