import type {
  Calibration,
  IssueOutcome,
  LedgerEvent,
  PendingReason,
  Pigeon,
  ResultRow,
  ResultStatus,
  RetireReason,
  Ring,
  Session,
  SessionView,
} from "./types";

// 业务规则常量
export const CALIB_TTL_MS = 72 * 60 * 60 * 1000;

// ---------- 台账折叠：事件流 -> 派生视图 ----------

export interface FoldState {
  pigeons: Map<string, Pigeon>;
  rings: Map<string, Ring>;
  ringCodes: Map<string, string>; // 电子环号 -> ringId（全局唯一）
  calibrations: Map<string, Calibration>;
  sessions: Map<string, Session>;
  sessionViews: Map<string, SessionView>;
  results: ResultRow[];
  invalidatedByIssue: Map<string, { at: number; seq: number; note: string }>;
  invalidatedByCalib: Map<string, { at: number; seq: number; note: string }>;
  lastSeq: number;
}

interface RawResult {
  id: string;
  sessionId: string;
  pigeonId: string;
  ringId?: string;
  recordedAt: number;
  returnedAt: number | null;
  speed: number | null;
  resolvedAt?: number;
}

/** 截至 cutoff 时刻某羽赛鸽的在役环情况（按事件流重放）。 */
export function activeRingAt(
  events: LedgerEvent[],
  pigeonId: string,
  cutoff: number
): { ringId?: string; status: ResultStatus; reason?: PendingReason } {
  let ringId: string | undefined;
  const retired = new Map<string, { at: number; reason: RetireReason; replacedBy?: string }>();

  for (const e of events) {
    if (e.at > cutoff) break;
    switch (e.type) {
      case "ring-issued":
        if (e.pigeonId === pigeonId) ringId = e.ringId;
        break;
      case "ring-replaced":
        if (e.pigeonId === pigeonId) {
          if (e.oldRingId === ringId) ringId = e.newRingId;
          retired.set(e.oldRingId, { at: e.at, reason: "replaced", replacedBy: e.newRingId });
        }
        break;
      case "ring-voided":
        if (e.pigeonId === pigeonId) {
          if (e.ringId === ringId) ringId = undefined;
          retired.set(e.ringId, { at: e.at, reason: "void" });
        }
        break;
      default:
        break;
    }
  }

  if (!ringId) return { status: "pending", reason: "ring-missing" };
  const retire = retired.get(ringId);
  if (retire) {
    return retire.reason === "replaced"
      ? { ringId, status: "archived" }
      : { ringId, status: "pending", reason: "ring-voided" };
  }
  return { ringId, status: "valid" };
}

/** 截至 cutoff 时刻、某羽鸽在 anchor（开笼）时点适用的最近一次有效校准。 */
function latestCalibration(
  calibrations: Map<string, Calibration>,
  pigeonId: string,
  anchor: number
): Calibration | undefined {
  let best: Calibration | undefined;
  for (const c of calibrations.values()) {
    if (c.pigeonId !== pigeonId || c.superseded) continue;
    if (c.calibratedAt <= anchor && (!best || c.calibratedAt > best.calibratedAt)) best = c;
  }
  return best;
}

/**
 * 成绩有效性判定。
 * - archived：环在开笼时为“被换环”状态，旧成绩永久留档，不进排行、不算未归巢。
 * - pending：环停用 / 在役环缺失 / 发环晚于开笼 / 校准缺失或超过 72 小时。
 * - valid：当次在役环 + 开笼前 72 小时内的最近一次校准。
 */
