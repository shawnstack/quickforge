package com.quickforge.mobile.remote

import android.content.Context
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/** 登录态失效（refreshToken 过期/被撤销）——JS 侧应提示重新登录。 */
class AuthExpiredException(message: String) : Exception(message)

data class Device(
    val installationId: String,
    val name: String,
    val online: Boolean,
    val services: List<JSONObject>,
)

data class TurnCredentials(
    val urls: List<String>,
    val username: String,
    val credential: String,
)

/** 进程内共享 OkHttp 客户端（服务与插件共用）。 */
object CloudHttp {
    val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(20, TimeUnit.SECONDS)
            .pingInterval(20, TimeUnit.SECONDS)
            .build()
    }
}

/**
 * 云 API 客户端：
 * - POST /oauth/token（refresh grant，JSON body，与云 tokenRequest 字段一致）；
 * - GET /v1/remote/devices、POST /v1/remote/turn-credentials（Bearer accessToken；
 *   401 自动换新 token 重试一次，refreshToken 失效则抛 [AuthExpiredException]）。
 */
class CloudApi(private val context: Context, private val client: OkHttpClient) {

    private val store = CloudAccountStore(context)

    /**
     * 用 refreshToken 换新 accessToken；成功则轮换并持久化新 refreshToken。
     * 401（过期/重用）时清空会话返回 null；网络错误抛 [IOException]。
     * 同步锁防止并发刷新使用同一 refreshToken 触发云侧重用检测。
     */
    @Synchronized
    fun refreshAccessToken(): String? {
        val cloudUrl = store.cloudUrl() ?: return null
        val refreshToken = store.refreshToken() ?: return null
        val body = JSONObject()
            .put("grantType", "refresh_token")
            .put("refreshToken", refreshToken)
            .toString()
        val request = Request.Builder()
            .url(cloudUrl.trimEnd('/') + "/oauth/token")
            .post(body.toRequestBody(JSON_MEDIA))
            .build()
        client.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            when {
                response.code == 200 -> {
                    val o = JSONObject(text)
                    val access = o.optString("accessToken")
                    val nextRefresh = o.optString("refreshToken")
                    if (access.isNotEmpty() && nextRefresh.isNotEmpty()) {
                        store.save(nextRefresh, cloudUrl)
                        SessionStore.accessToken = access
                        return access
                    }
                    return null
                }
                response.code in 400..499 -> {
                    // 过期/重用/失效：清会话，提示重新登录
                    store.clear()
                    SessionStore.accessToken = null
                    return null
                }
                else -> throw IOException("refresh failed: HTTP ${response.code}")
            }
        }
    }

    /** 内存 accessToken 优先，缺失则刷新。 */
    fun ensureAccessToken(): String? {
        SessionStore.accessToken?.let { return it }
        return refreshAccessToken()
    }

    /** GET /v1/remote/devices -> 本账号在线 agent 设备列表。 */
    fun listDevices(): List<Device> {
        val json = requestWithAuth("GET", "/v1/remote/devices", null)
        val items = json.optJSONArray("items") ?: return emptyList()
        return buildList {
            for (i in 0 until items.length()) {
                val d = items.optJSONObject(i) ?: continue
                val services = d.optJSONArray("services")
                add(
                    Device(
                        installationId = d.optString("installationId"),
                        name = d.optString("name"),
                        online = d.optBoolean("online"),
                        services = buildList {
                            if (services != null) {
                                for (j in 0 until services.length()) {
                                    services.optJSONObject(j)?.let { add(it) }
                                }
                            }
                        },
                    )
                )
            }
        }
    }

    /** POST /v1/remote/turn-credentials -> TURN/STUN 短期凭证。 */
    fun turnCredentials(): TurnCredentials {
        val json = requestWithAuth("POST", "/v1/remote/turn-credentials", null)
        val urls = json.optJSONArray("urls")
        return TurnCredentials(
            urls = buildList {
                if (urls != null) {
                    for (i in 0 until urls.length()) {
                        val u = urls.optString(i)
                        if (u.isNotEmpty()) add(u)
                    }
                }
            },
            username = json.optString("username"),
            credential = json.optString("credential"),
        )
    }

    /** 鉴权请求：401 -> 刷新 -> 重试一次；仍 401 抛 [AuthExpiredException]。 */
    private fun requestWithAuth(method: String, path: String, body: JSONObject?): JSONObject {
        val cloudUrl = store.cloudUrl() ?: throw AuthExpiredException("未登录")

        fun call(token: String): okhttp3.Response {
            val builder = Request.Builder()
                .url(cloudUrl.trimEnd('/') + path)
                .header("Authorization", "Bearer $token")
                .header("User-Agent", "quickforge-android/1.0")
            if (body != null) {
                builder.post(body.toString().toRequestBody(JSON_MEDIA))
            } else if (method == "POST") {
                builder.post("".toRequestBody(JSON_MEDIA))
            } else {
                builder.get()
            }
            return client.newCall(builder.build()).execute()
        }

        var response = call(ensureAccessToken() ?: throw AuthExpiredException("登录已过期，请重新登录"))
        if (response.code == 401) {
            response.close()
            val fresh = refreshAccessToken() ?: throw AuthExpiredException("登录已过期，请重新登录")
            response = call(fresh)
        }
        response.use { r ->
            val text = r.body?.string().orEmpty()
            when {
                r.code == 200 -> return if (text.isEmpty()) JSONObject() else JSONObject(text)
                r.code == 401 -> throw AuthExpiredException("登录已过期，请重新登录")
                else -> throw IOException("cloud api $path failed: HTTP ${r.code}")
            }
        }
    }

    companion object {
        private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
    }
}
