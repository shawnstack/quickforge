package com.quickforge.mobile;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Message;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

public class MainActivity extends BridgeActivity {
    private static final Set<String> EXTERNAL_SCHEMES = new HashSet<>(
        Arrays.asList("http", "https", "mailto", "tel", "sms", "geo")
    );

    @Override
    protected void load() {
        super.load();

        WebView webView = bridge.getWebView();
        webView.getSettings().setSupportMultipleWindows(true);
        bridge.setWebViewClient(new QuickForgeWebViewClient(bridge));
        webView.setWebChromeClient(new QuickForgeWebChromeClient(bridge));
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