export function evaluateResult(
  row: RawResult,
  releaseAt: number,
  ctx: {
    events: LedgerEvent[];
    rings: Map<string, Ring>;
    calibrations: Map<string, Calibration>;
    invalidatedByIssue: Map<string, { at: number; seq: number; note: string }>;
    invalidatedByCalib: Map<string, { at: number; seq: number; note: string }>;
  }
): ResultRow {
  const base: ResultRow = {
    id: row.id,
    sessionId: row.sessionId,
    pigeonId: row.pigeonId,
    ringId: row.ringId,
    recordedAt: row.recordedAt,
    returnedAt: row.returnedAt,
    speed: row.speed,
    status: "pending",
  };
  if (row.resolvedAt) base.resolvedAt = row.resolvedAt;

  // 1) 在役环判定。以成绩登记时点绑定的环为准，并与开笼时点的在役环交叉校验。
  const probe = activeRingAt(ctx.events, row.pigeonId, releaseAt);
  const bound = row.ringId ? ctx.rings.get(row.ringId) : undefined;
  const probeRing = probe.ringId ? ctx.rings.get(probe.ringId) : undefined;
  const ring =
    bound && bound.pigeonId === row.pigeonId
      ? bound
      : probeRing && probeRing.pigeonId === row.pigeonId
        ? probeRing
        : undefined;

  // 换环留档：绑定环在开笼时在役、后被换环 -> 旧成绩永久留档
  if (ring && ring.status === "retired" && ring.retireReason === "replaced" && ring.issuedAt <= releaseAt) {
    return { ...base, ringId: ring.id, status: "archived" };
  }
  if (probe.status === "archived") {
    return { ...base, ringId: probe.ringId ?? ring?.id ?? row.ringId, status: "archived" };
  }

  let ringStatus: ResultStatus = ring ? probe.status : "pending";
  let reason: PendingReason | undefined = probe.reason;

  if (!ring) {
    ringStatus = "pending";
    reason = "ring-missing";
  } else if (ring.pigeonId !== row.pigeonId) {
    ringStatus = "pending";
    reason = "ring-missing";
  } else if (ring.issuedAt > releaseAt) {
    ringStatus = "pending";
    reason = "ring-not-issued";
  } else if (ring.status === "retired") {
    if (ring.retireReason === "void") {
      ringStatus = "pending";
      reason = "ring-voided";
    } else {
      ringStatus = "archived";
    }
  } else {
    base.ringId = ring.id;
    ringStatus = "valid";
  }

  if (ringStatus === "pending") return { ...base, status: "pending", pendingReason: reason };
  if (ringStatus === "archived") return { ...base, status: "archived" };

  // 3) 最近一次校准（开笼前、72 小时内）
  const calib = latestCalibration(ctx.calibrations, row.pigeonId, releaseAt);
  if (!calib) return { ...base, status: "pending", pendingReason: "calib-missing" };
  if (releaseAt - calib.calibratedAt > CALIB_TTL_MS) {
    return { ...base, status: "pending", pendingReason: "calib-expired" };
  }

  // 4) 更正失效：发放记录或校准记录被更正 -> 立即失效；重算时若新记录合规则恢复有效，
  //    否则按具体原因待复核。失效留痕挂在结果上供审计。
  const issueHit = ctx.invalidatedByIssue.get(row.id);
  if (issueHit && issueHit.at >= row.recordedAt) {
    return {
      ...base,
      status: "pending",
      invalidation: { ...issueHit, kind: "issue" },
    };
  }
  const calibHit = ctx.invalidatedByCalib.get(row.id);
  if (calibHit && calibHit.at >= row.recordedAt) {
    return {
      ...base,
      status: "pending",
      invalidation: { ...calibHit, kind: "calib" },
    };
  }

  return { ...base, status: "valid" };
}

