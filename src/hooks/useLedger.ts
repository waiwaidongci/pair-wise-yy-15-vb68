import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  activeRingFor,
  canCorrectIssuance,
  canIssue,
  ringById,
} from "../rules/engine";
import { fold } from "../rules/fold";
import { loadEvents, resetLedger, saveEvents } from "../ledger/storage";
import type { Calibration, LedgerEvent, LedgerState, RingIssue } from "../rules/types";

function uid(prefix: string): string {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${rnd}`;
}

export interface IssueResult {
  kind: "issued" | "reused";
  ringCode: string;
}

export function useLedger() {
  const [{ events }, setStore] = useState(() => {
    const loaded = loadEvents();
    return { events: loaded.events };
  });
  const eventsRef = useRef(events);
  eventsRef.current = events;

  // 跨标签页：另一处写入后，本页环档案 / 复核队列 / 成绩同步一致
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "pigeon-band-ledger-v1" && e.newValue) {
        try {
          const data = JSON.parse(e.newValue) as { events?: LedgerEvent[] };
          if (Array.isArray(data.events)) setStore({ events: data.events });
        } catch {
          /* 忽略损坏数据 */
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const state: LedgerState = useMemo(() => fold(events), [events]);

  const commit = useCallback((newEvents: LedgerEvent[]) => {
    setStore((prev) => {
      const next = [...prev.events, ...newEvents];
      saveEvents(next);
      return { events: next };
    });
  }, []);

  // 发环处理中的并发合并：同一羽+同一枚环的并发/重复请求沿用首次结果
  const inflight = useRef(
    new Map<string, Promise<IssueResult>>()
  );

  const issueRing = useCallback(
    async (pigeonId: string, ringCode: string): Promise<IssueResult> => {
      const current = fold(eventsRef.current);
      const pigeon = current.pigeons.get(pigeonId);
      if (!pigeon) throw new Error("赛鸽不存在");
      const requestId = uid("req");
      const check = canIssue(current.issues, pigeonId, ringCode, requestId);
      if (!check.ok) throw new Error(check.error);

      const key = `${pigeonId}::${ringCode}`;
      const pending = inflight.current.get(key);
      if (pending) {
        // 并发的第二笔不重复写入，直接沿用首次结果
        return pending.then((r) => ({ ...r, kind: "reused" as const }));
      }

      const task = new Promise<IssueResult>((resolve) => {
        // 模拟发环设备写入耗时，期间重复点击/并发请求都会走首次结果
        setTimeout(() => {
          const fresh = fold(eventsRef.current);
          // 写入前再校验：已有同 requestId 或同环在役记录则沿用，绝不重复发环
          const reused = fresh.issues.find(
            (i) =>
              i.ringCode === ringCode &&
              i.pigeonId === pigeonId &&
              i.deactivatedAt == null
          );
          if (reused) {
            resolve({ kind: "reused", ringCode });
          } else {
            commit([
              {
                type: "RingIssued",
                at: Date.now(),
                ringCode,
                pigeonId,
                requestId,
              },
            ]);
            resolve({ kind: "issued", ringCode });
          }
          inflight.current.delete(key);
        }, 600);
      });
      inflight.current.set(key, task);
      return task;
    },
    [commit]
  );

  const deactivateRing = useCallback(
    (ringCode: string, reason: string) => {
      const current = fold(eventsRef.current);
      const iss = current.issues.find((i) => i.ringCode === ringCode);
      if (!iss) throw new Error("电子环不存在");
      if (iss.deactivatedAt != null) throw new Error("该环已停用");
      commit([
        { type: "RingDeactivated", at: Date.now(), ringCode, reason: reason || "停用" },
      ]);
    },
    [commit]
  );

  /** 换环：旧环停用 + 新环发放同批提交，旧成绩留档 */
  const replaceRing = useCallback(
    (oldRingCode: string, newRingCode: string, reason: string) => {
      const current = fold(eventsRef.current);
      const old = current.issues.find((i) => i.ringCode === oldRingCode);
      if (!old) throw new Error("旧电子环不存在");
      if (old.deactivatedAt != null) throw new Error("旧电子环已停用");
      if (current.issues.some((i) => i.ringCode === newRingCode)) {
        throw new Error("新环号已在台账中登记");
      }
      const at = Date.now();
      commit([
        { type: "RingDeactivated", at, ringCode: oldRingCode, reason: reason || "换环" },
        {
          type: "RingIssued",
          at,
          ringCode: newRingCode,
          pigeonId: old.pigeonId,
          requestId: uid("req"),
        },
      ]);
    },
    [commit]
  );

  const correctIssuance = useCallback(
    (ringCode: string, pigeonId: string, issuedAt: number) => {
      const current = fold(eventsRef.current);
      const check = canCorrectIssuance(current.issues, ringCode, pigeonId, issuedAt);
      if (!check.ok) throw new Error(check.error);
      commit([
        {
          type: "IssuanceCorrected",
          at: Date.now(),
          ringCode,
          pigeonId,
          issuedAt,
        },
      ]);
    },
    [commit]
  );

  const recordCalibration = useCallback(
    (ringCode: string, calibratedAt: number, offsetSec: number, note: string) => {
      const current = fold(eventsRef.current);
      const iss = current.issues.find((i) => i.ringCode === ringCode);
      if (!iss) throw new Error("电子环不存在");
      if (calibratedAt > Date.now()) throw new Error("校准时间不能晚于当前时间");
      const calibration: Calibration = {
        id: uid("cal"),
        ringCode,
        calibratedAt,
        offsetSec,
        note,
        corrected: false,
        createdAt: Date.now(),
      };
      commit([{ type: "CalibrationRecorded", at: Date.now(), calibration }]);
    },
    [commit]
  );

  const correctCalibration = useCallback(
    (calibrationId: string, calibratedAt: number, offsetSec: number, note: string) => {
      commit([
        {
          type: "CalibrationCorrected",
          at: Date.now(),
          calibrationId,
          calibratedAt,
          offsetSec,
          note,
        },
      ]);
    },
    [commit]
  );

  const scheduleSession = useCallback(
    (data: {
      name: string;
      site: string;
      distanceM: number;
      weather: string;
      releasedAt: number;
    }) => {
      commit([
        { type: "SessionScheduled", at: Date.now(), session: { id: uid("s"), ...data } },
      ]);
    },
    [commit]
  );

  const correctSession = useCallback(
    (
      sessionId: string,
      data: {
        name: string;
        site: string;
        distanceM: number;
        weather: string;
        releasedAt: number;
      }
    ) => {
      commit([{ type: "SessionCorrected", at: Date.now(), sessionId, ...data }]);
    },
    [commit]
  );

  /** 登记成绩：自动绑定放飞当刻该羽的在役环；无环则空绑定，落待复核 */
  const recordResult = useCallback(
    (sessionId: string, pigeonId: string, arrivedAt: number | null) => {
      const current = fold(eventsRef.current);
      const session = current.sessions.get(sessionId);
      if (!session) throw new Error("训放场次不存在");
      if (arrivedAt != null && arrivedAt < session.releasedAt) {
        // 允许登记，但评定会因时间矛盾进待复核
      }
      const active = activeRingFor(current.issues, pigeonId, session.releasedAt);
      const id = uid("r");
      commit([
        {
          type: "ResultRecorded",
          at: Date.now(),
          id,
          sessionId,
          pigeonId,
          boundRingCode: active?.ringCode ?? null,
          arrivedAt,
        },
      ]);
      return id;
    },
    [commit]
  );

  const annotateResult = useCallback(
    (id: string, note: string) => {
      commit([{ type: "ResultAnnotated", at: Date.now(), id, note }]);
    },
    [commit]
  );

  const reset = useCallback(() => {
    setStore({ events: resetLedger() });
  }, []);

  return {
    state,
    events,
    issueRing,
    deactivateRing,
    replaceRing,
    correctIssuance,
    recordCalibration,
    correctCalibration,
    scheduleSession,
    correctSession,
    recordResult,
    annotateResult,
    reset,
  };
}

export type LedgerApi = ReturnType<typeof useLedger>;

export function ringOwnerName(api: LedgerApi, issue: RingIssue | undefined): string {
  if (!issue) return "—";
  return api.state.pigeons.get(issue.pigeonId)?.band ?? "未知赛鸽";
}

export { ringById };
