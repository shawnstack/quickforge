package com.quickforge.mobile.remote

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import com.quickforge.mobile.MainActivity
import org.webrtc.DataChannel
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.RtpTransceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.ByteBuffer
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import kotlin.random.Random

/**
 * 远程隧道前台服务：信令 WS（okhttp）+ WebRTC DataChannel（webrtc-sdk）+
 * 本地 TCP server（127.0.0.1:18080）。参考 QuickForgeNotificationService 模式，
 * 通过 action 型 Intent 接收插件命令，状态变化经 [listener] 上报（插件转发给 JS）。
 *
 * 生命周期：插件 setToken/connect 时以前台服务启动；disconnect 拆除隧道但服务常驻；
 * signOut 发 ACTION_STOP 彻底停止。
 */
class RemoteTunnelService : Service() {

    companion object {
        private const val TAG = "RemoteTunnel"
        private const val CHANNEL_REMOTE = "quickforge_remote"
        private const val NOTIFICATION_ID_REMOTE = 2001
        private const val LOCAL_PORT = 18080
        private const val LOCAL_HOST = "127.0.0.1"
        private const val DC_NAME = "qf-tunnel"
        private const val WS_PING_INTERVAL_MS = 10_000L
        private const val CHUNK_SIZE = 16 * 1024
        private const val WS_CONNECT_TIMEOUT_S = 15L
        /** 背压等待超时（毫秒）：防止丢失唤醒导致 socket 读线程长时间空等。 */
        private const val BACKPRESSURE_POLL_MS = 50L
        /** 待发送帧 Java executor 队列字节预算（4MB，按字节计 permit，Int 可容纳）。 */
        private const val SEND_QUEUE_MAX_BYTES = 4 * 1024 * 1024
        /** 指数退避重连：单次延迟上限（秒）。 */
        private const val RECONNECT_MAX_DELAY_S = 30L
        /** 指数退避重连：附加随机抖动上限（毫秒）。 */
        private const val RECONNECT_JITTER_MS = 500L
        /** ICE DISCONNECTED 后等待瞬时自愈，再发起 restart offer。 */
        private const val ICE_RESTART_DELAY_MS = 2_000L
        /** ICE restart 等待恢复的总超时。 */
        private const val ICE_RESTART_TIMEOUT_MS = 10_000L
        /** 默认网络切换事件去抖，避免系统连续回调触发多次协商。 */
        private const val NETWORK_CHANGE_DEBOUNCE_MS = 800L
        /** 信令短断保留数据面的最长恢复时间（需小于 agent ICE 断线宽限）。 */
        private const val SIGNAL_RESUME_TIMEOUT_MS = 12_000L
        /** 持久化目标设备与自动重连标志（服务被系统重建后用于恢复）。 */
        private const val PREF_NAME = "qf_remote"
        private const val PREF_TARGET = "targetInstallation"
        private const val PREF_RECONNECT = "reconnectEnabled"

        const val ACTION_START = "com.quickforge.mobile.REMOTE_TUNNEL_START"
        const val ACTION_CONNECT = "com.quickforge.mobile.REMOTE_TUNNEL_CONNECT"
        const val ACTION_DISCONNECT = "com.quickforge.mobile.REMOTE_TUNNEL_DISCONNECT"
        const val ACTION_STOP = "com.quickforge.mobile.REMOTE_TUNNEL_STOP"
        const val ACTION_RETRY = "com.quickforge.mobile.REMOTE_TUNNEL_RETRY"
        const val EXTRA_INSTALLATION_ID = "installationId"

        const val STATE_IDLE = "idle"
        const val STATE_CONNECTING = "connecting"
        const val STATE_CONNECTED = "connected"
        const val STATE_ERROR = "error"
        const val STATE_RECONNECTING = "reconnecting"

        @Volatile
        var currentState: String = STATE_IDLE
        @Volatile
        var currentError: String? = null
        @Volatile
        var listener: ((state: String, error: String?) -> Unit)? = null

        /** 状态迁移的唯一入口：更新静态快照并通知插件（可跨线程调用）。 */
        fun setState(state: String, error: String? = null) {
            currentState = state
            currentError = error
            val callback = listener ?: return
            try {
                Handler(Looper.getMainLooper()).post { callback(state, error) }
            } catch (_: Exception) {
                // listener callback must not break the tunnel state machine
            }
        }
    }

