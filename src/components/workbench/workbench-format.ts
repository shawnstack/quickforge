export function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function fmtHm(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fmtClock(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 倒计时不带 T 前缀：未来纯 HH:MM:SS，过点由调用方加 + 号。 */
export function fmtSpan(ms: number): string {
  const total = Math.max(0, Math.floor(Math.abs(ms) / 1000))
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`
}