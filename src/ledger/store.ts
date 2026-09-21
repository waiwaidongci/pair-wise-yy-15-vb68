import type {
  Calibration,
  IssueOutcome,
  LedgerEvent,
  NewEvent,
  Pigeon,
  ResultRow,
  Ring,
  SessionView,
} from "../domain/types";
import { foldEvents, resolveIssue, type FoldState, type IssueRequest } from "../domain/rules";
import { buildSeedEvents } from "../domain/seed";

const STORAGE_KEY = "pigeon-e-ring-ledger-v1";

type Listener = () => void;

/**
 * 台账存储：事件追加即落盘，所有视图经规则层折叠派生。
 * 发环命令带每羽互斥：同一鸽的重复/并发发环沿用首次结果。
 */
class LedgerStore {
  private events: LedgerEvent[] = [];
  private state: FoldState;
  private listeners = new Set<Listener>();
  private inflight = new Map<string, { requestId: string; outcome: IssueOutcome }>();
  private issueLocks = new Map<string, Promise<IssueOutcome>>();

  constructor() {
    this.events = this.load();
    if (this.events.length === 0) {
      this.events = buildSeedEvents(Date.now());
      this.persist();
    }
    this.state = foldEvents(this.events);
  }

  private load(): LedgerEvent[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as LedgerEvent[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.events));
    } catch {
      // 存储不可用时仅保留内存态
    }
  }

  private append(event: NewEvent): LedgerEvent {
    const full = {
      ...(event as object),
      seq: this.events.length + 1,
      at: event.at ?? Date.now(),
    } as LedgerEvent;
    this.events.push(full);
    this.state = foldEvents(this.events);
    this.persist();
    this.listeners.forEach((l) => l());
    return full;
  }

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): FoldState => this.state;

  getEvents(): LedgerEvent[] {
    return [...this.events];
  }

  reset() {
    this.events = buildSeedEvents(Date.now());
    this.persist();
    this.state = foldEvents(this.events);
    this.listeners.forEach((l) => l());
  }

  /** 从持久层重新加载并折叠，模拟页面刷新。 */
  reload() {
    this.events = this.load();
    this.state = foldEvents(this.events);
    this.listeners.forEach((l) => l());
  }

  clear() {
    this.events = [];
    this.persist();
    this.state = foldEvents(this.events);
    this.listeners.forEach((l) => l());
  }

  // ---------- 赛鸽 ----------

  registerPigeon(input: { band: string; bloodline: string; health: string }): Pigeon {
    const id = `P-${String(this.state.pigeons.size + 1).padStart(2, "0")}-${Date.now().toString(36)}`;
    this.append({
      type: "pigeon-registered",
      pigeonId: id,
      band: input.band,
      bloodline: input.bloodline,
      health: input.health,
    });
    return this.state.pigeons.get(id)!;
  }

  // ---------- 电子环发放：互斥 + 去重 ----------

  issueRing(input: {
    pigeonId: string;
    code: string;
    note: string;
  }): Promise<IssueOutcome> {
    const existing = this.issueLocks.get(input.pigeonId);
    if (existing) {
      return existing.then((o) => ({
        ...o,
        deduped: true,
        notice: "并发发环请求已合并，沿用首次结果。",
      }));
    }

    const request: IssueRequest = {
      requestId: `${input.pigeonId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      pigeonId: input.pigeonId,
      code: input.code.trim(),
      note: input.note,
      at: Date.now(),
    };

    const { outcome, error } = resolveIssue(request, this.state, this.inflight);
    if (error) return Promise.reject(new Error(error));
    if (!outcome.created) return Promise.resolve(outcome);

    const task = new Promise<IssueOutcome>((resolve) => {
      // 模拟发环写入的异步窗口；窗口内重复/并发请求都会落到同一结果
      window.setTimeout(() => {
        this.append({
          type: "ring-issued",
          ringId: outcome.ringId,
          code: outcome.code,
          pigeonId: outcome.pigeonId,
          note: request.note,
        });
        this.inflight.delete(input.pigeonId);
        this.issueLocks.delete(input.pigeonId);
        resolve(outcome);
      }, 600);
    });

    this.issueLocks.set(input.pigeonId, task);
    return task;
  }

  replaceRing(input: { pigeonId: string; newCode: string; note: string }) {
    const old = this.getActiveRing(input.pigeonId);
    if (!old) throw new Error("该羽当前没有在役环，请先发放电子环");
    if (this.state.ringCodes.has(input.newCode.trim())) {
      throw new Error(`电子环号 ${input.newCode} 已存在`);
    }
    this.append({
      type: "ring-replaced",
      pigeonId: input.pigeonId,
      oldRingId: old.id,
      newRingId: `R-${input.newCode.trim()}`,
      newCode: input.newCode.trim(),
      note: input.note,
    });
  }

  voidRing(input: { ringId: string; note: string }) {
    const ring = this.state.rings.get(input.ringId);
    if (!ring) throw new Error("电子环不存在");
    if (ring.status !== "active") throw new Error("该环已不在役");
    this.append({ type: "ring-voided", ringId: ring.id, pigeonId: ring.pigeonId, note: input.note });
  }

  /** 更正发放记录：关联成绩立即失效并重算。 */
  correctRing(input: { ringId: string; issuedAt: number; note: string; reason: string }) {
    const ring = this.state.rings.get(input.ringId);
    if (!ring) throw new Error("电子环不存在");
    this.append({
      type: "ring-corrected",
      ringId: ring.id,
      issuedAt: input.issuedAt,
      note: input.note,
      reason: input.reason,
    });
  }

  // ---------- 校准 ----------

  calibrate(input: { pigeonId: string; readerId: string; offsetMs: number; note: string }): Calibration {
    const ring = this.getActiveRing(input.pigeonId);
    if (!ring) throw new Error("该羽没有在役电子环，无法校准");
    const id = `C-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    this.append({
      type: "calibration-checked",
      calibrationId: id,
      ringId: ring.id,
      pigeonId: input.pigeonId,
      readerId: input.readerId || "RW-棚01",
      offsetMs: Number.isFinite(input.offsetMs) ? input.offsetMs : 0,
      note: input.note,
    });
    return this.state.calibrations.get(id)!;
  }

  /** 更正校准记录：旧记录作废、新记录补登，关联成绩立即失效并重算。 */
  correctCalibration(input: {
    calibrationId: string;
    readerId: string;
    calibratedAt: number;
    offsetMs: number;
    note: string;
    reason: string;
  }) {
    const old = this.state.calibrations.get(input.calibrationId);
    if (!old) throw new Error("校准记录不存在");
    const id = `C-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    this.append({
      type: "calibration-corrected",
      calibrationId: old.id,
      newCalibrationId: id,
      reason: input.reason,
      readerId: input.readerId,
      calibratedAt: input.calibratedAt,
      offsetMs: input.offsetMs,
      note: input.note,
    });
  }

  // ---------- 训放批次与成绩 ----------

  createBatch(input: {
    site: string;
    distanceM: number;
    weather: string;
    releaseAt: number;
    pigeonIds: string[];
  }): SessionView {
    const id = `S-${Date.now().toString(36)}`;
    const releaseAt = input.releaseAt;
    this.append({
      type: "batch-created",
      at: Date.now(),
      sessionId: id,
      site: input.site,
      distanceM: input.distanceM,
      weather: input.weather,
      releaseAt,
    });
    input.pigeonIds.forEach((pigeonId, i) => {
      this.append({
        type: "result-recorded",
        at: releaseAt + i * 1000,
        resultId: `RR-${id}-${pigeonId}`,
        sessionId: id,
        pigeonId,
      });
    });
    return this.state.sessionViews.get(id)!;
  }

  recordReturn(input: { resultId: string; returnedAt: number; speed: number | null }) {
    const row = this.state.results.find((r) => r.id === input.resultId);
    if (!row) throw new Error("成绩记录不存在");
    if (row.returnedAt !== null) throw new Error("该羽已登记归巢，重复登记沿用首次结果");
    const session = this.state.sessions.get(row.sessionId)!;
    this.append({
      type: "return-recorded",
      at: Date.now(),
      resultId: row.id,
      sessionId: row.sessionId,
      pigeonId: row.pigeonId,
      returnedAt: input.returnedAt,
      speed: input.speed,
    });
  }

  resolveReview(input: { resultId: string; note: string }) {
    const row = this.state.results.find((r) => r.id === input.resultId);
    if (!row || row.status !== "pending") throw new Error("仅待复核成绩可确认");
    this.append({ type: "review-resolved", resultId: row.id, note: input.note });
  }

  // ---------- 查询辅助 ----------

  getActiveRing(pigeonId: string): Ring | undefined {
    let best: Ring | undefined;
    for (const r of this.state.rings.values()) {
      if (r.pigeonId !== pigeonId || r.status !== "active") continue;
      if (!best || r.issuedAt > best.issuedAt) best = r;
    }
    return best;
  }

  getPigeonResults(pigeonId: string): ResultRow[] {
    return this.state.results
      .filter((r) => r.pigeonId === pigeonId)
      .sort((a, b) => {
        const sa = this.state.sessions.get(a.sessionId)?.releaseAt ?? 0;
        const sb = this.state.sessions.get(b.sessionId)?.releaseAt ?? 0;
        return sb - sa;
      });
  }
}

export const ledger = new LedgerStore();
