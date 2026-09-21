// 领域类型：电子环、校准、训放批次与成绩。
// 唯一事实来源是台账事件（LedgerEvent），以下视图类型全部由事件折叠派生。

export type RingStatus = "active" | "retired";
export type RetireReason = "void" | "replaced";
export type ResultStatus = "valid" | "pending" | "archived";

export type PendingReason =
  | "ring-missing" // 在役环缺失（未发放/已停用且未换环）
  | "ring-not-issued" // 开笼时间早于发环时间
  | "ring-voided" // 环已停用
  | "ring-retired" // 环已被换环，当前记录晚于换环时间
  | "calib-missing" // 缺少开笼前最近一次校准
  | "calib-expired"; // 最近一次校准距开笼超过 72 小时

export interface Pigeon {
  id: string;
  band: string; // 统一足环号
  bloodline: string; // 血统
  health: string; // 健康状态
  registeredAt: number;
}

export interface Ring {
  id: string;
  code: string; // 电子环号
  pigeonId: string;
  issuedAt: number;
  note: string;
  status: RingStatus;
  retiredAt?: number;
  retireReason?: RetireReason;
  replacedBy?: string; // 换环后继任环 id
  correctedAt?: number; // 发放记录最近一次更正时间
  correctedSeq?: number;
}

export interface Calibration {
  id: string;
  ringId: string;
  pigeonId: string;
  readerId: string;
  calibratedAt: number;
  offsetMs: number; // 读写器钟差（毫秒）
  note: string;
  superseded?: boolean; // 已被更正记录取代
  supersededBy?: string;
}

export interface Session {
  id: string;
  site: string;
  distanceM: number;
  weather: string;
  releaseAt: number; // 开笼时间
  createdAt: number;
}

export interface ResultRow {
  id: string;
  sessionId: string;
  pigeonId: string;
  ringId?: string; // 登记时在役环
  recordedAt: number;
  returnedAt: number | null;
  speed: number | null; // m/min
  status: ResultStatus;
  pendingReason?: PendingReason;
  invalidation?: { at: number; seq: number; kind: "issue" | "calib"; note: string };
  resolvedAt?: number; // 人工复核确认时间
  rank?: number; // 当批成绩名次（仅有效归巢成绩）
}

export interface SessionView extends Session {
  results: ResultRow[];
  ranked: ResultRow[];
  releasedCount: number; // 在役有效成绩数（不计待复核/留档）
  returnedCount: number; // 在役有效归巢数
  unreturnedCount: number; // 在役有效未归巢数
  pendingCount: number;
}

export interface LedgerEventBase {
  seq?: number;
  at: number;
}

export interface PigeonRegisteredEvent extends LedgerEventBase {
  type: "pigeon-registered";
  pigeonId: string;
  band: string;
  bloodline: string;
  health: string;
}

export interface RingIssuedEvent extends LedgerEventBase {
  type: "ring-issued";
  ringId: string;
  code: string;
  pigeonId: string;
  note: string;
}

export interface RingReplacedEvent extends LedgerEventBase {
  type: "ring-replaced";
  pigeonId: string;
  oldRingId: string;
  newRingId: string;
  newCode: string;
  note: string;
}

export interface RingVoidedEvent extends LedgerEventBase {
  type: "ring-voided";
  ringId: string;
  pigeonId: string;
  note: string;
}

export interface RingCorrectedEvent extends LedgerEventBase {
  type: "ring-corrected";
  ringId: string;
  issuedAt: number;
  note: string;
  reason: string;
}

export interface CalibrationCheckedEvent extends LedgerEventBase {
  type: "calibration-checked";
  calibrationId: string;
  ringId: string;
  pigeonId: string;
  readerId: string;
  offsetMs: number;
  note: string;
}

export interface CalibrationCorrectedEvent extends LedgerEventBase {
  type: "calibration-corrected";
  calibrationId: string;
  newCalibrationId: string;
  reason: string;
  readerId: string;
  calibratedAt: number;
  offsetMs: number;
  note: string;
}

export interface BatchCreatedEvent extends LedgerEventBase {
  type: "batch-created";
  sessionId: string;
  site: string;
  distanceM: number;
  weather: string;
  releaseAt: number;
}

export interface ResultRecordedEvent extends LedgerEventBase {
  type: "result-recorded";
  resultId: string;
  sessionId: string;
  pigeonId: string;
}

export interface ReturnRecordedEvent extends LedgerEventBase {
  type: "return-recorded";
  resultId: string;
  sessionId: string;
  pigeonId: string;
  returnedAt: number;
  speed: number | null;
}

export interface ReviewResolvedEvent extends LedgerEventBase {
  type: "review-resolved";
  resultId: string;
  note: string;
}

export type LedgerEvent =
  | PigeonRegisteredEvent
  | RingIssuedEvent
  | RingReplacedEvent
  | RingVoidedEvent
  | RingCorrectedEvent
  | CalibrationCheckedEvent
  | CalibrationCorrectedEvent
  | BatchCreatedEvent
  | ResultRecordedEvent
  | ReturnRecordedEvent
  | ReviewResolvedEvent;

/** 台账追加入参：序号由台账生成，时间默认取当前时刻。 */
export type NewEvent =
  | (Omit<PigeonRegisteredEvent, "seq" | "at"> & { at?: number })
  | (Omit<RingIssuedEvent, "seq" | "at"> & { at?: number })
  | (Omit<RingReplacedEvent, "seq" | "at"> & { at?: number })
  | (Omit<RingVoidedEvent, "seq" | "at"> & { at?: number })
  | (Omit<RingCorrectedEvent, "seq" | "at"> & { at?: number })
  | (Omit<CalibrationCheckedEvent, "seq" | "at"> & { at?: number })
  | (Omit<CalibrationCorrectedEvent, "seq" | "at"> & { at?: number })
  | (Omit<BatchCreatedEvent, "seq" | "at"> & { at?: number })
  | (Omit<ResultRecordedEvent, "seq" | "at"> & { at?: number })
  | (Omit<ReturnRecordedEvent, "seq" | "at"> & { at?: number })
  | (Omit<ReviewResolvedEvent, "seq" | "at"> & { at?: number });

export interface IssueOutcome {
  ringId: string;
  code: string;
  pigeonId: string;
  created: boolean;
  deduped: boolean;
  notice?: string;
}
