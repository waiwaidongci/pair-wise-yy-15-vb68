import { useSyncExternalStore } from "react";
import { ledger } from "../ledger/store";
import type { FoldState } from "../domain/rules";

export function useLedger(): FoldState {
  return useSyncExternalStore(ledger.subscribe, ledger.getSnapshot, ledger.getSnapshot);
}

export function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtFull(ts: number): string {
  const d = new Date(ts);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtAge(ts: number, now: number): string {
  const diff = now - ts;
  const h = Math.floor(diff / 3600000);
  if (h < 1) return `${Math.max(1, Math.floor(diff / 60000))} 分钟前`;
  if (h < 48) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

export function toLocalInputValue(ts: number): string {
  return fmtFull(ts);
}
