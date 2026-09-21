import { dayMs, hourMs, minuteMs } from "../rules/engine";
import type { LedgerEvent } from "../rules/types";

export interface SeedContext {
  now: number;
  ids: {
    p1: string;
    p2: string;
    p3: string;
    p4: string;
    p5: string;
    p6: string;
    p7: string;
    p8: string;
    s1: string;
    s2: string;
    s3: string;
  };
}

function calId(n: number) {
  return `seed-cal-${n}`;
}
function resultId(n: number) {
  return `seed-r${n}`;
}

/**
 * 首次打开时生成演示台账（时间锚定首次加载时刻，刷新后原样保留）。
 * 覆盖：正常排行、未归巢、环停用待复核、校准缺失/超72h待复核、换环留档。
 */
export function buildSeedEvents(now: number): LedgerEvent[] {
  const T = now;
  const ids = {
    p1: "p-1839",
    p2: "p-2114",
    p3: "p-8771",
    p4: "p-3062",
    p5: "p-4550",
    p6: "p-6608",
    p7: "p-7720",
    p8: "p-8813",
    s1: "s-1",
    s2: "s-2",
    s3: "s-3",
  };
  const ev: LedgerEvent[] = [];

  const pigeons: [string, string, string, "赛鸽" | "种鸽"][] = [
    [ids.p1, "CHN-24-001839", "詹森系", "赛鸽"],
    [ids.p2, "CHN-24-002114", "凡龙系", "赛鸽"],
    [ids.p3, "CHN-23-008771", "胡本系", "种鸽"],
    [ids.p4, "CHN-24-003062", "考夫曼系", "赛鸽"],
    [ids.p5, "CHN-24-004550", "英格斯系", "赛鸽"],
    [ids.p6, "CHN-25-006608", "狄尔巴系", "赛鸽"],
    [ids.p7, "CHN-24-007720", "杨阿滕系", "赛鸽"],
    [ids.p8, "CHN-24-008813", "盖比系", "赛鸽"],
  ];
  pigeons.forEach(([id, band, bloodline, role], i) =>
    ev.push({
      type: "PigeonRegistered",
      at: T - 60 * dayMs(1) + i,
      pigeon: { id, band, bloodline, role },
    })
  );

  const issue = (
    ringCode: string,
    pigeonId: string,
    at: number,
    n: number
  ) =>
    ev.push({
      type: "RingIssued",
      at,
      ringCode,
      pigeonId,
      requestId: `seed-req-${n}`,
    });

  // —— 电子环发放 ——
  issue("E-1839", ids.p1, T - 40 * dayMs(1), 1);
  issue("E-2114", ids.p2, T - 40 * dayMs(1), 2);
  issue("E-8771", ids.p3, T - 40 * dayMs(1), 3);
  issue("E-3062", ids.p4, T - 40 * dayMs(1), 4);
  issue("E-4550", ids.p5, T - 30 * dayMs(1), 5);
  issue("E-6608", ids.p6, T - 20 * dayMs(1), 6);
  issue("E-7720", ids.p7, T - 15 * dayMs(1), 7);
  issue("E-8813A", ids.p8, T - 60 * dayMs(1), 8);

  // —— 换环（p8）：旧环停用 + 新环同刻发放，s1 旧成绩将留档 ——
  ev.push({
    type: "RingDeactivated",
    at: T - 12 * dayMs(1),
    ringCode: "E-8813A",
    reason: "换环：旧环读数异常退役",
  });
  issue("E-8813B", ids.p8, T - 12 * dayMs(1) + 1000, 9);

  // —— p5 旧环退役，暂无新环：关联 s2 成绩进待复核（RING_STOPPED）——
  ev.push({
    type: "RingDeactivated",
    at: T - 6 * dayMs(1),
    ringCode: "E-4550",
    reason: "电子环损坏退役，等待补发",
  });

  // —— 训放场次时间锚点 ——
  const s1Start = T - 20 * dayMs(1) + 7 * hourMs(1) + 30 * minuteMs(1);
  const s2Start = T - 9 * dayMs(1) + 7 * hourMs(1);
  const s3Start = T - 10 * hourMs(1);

  // —— 校准记录 ——
  const cal = (
    n: number,
    ringCode: string,
    calibratedAt: number,
    offsetSec: number,
    note: string
  ) =>
    ev.push({
      type: "CalibrationRecorded",
      at: calibratedAt,
      calibration: {
        id: calId(n),
        ringCode,
        calibratedAt,
        offsetSec,
        note,
        corrected: false,
        createdAt: calibratedAt,
      },
    });

  cal(1, "E-1839", T - 21 * dayMs(1), 1, "s1 赛前校准");
  cal(2, "E-2114", T - 21 * dayMs(1), -2, "s1 赛前校准");
  cal(3, "E-8771", T - 21 * dayMs(1), 0, "s1 赛前校准");
  cal(4, "E-3062", T - 21 * dayMs(1), 1, "s1 赛前校准");
  cal(5, "E-8813A", T - 21 * dayMs(1), 3, "s1 赛前校准");

  cal(6, "E-1839", T - 10 * dayMs(1), 2, "s2 赛前校准");
  cal(7, "E-2114", T - 10 * dayMs(1), -1, "s2 赛前校准");
  cal(8, "E-3062", T - 10 * dayMs(1), 0, "s2 赛前校准");

  // s3 赛前校准（均须早于 s3Start = T-10h）：
  // p1/p4/p7/p8新环 在 72h 内；p2 最近校准已 10 天（超72h）；p6 从未校准
  cal(9, "E-1839", s3Start - 2 * hourMs(1), 1, "s3 赛前校准");
  cal(10, "E-3062", s3Start - 3 * hourMs(1), -2, "s3 赛前校准");
  cal(11, "E-7720", s3Start - 26 * hourMs(1), 0, "s3 赛前校准");
  cal(12, "E-8813B", s3Start - 38 * hourMs(1), 1, "新环启用校准");

  // —— 训放场次 ——
  const session = (
    id: string,
    name: string,
    site: string,
    distanceM: number,
    weather: string,
    releasedAt: number
  ): LedgerEvent => ({
    type: "SessionScheduled",
    at: releasedAt - dayMs(1),
    session: { id, name, site, distanceM, weather, releasedAt },
  });

  ev.push(session(ids.s1, "第1站 鹤壁", "鹤壁", 80000, "晴", s1Start));
  ev.push(session(ids.s2, "第2站 濮阳", "濮阳", 100000, "侧风", s2Start));
  ev.push(session(ids.s3, "第3站 新乡", "新乡", 120000, "多云", s3Start));

  // —— 归巢成绩 ——
  let r = 0;
  const result = (
    sessionId: string,
    pigeonId: string,
    boundRingCode: string | null,
    releasedAt: number,
    flightMin: number | null
  ) => {
    r += 1;
    ev.push({
      type: "ResultRecorded",
      at: flightMin == null ? T : releasedAt + flightMin * minuteMs(1) + 1000,
      id: resultId(r),
      sessionId,
      pigeonId,
      boundRingCode,
      arrivedAt: flightMin == null ? null : releasedAt + flightMin * minuteMs(1),
    });
  };

  // s1：全员有效归巢；p8 当时挂旧环，换环后该成绩留档
  result(ids.s1, ids.p4, "E-3062", s1Start, 60);
  result(ids.s1, ids.p1, "E-1839", s1Start, 62);
  result(ids.s1, ids.p2, "E-2114", s1Start, 68);
  result(ids.s1, ids.p8, "E-8813A", s1Start, 70);
  result(ids.s1, ids.p3, "E-8771", s1Start, 75);

  // s2：p1/p2/p4 有效；p5 环现已停用且无新环 -> 待复核
  result(ids.s2, ids.p4, "E-3062", s2Start, 78);
  result(ids.s2, ids.p1, "E-1839", s2Start, 82);
  result(ids.s2, ids.p2, "E-2114", s2Start, 95);
  result(ids.s2, ids.p5, "E-4550", s2Start, 88);

  // s3：p4/p8/p1 有效排行；p7 有效但未归巢；p2 校准超72h、p6 无校准 -> 待复核
  result(ids.s3, ids.p4, "E-3062", s3Start, 230);
  result(ids.s3, ids.p8, "E-8813B", s3Start, 240);
  result(ids.s3, ids.p1, "E-1839", s3Start, 252);
  result(ids.s3, ids.p2, "E-2114", s3Start, 270);
  result(ids.s3, ids.p6, "E-6608", s3Start, 300);
  result(ids.s3, ids.p7, "E-7720", s3Start, null);

  return ev;
}
