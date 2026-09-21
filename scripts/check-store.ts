import { JSDOM } from "jsdom";

// 先建 DOM/localStorage，再加载 store（构造函数会读取 localStorage）
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).localStorage = dom.window.localStorage;
(globalThis as any).navigator = dom.window.navigator;

const { ledger } = await import("../src/ledger/store");

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name} ${extra}`);
  }
}

// 1) 种子初始：待复核、未归巢、留档同时存在
let st = ledger.getSnapshot();
const pendingSeed = st.results.filter((r) => r.status === "pending" && !r.resolvedAt);
assert("种子含待复核（过期/缺失/停用）", pendingSeed.length >= 3);
assert("种子含有效未归巢", st.results.some((r) => r.status === "valid" && r.returnedAt === null));
assert("种子含换环留档", st.results.some((r) => r.status === "archived"));

// 2) 并发发环：给无在役环的 P-04 同时发两次（不同环号）-> 同一结果
const p4 = [...st.pigeons.values()].find((p) => p.band === "CHN-23-008771")!;
const [o1, o2] = await Promise.all([
  ledger.issueRing({ pigeonId: p4.id, code: "CHN-E9001", note: "补发A" }),
  ledger.issueRing({ pigeonId: p4.id, code: "CHN-E9002", note: "并发补发B" }),
]);
assert("并发首单新建", o1.created && !o1.deduped && o1.code === "CHN-E9001");
assert("并发次单合并沿用首次", o2.deduped && o2.ringId === o1.ringId && o2.code === "CHN-E9001");
st = ledger.getSnapshot();
assert("只产生一枚新环", [...st.rings.values()].filter((r) => r.pigeonId === p4.id).length === 2);

// 3) 已有在役环再发 -> 沿用首次
const o3 = await ledger.issueRing({ pigeonId: p4.id, code: "CHN-E9999", note: "重复" });
assert("重复发环沿用首次", !o3.created && o3.deduped && o3.ringId === o1.ringId);

// 4) 环号全局唯一
const p3 = [...st.pigeons.values()].find((p) => p.band === "CHN-24-003207")!;
let collision = "";
try {
  // P3 在役 E0003，换号占用在役环号会先被“已有在役环”拦截；停用后再测冲突
  ledger.voidRing({ ringId: st.rings.get("R-CHN-E0003")!.id, note: "测试停用" });
  await ledger.issueRing({ pigeonId: p3.id, code: "CHN-E0001", note: "撞号" }); // E0001 在役于 P1
} catch (e) {
  collision = (e as Error).message;
}
assert("环号冲突被拒绝", collision.includes("已在役"));

// 5) 历史成绩绑定的旧环已停用：即使补发新环并补校准，旧成绩仍按“环停用”待复核（不复活）
await ledger.issueRing({ pigeonId: p3.id, code: "CHN-E9003", note: "停用后补发" });
st = ledger.getSnapshot();
const p3NewRing = ledger.getActiveRing(p3.id)!;
ledger.calibrate({ pigeonId: p3.id, readerId: "RW-测试", offsetMs: 0, note: "新环校准" });
st = ledger.getSnapshot();
const p3Old = st.results.filter((r) => r.pigeonId === p3.id);
assert(
  "旧环停用后历史成绩保持待复核（环停用），新环不复活旧成绩",
  p3Old.every((r) => r.status !== "valid") && p3Old.some((r) => r.pendingReason === "ring-voided")
);
assert("补发新环在役且已校准", p3NewRing.status === "active" && p3NewRing.code === "CHN-E9003");

// 6) 更正校准 -> 关联成绩立即失效留痕（更正后的校准仍在最近一批开笼 72h 窗口内）
const p1 = [...st.pigeons.values()].find((p) => p.band === "CHN-24-001839")!;
const sessionB = [...st.sessions.values()].sort((a, b) => b.releaseAt - a.releaseAt)[0];
const c1 = [...st.calibrations.values()]
  .filter((c) => c.pigeonId === p1.id && !c.superseded && c.calibratedAt <= sessionB.releaseAt)
  .sort((a, b) => b.calibratedAt - a.calibratedAt)[0];
ledger.correctCalibration({
  calibrationId: c1.id,
  readerId: "RW-测试",
  calibratedAt: sessionB.releaseAt - 60 * 60 * 1000, // 更正后：开笼前 1 小时，仍有效
  offsetMs: 999,
  note: "更正",
  reason: "钟差录反",
});
st = ledger.getSnapshot();
const p1Invalidated = st.results.filter(
  (r) => r.pigeonId === p1.id && r.sessionId === sessionB.id && r.invalidation?.kind === "calib"
);
assert("校准更正后关联成绩立即失效", p1Invalidated.length === 1, JSON.stringify(st.results.filter(r=>r.pigeonId===p1.id).map(r=>({s:r.sessionId,i:r.invalidation?.kind}))));
assert("旧校准标记作废", st.calibrations.get(c1.id)!.superseded === true);
assert("失效成绩出现在待复核队列", st.results.some((r) => r.status === "pending" && r.invalidation));

// 7) 复核确认出队（仍不计排行）
const queued = st.results.find((r) => r.status === "pending" && !r.resolvedAt && r.invalidation)!;
ledger.resolveReview({ resultId: queued.id, note: "人工确认" });
st = ledger.getSnapshot();
const resolved = st.results.find((r) => r.id === queued.id)!;
assert("复核确认后带 resolvedAt", !!resolved.resolvedAt);
assert("确认后出待处理队列", !st.results.some((r) => r.id === queued.id && r.status === "pending" && !r.resolvedAt));
assert("确认后仍不排行", resolved.rank === undefined);

// 8) 刷新一致性：重新从 localStorage 折叠后状态一致
const before = JSON.stringify({
  rings: [...st.rings.values()].map((r) => [r.id, r.status, r.retireReason ?? ""]),
  results: st.results.map((r) => [r.id, r.status, r.pendingReason ?? "", r.rank ?? 0, r.resolvedAt ?? 0]),
  pending: st.results.filter((r) => r.status === "pending" && !r.resolvedAt).length,
});
ledger.reload();
const st2 = ledger.getSnapshot();
const after = JSON.stringify({
  rings: [...st2.rings.values()].map((r) => [r.id, r.status, r.retireReason ?? ""]),
  results: st2.results.map((r) => [r.id, r.status, r.pendingReason ?? "", r.rank ?? 0, r.resolvedAt ?? 0]),
  pending: st2.results.filter((r) => r.status === "pending" && !r.resolvedAt).length,
});
assert("刷新后环档案与成绩/队列一致", before === after);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
