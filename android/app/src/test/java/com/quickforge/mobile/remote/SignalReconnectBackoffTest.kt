package com.quickforge.mobile.remote

import org.junit.Assert.assertEquals
import org.junit.Test

class SignalReconnectBackoffTest {
    @Test
    fun `first reconnect can run immediately`() {
        assertEquals(0L, signalReconnectDelayMs(attempt = 0, immediate = true))
    }

    @Test
    fun `subsequent reconnects use capped exponential backoff`() {
        assertEquals(listOf(1000L, 2000L, 4000L, 8000L, 8000L), (0..4).map { signalReconnectDelayMs(it, false) })
    }
}
