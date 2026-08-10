package com.quickforge.mobile.remote

import android.content.Intent
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Capacitor 插件 RemoteTunnel（原生↔JS 契约）：
 *
 * - setToken({accessToken, refreshToken, cloudUrl, email?}): Promise<void>
 *   email 为账号邮箱（可空，不强制校验），随会话明文持久化，供登录界面展示账号信息；
 * - hasSession(): Promise<{signedIn: boolean, email?: string, cloudUrl?: string}>
 *   返回当前会话账号信息（signedIn 判断逻辑不变；email/cloudUrl 为 null 时不返回该字段）；
 * - signOut(): Promise<void>
 * - listDevices(): Promise<{items: [{installationId, name, online, services}]}>
 * - connect({installationId}): Promise<void>
 * - disconnect(): Promise<void>
 * - retry(): Promise<void>
 * - getState(): Promise<{state, error?}>
 * - 事件 remoteStateChanged {state, error?}
 *
 * 原生实现位于 [RemoteTunnelService]（前台服务：信令 WS + WebRTC + 本地 TCP
 * 18080）；本插件只做参数校验、令牌存取与事件转发。
 */
@CapacitorPlugin(name = "RemoteTunnel")
class RemoteTunnel : Plugin() {

    private val executor: ExecutorService =
        Executors.newSingleThreadExecutor { r -> Thread(r, "qf-remote-plugin") }

    private val store: CloudAccountStore by lazy { CloudAccountStore(context) }

    override fun load() {
        super.load()
        RemoteTunnelService.listener = { state, error ->
            val data = JSObject().put("state", state)
            error?.let { data.put("error", it) }
            notifyListeners("remoteStateChanged", data)
        }
    }

    /**
     * 保存令牌并唤醒前台服务。email 可空（旧客户端不传时仅不写入/清除邮箱字段），
     * accessToken、refreshToken、cloudUrl 均为必填。契约详见类头注释。
     */
    @PluginMethod
    fun setToken(call: PluginCall) {
        val accessToken = call.getString("accessToken")
        val refreshToken = call.getString("refreshToken")
        val cloudUrl = call.getString("cloudUrl")
        val email = call.getString("email")
        if (accessToken.isNullOrEmpty() || refreshToken.isNullOrEmpty() || cloudUrl.isNullOrEmpty()) {
            call.reject("accessToken、refreshToken、cloudUrl 均为必填")
            return
        }
        executor.execute {
            try {
                // refreshToken 加密落盘（Keystore），email/cloudUrl 明文，accessToken 仅内存
                store.save(refreshToken, cloudUrl, email)
                SessionStore.accessToken = accessToken
                // 唤醒前台服务，准备后续 connect
                ContextCompat.startForegroundService(
                    context,
                    Intent(context, RemoteTunnelService::class.java)
                        .setAction(RemoteTunnelService.ACTION_START),
                )
                call.resolve()
            } catch (e: Exception) {
                call.reject("令牌保存失败: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun hasSession(call: PluginCall) {
        val signedIn = store.cloudUrl() != null &&
            (SessionStore.accessToken != null || store.refreshToken() != null)
        val data = JSObject().put("signedIn", signedIn)
        // email/cloudUrl 为 null 时不要 put，避免 JSObject 序列化出 "null" 字符串
        store.email()?.let { data.put("email", it) }
        store.cloudUrl()?.let { data.put("cloudUrl", it) }
        call.resolve(data)
    }

    @PluginMethod
    fun signOut(call: PluginCall) {
        executor.execute {
            try {
                store.clear()
                SessionStore.accessToken = null
                RemoteTunnelService.setState(RemoteTunnelService.STATE_IDLE, null)
                context.startService(
                    Intent(context, RemoteTunnelService::class.java)
                        .setAction(RemoteTunnelService.ACTION_STOP),
                )
                call.resolve()
            } catch (e: Exception) {
                call.reject("退出登录失败: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun listDevices(call: PluginCall) {
        executor.execute {
            try {
                val items = CloudApi(context, CloudHttp.client).listDevices()
                val array = JSArray()
                for (device in items) {
                    array.put(JSObject(device.toJson()))
                }
                call.resolve(JSObject().put("items", array))
            } catch (e: AuthExpiredException) {
                call.reject(e.message ?: "登录已过期，请重新登录", "auth_expired")
            } catch (e: Exception) {
                call.reject("获取设备列表失败: ${e.message}", "network_error")
            }
        }
    }

    @PluginMethod
    fun connect(call: PluginCall) {
        val installationId = call.getString("installationId")
        if (installationId.isNullOrEmpty()) {
            call.reject("installationId 必填")
            return
        }
        executor.execute {
            try {
                ContextCompat.startForegroundService(
                    context,
                    Intent(context, RemoteTunnelService::class.java)
                        .setAction(RemoteTunnelService.ACTION_CONNECT)
                        .putExtra(RemoteTunnelService.EXTRA_INSTALLATION_ID, installationId),
                )
                call.resolve()
            } catch (e: Exception) {
                call.reject("启动远程服务失败: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun disconnect(call: PluginCall) {
        executor.execute {
            try {
                context.startService(
                    Intent(context, RemoteTunnelService::class.java)
                        .setAction(RemoteTunnelService.ACTION_DISCONNECT),
                )
                call.resolve()
            } catch (e: Exception) {
                call.reject("停止远程服务失败: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun retry(call: PluginCall) {
        executor.execute {
            try {
                context.startService(
                    Intent(context, RemoteTunnelService::class.java)
                        .setAction(RemoteTunnelService.ACTION_RETRY),
                )
                call.resolve()
            } catch (e: Exception) {
                call.reject("重试远程服务失败: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun getState(call: PluginCall) {
        val data = JSObject().put("state", RemoteTunnelService.currentState)
        RemoteTunnelService.currentError?.let { data.put("error", it) }
        call.resolve(data)
    }

    private fun Device.toJson(): String {
        val services = JSArray()
        for (s in this.services) {
            services.put(JSObject(s.toString()))
        }
        return JSObject()
            .put("installationId", installationId)
            .put("name", name)
            .put("online", online)
            .put("services", services)
            .toString()
    }
}
