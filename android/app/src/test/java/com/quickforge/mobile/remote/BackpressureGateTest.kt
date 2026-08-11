package com.quickforge.mobile.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [BackpressureGate] 纯逻辑单元测试：验证高/低水位迟滞状态迁移与参数校验。
 */
class BackpressureGateTest {

    @Test
    fun `initial state is not paused`() {
        val gate = BackpressureGate()
        assertFalse(gate.paused)
    }

    @Test
    fun `buffered amount below high water stays unpaused`() {
        val gate = BackpressureGate()
        gate.update(BackpressureGate.DEFAULT_HIGH_WATER_BYTES)
        assertFalse(gate.paused)
        gate.update(BackpressureGate.DEFAULT_LOW_WATER_BYTES)
        assertFalse(gate.paused)
    }

    @Test
    fun `buffered amount above high water pauses`() {
        val gate = BackpressureGate()
        gate.update(BackpressureGate.DEFAULT_HIGH_WATER_BYTES + 1)
        assertTrue(gate.paused)
    }

    @Test
    fun `paused stays paused between low and high water`() {
        val gate = BackpressureGate()
        gate.update(BackpressureGate.DEFAULT_HIGH_WATER_BYTES + 1)
        assertTrue(gate.paused)
        // 介于低水位之上、高水位之下：迟滞，不恢复
        gate.update(BackpressureGate.DEFAULT_LOW_WATER_BYTES + 1)
        assertTrue(gate.paused)
    }

    @Test
    fun `paused resumes once buffered amount drops to low water`() {
        val gate = BackpressureGate()
        gate.update(BackpressureGate.DEFAULT_HIGH_WATER_BYTES + 1)
        gate.update(BackpressureGate.DEFAULT_LOW_WATER_BYTES)
        assertFalse(gate.paused)
    }

    @Test
    fun `resumed state pauses again when high water exceeded`() {
        val gate = BackpressureGate()
        gate.update(BackpressureGate.DEFAULT_HIGH_WATER_BYTES + 1)
        gate.update(BackpressureGate.DEFAULT_LOW_WATER_BYTES)
        assertFalse(gate.paused)
        gate.update(BackpressureGate.DEFAULT_HIGH_WATER_BYTES + 1)
        assertTrue(gate.paused)
    }

    @Test
    fun `custom watermarks are respected`() {
        val gate = BackpressureGate(highWater = 200, lowWater = 100)
        gate.update(150)
        assertFalse(gate.paused)
        gate.update(201)
        assertTrue(gate.paused)
        gate.update(101)
        assertTrue(gate.paused)
        gate.update(100)
        assertFalse(gate.paused)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `high water must exceed low water`() {
        BackpressureGate(highWater = 100, lowWater = 200)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `low water must be non-negative`() {
        BackpressureGate(highWater = 200, lowWater = -1)
    }

    @Test
    fun `default watermarks are 4MB high and 1MB low`() {
        assertEquals(4L * 1024 * 1024, BackpressureGate.DEFAULT_HIGH_WATER_BYTES)
        assertEquals(1L * 1024 * 1024, BackpressureGate.DEFAULT_LOW_WATER_BYTES)
    }
}