export function foldEvents(eventsInput: LedgerEvent[]): FoldState {
  // 规范化序号（并发/持久化恢复后仍保持全序）
  const events = [...eventsInput].sort((a, b) => a.at - b.at || (a.seq ?? 0) - (b.seq ?? 0));
  events.forEach((e, i) => {
    e.seq = i + 1;
  });

  const pigeons = new Map<string, Pigeon>();
  const rings = new Map<string, Ring>();
  // 事件重放过程中“当前时点”每羽的在役环，用于成绩登记时绑定当次在役环
  const activeNow = new Map<string, string>();

  const calibrations = new Map<string, Calibration>();
  const sessions = new Map<string, Session>();
  const raw = new Map<string, RawResult>();
  const invalidatedByIssue = new Map<string, { at: number; seq: number; note: string }>();
  const invalidatedByCalib = new Map<string, { at: number; seq: number; note: string }>();

  for (const e of events) {
    switch (e.type) {
      case "pigeon-registered":
        if (!pigeons.has(e.pigeonId)) {
          pigeons.set(e.pigeonId, {
            id: e.pigeonId,
            band: e.band,
            bloodline: e.bloodline,
            health: e.health,
            registeredAt: e.at,
          });
        }
        break;
      case "ring-issued":
        if (!rings.has(e.ringId)) {
          rings.set(e.ringId, {
            id: e.ringId,
            code: e.code,
            pigeonId: e.pigeonId,
            issuedAt: e.at,
            note: e.note,
            status: "active",
          });
          activeNow.set(e.pigeonId, e.ringId);
        }
        break;
      case "ring-replaced": {
        const old = rings.get(e.oldRingId);
        if (old) {
          old.status = "retired";
          old.retiredAt = e.at;
          old.retireReason = "replaced";
          old.replacedBy = e.newRingId;
        }
        rings.set(e.newRingId, {
          id: e.newRingId,
          code: e.newCode,
          pigeonId: e.pigeonId,
          issuedAt: e.at,
          note: e.note,
          status: "active",
        });
        activeNow.set(e.pigeonId, e.newRingId);
        break;
      }
      case "ring-voided": {
        const r = rings.get(e.ringId);
        if (r) {
          r.status = "retired";
          r.retiredAt = e.at;
          r.retireReason = "void";
        }
        if (activeNow.get(e.pigeonId) === e.ringId) activeNow.delete(e.pigeonId);
        break;
      }
      case "ring-corrected": {
        const r = rings.get(e.ringId);
        if (r) {
          const retired = r.status === "retired";
          const retiredAt = r.retiredAt;
          const retireReason = r.retireReason;
          const replacedBy = r.replacedBy;
          r.issuedAt = e.issuedAt;
          r.note = e.note;
          // 更正发放记录不复活已停用/退役的环
          if (retired) {
            r.status = "retired";
            r.retiredAt = retiredAt;
            r.retireReason = retireReason;
            r.replacedBy = replacedBy;
          }
          r.correctedAt = e.at;
          r.correctedSeq = e.seq;
          // 更正发放记录：关联成绩立即失效并重算（含该羽名下绑定此环的成绩）
          for (const rr of raw.values()) {
            if (rr.ringId !== e.ringId && rr.pigeonId !== r.pigeonId) continue;
            invalidatedByIssue.set(rr.id, { at: e.at, seq: e.seq ?? 0, note: e.reason });
          }
        }
        break;
      }
      case "calibration-checked":
        if (!calibrations.has(e.calibrationId)) {
          calibrations.set(e.calibrationId, {
            id: e.calibrationId,
            ringId: e.ringId,
            pigeonId: e.pigeonId,
            readerId: e.readerId,
            calibratedAt: e.at,
            offsetMs: e.offsetMs,
            note: e.note,
          });
        }
        break;
      case "calibration-corrected": {
        const old = calibrations.get(e.calibrationId);
        if (old) {
          old.superseded = true;
          old.supersededBy = e.newCalibrationId;
        }
        calibrations.set(e.newCalibrationId, {
          id: e.newCalibrationId,
          ringId: old?.ringId ?? "",
          pigeonId: old?.pigeonId ?? "",
          readerId: e.readerId,
          calibratedAt: e.calibratedAt,
          offsetMs: e.offsetMs,
          note: e.note,
        });
        // 关联成绩（该校准当时服务的鸽、开笼不早于原校准时间）立即失效
        if (old) {
          for (const r of raw.values()) {
            if (r.pigeonId !== old.pigeonId) continue;
            const s = sessions.get(r.sessionId);
            if (s && s.releaseAt >= old.calibratedAt) {
              invalidatedByCalib.set(r.id, { at: e.at, seq: e.seq ?? 0, note: e.reason });
            }
          }
        }
        break;
      }
      case "batch-created":
        if (!sessions.has(e.sessionId)) {
          sessions.set(e.sessionId, {
            id: e.sessionId,
            site: e.site,
            distanceM: e.distanceM,
            weather: e.weather,
            releaseAt: e.releaseAt,
            createdAt: e.at,
          });
        }
        break;
      case "result-recorded":
        if (!raw.has(e.resultId)) {
          // 绑定登记时点的在役环（历史快照，不受后续换环影响）
          const ringId = activeNow.get(e.pigeonId);
          raw.set(e.resultId, {
            id: e.resultId,
            sessionId: e.sessionId,
            pigeonId: e.pigeonId,
            ringId,
            recordedAt: e.at,
            returnedAt: null,
            speed: null,
          });
        }
        break;
      case "return-recorded": {
        const r = raw.get(e.resultId);
        if (r && r.returnedAt === null) {
          r.returnedAt = e.returnedAt;
          r.speed = e.speed;
        }
        break;
      }
      case "review-resolved": {
        const r = raw.get(e.resultId);
        if (r) r.resolvedAt = e.at;
        break;
      }
      default:
        break;
    }
  }

  const ringCodes = new Map<string, string>();
  for (const r of rings.values()) ringCodes.set(r.code, r.id);

  // 成绩复核判定（统一重算）
  const ctx = { events, rings, calibrations, invalidatedByIssue, invalidatedByCalib };
  const results: ResultRow[] = [];
  for (const r of raw.values()) {
    const s = sessions.get(r.sessionId);
    if (!s) continue;
    results.push(evaluateResult(r, s.releaseAt, ctx));
  }

  // 组装批次视图 + 当批排行（只排有效归巢成绩）
  const sessionViews = new Map<string, SessionView>();
  for (const s of sessions.values()) {
    const rows = results
      .filter((r) => r.sessionId === s.id)
      .sort((a, b) => (a.returnedAt ?? Infinity) - (b.returnedAt ?? Infinity));

    const ranked = rows
      .filter((r) => r.status === "valid" && r.returnedAt !== null && r.speed !== null)
      .sort((a, b) => (b.speed ?? 0) - (a.speed ?? 0));
    ranked.forEach((r, i) => {
      r.rank = i + 1;
    });

    const inService = rows.filter((r) => r.status === "valid");
    const returnedCount = inService.filter((r) => r.returnedAt !== null).length;
    sessionViews.set(s.id, {
      ...s,
      results: rows,
      ranked,
      releasedCount: inService.length,
      returnedCount,
      unreturnedCount: inService.length - returnedCount,
      pendingCount: rows.filter((r) => r.status === "pending").length,
    });
  }

  return {
    pigeons,
    rings,
    ringCodes,
    calibrations,
    sessions,
    sessionViews,
    results,
    invalidatedByIssue,
    invalidatedByCalib,
    lastSeq: events.length,
  };
}

