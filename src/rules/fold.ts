import { evaluateResult } from "./engine";
import type { LedgerEvent, LedgerState, Outcome, ResultRecord } from "./types";

export const EMPTY_STATE: LedgerState = {
  pigeons: new Map(),
  issues: [],
  calibrations: [],
  sessions: new Map(),
  results: [],
};

function clone(out: Outcome): Outcome {
  return { ...out };
}

function sameOutcome(a: Outcome, b: Outcome): boolean {
  return (
    a.status === b.status &&
    a.reason === b.reason &&
    a.ringCode === b.ringCode &&
    a.calibrationId === b.calibrationId &&
    a.calAgeMs === b.calAgeMs &&
    (a.speed ?? null) === (b.speed ?? null)
  );
}

function affectedPigeons(state: LedgerState, ev: LedgerEvent): Set<string> {
  const ids = new Set<string>();
  const addRingOwner = (ringCode: string) => {
    const iss = state.issues.find((i) => i.ringCode === ringCode);
    if (iss) ids.add(iss.pigeonId);
  };
  switch (ev.type) {
    case "RingIssued":
      ids.add(ev.pigeonId);
      break;
    case "RingDeactivated":
      addRingOwner(ev.ringCode);
      break;
    case "IssuanceCorrected":
      addRingOwner(ev.ringCode);
      ids.add(ev.pigeonId);
      break;
    case "CalibrationRecorded":
    case "CalibrationCorrected": {
      const code =
        ev.type === "CalibrationRecorded"
          ? ev.calibration.ringCode
          : state.calibrations.find((c) => c.id === ev.calibrationId)?.ringCode;
      if (code) addRingOwner(code);
      state.results.forEach((r) => {
        if (r.boundRingCode === code || r.outcome.ringCode === code)
          ids.add(r.pigeonId);
      });
      break;
    }
    default:
      break;
  }
  return ids;
}

export function causeLabel(ev: LedgerEvent): string {
  switch (ev.type) {
    case "ResultRecorded":
      return "成绩登记，首次评定";
    case "RingIssued":
      return "电子环发放，关联成绩重算";
    case "RingDeactivated":
      return "电子环停用，关联成绩立即失效并重算";
    case "IssuanceCorrected":
      return "发放记录更正，关联成绩立即失效并重算";
    case "CalibrationRecorded":
      return "新校准登记，成绩重算";
    case "CalibrationCorrected":
      return "校准记录更正，关联成绩立即失效并重算";
    case "SessionCorrected":
      return "放飞信息更正，成绩重算";
    default:
      return ev.type;
  }
}

/**
 * 台账 fold：只追加事件 -> 物化状态。
 * 成绩永远由当前台账重算：环停用 / 校准缺失或超 72 小时 -> 待复核；
 * 换环 -> 旧成绩留档；发放 / 校准更正 -> 立即失效重算。
 * 每次评定变化追加一条 revision，刷新后从事件重放得到完全一致的状态。
 */
