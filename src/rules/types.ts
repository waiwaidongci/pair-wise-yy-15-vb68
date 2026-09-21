// ===== 领域模型与台账事件（规则层：纯类型，无 React、无存储）=====

export interface Pigeon {
  id: string;
  /** 终身足环号 */
  band: string;
  bloodline: string;
  role: "赛鸽" | "种鸽";
}

export interface RingIssue {
  ringCode: string;
  pigeonId: string;
  issuedAt: number;
  deactivatedAt: number | null;
  deactivateReason: string | null;
  /** 首次发放的幂等请求号，重复/并发发环沿用此结果 */
  requestId: string;
  corrected: boolean;
}

export interface Calibration {
  id: string;
  ringCode: string;
  calibratedAt: number;
  /** 电子环钟差（秒，正=环钟偏快） */
  offsetSec: number;
  note: string;
  corrected: boolean;
  createdAt: number;
}

export interface TrainingSession {
  id: string;
  name: string;
  site: string;
  distanceM: number;
  weather: string;
  releasedAt: number;
}

export type ResultStatus = "valid" | "pending" | "archived";

export type PendingReason =
  | "RING_STOPPED"
  | "RING_MISSING"
  | "ISSUE_CORRECTED"
  | "CAL_MISSING"
  | "CAL_STALE"
  | "TIME_INVALID";

export interface Outcome {
  status: ResultStatus;
  reason?: PendingReason;
  /** 重算后实际绑定的当次在役环 */
  ringCode: string | null;
  calibrationId: string | null;
  /** 放飞时距最近一次校准的毫秒数 */
  calAgeMs: number | null;
  /** m/min，仅有效且已归巢时有值 */
  speed: number | null;
}

export interface Revision {
  at: number;
  label: string;
  before: Outcome | null;
  after: Outcome;
}

export interface ResultRecord {
  id: string;
  sessionId: string;
  pigeonId: string;
  /** 记成绩时在役环（留档判定用），有效绑定以重算结果为准 */
  boundRingCode: string | null;
  arrivedAt: number | null;
  createdAt: number;
  note: string;
  outcome: Outcome;
  revisions: Revision[];
}

export type LedgerEvent =
  | { type: "PigeonRegistered"; at: number; pigeon: Pigeon }
  | {
      type: "RingIssued";
      at: number;
      ringCode: string;
      pigeonId: string;
      requestId: string;
    }
  | { type: "RingDeactivated"; at: number; ringCode: string; reason: string }
  | {
      type: "IssuanceCorrected";
      at: number;
      ringCode: string;
      pigeonId: string;
      issuedAt: number;
    }
  | { type: "CalibrationRecorded"; at: number; calibration: Calibration }
  | {
      type: "CalibrationCorrected";
      at: number;
      calibrationId: string;
      calibratedAt: number;
      offsetSec: number;
      note: string;
    }
  | { type: "SessionScheduled"; at: number; session: TrainingSession }
  | {
      type: "SessionCorrected";
      at: number;
      sessionId: string;
      name: string;
      site: string;
      distanceM: number;
      weather: string;
      releasedAt: number;
    }
  | {
      type: "ResultRecorded";
      at: number;
      id: string;
      sessionId: string;
      pigeonId: string;
      boundRingCode: string | null;
      arrivedAt: number | null;
    }
  | { type: "ResultAnnotated"; at: number; id: string; note: string };

export interface LedgerState {
  pigeons: Map<string, Pigeon>;
  issues: RingIssue[];
  calibrations: Calibration[];
  sessions: Map<string, TrainingSession>;
  results: ResultRecord[];
}
