package com.quickforge.mobile.remote

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * 信令消息，JSON 字段与 Go protocol.Message 一致（未用字段省略）。
 */
data class SignalMessage(
    val type: String,
    val sessionId: String? = null,
    val installationId: String? = null,
    val sdp: String? = null,
    val candidate: SignalIceCandidate? = null,
    val reason: String? = null,
) {
    fun toJson(): String {
        val o = JSONObject().put("type", type)
        sessionId?.let { o.put("sessionId", it) }
        installationId?.let { o.put("installationId", it) }
        sdp?.let { o.put("sdp", it) }
        candidate?.let {
            val c = JSONObject()
                .put("candidate", it.candidate)
            it.sdpMid?.let { m -> c.put("sdpMid", m) }
            if (it.sdpMLineIndex != null && it.sdpMLineIndex >= 0) {
                c.put("sdpMLineIndex", it.sdpMLineIndex)
            }
            o.put("candidate", c)
        }
        reason?.let { o.put("reason", it) }
        return o.toString()
    }

    companion object {
        fun fromJson(json: String): SignalMessage {
            val o = JSONObject(json)
            val cand = o.optJSONObject("candidate")?.let {
                SignalIceCandidate(
                    candidate = it.optString("candidate", ""),
                    sdpMid = if (it.has("sdpMid")) it.optString("sdpMid") else null,
                    sdpMLineIndex = if (it.has("sdpMLineIndex")) it.optInt("sdpMLineIndex", -1) else null,
                )
            }
            return SignalMessage(
                type = o.optString("type", ""),
                sessionId = o.optString("sessionId").ifEmpty { null },
                installationId = o.optString("installationId").ifEmpty { null },
                sdp = o.optString("sdp").ifEmpty { null },
                candidate = cand,
                reason = o.optString("reason").ifEmpty { null },
            )
        }
    }
}

/** trickle ICE 候选（对应 Go protocol.ICECandidate）。 */
data class SignalIceCandidate(
    val candidate: String,
    val sdpMid: String?,
    val sdpMLineIndex: Int?,
)

/**
 * 信令 WebSocket 客户端（okhttp）。Bearer accessToken 仅在连接握手时使用；
 * 协议层 ping 由 okhttp pingInterval 兜底，应用层 ping 由服务定时发送。
 */
class SignalClient(
    private val client: OkHttpClient,
    private val wsUrl: String,
    private val accessToken: () -> String?,
    private val listener: Listener,
) {
    interface Listener {
        fun onOpen()
        fun onMessage(message: SignalMessage)
        fun onClosed(code: Int, reason: String?)
        /** [error]：http_401 / http_4xx / 超时等可读描述。 */
        fun onFailure(error: String)
    }

    @Volatile
    private var socket: WebSocket? = null

    fun connect() {
        val token = accessToken()
        if (token == null) {
            listener.onFailure("not_signed_in")
            return
        }
        val request = Request.Builder()
            .url(wsUrl)
            .header("Authorization", "Bearer $token")
            .header("User-Agent", "quickforge-android/1.0")
            .build()
        socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                listener.onOpen()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    listener.onMessage(SignalMessage.fromJson(text))
                } catch (_: Exception) {
                    // 忽略畸形消息
                }
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                // 信令仅文本消息
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                listener.onClosed(code, reason)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                val httpCode = response?.code
                val message = t.message
                listener.onFailure(
                    if (httpCode != null) {
                        "http_$httpCode"
                    } else {
                        message?.takeIf { it.isNotBlank() } ?: "ws_failure"
                    }
                )
            }
        })
    }

    fun send(message: SignalMessage) {
        socket?.send(message.toJson())
    }

    fun close() {
        socket?.close(1000, "bye")
        socket = null
    }

    companion object {
        /** http(s) cloudUrl -> ws(s) 信令地址。 */
        fun wsUrl(cloudUrl: String): String {
            val base = cloudUrl.trimEnd('/')
            return when {
                base.startsWith("https://") -> "wss://" + base.removePrefix("https://") + "/ws/signal"
                base.startsWith("http://") -> "ws://" + base.removePrefix("http://") + "/ws/signal"
                else -> base + "/ws/signal"
            }
        }
    }
}