    // 控制面串行化：connect/disconnect/信令回调全部投递到该线程。
    private val control = Executors.newSingleThreadExecutor { r -> Thread(r, "qf-tunnel-control") }
    // DataChannel 发送串行化：多路流复用单通道，帧必须整帧原子发送。
    private val dcWriter = Executors.newSingleThreadExecutor { r -> Thread(r, "qf-tunnel-dc-writer") }
    private val socketPool = Executors.newCachedThreadPool { r -> Thread(r, "qf-tunnel-socket") }
    private val pingScheduler = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "qf-tunnel-ping") }

    private val engineLock = Any()

    /** socket 读线程等待 DataChannel 缓冲排空的同步点（与 teardown/唤醒互斥）。 */
    private val backpressureLock: java.lang.Object = java.lang.Object()
    /** socket→DataChannel 背压水位门（共享，见 [awaitDrainForBackpressure]）。 */
    private val backpressure = BackpressureGate()
    /** 发送帧队列字节预算信号量：按字节计 permit，保证 dcWriter 队列待发字节有界。 */
    private val sendQueueBudget = Semaphore(SEND_QUEUE_MAX_BYTES)

    private lateinit var store: CloudAccountStore
    private lateinit var cloudApi: CloudApi

    private var signal: SignalClient? = null
    private var peerConnection: PeerConnection? = null
    /** @Volatile：背压等待循环在 engineLock 外读取，需跨线程可见 teardown 置空。 */
    @Volatile
    private var dataChannel: DataChannel? = null
    private var serverSocket: ServerSocket? = null
    private var acceptThread: Thread? = null
    private var pingTask: ScheduledFuture<*>? = null
    /** 指数退避重连定时任务（control 线程 / engineLock 保护）。 */
    private var reconnectTask: ScheduledFuture<*>? = null
    /** ICE restart 延迟/超时任务（control 线程 / engineLock 保护）。 */
    private var iceRestartDelayTask: ScheduledFuture<*>? = null
    private var iceRestartTimeoutTask: ScheduledFuture<*>? = null
    private var networkRestartTask: ScheduledFuture<*>? = null
    private var restartInProgress = false
    private var signalReconnectTask: ScheduledFuture<*>? = null
    private var signalResumeTimeoutTask: ScheduledFuture<*>? = null
    private var signalReconnectAttempt = 0
    private var signalResumeReason = "信令连接中断"
    private var lastDefaultNetwork: Network? = null
    /** 重连退避计数（1,2,4,8,16,30,30...），仅在 control 线程读写。 */
    private var reconnectAttempt = 0
    /** 是否允许自动重连；用户主动断开 / 退出登录时置 false。 */
    @Volatile
    private var reconnectEnabled = false
    /** 最近一次收到信令 pong 的时间戳（毫秒），用于心跳超时判定。 */
    @Volatile
    private var lastPongAt = 0L
    private lateinit var prefs: SharedPreferences
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var sessionId: String? = null
    private var targetInstallation: String? = null
    private val connectionGenerations = AtomicLong(0)
    @Volatile
    private var currentGeneration = 0L

    // streamID -> 本地 TCP socket（engineLock 保护）
    private val streams = HashMap<Int, Socket>()
    private val streamIds = AtomicInteger(0)
    private val frameDecoder = FrameDecoder()
    private val sendLock = Any()

    private var foregroundStarted = false

    private val peerConnectionFactory: PeerConnectionFactory by lazy {
        Log.i(TAG, "PeerConnectionFactory initialization started")
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(applicationContext)
                .setEnableInternalTracer(false)
                .createInitializationOptions()
        )
        PeerConnectionFactory.builder().createPeerConnectionFactory().also {
            Log.i(TAG, "PeerConnectionFactory initialization completed")
        }
    }

    override fun onCreate() {
        super.onCreate()
        store = CloudAccountStore(this)
        cloudApi = CloudApi(this, CloudHttp.client)
        prefs = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        createChannel()
        registerNetworkCallback()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                startForegroundCompat()
            }
            ACTION_CONNECT -> {
                startForegroundCompat()
                val installationId = intent.getStringExtra(EXTRA_INSTALLATION_ID)
                if (installationId.isNullOrEmpty()) {
                    fail("缺少目标设备 ID")
                } else {
                    control.execute { doConnect(installationId) }
                }
            }
            ACTION_DISCONNECT -> {
                control.execute {
                    reconnectEnabled = false
                    cancelReconnectTask()
                    reconnectAttempt = 0
                    clearPersistedTarget()
                    teardownTunnel("", STATE_IDLE, autoReconnect = false)
                }
            }
            ACTION_STOP -> {
                control.execute {
                    reconnectEnabled = false
                    cancelReconnectTask()
                    reconnectAttempt = 0
                    clearPersistedTarget()
                    teardownTunnel("", STATE_IDLE, autoReconnect = false)
                    stopForegroundCompat()
                    stopSelf()
                }
            }
            ACTION_RETRY -> {
                startForegroundCompat()
                control.execute {
                    cancelReconnectTask()
                    reconnectAttempt = 0
                    val target = targetInstallation
                    if (target != null) {
                        doConnect(target)
                    } else {
                        setState(STATE_IDLE, "未连接任何设备")
                    }
                }
            }
            else -> {
                // START_STICKY 重启（intent 为 null）：保持前台存活，等待插件指令；
                // 若此前隧道处于自动重连状态，恢复目标设备继续重连
                startForegroundCompat()
                if (intent == null) {
                    val savedTarget = prefs.getString(PREF_TARGET, null)
                    if (!savedTarget.isNullOrEmpty() && prefs.getBoolean(PREF_RECONNECT, false)) {
                        control.execute { doConnect(savedTarget) }
                    }
                }
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        networkCallback?.let { cb ->
            try {
                (getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager)
                    ?.unregisterNetworkCallback(cb)
            } catch (_: Exception) {
                // 注销失败不影响销毁流程
            }
        }
        networkCallback = null
        pingTask?.cancel(true)
        teardownTunnel("", STATE_IDLE, autoReconnect = false)
        control.shutdownNow()
        dcWriter.shutdownNow()
        socketPool.shutdownNow()
        pingScheduler.shutdownNow()
        stopForegroundCompat()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ---------------------------------------------------------------- connect

    private fun doConnect(installationId: String) {
        reconnectEnabled = true
        if (currentState == STATE_CONNECTING || currentState == STATE_CONNECTED) {
            teardownTunnel("", STATE_IDLE, autoReconnect = false)
        }
        val generation = connectionGenerations.incrementAndGet()
        currentGeneration = generation
        val cloudUrl = store.cloudUrl()
        if (cloudUrl == null) {
            fail("未登录，请先登录", generation)
            return
        }
        Log.i(TAG, "connection started")
        setState(STATE_CONNECTING)
        targetInstallation = installationId
        persistTarget(installationId)
        sessionId = UUID.randomUUID().toString()
        connectSession(installationId, retried = false, generation)
    }

    /** 建立信令 WS -> hello -> PeerConnection/DataChannel -> offer。 */
    private fun connectSession(installationId: String, retried: Boolean, generation: Long) {
        if (!isCurrentGeneration(generation)) return
        val cloudUrl = store.cloudUrl() ?: run {
            fail("未登录，请先登录", generation)
            return
        }
        val access = try {
            cloudApi.ensureAccessToken()
        } catch (e: Exception) {
            fail("获取令牌失败: ${e.message}", generation)
            return
        }
        if (!isCurrentGeneration(generation)) return
        if (access == null) {
            fail("登录已过期，请重新登录", generation, autoReconnect = false)
            return
        }
        Log.i(TAG, "access token ready")

        val credentials = try {
            cloudApi.turnCredentials()
        } catch (e: AuthExpiredException) {
            fail(e.message ?: "登录已过期，请重新登录", generation, autoReconnect = false)
            return
        } catch (e: Exception) {
            fail("获取中继凭证失败: ${e.message}", generation)
            return
        }
        if (!isCurrentGeneration(generation)) return
        Log.i(TAG, "TURN ready")

        val sid = sessionId
        if (sid == null) {
            fail("会话异常，请重试", generation)
            return
        }

        val opened = CountDownLatch(1)
        var openError: String? = null
        var openOk = false

        lateinit var client: SignalClient
        client = SignalClient(
            CloudHttp.client,
            SignalClient.wsUrl(cloudUrl),
            { SessionStore.accessToken },
            object : SignalClient.Listener {
                override fun onOpen() {
                    if (!isCurrentGeneration(generation)) return
                    Log.i(TAG, "signal opened")
                    openOk = true
                    lastPongAt = System.currentTimeMillis()
                    opened.countDown()
                    signal?.send(SignalMessage(type = "hello"))
                    startPing(generation)
                }

                override fun onMessage(message: SignalMessage) {
                    if (isCurrentGeneration(generation)) handleSignal(message, generation)
                }

                override fun onClosed(code: Int, reason: String?) {
                    if (!isCurrentGeneration(generation)) {
                        opened.countDown()
                        return
                    }
                    control.execute {
                        if (!isCurrentGeneration(generation) || signal !== client) return@execute
                        if (openOk) {
                            handleSignalLoss(reason ?: "信号连接已关闭", generation)
                        } else {
                            opened.countDown()
                        }
                    }
                }

                override fun onFailure(error: String) {
                    if (!isCurrentGeneration(generation)) {
                        opened.countDown()
                        return
                    }
                    control.execute {
                        if (!isCurrentGeneration(generation) || signal !== client) return@execute
                        if (!openOk) {
                            openError = error
                            opened.countDown()
                        } else {
                            handleSignalLoss(error, generation)
                        }
                    }
                }
            }
        )
        signal = client
        client.connect()

        val openedOk: Boolean = try {
            opened.await(WS_CONNECT_TIMEOUT_S, TimeUnit.SECONDS)
        } catch (e: InterruptedException) {
            // 控制线程被中断（如服务销毁/快速重连）：恢复中断标志避免吞掉中断，
            // 仅在代际仍有效时干净收尾（fail 触发 teardown 关闭信令连接），
            // 防止控制线程意外死亡导致连接泄漏或误伤新一代连接。
            Thread.currentThread().interrupt()
            if (isCurrentGeneration(generation)) {
                fail("信令连接被中断", generation)
            }
            return
        }
        if (!openedOk) {
            fail("信令连接超时", generation)
            return
        }
        if (!isCurrentGeneration(generation)) {
            client.close()
            return
        }
        val err = openError
        if (err != null) {
            if (err == "http_401" && !retried) {
                val fresh = cloudApi.refreshAccessToken()
                if (!isCurrentGeneration(generation)) return
                if (fresh == null) {
                    fail("登录已过期，请重新登录", generation, autoReconnect = false)
                    return
                }
                connectSession(installationId, retried = true, generation)
                return
            }
            fail("信令连接失败: $err", generation)
            return
        }
        createPeerConnection(credentials, sid, installationId, generation)
    }

    // ----------------------------------------------------------- WebRTC

    private fun createPeerConnection(
        credentials: TurnCredentials,
        sid: String,
        installationId: String,
        generation: Long,
    ) {
        if (!isCurrentGeneration(generation)) return
        val iceServers = credentials.urls.mapNotNull { url ->
            when {
                url.startsWith("turn:") -> PeerConnection.IceServer.builder(url)
                    .setUsername(credentials.username)
                    .setPassword(credentials.credential)
                    .createIceServer()
                url.startsWith("stun:") -> PeerConnection.IceServer.builder(url).createIceServer()
                else -> null
            }
        }
        // webrtc-sdk 137 起 RTCConfiguration 为 PeerConnection 的嵌套类
        val config = PeerConnection.RTCConfiguration(iceServers)

        val pc = try {
            peerConnectionFactory.createPeerConnection(
                config,
                object : PeerConnection.Observer {
                    override fun onIceCandidate(ice: IceCandidate?) {
                        if (!isCurrentGeneration(generation)) return
                        ice ?: return
                        signal?.send(
                            SignalMessage(
                                type = "candidate",
                                sessionId = sid,
                                candidate = SignalIceCandidate(
                                    candidate = ice.sdp,
                                    sdpMid = ice.sdpMid,
                                    sdpMLineIndex = if (ice.sdpMLineIndex >= 0) ice.sdpMLineIndex else null,
                                ),
                            )
                        )
                    }

                    override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
                        when (state) {
                            PeerConnection.IceConnectionState.FAILED ->
                                control.execute {
                                    if (isCurrentGeneration(generation)) {
                                        beginIceRestart("ICE 连接失败", generation)
                                    }
                                }
                            PeerConnection.IceConnectionState.DISCONNECTED -> {
                                if (!isCurrentGeneration(generation)) return
                                Log.d(TAG, "ICE disconnected, scheduling restart")
                                scheduleIceRestart("ICE 连接中断", generation)
                            }
                            PeerConnection.IceConnectionState.CONNECTED,
                            PeerConnection.IceConnectionState.COMPLETED ->
                                control.execute {
                                    if (isCurrentGeneration(generation)) {
                                        completeIceRestart()
                                    }
                                }
                            else -> {}
                        }
                    }

                    override fun onDataChannel(channel: DataChannel?) {
                        // 手机端主动创建通道，此处无远程通道
                    }

                    override fun onSignalingChange(state: PeerConnection.SignalingState?) {}
                    override fun onIceConnectionReceivingChange(receiving: Boolean) {}
                    override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) {}
                    override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) {}
                    override fun onAddStream(stream: MediaStream?) {}
                    override fun onRemoveStream(stream: MediaStream?) {}
                    override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) {}
                    override fun onRemoveTrack(receiver: RtpReceiver?) {}
                    override fun onTrack(transceiver: RtpTransceiver?) {}
                    override fun onRenegotiationNeeded() {}
                },
            )
        } catch (e: Exception) {
            Log.e(TAG, "createPeerConnection failed", e)
            fail("创建 PeerConnection 失败: ${e.message}", generation)
            return
        } catch (e: LinkageError) {
            Log.e(TAG, "WebRTC initialization failed", e)
            fail("WebRTC 初始化失败: ${e.message ?: e.javaClass.simpleName}", generation)
            return
        }
        if (!isCurrentGeneration(generation)) {
            pc?.close()
            return
        }
        if (pc == null) {
            fail("创建 PeerConnection 失败", generation)
            return
        }
        Log.i(TAG, "PeerConnection created")
        peerConnection = pc

        val dc = pc.createDataChannel(DC_NAME, DataChannel.Init())
        if (dc == null) {
            fail("创建数据通道失败", generation)
            return
        }
        Log.i(TAG, "DataChannel created")
        dataChannel = dc
        dc.registerObserver(object : DataChannel.Observer {
            override fun onBufferedAmountChange(previousAmount: Long) {
                // 缓冲量变化（通常为下降）：唤醒可能因背压暂停的 socket 读线程重新评估水位
                synchronized(backpressureLock) { backpressureLock.notifyAll() }
            }

            override fun onStateChange() {
                if (!isCurrentGeneration(generation)) return
                when (dc.state()) {
                    DataChannel.State.OPEN -> {
                        if (startTcpServer(generation) && isCurrentGeneration(generation)) {
                            // 连接成功，重置退避计数，下次断线从头退避
                            synchronized(engineLock) { reconnectAttempt = 0 }
                            setState(STATE_CONNECTED)
                        }
                    }
                    DataChannel.State.CLOSED -> {
                        control.execute {
                            if (isCurrentGeneration(generation)) {
                                teardownTunnel("数据通道已关闭", STATE_IDLE, autoReconnect = true)
                            }
                        }
                    }
                    else -> {}
                }
            }

            override fun onMessage(buffer: DataChannel.Buffer) {
                if (!isCurrentGeneration(generation)) return
                if (buffer.data.hasRemaining()) {
                    val bytes = ByteArray(buffer.data.remaining())
                    buffer.data.get(bytes)
                    handleChannelBytes(bytes)
                }
            }
        })

        createAndSendOffer(pc, sid, installationId, generation, isRestart = false)
    }

    private fun createAndSendOffer(
        pc: PeerConnection,
        sid: String,
        installationId: String,
        generation: Long,
        isRestart: Boolean,
    ) {
        if (!isCurrentGeneration(generation)) return
        if (isRestart) {
            try {
                pc.restartIce()
            } catch (e: Exception) {
                fallbackFullReconnect("ICE restart 启动失败: ${e.message}", generation)
                return
            }
        }
        pc.createOffer(
            object : SdpObserver {
                override fun onCreateSuccess(sdp: SessionDescription?) {
                    if (!isCurrentGeneration(generation)) return
                    val localSdp = sdp ?: return
                    pc.setLocalDescription(
                        object : SdpObserver {
                            override fun onCreateSuccess(sdp: SessionDescription?) {}
                            override fun onCreateFailure(error: String?) {}
                            override fun onSetSuccess() {
                                if (!isCurrentGeneration(generation)) return
                                signal?.send(
                                    SignalMessage(
                                        type = "offer",
                                        sessionId = sid,
                                        installationId = installationId,
                                        sdp = localSdp.description,
                                    )
                                )
                            }
                            override fun onSetFailure(error: String?) {
                                if (isRestart) {
                                    control.execute { fallbackFullReconnect("设置 ICE restart SDP 失败: $error", generation) }
                                } else {
                                    fail("设置本地 SDP 失败: $error", generation)
                                }
                            }
                        },
                        localSdp,
                    )
                }

                override fun onCreateFailure(error: String?) {
                    if (isRestart) {
                        control.execute { fallbackFullReconnect("创建 ICE restart offer 失败: $error", generation) }
                    } else {
                        fail("创建 offer 失败: $error", generation)
                    }
                }

                override fun onSetSuccess() {}
                override fun onSetFailure(error: String?) {}
            },
            MediaConstraints(),
        )
    }

    private fun scheduleIceRestart(reason: String, generation: Long) {
        synchronized(engineLock) {
            iceRestartDelayTask?.cancel(false)
            iceRestartDelayTask = pingScheduler.schedule(
                { control.execute { beginIceRestart(reason, generation) } },
                ICE_RESTART_DELAY_MS,
                TimeUnit.MILLISECONDS,
            )
        }
    }

    private fun beginIceRestart(reason: String, generation: Long) {
        if (!isCurrentGeneration(generation) || restartInProgress) return
        val pc = peerConnection
        val sid = sessionId
        val installationId = targetInstallation
        if (currentState != STATE_CONNECTED || pc == null || sid == null || installationId == null) {
            fallbackFullReconnect(reason, generation)
            return
        }
        // 信令正在短断重挂时先保留 PeerConnection/DataChannel；新 WS onOpen 后会再次
        // 调用 beginIceRestart。最终失败由 signalResumeTimeoutTask 统一回退全量重连。
        if (signal == null) {
            if (signalResumeTimeoutTask != null) return
            fallbackFullReconnect(reason, generation)
            return
        }
        val pendingLocalOffer = if (pc.signalingState() == PeerConnection.SignalingState.HAVE_LOCAL_OFFER) {
            pc.localDescription
        } else {
            null
        }
        restartInProgress = true
        synchronized(engineLock) {
            iceRestartDelayTask?.cancel(false)
            iceRestartDelayTask = null
            iceRestartTimeoutTask?.cancel(false)
            iceRestartTimeoutTask = pingScheduler.schedule(
                { control.execute { fallbackFullReconnect("$reason，ICE restart 超时", generation) } },
                ICE_RESTART_TIMEOUT_MS,
                TimeUnit.MILLISECONDS,
            )
        }
        if (pendingLocalOffer != null) {
            Log.i(TAG, "resending pending ICE restart offer: $reason")
            signal?.send(
                SignalMessage(
                    type = "offer",
                    sessionId = sid,
                    installationId = installationId,
                    sdp = pendingLocalOffer.description,
                )
            )
        } else {
            Log.i(TAG, "starting ICE restart: $reason")
            createAndSendOffer(pc, sid, installationId, generation, isRestart = true)
        }
    }

    private fun completeIceRestart() {
        synchronized(engineLock) {
            iceRestartDelayTask?.cancel(false)
            iceRestartDelayTask = null
            iceRestartTimeoutTask?.cancel(false)
            iceRestartTimeoutTask = null
        }
        if (restartInProgress) Log.i(TAG, "ICE restart completed")
        restartInProgress = false
    }

    private fun fallbackFullReconnect(reason: String, generation: Long) {
        if (!isCurrentGeneration(generation)) return
        Log.w(TAG, "ICE restart fallback: $reason")
        teardownTunnel(reason, STATE_IDLE, autoReconnect = true)
    }

    private fun handleSignal(message: SignalMessage, generation: Long) {
        if (!isCurrentGeneration(generation)) return
        if (message.sessionId != null && message.sessionId != sessionId) return
        when (message.type) {
            "answer" -> {
                val sdp = message.sdp ?: return
                val pc = peerConnection ?: return
                pc.setRemoteDescription(
                    object : SdpObserver {
                        override fun onCreateSuccess(sdp: SessionDescription?) {}
                        override fun onCreateFailure(error: String?) {}
                        override fun onSetSuccess() {}
                        override fun onSetFailure(error: String?) {
                            fail("设置远端 SDP 失败: $error", generation)
                        }
                    },
                    SessionDescription(SessionDescription.Type.ANSWER, sdp),
                )
            }
            "candidate" -> {
                val c = message.candidate ?: return
                peerConnection?.addIceCandidate(
                    IceCandidate(c.sdpMid ?: "", c.sdpMLineIndex ?: 0, c.candidate)
                )
            }
            "ping" -> {
                signal?.send(SignalMessage(type = "pong"))
            }
            "pong" -> {
                // 应用层心跳应答：更新最近应答时间，供 startPing 判定心跳超时
                lastPongAt = System.currentTimeMillis()
            }
            "close" -> {
                control.execute {
                    if (isCurrentGeneration(generation)) {
                        teardownTunnel(message.reason ?: "对端已关闭", STATE_IDLE, autoReconnect = true)
                    }
                }
            }
            else -> {
                Log.w(TAG, "unknown signal message: ${message.type}")
            }
        }
    }

    // ------------------------------------------------------------ TCP bridge

    private fun startTcpServer(generation: Long): Boolean {
        if (!isCurrentGeneration(generation)) return false
        synchronized(engineLock) {
            if (serverSocket != null) return true
            try {
                serverSocket = ServerSocket(
                    LOCAL_PORT,
                    64,
                    InetAddress.getByName(LOCAL_HOST),
                )
            } catch (e: IOException) {
                fail("本地端口 $LOCAL_PORT 启动失败: ${e.message}", generation)
                return false
            }
        }
        val thread = Thread { acceptLoop() }
        thread.name = "qf-tunnel-accept"
        thread.isDaemon = true
        acceptThread = thread
        try {
            thread.start()
        } catch (e: Exception) {
            synchronized(engineLock) {
                acceptThread = null
                serverSocket?.close()
                serverSocket = null
            }
            fail("本地端口 $LOCAL_PORT 启动失败: ${e.message}", generation)
            return false
        }
        Log.i(TAG, "local port ready: $LOCAL_HOST:$LOCAL_PORT")
        return true
    }

    private fun acceptLoop() {
        while (true) {
            val ss = synchronized(engineLock) { serverSocket } ?: return
            val socket = try {
                ss.accept()
            } catch (_: Exception) {
                return
            }
            val streamId = allocateStreamId()
            if (streamId == null) {
                try {
                    socket.close()
                } catch (_: IOException) {
                }
                return
            }
            synchronized(engineLock) { streams[streamId] = socket }
            sendToChannel(TunnelFrames.encodeOpen(streamId, TunnelFrames.SERVICE_QF_WEB))
            socketPool.execute { socketToChannelLoop(socket, streamId) }
        }
    }

    private fun socketToChannelLoop(socket: Socket, streamId: Int) {
        try {
            val input = socket.getInputStream()
            val buffer = ByteArray(CHUNK_SIZE)
            while (true) {
                // 应用层背压：DataChannel 缓冲超水位时暂停读取，等待排空后再投递；
                // 等待期间通道关闭/置空或线程中断返回 false，立即退出读取循环
                if (!awaitDrainForBackpressure()) break
                val n = input.read(buffer)
                if (n < 0) break
                sendToChannel(TunnelFrames.encodeData(streamId, buffer.copyOf(n)))
            }
            sendToChannel(TunnelFrames.encodeControl(TunnelFrames.TYPE_CLOSE, streamId))
        } catch (_: Exception) {
            // 尽力通知对端；随后统一关闭
        } finally {
            closeStream(streamId)
        }
    }

    /**
     * 依据 [BackpressureGate] 高/低水位暂停当前 socket 读线程：超过高水位时
     * 等待直到降至低水位（迟滞）。返回 true 表示缓冲可继续投递；
     * 返回 false 表示线程被中断或 [dataChannel] 已置空 / 未 OPEN，调用方应退出循环。
     * teardown 会置空 [dataChannel] 并 notifyAll，等待线程据此尽快退出，
     * 随后 socket 已被关闭，read 抛异常结束循环——不会无限空等。
     */
    private fun awaitDrainForBackpressure(): Boolean {
        while (true) {
            if (Thread.currentThread().isInterrupted) return false
            val dc = dataChannel
            if (dc == null || dc.state() != DataChannel.State.OPEN) return false
            synchronized(backpressureLock) {
                backpressure.update(dc.bufferedAmount())
                if (!backpressure.paused) return true
                try {
                    // 超时兜底 + onBufferedAmountChange/teardown 的 notifyAll 唤醒
                    backpressureLock.wait(BACKPRESSURE_POLL_MS)
                } catch (e: InterruptedException) {
                    Thread.currentThread().interrupt()
                    return false
                }
            }
        }
    }

    /**
     * 帧 -> socket 路由（DataChannel 消息串行到达；与 teardown 互斥）。
     * 锁内仅解析帧并取出 socket 引用，socket write/flush 移到锁外执行：
     * 本地 TCP 对端不读数据时 write 可能长时间阻塞，若持 engineLock 会阻断
     * teardownTunnel 等全部需要该锁的路径；锁外写失败后安全 closeStream。
     */
    private fun handleChannelBytes(bytes: ByteArray) {
        data class Pending(val streamId: Int, val socket: Socket?, val payload: ByteArray?)
        val pending = ArrayList<Pending>()
        synchronized(engineLock) {
            val frames = frameDecoder.push(bytes)
            for (frame in frames) {
                when (frame.type) {
                    TunnelFrames.TYPE_DATA -> {
                        val socket = streams[frame.streamId] ?: continue
                        pending.add(Pending(frame.streamId, socket, frame.payload))
                    }
                    TunnelFrames.TYPE_CLOSE, TunnelFrames.TYPE_ERROR ->
                        pending.add(Pending(frame.streamId, null, null))
                    TunnelFrames.TYPE_OPEN -> {
                        // agent 不会主动 OPEN，忽略
                    }
                    else -> {}
                }
            }
        }
        for (p in pending) {
            val socket = p.socket
            if (socket != null) {
                try {
                    val out = socket.getOutputStream()
                    out.write(p.payload!!)
                    out.flush()
                } catch (_: Exception) {
                    closeStream(p.streamId)
                }
            } else {
                closeStream(p.streamId)
            }
        }
    }

    /**
     * 整帧原子入队发送（多路流复用单 DataChannel 的串行化点）。
     * 提交前先按帧字节数从 [sendQueueBudget] 循环获取 permit（50ms 轮询），使
     * Java executor 队列的待发字节真正有界；期间每轮核对当前 [dataChannel] 仍是
     * 捕获的 dc 且 OPEN、线程未被中断，否则放弃投递直接 return。
     * 任务执行后（无论成败）都会 release 对应 permit。
     * 注意：native bufferedAmount 仅用于 [awaitDrainForBackpressure] 的水位判断，
     * 并不单独限制发送队列，队列有界性由本预算信号量保证。
     */
    private fun sendToChannel(frame: ByteArray) {
        val dc = dataChannel ?: return
        val size = frame.size
        while (true) {
            if (Thread.currentThread().isInterrupted) return
            // 每轮核对通道仍是捕获的实例且处于 OPEN：teardown/关闭后立即放弃
            if (dataChannel !== dc || dc.state() != DataChannel.State.OPEN) return
            val acquired = try {
                sendQueueBudget.tryAcquire(size, BACKPRESSURE_POLL_MS, TimeUnit.MILLISECONDS)
            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
                return
            }
            if (acquired) break
        }
        try {
            dcWriter.execute {
                try {
                    synchronized(sendLock) {
                        if (dc.state() == DataChannel.State.OPEN) {
                            dc.send(DataChannel.Buffer(ByteBuffer.wrap(frame), true))
                        }
                    }
                } catch (_: Exception) {
                    // send race after close: ignore
                } finally {
                    sendQueueBudget.release(size)
                }
            }
        } catch (e: RejectedExecutionException) {
            // executor 已关闭（如服务销毁）：归还预算，避免泄漏
            sendQueueBudget.release(size)
        } catch (e: RuntimeException) {
            // execute 阶段其它运行时异常同样归还预算
            sendQueueBudget.release(size)
        }
    }

    private fun closeStream(streamId: Int) {
        val socket = synchronized(engineLock) { streams.remove(streamId) } ?: return
        try {
            socket.close()
        } catch (_: Exception) {
        }
    }

    private fun allocateStreamId(): Int? {
        synchronized(engineLock) {
            repeat(0xFFFF) {
                val id = streamIds.incrementAndGet() and 0xFFFF
                if (id != 0 && !streams.containsKey(id)) return id
            }
            return null
        }
    }

    private fun handleSignalLoss(reason: String, generation: Long) {
        if (!isCurrentGeneration(generation)) return
        val dc = dataChannel
        if (currentState != STATE_CONNECTED || dc == null || dc.state() != DataChannel.State.OPEN) {
            teardownTunnel(reason, STATE_IDLE, autoReconnect = true)
            return
        }
        signalResumeReason = reason
        synchronized(engineLock) {
            iceRestartDelayTask?.cancel(false)
            iceRestartDelayTask = null
            iceRestartTimeoutTask?.cancel(false)
            iceRestartTimeoutTask = null
            restartInProgress = false
        }
        pingTask?.cancel(true)
        pingTask = null
        signal?.close()
        signal = null
        if (signalResumeTimeoutTask == null) {
            signalResumeTimeoutTask = pingScheduler.schedule(
                { control.execute { fallbackFullReconnect("$signalResumeReason，信令恢复超时", generation) } },
                SIGNAL_RESUME_TIMEOUT_MS,
                TimeUnit.MILLISECONDS,
            )
        }
        scheduleSignalReconnect(generation, immediate = signalReconnectAttempt == 0)
    }

    private fun scheduleSignalReconnect(generation: Long, immediate: Boolean = false) {
        if (!isCurrentGeneration(generation) || signalReconnectTask != null) return
        val attempt = signalReconnectAttempt++
        val delayMs = signalReconnectDelayMs(attempt, immediate)
        signalReconnectTask = pingScheduler.schedule(
            { control.execute { reconnectSignal(generation) } },
            delayMs,
            TimeUnit.MILLISECONDS,
        )
    }

    private fun reconnectSignal(generation: Long) {
        signalReconnectTask = null
        if (!isCurrentGeneration(generation) || signal != null) return
        val cloudUrl = store.cloudUrl() ?: run {
            fallbackFullReconnect("信令恢复失败：未登录", generation)
            return
        }
        lateinit var client: SignalClient
        client = SignalClient(
            CloudHttp.client,
            SignalClient.wsUrl(cloudUrl),
            { SessionStore.accessToken },
            object : SignalClient.Listener {
                override fun onOpen() {
                    control.execute {
                        if (!isCurrentGeneration(generation) || signal !== client) return@execute
                        lastPongAt = System.currentTimeMillis()
                        signalReconnectAttempt = 0
                        signalReconnectTask?.cancel(false)
                        signalReconnectTask = null
                        signalResumeTimeoutTask?.cancel(false)
                        signalResumeTimeoutTask = null
                        client.send(SignalMessage(type = "hello"))
                        startPing(generation)
                        beginIceRestart("信令连接已恢复", generation)
                    }
                }

                override fun onMessage(message: SignalMessage) {
                    if (isCurrentGeneration(generation)) handleSignal(message, generation)
                }

                override fun onClosed(code: Int, reason: String?) {
                    control.execute {
                        if (isCurrentGeneration(generation) && signal === client) {
                            signal = null
                            scheduleSignalReconnect(generation)
                        }
                    }
                }

                override fun onFailure(error: String) {
                    control.execute {
                        if (isCurrentGeneration(generation) && signal === client) {
                            signal = null
                            scheduleSignalReconnect(generation)
                        }
                    }
                }
            },
        )
        signal = client
        client.connect()
    }

    // ------------------------------------------------------------ heartbeat

    private fun startPing(generation: Long) {
        pingTask?.cancel(true)
        pingTask = pingScheduler.scheduleAtFixedRate(
            {
                if (isCurrentGeneration(generation)) {
                    val now = System.currentTimeMillis()
                    if (now - lastPongAt > 2 * WS_PING_INTERVAL_MS) {
                        // 信令心跳超时：优先仅重挂 WebSocket，保留仍可用的数据面。
                        control.execute {
                            if (isCurrentGeneration(generation)) {
                                handleSignalLoss("心跳超时", generation)
                            }
                        }
                    } else {
                        signal?.send(SignalMessage(type = "ping"))
                    }
                }
            },
            WS_PING_INTERVAL_MS,
            WS_PING_INTERVAL_MS,
            TimeUnit.MILLISECONDS,
        )
    }

    // ------------------------------------------------------------ teardown

    private fun isCurrentGeneration(generation: Long): Boolean = generation == currentGeneration

    private fun fail(error: String, generation: Long? = null, autoReconnect: Boolean = true) {
        if (generation != null && !isCurrentGeneration(generation)) return
        Log.w(TAG, "tunnel error: $error")
        teardownTunnel(error, STATE_ERROR, autoReconnect)
    }

    /**
     * 拆除隧道全部资源（幂等）。[reason] 仅在新状态为 error 时上报。
     * [autoReconnect] 为 true 且允许重连（[reconnectEnabled] 且目标设备未清）时，
     * 保留目标设备、调度指数退避重连，并以 [STATE_RECONNECTING] 上报断线原因。
     */
    private fun teardownTunnel(reason: String, newState: String, autoReconnect: Boolean = false) {
        val closedSignal: SignalClient?
        val closedDataChannel: DataChannel?
        val closedPeerConnection: PeerConnection?
        var keepTarget = false
        currentGeneration = connectionGenerations.incrementAndGet()
        synchronized(engineLock) {
            pingTask?.cancel(true)
            pingTask = null
            reconnectTask?.cancel(false)
            reconnectTask = null
            iceRestartDelayTask?.cancel(false)
            iceRestartDelayTask = null
            iceRestartTimeoutTask?.cancel(false)
            iceRestartTimeoutTask = null
            networkRestartTask?.cancel(false)
            networkRestartTask = null
            signalReconnectTask?.cancel(false)
            signalReconnectTask = null
            signalResumeTimeoutTask?.cancel(false)
            signalResumeTimeoutTask = null
            signalReconnectAttempt = 0
            restartInProgress = false
            lastPongAt = 0L

            acceptThread?.interrupt()
            acceptThread = null
            serverSocket?.close()
            serverSocket = null
            for (socket in streams.values) {
                try {
                    socket.close()
                } catch (_: IOException) {
                }
            }
            streams.clear()
            frameDecoder.reset()

            closedDataChannel = dataChannel
            dataChannel = null
            closedPeerConnection = peerConnection
            peerConnection = null

            closedSignal = signal
            signal = null

            sessionId = null
            keepTarget = autoReconnect && reconnectEnabled && targetInstallation != null
            if (!keepTarget) {
                targetInstallation = null
            }
            // 唤醒因背压暂停的 socket 读线程：通道/代际已变，令其尽快退出等待
            synchronized(backpressureLock) { backpressureLock.notifyAll() }
        }
        closedDataChannel?.close()
        closedPeerConnection?.close()
        closedSignal?.close()
        if (keepTarget) {
            scheduleReconnect()
            setState(STATE_RECONNECTING, reason)
        } else {
            setState(newState, if (newState == STATE_ERROR) reason else null)
        }
    }

    /** 取消待执行的退避重连任务（需在 control 线程或 engineLock 保护下调用）。 */
    private fun cancelReconnectTask() {
        synchronized(engineLock) {
            reconnectTask?.cancel(false)
            reconnectTask = null
        }
    }

    /** 调度指数退避重连：2^(n-1) 秒封顶 30 秒，附加 0~500ms 随机抖动。 */
    private fun scheduleReconnect() {
        synchronized(engineLock) {
            reconnectTask?.cancel(false)
            val attempt = reconnectAttempt + 1
            reconnectAttempt = attempt
            val delaySec = minOf(1L shl (attempt - 1).coerceAtMost(5), RECONNECT_MAX_DELAY_S)
            val delayMs = delaySec * 1000L + Random.nextLong(RECONNECT_JITTER_MS + 1)
            reconnectTask = pingScheduler.schedule(
                {
                    control.execute {
                        if (reconnectEnabled && targetInstallation != null) {
                            doConnect(targetInstallation!!)
                        }
                    }
                },
                delayMs,
                TimeUnit.MILLISECONDS,
            )
        }
    }

    /** 持久化目标设备与自动重连标志（服务被系统重建后用于恢复连接）。 */
    private fun persistTarget(installationId: String) {
        prefs.edit()
            .putString(PREF_TARGET, installationId)
            .putBoolean(PREF_RECONNECT, true)
            .apply()
    }

    private fun clearPersistedTarget() {
        prefs.edit().remove(PREF_TARGET).remove(PREF_RECONNECT).apply()
    }

    // ------------------------------------------------------------ network

    /** 默认网络回调：网络恢复时立即重连；已连接时默认网络变化触发去抖 ICE restart。 */
    private fun registerNetworkCallback() {
        val manager = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                control.execute {
                    val previous = lastDefaultNetwork
                    lastDefaultNetwork = network
                    if (previous == null) return@execute
                    if (currentState == STATE_CONNECTED && previous != network) {
                        synchronized(engineLock) {
                            networkRestartTask?.cancel(false)
                            val generation = currentGeneration
                            networkRestartTask = pingScheduler.schedule(
                                { control.execute { beginIceRestart("默认网络已切换", generation) } },
                                NETWORK_CHANGE_DEBOUNCE_MS,
                                TimeUnit.MILLISECONDS,
                            )
                        }
                        return@execute
                    }
                    if (reconnectEnabled && targetInstallation != null && currentState != STATE_CONNECTING && currentState != STATE_CONNECTED) {
                        Log.i(TAG, "network available, reconnecting immediately")
                        cancelReconnectTask()
                        reconnectAttempt = 0
                        doConnect(targetInstallation!!)
                    }
                }
            }
        }
        try {
            manager.registerDefaultNetworkCallback(callback)
            networkCallback = callback
        } catch (e: Exception) {
            Log.w(TAG, "register network callback failed", e)
        }
    }

    // ------------------------------------------------------------ foreground

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_REMOTE, "远程访问", NotificationManager.IMPORTANCE_LOW)
        )
    }

    private fun buildNotification(): Notification {
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_REMOTE)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        val launch = Intent(this, MainActivity::class.java)
        launch.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        val contentIntent = PendingIntent.getActivity(
            this,
            0,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return builder
            .setSmallIcon(android.R.drawable.stat_notify_more)
            .setContentTitle("QuickForge 远程访问")
            .setContentText("远程隧道运行中")
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .build()
    }

    private fun startForegroundCompat() {
        if (foregroundStarted) return
        foregroundStarted = true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID_REMOTE,
                buildNotification(),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
        } else {
            startForeground(NOTIFICATION_ID_REMOTE, buildNotification())
        }
    }

    private fun stopForegroundCompat() {
        if (!foregroundStarted) return
        foregroundStarted = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
    }
}
