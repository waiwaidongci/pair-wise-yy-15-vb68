import type {
  Calibration,
  LedgerState,
  Outcome,
  PendingReason,
  ResultRecord,
  RingIssue,
  TrainingSession,
} from "./types";

// ===== 常量 =====

/** 校准有效期：放飞时距最近一次校准超过 72 小时即进待复核 */
export const CAL_FRESH_MS = 72 * 60 * 60 * 1000;

export const PENDING_REASON_TEXT: Record<PendingReason, string> = {
  RING_STOPPED: "电子环已停用",
  RING_MISSING: "放飞时无在役电子环",
  ISSUE_CORRECTED: "发放记录已更正，需重新确认绑定",
  CAL_MISSING: "缺少电子环校准记录",
  CAL_STALE: "最近校准距放飞已超过 72 小时",
  TIME_INVALID: "归巢时间早于放飞时间",
};

// ===== 时间工具 =====

export const minuteMs = (m: number) => m * 60 * 1000;
export const hourMs = (h: number) => h * minuteMs(60);
export const dayMs = (d: number) => d * 24 * hourMs(1);

export function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours()
  )}:${p(d.getMinutes())}`;
}

/** input[type=datetime-local] 的本地时间字符串 -> ms */
export function localInputToMs(value: string): number {
  return new Date(value).getTime();
}

/** ms -> input[type=datetime-local] 值（本地时区） */
export function msToLocalInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours()
  )}:${p(d.getMinutes())}`;
}

export function fmtSpeed(v: number | null): string {
  return v == null ? "—" : `${Math.round(v).toLocaleString()} m/min`;
}

// ===== 发环规则 =====

/** 某羽赛鸽当前在役电子环（同一时间只认一枚） */
export function activeRingFor(
  issues: RingIssue[],
  pigeonId: string,
  at = Date.now()
): RingIssue | null {
  const mine = issues.filter(
    (i) =>
      i.pigeonId === pigeonId &&
      i.issuedAt <= at &&
      (i.deactivatedAt == null || i.deactivatedAt > at)
  );
  return mine.length === 0
    ? null
    : mine.reduce((a, b) => (a.issuedAt >= b.issuedAt ? a : b));
}

export function ringById(issues: RingIssue[], code: string): RingIssue | null {
  return issues.find((i) => i.ringCode === code) ?? null;
}

export type IssueCheck =
  | { ok: true }
  | { ok: false; error: string };

/**
 * 发环前置校验：每羽同一时间只认一枚在役电子环；
 * 同一 requestId（重复点击/并发）沿用首次结果，调用方据此短路。
 */
export function canIssue(
  issues: RingIssue[],
  pigeonId: string,
  ringCode: string,
  requestId: string
): IssueCheck {
  const sameRequest = issues.find((i) => i.requestId === requestId);
  if (sameRequest) return { ok: true }; // 幂等：首次结果已存在
  const occupied = issues.find(
    (i) => i.ringCode === ringCode && i.deactivatedAt == null
  );
  if (occupied) {
    return {
      ok: false,
      error: `环 ${ringCode} 已在役（绑定在另一羽赛鸽身上），不能重复发放`,
    };
  }
  const active = activeRingFor(issues, pigeonId);
  if (active) {
    return {
      ok: false,
      error: `该羽赛鸽已有在役电子环 ${active.ringCode}，换环须先停用旧环`,
    };
  }
  return { ok: true };
}

/**
 * 发放更正前置校验：新时间区间不得与该羽（其它）在役时段重叠，
 * 不允许制造同一时间两枚在役环。
 */
export function canCorrectIssuance(
  issues: RingIssue[],
  ringCode: string,
  pigeonId: string,
  issuedAt: number
): IssueCheck {
  const target = ringById(issues, ringCode);
  if (!target) return { ok: false, error: "电子环不存在" };
  const end = target.deactivatedAt ?? Number.POSITIVE_INFINITY;
  if (issuedAt >= end) return { ok: false, error: "发放时间必须早于停用时间" };
  const clash = issues.find(
    (i) =>
      i.pigeonId === pigeonId &&
      i.ringCode !== ringCode &&
      i.issuedAt < end &&
      (i.deactivatedAt ?? Number.POSITIVE_INFINITY) > issuedAt
  );
  if (clash) {
    return {
      ok: false,
      error: `更正后将与 ${clash.ringCode} 的在役时段重叠，违反一羽一环`,
    };
  }
  return { ok: true };
}

// ===== 校准规则 =====

export function calibrationsOf(cals: Calibration[], ringCode: string) {
  return cals
    .filter((c) => c.ringCode === ringCode && c.calibratedAt)
    .sort((a, b) => b.calibratedAt - a.calibratedAt);
}

