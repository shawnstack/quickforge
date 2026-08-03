package com.quickforge.mobile;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Message;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.content.ContextCompat;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.JSExport;
import com.getcapacitor.PluginHandle;

import org.json.JSONObject;

import java.lang.reflect.Field;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "QuickForgeMain";

    /** True while the activity is visible; used by the notification service to avoid duplicate alerts. */
    static volatile boolean isAppInForeground = false;

    /** Session id delivered by a task notification tap, consumed once the page has loaded. */
    private static volatile String pendingSessionId;

    private static final Set<String> EXTERNAL_SCHEMES = new HashSet<>(
        Arrays.asList("http", "https", "mailto", "tel", "sms", "geo")
    );

    @Override
    protected void load() {
        super.load();

        WebView webView = bridge.getWebView();
        webView.getSettings().setSupportMultipleWindows(true);
        webView.addJavascriptInterface(new QuickForgeBridge(this), "QuickForgeBridge");
        bridge.setWebViewClient(new QuickForgeWebViewClient(bridge));
        webView.setWebChromeClient(new QuickForgeWebChromeClient(bridge));

        String sessionId = getIntent().getStringExtra(QuickForgeNotificationService.EXTRA_SESSION_ID);
        if (sessionId != null && !sessionId.isEmpty()) pendingSessionId = sessionId;
    }

    @Override
    public void onStart() {
        super.onStart();
        isAppInForeground = true;
    }

    @Override
    public void onStop() {
        isAppInForeground = false;
        super.onStop();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String sessionId = intent.getStringExtra(QuickForgeNotificationService.EXTRA_SESSION_ID);
        if (sessionId != null && !sessionId.isEmpty()) {
            pendingSessionId = sessionId;
            injectOpenSession(bridge.getWebView());
        }
    }

    private static void injectOpenSession(WebView view) {
        String sessionId = pendingSessionId;
        if (view == null || sessionId == null || sessionId.isEmpty()) return;
        pendingSessionId = null;
        String quoted = JSONObject.quote(sessionId);
        // Retry until the React app registers the global opener, then jump to the session.
        String script = "(function(sid){" +
            "var tries=0;" +
            "function fire(){" +
            "if(window.__quickforgeOpenSession){window.__quickforgeOpenSession(sid);}" +
            "else if(++tries<50){setTimeout(fire,200);}" +
            "}" +
            "fire();" +
            "})(" + quoted + ");";
        view.evaluateJavascript(script, null);
    }

    /** JavaScript bridge exposed to the loaded QuickForge page as window.QuickForgeBridge. */
    private static final class QuickForgeBridge {
        private final Activity activity;

        QuickForgeBridge(Activity activity) {
            this.activity = activity;
        }

        @JavascriptInterface
        public void setNotificationService(boolean enabled, String serverUrl) {
            activity.runOnUiThread(() -> {
                Intent intent = new Intent(activity, QuickForgeNotificationService.class);
                if (enabled) {
                    intent.setAction(QuickForgeNotificationService.ACTION_START);
                    intent.putExtra(QuickForgeNotificationService.EXTRA_SERVER_URL, serverUrl);
                    ContextCompat.startForegroundService(activity, intent);
                } else {
                    activity.stopService(intent);
                }
            });
        }
    }

    private static boolean isExternalUri(Uri uri) {
        String scheme = uri != null ? uri.getScheme() : null;
        return scheme != null && EXTERNAL_SCHEMES.contains(scheme.toLowerCase(Locale.ROOT));
    }

    private static boolean launchExternal(Bridge bridge, Uri uri) {
        if (!isExternalUri(uri)) return false;

        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        try {
            bridge.getActivity().startActivity(intent);
        } catch (ActivityNotFoundException ignored) {
            // Consume the URL even when Android has no matching application.
        }
        return true;
    }

    private static boolean isExplicitLinkNavigation(WebView view, WebResourceRequest request) {
        if (!request.isForMainFrame() || !request.hasGesture()) return false;
        WebView.HitTestResult hit = view.getHitTestResult();
        if (hit == null) return false;
        int type = hit.getType();
        return type == WebView.HitTestResult.SRC_ANCHOR_TYPE
            || type == WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE;
    }

    private static final class QuickForgeWebViewClient extends BridgeWebViewClient {
        private final Bridge bridge;

        QuickForgeWebViewClient(Bridge bridge) {
            super(bridge);
            this.bridge = bridge;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri target = request.getUrl();

            if (isExplicitLinkNavigation(view, request) && launchExternal(bridge, target)) {
                return true;
            }

            String scheme = target != null ? target.getScheme() : null;
            if (request.isForMainFrame()
                && ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))) {
                return false;
            }

            return super.shouldOverrideUrlLoading(view, request);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            if (pendingSessionId != null) injectOpenSession(view);
            injectCapacitorBridgeForRemotePage(bridge, view, url);
        }
    }

    /**
     * Capacitor injects its native bridge JS (PluginHeaders, Plugins proxies and
     * native-bridge.js) only for the local app origin. Remote pages (e.g. a
     * QuickForge server over Tailscale) never receive it, so plugins look
     * unavailable there. Inject the same non-destructive snippets for every
     * finished remote page.
     */
    private static void injectCapacitorBridgeForRemotePage(Bridge bridge, WebView view, String url) {
        if (url == null || url.startsWith("https://localhost") || url.startsWith("about:")) return;
        try {
            // Bridge.plugins is a private HashMap<String, PluginHandle>; reflect to
            // build the plugin proxies/headers exactly like the local injection does.
            Field field = Bridge.class.getDeclaredField("plugins");
            field.setAccessible(true);
            @SuppressWarnings("unchecked")
            Map<String, PluginHandle> plugins = (Map<String, PluginHandle>) field.get(bridge);
            String js = JSExport.getBridgeJS(view.getContext()) + "\n" + JSExport.getPluginJS(plugins.values());
            view.evaluateJavascript(js, null);
        } catch (Exception ex) {
            Log.w(TAG, "Failed to inject Capacitor bridge into " + url, ex);
        }
    }

    private static final class QuickForgeWebChromeClient extends BridgeWebChromeClient {
        private final Bridge bridge;

        QuickForgeWebChromeClient(Bridge bridge) {
            super(bridge);
            this.bridge = bridge;
        }

        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            if (!isUserGesture || !(resultMsg.obj instanceof WebView.WebViewTransport)) return false;

            WebView popup = new WebView(view.getContext());
            popup.setWebViewClient(new WebViewClient() {
                private boolean route(WebView child, Uri uri) {
                    String scheme = uri != null ? uri.getScheme() : null;
                    if ("about".equalsIgnoreCase(scheme)) return false;

                    launchExternal(bridge, uri);
                    child.post(() -> {
                        child.stopLoading();
                        child.destroy();
                    });
                    return true;
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView child, WebResourceRequest request) {
                    return route(child, request.getUrl());
                }

                @Override
                public void onPageStarted(WebView child, String url, Bitmap favicon) {
                    if (!route(child, Uri.parse(url))) super.onPageStarted(child, url, favicon);
                }
            });

            WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
            transport.setWebView(popup);
            resultMsg.sendToTarget();
            return true;
        }
    }
}
