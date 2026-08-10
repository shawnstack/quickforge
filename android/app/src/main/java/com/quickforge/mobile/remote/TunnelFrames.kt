package com.quickforge.mobile.remote

import java.io.ByteArrayOutputStream

/**
 * qf-tunnel DataChannel 帧编解码，字节格式与 Go 端 internal/remote/protocol/frames.go 完全一致：
 *
 * ```
 * byte 0       : type  1=OPEN  2=DATA  3=CLOSE  4=ERROR
 * byte 1-2     : streamID (BE uint16)
 * byte 3-4     : length  (BE uint16, 仅 DATA 有 payload)
 * payload(OPEN): serviceID (1B, qf-web=1)
 * payload(DATA): 原始字节
 * ```
 */
object TunnelFrames {
    const val TYPE_OPEN: Byte = 1
    const val TYPE_DATA: Byte = 2
    const val TYPE_CLOSE: Byte = 3
    const val TYPE_ERROR: Byte = 4

    /** 内置服务表 serviceID（与 Go ServiceQuickForge 一致）。 */
    const val SERVICE_QF_WEB: Byte = 1

    const val HEADER_LEN = 5
    const val MAX_PAYLOAD = 0xFFFF

    /** 一次成功解码的帧。 */
    class Frame(val type: Byte, val streamId: Int, val payload: ByteArray)

    /** 编码 OPEN 帧（新建流，payload 为 1 字节 serviceID）。 */
    fun encodeOpen(streamId: Int, serviceId: Byte): ByteArray {
        require(streamId in 1..MAX_PAYLOAD) { "streamId out of range" }
        val bytes = ByteArray(HEADER_LEN + 1)
        bytes[0] = TYPE_OPEN
        writeStreamId(bytes, streamId)
        writeLength(bytes, 1)
        bytes[HEADER_LEN] = serviceId
        return bytes
    }

    /** 编码 DATA 帧；payload 超 65535 字节抛异常（调用方应分片）。 */
    fun encodeData(streamId: Int, payload: ByteArray): ByteArray {
        require(streamId in 1..MAX_PAYLOAD) { "streamId out of range" }
        require(payload.size <= MAX_PAYLOAD) { "frame payload exceeds 65535 bytes" }
        val bytes = ByteArray(HEADER_LEN + payload.size)
        bytes[0] = TYPE_DATA
        writeStreamId(bytes, streamId)
        writeLength(bytes, payload.size)
        payload.copyInto(bytes, HEADER_LEN)
        return bytes
    }

    /** 编码 CLOSE/ERROR 帧（无 payload）。 */
    fun encodeControl(type: Byte, streamId: Int): ByteArray {
        require(streamId in 1..MAX_PAYLOAD) { "streamId out of range" }
        val bytes = ByteArray(HEADER_LEN)
        bytes[0] = type
        writeStreamId(bytes, streamId)
        writeLength(bytes, 0)
        return bytes
    }

    private fun writeStreamId(bytes: ByteArray, streamId: Int) {
        bytes[1] = ((streamId shr 8) and 0xFF).toByte()
        bytes[2] = (streamId and 0xFF).toByte()
    }

    private fun writeLength(bytes: ByteArray, length: Int) {
        bytes[3] = ((length shr 8) and 0xFF).toByte()
        bytes[4] = (length and 0xFF).toByte()
    }
}

/**
 * 增量帧解析器：单条 DataChannel 消息可能包含多帧或半帧，
 * 语义与 Go DecodeFrame 一致（数据不足返回 incomplete）。
 */
class FrameDecoder {
    private val buffer = ByteArrayOutputStream()

    /** 追加字节并尝试取出所有完整帧；半帧留在内部缓冲。 */
    fun push(data: ByteArray): List<TunnelFrames.Frame> {
        buffer.write(data)
        val bytes = buffer.toByteArray()
        val frames = ArrayList<TunnelFrames.Frame>()
        var offset = 0
        while (bytes.size - offset >= TunnelFrames.HEADER_LEN) {
            val length = ((bytes[offset + 3].toInt() and 0xFF) shl 8) or (bytes[offset + 4].toInt() and 0xFF)
            if (bytes.size - offset < TunnelFrames.HEADER_LEN + length) break
            val type = bytes[offset]
            val streamId = ((bytes[offset + 1].toInt() and 0xFF) shl 8) or (bytes[offset + 2].toInt() and 0xFF)
            val payload = bytes.copyOfRange(offset + TunnelFrames.HEADER_LEN, offset + TunnelFrames.HEADER_LEN + length)
            frames.add(TunnelFrames.Frame(type, streamId, payload))
            offset += TunnelFrames.HEADER_LEN + length
        }
        if (offset > 0) {
            buffer.reset()
            if (offset < bytes.size) buffer.write(bytes, offset, bytes.size - offset)
        }
        return frames
    }

    fun reset() {
        buffer.reset()
    }
}
