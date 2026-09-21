import { foldEvents, resolveIssue, CALIB_TTL_MS } from "../src/domain/rules";
import type { LedgerEvent } from "../src/domain/types";

const H = 3600_000;
const MIN = 60_000;
let at = 0;
let seq = 0;
const events: LedgerEvent[] = [];
function push<E extends LedgerEvent>(e: Omit<E, "seq" | "at"> & { at?: number }): E {
  const ev = { ...(e as object), seq: ++seq, at: e.at ?? ++at * 1000 } as E;
  events.push(ev);
  return ev;
}

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${name} ${extra}`);
  }
}

const T = 10 * 24 * H;

// 3 羽鸽
for (const id of ["P1", "P2", "P3"]) {
  push({ type: "pigeon-registered", at: 1000, pigeonId: id, band: id, bloodline: "B", health: "ok" });
}
// P1 发环 + 有效校准；P2 发环 + 过期校准；P3 发环无校准
push({ type: "ring-issued", at: T - 10 * H, ringId: "R1", code: "E1", pigeonId: "P1", note: "" });
push({ type: "ring-issued", at: T - 10 * H, ringId: "R2", code: "E2", pigeonId: "P2", note: "" });
push({ type: "ring-issued", at: T - 10 * H, ringId: "R3", code: "E3", pigeonId: "P3", note: "" });
push({ type: "calibration-checked", at: T - 2 * H, calibrationId: "C1", ringId: "R1", pigeonId: "P1", readerId: "rw", offsetMs: 0, note: "" });
push({ type: "calibration-checked", at: T - 80 * H, calibrationId: "C2", ringId: "R2", pigeonId: "P2", readerId: "rw", offsetMs: 0, note: "" });

// 批次开笼 T
push({ type: "batch-created", at: T - H, sessionId: "S", site: "x", distanceM: 80000, weather: "晴", releaseAt: T });
push({ type: "result-recorded", at: T + 1000, resultId: "R-P1", sessionId: "S", pigeonId: "P1" });
push({ type: "result-recorded", at: T + 2000, resultId: "R-P2", sessionId: "S", pigeonId: "P2" });
push({ type: "result-recorded", at: T + 3000, resultId: "R-P3", sessionId: "S", pigeonId: "P3" });
push({ type: "return-recorded", at: T + 70 * MIN, resultId: "R-P1", sessionId: "S", pigeonId: "P1", returnedAt: T + 70 * MIN, speed: 1142.9 });
push({ type: "return-recorded", at: T + 80 * MIN, resultId: "R-P2", sessionId: "S", pigeonId: "P2", returnedAt: T + 80 * MIN, speed: 1000 });
// P3 未归巢

let st = foldEvents(events);
const get = (id: string) => st.results.find((r) => r.id === id)!;
assert("P1 有效", get("R-P1").status === "valid");
assert("P1 名次 #1", get("R-P1").rank === 1);
assert("P2 校准过期待复核", get("R-P2").status === "pending" && get("R-P2").pendingReason === "calib-expired");
assert("P2 不算排行", get("R-P2").rank === undefined);
assert("P3 校准缺失待复核", get("R-P3").status === "pending" && get("R-P3").pendingReason === "calib-missing");
assert("P3 待复核不算未归巢", st.sessionViews.get("S")!.unreturnedCount === 0);
assert("P1 有效归巢计数 1", st.sessionViews.get("S")!.returnedCount === 1);
assert("72h 常量正确", CALIB_TTL_MS === 72 * H);

// P3 补校准（开笼前）-> 自动重算为有效未归巢
push({ type: "calibration-checked", at: T - H, calibrationId: "C3", ringId: "R3", pigeonId: "P3", readerId: "rw", offsetMs: 0, note: "补" });
st = foldEvents(events);
assert("P3 补校准后有效", st.results.find((r) => r.id === "R-P3")!.status === "valid");
assert("P3 现在计未归巢 1", st.sessionViews.get("S")!.unreturnedCount === 1);

// 停用 P1 环 -> P1 成绩变待复核（环停用），排行清空
push({ type: "ring-voided", at: T + 3 * H, ringId: "R1", pigeonId: "P1", note: "故障" });
st = foldEvents(events);
const p1AfterVoid = st.results.find((r) => r.id === "R-P1")!;
assert("P1 停环后待复核", p1AfterVoid.status === "pending" && p1AfterVoid.pendingReason === "ring-voided");
assert("P1 名次撤销", p1AfterVoid.rank === undefined);
assert("队列计数含 P1/P2", st.sessionViews.get("S")!.pendingCount === 2);

// 更正 P2 校准记录：旧记录作废、成绩立即失效并重算 -> 按规则留在待复核（失效留痕）
push({
  type: "calibration-corrected",
  at: T + 4 * H,
  calibrationId: "C2",
  newCalibrationId: "C2B",
  reason: "时间录错",
  readerId: "rw",
  calibratedAt: T - 10 * H,
  offsetMs: 100,
  note: "更正",
});
st = foldEvents(events);
const p2 = st.results.find((r) => r.id === "R-P2")!;
assert("P2 校正式更正后立即失效待复核", p2.status === "pending" && p2.invalidation?.kind === "calib");
assert("旧校准 C2 已作废", st.calibrations.get("C2")!.superseded === true);
assert("排行已无 P2", p2.rank === undefined);

// 复核员以“新增校准”方式补正（新校准在 72h 内）后，待复核成绩仍带更正留痕 -> 保留待人工复核确认；
// 全新批次成绩不受历史更正影响，直接有效。
push({
  type: "batch-created",
  at: T + 4.5 * H,
  sessionId: "SNEW",
  site: "z",
  distanceM: 100000,
  weather: "晴",
  releaseAt: T + 4.5 * H,
});
push({ type: "result-recorded", at: T + 4.5 * H + 1000, resultId: "RN-P2", sessionId: "SNEW", pigeonId: "P2" });
push({
  type: "return-recorded",
  at: T + 4.5 * H + 90 * MIN,
  resultId: "RN-P2",
  sessionId: "SNEW",
  pigeonId: "P2",
  returnedAt: T + 4.5 * H + 90 * MIN,
  speed: 1111,
});
st = foldEvents(events);
const p2new = st.results.find((r) => r.id === "RN-P2")!;
assert("新批次 P2 用更正后的有效校准 -> 有效 #1", p2new.status === "valid" && p2new.rank === 1, p2new.status);

// 换环 P3：旧成绩留档
push({ type: "ring-replaced", at: T + 5 * H, pigeonId: "P3", oldRingId: "R3", newRingId: "R3B", newCode: "E3B", note: "换" });
st = foldEvents(events);
const p3 = st.results.find((r) => r.id === "R-P3")!;
assert("P3 换环后旧成绩留档", p3.status === "archived" && p3.ringId === "R3");
assert("留档成绩不算未归巢", st.sessionViews.get("S")!.unreturnedCount === 0);
assert("新环在役", st.rings.get("R3B")!.status === "active");
assert("旧环退役原因 replaced", st.rings.get("R3")!.retireReason === "replaced");

// 更正发放记录（把 P2 发环时间改到开笼之后）-> 关联成绩立即失效待复核
push({ type: "ring-corrected", at: T + 6 * H, ringId: "R2", issuedAt: T + 2 * H, note: "改", reason: "发环时间录错" });
st = foldEvents(events);
const p2c = st.results.find((r) => r.id === "R-P2")!;
assert("P2 发放更正后待复核（发环晚于开笼）", p2c.status === "pending" && p2c.pendingReason === "ring-not-issued", p2c.status);
// 再更正回到开笼前 -> 仍带 invalidation 标记，保持待复核（更正即失效，人工重算确认）
push({ type: "ring-corrected", at: T + 7 * H, ringId: "R2", issuedAt: T - 20 * H, note: "改回", reason: "再次核实" });
st = foldEvents(events);
const p2d = st.results.find((r) => r.id === "R-P2")!;
assert("P2 再次更正仍在待复核（失效重算留痕）", p2d.status === "pending" && p2d.invalidation !== undefined);

// 新批次：先停用 R2，登记时无在役环 -> ring-missing；随后补发新环
push({ type: "ring-voided", at: T + 8.5 * H, ringId: "R2", pigeonId: "P2", note: "停用" });
push({
  type: "batch-created",
  at: T + 9 * H,
  sessionId: "S2",
  site: "y",
  distanceM: 60000,
  weather: "",
  releaseAt: T + 9 * H,
});
push({ type: "result-recorded", at: T + 9 * H + 1000, resultId: "R2-P2", sessionId: "S2", pigeonId: "P2" });
st = foldEvents(events);
assert("无在役环登记 -> ring-missing", st.results.find((r) => r.id === "R2-P2")!.pendingReason === "ring-missing");
push({ type: "ring-issued", at: T + 10 * H, ringId: "R2N", code: "E2N", pigeonId: "P2", note: "补发" });

// 再开一批：环已补发但发环时间晚于开笼 -> ring-not-issued
push({
  type: "batch-created",
  at: T + 11 * H,
  sessionId: "S3",
  site: "z",
  distanceM: 60000,
  weather: "",
  releaseAt: T + 9.5 * H,
});
push({ type: "result-recorded", at: T + 11 * H + 1000, resultId: "R3-P2", sessionId: "S3", pigeonId: "P2" });
st = foldEvents(events);
assert("发环晚于开笼 -> ring-not-issued", st.results.find((r) => r.id === "R3-P2")!.pendingReason === "ring-not-issued");

// 并发/重复发环裁决：同一鸽两个在途请求
{
  const inflight = new Map();
  const r1 = resolveIssue(
    { requestId: "a", pigeonId: "PX", code: "EX", note: "", at: 2000 },
    foldEvents([
      { type: "pigeon-registered", seq: 1, at: 1000, pigeonId: "PX", band: "X", bloodline: "b", health: "h" },
    ]),
    inflight
  );
  const r2 = resolveIssue(
    { requestId: "b", pigeonId: "PX", code: "EX-DUP", note: "", at: 2001 },
    foldEvents([
      { type: "pigeon-registered", seq: 1, at: 1000, pigeonId: "PX", band: "X", bloodline: "b", health: "h" },
    ]),
    inflight
  );
  assert("并发发环首单新建", r1.outcome.created && r1.outcome.ringId === "R-EX");
  assert("并发发环次单合并沿用", r2.outcome.deduped && r2.outcome.ringId === "R-EX");
}

// 已有在役环再发 -> 沿用首次
{
  const state2 = foldEvents([
    { type: "pigeon-registered", seq: 1, at: 1000, pigeonId: "PY", band: "Y", bloodline: "b", health: "h" },
    { type: "ring-issued", seq: 2, at: 2000, ringId: "RY", code: "EY", pigeonId: "PY", note: "" },
  ]);
  const inflight = new Map();
  const r = resolveIssue({ requestId: "c", pigeonId: "PY", code: "EY2", note: "", at: 3000 }, state2, inflight);
  assert("已有在役环重复发环沿用首次", !r.outcome.created && r.outcome.deduped && r.outcome.ringId === "RY");
}

// 环号全局唯一冲突
{
  const state2 = foldEvents([
    { type: "pigeon-registered", seq: 1, at: 1000, pigeonId: "PZ", band: "Z", bloodline: "b", health: "h" },
    { type: "ring-issued", seq: 2, at: 2000, ringId: "RE", code: "DUP", pigeonId: "PZ", note: "" },
  ]);
  const inflight = new Map();
  const r = resolveIssue({ requestId: "d", pigeonId: "PNEW", code: "DUP", note: "", at: 3000 }, state2, inflight);
  assert("环号冲突报错", !!r.error);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