export function currentActiveRingForPigeon(
  rings: Map<string, Ring>,
  pigeonId: string
): Ring | undefined {
  let best: Ring | undefined;
  for (const r of rings.values()) {
    if (r.pigeonId !== pigeonId || r.status !== "active") continue;
    if (!best || r.issuedAt > best.issuedAt) best = r;
  }
  return best;
}

// ---------- 发环规则：每羽同一时间只认一枚在役环；重复/并发沿用首次结果 ----------

export interface IssueRequest {
  requestId: string;
  pigeonId: string;
  code: string;
  note: string;
  at: number;
}

/**
 * 并发发环裁决。同一鸽在途请求合并；已有在役环直接返回首次结果；
 * 电子环号全局唯一，重复环号沿用首次发环结果。
 */
export function resolveIssue(
  req: IssueRequest,
  state: FoldState,
  inflight: Map<string, { requestId: string; outcome: IssueOutcome }>
): { outcome: IssueOutcome; error?: string } {
  const existing = currentActiveRingForPigeon(state.rings, req.pigeonId);
  if (existing) {
    return {
      outcome: {
        ringId: existing.id,
        code: existing.code,
        pigeonId: req.pigeonId,
        created: false,
        deduped: true,
        notice: "该羽已有在役电子环，沿用首次发环结果；换环请走换环流程。",
      },
    };
  }

  const codeOwner = state.ringCodes.get(req.code);
  if (codeOwner) {
    const owner = state.rings.get(codeOwner)!;
    if (owner.status === "active") {
      return { outcome: emptyOutcome(req), error: `电子环号 ${req.code} 已在役于其他赛鸽` };
    }
  }

  const merged = inflight.get(req.pigeonId);
  if (merged) {
    return { outcome: { ...merged.outcome, deduped: true, notice: "重复/并发发环请求已合并，沿用首次结果。" } };
  }

  const ringId = `R-${req.code}`;
  const outcome: IssueOutcome = {
    ringId,
    code: req.code,
    pigeonId: req.pigeonId,
    created: true,
    deduped: false,
  };
  inflight.set(req.pigeonId, { requestId: req.requestId, outcome });
  return { outcome };
}

function emptyOutcome(req: IssueRequest): IssueOutcome {
  return { ringId: "", code: req.code, pigeonId: req.pigeonId, created: false, deduped: false };
}

// ---------- 展示辅助 ----------

export const PENDING_REASON_TEXT: Record<PendingReason, string> = {
  "ring-missing": "在役电子环缺失",
  "ring-not-issued": "开笼时电子环尚未发放",
  "ring-voided": "电子环已停用",
  "ring-retired": "电子环已退役",
  "calib-missing": "缺少开笼前最近一次校准",
  "calib-expired": "最近校准距开笼超过 72 小时",
};

export function calcSpeed(distanceM: number, releaseAt: number, returnedAt: number): number {
  const mins = (returnedAt - releaseAt) / 60000;
  if (mins <= 0) return 0;
  return Math.round((distanceM / mins) * 10) / 10;
}