/** 放飞当刻该环最近一次校准（要求校准本身有效：环在役） */
export function latestCalibration(
  state: Pick<LedgerState, "calibrations" | "issues">,
  ringCode: string,
  at: number
): { cal: Calibration | null; ageMs: number | null } {
  const cal =
    state.calibrations
      .filter((c) => c.ringCode === ringCode && c.calibratedAt <= at)
      .sort((a, b) => b.calibratedAt - a.calibratedAt)[0] ?? null;
  return cal ? { cal, ageMs: at - cal.calibratedAt } : { cal: null, ageMs: null };
}

// ===== 成绩评定（纯函数：给定台账状态重算一条成绩）=====

export function evaluateResult(
  state: LedgerState,
  result: Pick<
    ResultRecord,
    "boundRingCode" | "sessionId" | "arrivedAt"
  >
): Outcome {
  const session = state.sessions.get(result.sessionId);
  if (!session) {
    return pending(result.boundRingCode, "RING_MISSING");
  }

  // 记成绩时绑定的在役环
  const bound =
    (result.boundRingCode
      ? state.issues.find((i) => i.ringCode === result.boundRingCode)
      : undefined) ?? null;

  let ringCode: string | null = result.boundRingCode;

  // --- 规则一：绑定的环已停用 ---
  if (bound && bound.deactivatedAt != null) {
    // 换环：旧环被一枚更晚的新环接替 -> 旧成绩留档，永不回排行
    const successor = state.issues.find(
      (i) =>
        i.pigeonId === bound.pigeonId &&
        i.ringCode !== bound.ringCode &&
        i.issuedAt >= (bound.deactivatedAt as number)
    );
    if (successor) {
      return archived(bound.ringCode);
    }
    return pending(bound.ringCode, "RING_STOPPED");
  }

  // --- 记成绩时无绑定（放飞时就没环），或更正后环已改绑他羽 ---
  if (!bound) {
    // 更正发放可能导致该羽换了另一枚在役环：不自动替绑，先进待复核
    return pending(null, "RING_MISSING");
  }
  if (bound.corrected) {
    return pending(bound.ringCode, "ISSUE_CORRECTED");
  }

  // --- 规则二：最近一次校准，缺失 / 超过 72 小时 ---
  const { cal, ageMs } = latestCalibration(state, bound.ringCode, session.releasedAt);
  if (!cal) return pending(bound.ringCode, "CAL_MISSING");
  if ((ageMs as number) > CAL_FRESH_MS) {
    return pending(bound.ringCode, "CAL_STALE", cal.id, ageMs);
  }

  // --- 归巢时间合理性 ---
  if (result.arrivedAt != null && result.arrivedAt < session.releasedAt) {
    return pending(bound.ringCode, "TIME_INVALID", cal.id, ageMs);
  }

  const speed =
    result.arrivedAt == null
      ? null
      : (session.distanceM / (result.arrivedAt - session.releasedAt)) *
        60 *
        1000;

  return {
    status: "valid",
    ringCode: bound.ringCode,
    calibrationId: cal.id,
    calAgeMs: ageMs,
    speed,
  };
}

function pending(
  ringCode: string | null,
  reason: PendingReason,
  calibrationId: string | null = null,
  calAgeMs: number | null = null,
  speed: number | null = null
): Outcome {
  return {
    status: "pending",
    reason,
    ringCode,
    calibrationId,
    calAgeMs,
    speed,
  };
}

function archived(ringCode: string): Outcome {
  return {
    status: "archived",
    ringCode,
    calibrationId: null,
    calAgeMs: null,
    speed: null,
  };
}

// ===== 排行 / 统计选择器 =====

/** 有效且已归巢：参与排行 */
export function rankedResults(
  state: LedgerState,
  sessionId?: string
): ResultRecord[] {
  return state.results
    .filter(
      (r) =>
        r.outcome.status === "valid" &&
        r.arrivedAt != null &&
        (sessionId == null || r.sessionId === sessionId)
    )
    .sort((a, b) => (b.outcome.speed ?? 0) - (a.outcome.speed ?? 0));
}

/** 有效但未归巢：计入未归巢提醒（待复核不计） */
export function missingResults(
  state: LedgerState,
  sessionId?: string
): ResultRecord[] {
  return state.results.filter(
    (r) =>
      r.outcome.status === "valid" &&
      r.arrivedAt == null &&
      (sessionId == null || r.sessionId === sessionId)
  );
}

export function pendingResults(state: LedgerState): ResultRecord[] {
  return state.results.filter((r) => r.outcome.status === "pending");
}

export function sessionOf(state: LedgerState, id: string): TrainingSession | undefined {
  return state.sessions.get(id);
}
