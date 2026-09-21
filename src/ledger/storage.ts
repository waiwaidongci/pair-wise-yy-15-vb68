import { fold } from "../rules/fold";
import { buildSeedEvents } from "./seed";
import type { LedgerEvent, LedgerState } from "../rules/types";

const STORAGE_KEY = "pigeon-band-ledger-v1";
const META_KEY = "pigeon-band-ledger-meta-v1";

interface StoredLedger {
  version: 1;
  events: LedgerEvent[];
}

/** 载入台账事件；首次访问写入演示台账。刷新后从同一事件流重放。 */
export function loadEvents(): { events: LedgerEvent[]; seeded: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as StoredLedger;
      if (data?.version === 1 && Array.isArray(data.events)) {
        return { events: data.events, seeded: false };
      }
    }
  } catch {
    // 存储损坏则重建演示数据
  }
  const events = buildSeedEvents(Date.now());
  saveEvents(events);
  localStorage.setItem(META_KEY, JSON.stringify({ createdAt: Date.now() }));
  return { events, seeded: true };
}

export function saveEvents(events: LedgerEvent[]): void {
  const data: StoredLedger = { version: 1, events };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function materialize(events: LedgerEvent[]): LedgerState {
  return fold(events);
}

export function resetLedger(): LedgerEvent[] {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(META_KEY);
  const events = buildSeedEvents(Date.now());
  saveEvents(events);
  return events;
}
