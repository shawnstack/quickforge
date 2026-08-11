package com.quickforge.mobile.remote

/** 信令重挂退避：首次可立即执行，之后按 1/2/4/8 秒封顶。 */
internal fun signalReconnectDelayMs(attempt: Int, immediate: Boolean): Long {
    if (immediate) return 0L
    return minOf(1L shl attempt.coerceIn(0, 3), 8L) * 1000L
}