export function fold(events: LedgerEvent[], base: LedgerState = EMPTY_STATE): LedgerState {
  const state: LedgerState = {
    pigeons: new Map(base.pigeons),
    issues: base.issues.map((i) => ({ ...i })),
    calibrations: base.calibrations.map((c) => ({ ...c })),
    sessions: new Map(base.sessions),
    results: base.results.map((r) => ({
      ...r,
      revisions: r.revisions.map((v) => ({ ...v, before: v.before ? { ...v.before } : null, after: { ...v.after } })),
    })),
  };
  /** 重放期间的上次评定快照（含初始评定），用于产生确定性 revision */
  const prev = new Map<string, Outcome>();
  state.results.forEach((r) => prev.set(r.id, r.outcome));

  const recompute = (pigeonIds: Set<string>, sessionId: string | undefined, ev: LedgerEvent) => {
    const targets = state.results.filter(
      (r) =>
        pigeonIds.has(r.pigeonId) ||
        (sessionId != null && r.sessionId === sessionId)
    );
    for (const r of targets) {
      const before = prev.get(r.id) ?? null;
      const after = evaluateResult(state, r);
      // 已留档（换环）的旧成绩冻结，不再因后续事件变动
      if (before?.status === "archived") {
        prev.set(r.id, before);
        continue;
      }
      if (!before || !sameOutcome(before, after)) {
        const rev: ResultRecord["revisions"][number] = {
          at: ev.at,
          label: causeLabel(ev),
          before: before ? clone(before) : null,
          after: clone(after),
        };
        r.revisions.push(rev);
      }
      r.outcome = after;
      prev.set(r.id, after);
    }
  };

  for (const ev of events) {
    switch (ev.type) {
      case "PigeonRegistered":
        state.pigeons.set(ev.pigeon.id, { ...ev.pigeon });
        break;

      case "RingIssued":
        if (!state.issues.some((i) => i.requestId === ev.requestId)) {
          state.issues.push({
            ringCode: ev.ringCode,
            pigeonId: ev.pigeonId,
            issuedAt: ev.at,
            deactivatedAt: null,
            deactivateReason: null,
            requestId: ev.requestId,
            corrected: false,
          });
        }
        recompute(new Set([ev.pigeonId]), undefined, ev);
        break;

      case "RingDeactivated": {
        const iss = state.issues.find((i) => i.ringCode === ev.ringCode);
        if (iss) {
          iss.deactivatedAt = ev.at;
          iss.deactivateReason = ev.reason;
        }
        recompute(affectedPigeons(state, ev), undefined, ev);
        break;
      }

      case "IssuanceCorrected": {
        const old = state.issues.find((i) => i.ringCode === ev.ringCode);
        const oldPigeon = old?.pigeonId;
        if (old) {
          old.pigeonId = ev.pigeonId;
          old.issuedAt = ev.issuedAt;
          old.corrected = true;
        }
        const ids = new Set([ev.pigeonId]);
        if (oldPigeon) ids.add(oldPigeon);
        recompute(ids, undefined, ev);
        break;
      }

      case "CalibrationRecorded":
        state.calibrations.push({ ...ev.calibration });
        recompute(affectedPigeons(state, ev), undefined, ev);
        break;

      case "CalibrationCorrected": {
        const cal = state.calibrations.find((c) => c.id === ev.calibrationId);
        if (cal) {
          cal.calibratedAt = ev.calibratedAt;
          cal.offsetSec = ev.offsetSec;
          cal.note = ev.note;
          cal.corrected = true;
        }
        recompute(affectedPigeons(state, ev), undefined, ev);
        break;
      }

      case "SessionScheduled":
        state.sessions.set(ev.session.id, { ...ev.session });
        break;

      case "SessionCorrected": {
        const s = state.sessions.get(ev.sessionId);
        if (s) {
          s.name = ev.name;
          s.site = ev.site;
          s.distanceM = ev.distanceM;
          s.weather = ev.weather;
          s.releasedAt = ev.releasedAt;
        }
        recompute(new Set(), ev.sessionId, ev);
        break;
      }

      case "ResultRecorded": {
        const rec: ResultRecord = {
          id: ev.id,
          sessionId: ev.sessionId,
          pigeonId: ev.pigeonId,
          boundRingCode: ev.boundRingCode,
          arrivedAt: ev.arrivedAt,
          createdAt: ev.at,
          note: "",
          outcome: {
            status: "pending",
            ringCode: ev.boundRingCode,
            calibrationId: null,
            calAgeMs: null,
            speed: null,
          },
          revisions: [],
        };
        state.results.push(rec);
        recompute(new Set([ev.pigeonId]), ev.sessionId, ev);
        break;
      }

      case "ResultAnnotated": {
        const r = state.results.find((x) => x.id === ev.id);
        if (r) r.note = ev.note;
        break;
      }
    }
  }

  return state;
}
