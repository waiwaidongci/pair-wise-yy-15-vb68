import type { LedgerEvent } from "./types";
import { calcSpeed } from "./rules";

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;
const DAY = 24 * HOUR;

/** 首次使用时生成演示台账；时间锚定加载时刻，刷新后持久化不再漂移。 */
export function buildSeedEvents(now: number): LedgerEvent[] {
  const T = now;
  const events: LedgerEvent[] = [];
  let n = 0;
  const push = (e: LedgerEvent) => {
    events.push({ ...e, seq: ++n });
  };

  const pigeons: Array<[string, string, string, string]> = [
    ["P-01", "CHN-24-001839", "詹森系", "健康"],
    ["P-02", "CHN-24-002114", "凡龙系", "健康"],
    ["P-03", "CHN-24-003207", "胡本系", "观察"],
    ["P-04", "CHN-23-008771", "种鸽", "健康"],
    ["P-05", "CHN-24-004552", "盖比系", "健康"],
    ["P-06", "CHN-24-005908", "利奥系", "健康"],
    ["P-07", "CHN-24-006330", "詹森系", "健康"],
  ];

  // 入棚
  pigeons.forEach(([id, band, bloodline, health], i) => {
    push({
      type: "pigeon-registered",
      at: T - 20 * DAY - i * MIN,
      pigeonId: id,
      band,
      bloodline,
      health,
    });
  });

  // 发环（每羽一枚）
  const ringCodes: Record<string, string> = {
    "P-01": "CHN-E0001",
    "P-02": "CHN-E0002",
    "P-03": "CHN-E0003",
    "P-04": "CHN-E0004",
    "P-05": "CHN-E0005",
    "P-06": "CHN-E0006",
    "P-07": "CHN-E0007",
  };
  Object.entries(ringCodes).forEach(([pid, code], i) => {
    push({
      type: "ring-issued",
      at: T - 10 * DAY - i * MIN,
      ringId: `R-${code}`,
      code,
      pigeonId: pid,
      note: "赛季初次发环",
    });
  });

  // 校准：P1/P4/P5/P6/P7 在开笼前短期校准；P2 校准过早（>72h）；P3 无校准
  const calibs: Array<[string, string, number, number, string]> = [
    ["P-01", "C-E01", T - 30 * HOUR, -1200, "开笼前例行校准"],
    ["P-02", "C-E02", T - 120 * HOUR, 800, "早期校准（已超72小时）"],
    ["P-04", "C-E04", T - 28 * HOUR, -400, "开笼前例行校准"],
    ["P-05", "C-E05", T - 28 * HOUR, 0, "开笼前例行校准"],
    ["P-06", "C-E06", T - 28 * HOUR, 650, "开笼前例行校准"],
    ["P-07", "C-E07", T - 28 * HOUR, -250, "开笼前例行校准"],
  ];
  calibs.forEach(([pid, cid, at, offset, note]) => {
    push({
      type: "calibration-checked",
      at,
      calibrationId: cid,
      ringId: ringCodes[pid] ? `R-${ringCodes[pid]}` : "",
      pigeonId: pid,
      readerId: "RW-棚01",
      offsetMs: offset,
      note,
    });
  });

  // 第一批训放：80km，26 小时前开笼
  const releaseA = T - 26 * HOUR;
  push({
    type: "batch-created",
    at: releaseA - HOUR,
    sessionId: "S-A",
    site: "80km 南站",
    distanceM: 80000,
    weather: "晴 · 顺风",
    releaseAt: releaseA,
  });

  pigeons.forEach(([pid], i) => {
    push({ type: "result-recorded", at: releaseA + i * 1000, resultId: `RR-A-${pid}`, sessionId: "S-A", pigeonId: pid });
  });

  // 归巢：P1 70 分钟（第一），P6 82 分钟（第二）；P2/P3/P4/P5 均已归巢但环/校准不合规
  const returnsA: Array<[string, number]> = [
    ["P-01", 70],
    ["P-06", 82],
    ["P-02", 88],
    ["P-03", 95],
    ["P-04", 101],
    ["P-05", 78],
    // P-07 未归巢
  ];
  returnsA.forEach(([pid, mins]) => {
    push({
      type: "return-recorded",
      at: releaseA + mins * MIN,
      resultId: `RR-A-${pid}`,
      sessionId: "S-A",
      pigeonId: pid,
      returnedAt: releaseA + mins * MIN,
      speed: calcSpeed(80000, releaseA, releaseA + mins * MIN),
    });
  });

  // P4 电子环停用（成绩 -> 待复核：环停用）
  push({
    type: "ring-voided",
    at: T - 25 * HOUR,
    ringId: "R-CHN-E0004",
    pigeonId: "P-04",
    note: "环体开裂，停用待复检",
  });

  // P5 换环：旧成绩留档
  push({
    type: "ring-replaced",
    at: T - 4 * HOUR,
    pigeonId: "P-05",
    oldRingId: "R-CHN-E0005",
    newRingId: "R-CHN-E0505",
    newCode: "CHN-E0505",
    note: "换环：旧环读数异常",
  });
  push({
    type: "calibration-checked",
    at: T - 3.5 * HOUR,
    calibrationId: "C-E05B",
    ringId: "R-CHN-E0505",
    pigeonId: "P-05",
    readerId: "RW-棚02",
    offsetMs: 120,
    note: "新环换发后校准",
  });

  // 第二批训放：120km，2 小时前开笼
  const releaseB = T - 2 * HOUR;
  push({
    type: "batch-created",
    at: releaseB - 30 * MIN,
    sessionId: "S-B",
    site: "120km 新乡站",
    distanceM: 120000,
    weather: "多云 · 侧风",
    releaseAt: releaseB,
  });
  const partB = ["P-01", "P-05", "P-06", "P-02"];
  partB.forEach((pid, i) => {
    push({ type: "result-recorded", at: releaseB + i * 1000, resultId: `RR-B-${pid}`, sessionId: "S-B", pigeonId: pid });
  });
  const returnsB: Array<[string, number]> = [
    ["P-01", 95],
    ["P-05", 100],
    ["P-06", 108],
    ["P-02", 140],
  ];
  returnsB.forEach(([pid, mins]) => {
    push({
      type: "return-recorded",
      at: releaseB + mins * MIN,
      resultId: `RR-B-${pid}`,
      sessionId: "S-B",
      pigeonId: pid,
      returnedAt: releaseB + mins * MIN,
      speed: calcSpeed(120000, releaseB, releaseB + mins * MIN),
    });
  });

  return events;
}
