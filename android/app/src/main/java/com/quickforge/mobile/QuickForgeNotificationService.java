package com.quickforge.mobile;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Foreground service that watches the remote QuickForge server for running
 * sessions while the WebView JS is paused in the background. Polls
 * GET /api/agents and posts a system notification when a task ends.
 */
public class QuickForgeNotificationService extends Service {
    public static final String ACTION_START = "com.quickforge.mobile.NOTIFICATION_SERVICE_START";
    public static final String ACTION_STOP = "com.quickforge.mobile.NOTIFICATION_SERVICE_STOP";
    public static final String EXTRA_SERVER_URL = "serverUrl";
    public static final String EXTRA_SESSION_ID = "sessionId";

    private static final String CHANNEL_RUNNING = "quickforge_running";
    private static final String CHANNEL_TASKS = "quickforge_tasks";
    private static final int NOTIFICATION_ID_RUNNING = 1001;
    private static final long POLL_INTERVAL_BUSY_MS = 10_000L;
    private static final long POLL_INTERVAL_IDLE_MS = 60_000L;
    private static final int CONNECT_TIMEOUT_MS = 8_000;
    private static final int READ_TIMEOUT_MS = 8_000;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Map<String, String> lastStatus = new ConcurrentHashMap<>();

    private volatile String serverUrl;
    private volatile boolean polling = false;

    private final Runnable pollTask = new Runnable() {
        @Override
        public void run() {
            if (!polling) return;
            String target = serverUrl;
            if (target == null || target.isEmpty()) {
                scheduleNext(false);
                return;
            }
            executor.execute(() -> {
                boolean busy = pollOnce(target);
                handler.post(() -> {
                    if (polling) scheduleNext(busy);
                });
            });
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        createChannels();
        startForegroundCompat(NOTIFICATION_ID_RUNNING, buildRunningNotification());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopPolling();
            stopForegroundCompat();
            stopSelf();
            return START_NOT_STICKY;
        }
        String nextServer = intent != null ? intent.getStringExtra(EXTRA_SERVER_URL) : null;
        if (nextServer != null && !nextServer.trim().isEmpty()) {
            String normalized = nextServer.trim().replaceAll("/+$", "");
            if (!normalized.equals(serverUrl)) {
                serverUrl = normalized;
                lastStatus.clear();
            }
        }
        // After the system restarts the service (START_STICKY) the intent is
        // null; resume polling with the previously configured server.
        if (serverUrl == null || serverUrl.isEmpty()) {
            stopForegroundCompat();
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!polling) {
            polling = true;
            handler.post(pollTask);
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopPolling();
        executor.shutdownNow();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void stopPolling() {
        polling = false;
        handler.removeCallbacks(pollTask);
        lastStatus.clear();
    }

    private void scheduleNext(boolean busy) {
        handler.postDelayed(pollTask, busy ? POLL_INTERVAL_BUSY_MS : POLL_INTERVAL_IDLE_MS);
    }

    private boolean pollOnce(String target) {
        try {
            String body = httpGet(target + "/api/agents");
            JSONObject root = new JSONObject(body);
            JSONArray sessions = root.optJSONArray("sessions");
            if (sessions == null) return false;

            Set<String> seen = new HashSet<>();
            boolean busy = false;
            for (int i = 0; i < sessions.length(); i++) {
                JSONObject session = sessions.optJSONObject(i);
                if (session == null) continue;
                String sessionId = session.optString("sessionId");
                String status = session.optString("status");
                if (sessionId.isEmpty()) continue;
                seen.add(sessionId);
                String title = session.optString("title");
                String previous = lastStatus.put(sessionId, status);
                if ("running".equals(status)) {
                    busy = true;
                } else if ("running".equals(previous) && isTerminal(status)) {
                    notifyTaskEnd(sessionId, title, status);
                }
            }

            Iterator<Map.Entry<String, String>> it = lastStatus.entrySet().iterator();
            while (it.hasNext()) {
                if (!seen.contains(it.next().getKey())) it.remove();
            }
            return busy;
        } catch (Exception ignored) {
            // Server unreachable or malformed response; keep polling on the idle cadence.
            return false;
        }
    }

    private static boolean isTerminal(String status) {
        return "idle".equals(status) || "error".equals(status) || "aborted".equals(status);
    }

    private void notifyTaskEnd(String sessionId, String title, String status) {
        if (MainActivity.isAppInForeground) return;
        if (!hasNotificationPermission()) return;

        String statusText;
        switch (status) {
            case "error":
                statusText = "任务出错";
                break;
            case "aborted":
                statusText = "任务已中止";
                break;
            default:
                statusText = "任务已完成";
                break;
        }
        String displayTitle = title == null || title.trim().isEmpty() ? "QuickForge" : title.trim();

        Intent launch = new Intent(this, MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        launch.putExtra(EXTRA_SESSION_ID, sessionId);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            sessionId.hashCode(),
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_TASKS)
            : new Notification.Builder(this);
        Notification notification = builder
            .setSmallIcon(android.R.drawable.stat_notify_more)
            .setContentTitle(displayTitle)
            .setContentText(statusText)
            .setContentIntent(contentIntent)
            .setAutoCancel(true)
            .build();

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(sessionId.hashCode(), notification);
        }
    }

    private String httpGet(String urlString) throws Exception {
        URL url = new URL(urlString);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        try {
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Cache-Control", "no-cache");
            int code = connection.getResponseCode();
            if (code != HttpURLConnection.HTTP_OK) {
                throw new IllegalStateException("HTTP " + code);
            }
            StringBuilder result = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    result.append(line);
                }
            }
            return result.toString();
        } finally {
            connection.disconnect();
        }
    }

    private boolean hasNotificationPermission() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        manager.createNotificationChannel(new NotificationChannel(
            CHANNEL_RUNNING,
            "QuickForge 运行状态",
            NotificationManager.IMPORTANCE_LOW
        ));
        manager.createNotificationChannel(new NotificationChannel(
            CHANNEL_TASKS,
            "QuickForge 任务提醒",
            NotificationManager.IMPORTANCE_HIGH
        ));
    }

    private Notification buildRunningNotification() {
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_RUNNING)
            : new Notification.Builder(this);
        Intent launch = new Intent(this, MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            0,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        return builder
            .setSmallIcon(android.R.drawable.stat_notify_more)
            .setContentTitle("QuickForge 正在运行")
            .setContentText("任务完成后将在此提醒")
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .build();
    }

    private void startForegroundCompat(int id, Notification notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(id, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(id, notification);
        }
    }

    private void stopForegroundCompat() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
    }
}
