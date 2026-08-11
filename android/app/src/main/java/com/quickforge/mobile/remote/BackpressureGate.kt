package com.quickforge.mobile.remote

/**
 * socket→DataChannel 发送背压水位门（纯逻辑，无 Android/WebRTC 依赖，可 JVM 单测）。
 *
 * 基于 DataChannel.bufferedAmount() 的高/低水位迟滞控制：
 * - 缓冲量超过 [highWater] 时进入暂停（paused=true），调用方应停止向 DataChannel 投递；
 * - 缓冲量降至 [lowWater] 以下才恢复（paused=false）。
 *
 * 注意：本门只依据 native bufferedAmount 指导读端启停，并不单独限制发送队列；
 * 发送队列的字节有界性由调用方（RemoteTunnelService 的 sendQueueBudget 信号量）保证。
 *
 * 高/低双水位提供迟滞区间，避免缓冲量在单一阈值附近反复抖动导致读端频繁启停。
 * 本类不包含任何线程阻塞逻辑；多线程下的互斥/唤醒由调用方（RemoteTunnelService）
 * 自行协调，本类仅维护可测试的状态迁移。
 */
class BackpressureGate(
    val highWater: Long = DEFAULT_HIGH_WATER_BYTES,
    val lowWater: Long = DEFAULT_LOW_WATER_BYTES,
) {
    init {
        require(highWater > lowWater) { "highWater must be > lowWater" }
        require(lowWater >= 0) { "lowWater must be >= 0" }
    }

    /** 当前是否处于暂停（读端应停止投递）。 */
    var paused: Boolean = false
        private set

    /** 每次投递前用最新 bufferedAmount 推进状态。 */
    fun update(buffered: Long) {
        if (paused) {
            if (buffered <= lowWater) paused = false
        } else {
            if (buffered > highWater) paused = true
        }
    }

    companion object {
        /** 高水位（字节）：默认 4MB，超过则暂停 socket 读取。 */
        const val DEFAULT_HIGH_WATER_BYTES = 4L * 1024 * 1024

        /** 低水位（字节）：默认 1MB，降至该值以下恢复读取。 */
        const val DEFAULT_LOW_WATER_BYTES = 1L * 1024 * 1024
    }
}
