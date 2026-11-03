package ar.edu.jme.portal;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.io.IOException;
import java.io.InputStream;
import java.util.Collections;

public final class MainActivity extends Activity {
    private static final String APP_HOST = "appassets.androidplatform.net";
    private static final String APP_PATH = "/assets/www/";
    private static final String HOME_URL = "https://" + APP_HOST + APP_PATH + "index.html";
    private static final long STARTUP_FALLBACK_MS = 6000;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private WebView webView;
    private View startupOverlay;
    private boolean drawerOpen;
    private boolean startupFinished;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(15, 23, 42));
        getWindow().setNavigationBarColor(Color.rgb(15, 23, 42));

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(15, 23, 42));
        setContentView(root);
        applySystemBarInsets(root);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(244, 247, 251));
        webView.setOverScrollMode(View.OVER_SCROLL_IF_CONTENT_SCROLLS);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);

        webView.addJavascriptInterface(new AndroidBridge(), "JMEAndroid");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new PortalWebViewClient());
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        startupOverlay = createStartupOverlay();
        root.addView(startupOverlay, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        mainHandler.postDelayed(this::hideStartupOverlay, STARTUP_FALLBACK_MS);

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
            if (webView.getUrl() == null) webView.loadUrl(HOME_URL);
        } else {
            webView.loadUrl(HOME_URL);
        }
    }

    private void applySystemBarInsets(View root) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            root.setFitsSystemWindows(true);
            return;
        }
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            android.graphics.Insets bars = insets.getInsets(
                    WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
        });
        root.requestApplyInsets();
    }

    private View createStartupOverlay() {
        FrameLayout overlay = new FrameLayout(this);
        overlay.setBackgroundColor(Color.rgb(15, 23, 42));

        LinearLayout content = new LinearLayout(this);
        content.setGravity(Gravity.CENTER_HORIZONTAL);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(28), dp(24), dp(28), dp(24));

        ImageView icon = new ImageView(this);
        icon.setImageResource(R.drawable.ic_launcher_foreground);
        icon.setPadding(dp(12), dp(12), dp(12), dp(12));
        content.addView(icon, new LinearLayout.LayoutParams(dp(82), dp(82)));

        TextView title = new TextView(this);
        title.setText(R.string.institution_name);
        title.setTextColor(Color.WHITE);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        title.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        titleParams.topMargin = dp(18);
        content.addView(title, titleParams);

        ProgressBar progress = new ProgressBar(this);
        progress.setIndeterminateTintList(android.content.res.ColorStateList.valueOf(Color.rgb(125, 211, 252)));
        LinearLayout.LayoutParams progressParams = new LinearLayout.LayoutParams(dp(30), dp(30));
        progressParams.topMargin = dp(28);
        content.addView(progress, progressParams);

        overlay.addView(content, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        return overlay;
    }

    private void hideStartupOverlay() {
        if (startupFinished || startupOverlay == null) return;
        startupFinished = true;
        startupOverlay.animate().alpha(0f).setDuration(220).withEndAction(() -> {
            if (startupOverlay != null) startupOverlay.setVisibility(View.GONE);
        }).start();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (drawerOpen && webView != null) {
            webView.evaluateJavascript("window.JMEAndroidShell&&window.JMEAndroidShell.closeDrawer()", null);
            drawerOpen = false;
        } else if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        mainHandler.removeCallbacksAndMessages(null);
        if (webView != null) {
            webView.removeJavascriptInterface("JMEAndroid");
            webView.stopLoading();
            webView.loadUrl("about:blank");
            webView.clearHistory();
            webView.removeAllViews();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private boolean isAppAsset(Uri uri) {
        return "https".equals(uri.getScheme())
                && APP_HOST.equals(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443)
                && uri.getPath() != null
                && uri.getPath().startsWith(APP_PATH);
    }

    private String safeAssetName(String path) {
        String relative = Uri.decode(path.substring(APP_PATH.length()));
        if (relative.isEmpty() || relative.startsWith("/") || relative.indexOf('\\') >= 0) return null;
        for (String segment : relative.split("/")) {
            if (segment.isEmpty() || ".".equals(segment) || "..".equals(segment)) return null;
        }
        return relative;
    }

    private WebResourceResponse readAppAsset(Uri uri) {
        String assetName = safeAssetName(uri.getPath());
        if (assetName == null) return errorResponse(400, "Bad Request");
        try {
            InputStream stream = getAssets().open("www/" + assetName);
            String mimeType = getMimeType(assetName);
            String encoding = mimeType.startsWith("text/") || "application/javascript".equals(mimeType)
                    || "application/json".equals(mimeType) ? "UTF-8" : null;
            return new WebResourceResponse(
                    mimeType, encoding, 200, "OK",
                    Collections.singletonMap("Cache-Control", "no-cache"), stream);
        } catch (IOException error) {
            return errorResponse(404, "Not Found");
        }
    }

    private WebResourceResponse errorResponse(int statusCode, String reason) {
        byte[] body = reason.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        return new WebResourceResponse(
                "text/plain", "UTF-8", statusCode, reason,
                Collections.singletonMap("Cache-Control", "no-store"),
                new java.io.ByteArrayInputStream(body));
    }

    private String getMimeType(String name) {
        String lower = name.toLowerCase(java.util.Locale.ROOT);
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".js")) return "application/javascript";
        if (lower.endsWith(".json") || lower.endsWith(".webmanifest")) return "application/json";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    private void openExternalLink(Uri uri) {
        String scheme = uri.getScheme();
        if (!"https".equals(scheme) && !"http".equals(scheme)
                && !"mailto".equals(scheme) && !"tel".equals(scheme)) {
            Toast.makeText(this, "Enlace no compatible con la aplicación.", Toast.LENGTH_SHORT).show();
            return;
        }
        Intent intent = "mailto".equals(scheme)
                ? new Intent(Intent.ACTION_SENDTO, uri)
                : "tel".equals(scheme) ? new Intent(Intent.ACTION_DIAL, uri) : new Intent(Intent.ACTION_VIEW, uri);
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this, "No hay una aplicación disponible para abrir este enlace.", Toast.LENGTH_SHORT).show();
        }
    }

    private final class PortalWebViewClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (isAppAsset(uri)) return readAppAsset(uri);
            return super.shouldInterceptRequest(view, request);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (isAppAsset(uri)) return false;
            openExternalLink(uri);
            return true;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            Uri uri = Uri.parse(url);
            if (isAppAsset(uri)) return false;
            openExternalLink(uri);
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            drawerOpen = false;
            super.onPageStarted(view, url, favicon);
        }

        @Override
        public void onPageCommitVisible(WebView view, String url) {
            hideStartupOverlay();
            super.onPageCommitVisible(view, url);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            if (isAppAsset(Uri.parse(url))) {
                view.evaluateJavascript(MOBILE_DRAWER_SCRIPT, (ValueCallback<String>) value -> {});
            }
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            super.onReceivedError(view, request, error);
            if (request.isForMainFrame()) {
                hideStartupOverlay();
                Toast.makeText(MainActivity.this, R.string.offline_error, Toast.LENGTH_LONG).show();
            }
        }

    }

    private final class AndroidBridge {
        @JavascriptInterface
        public void setDrawerOpen(boolean isOpen) {
            runOnUiThread(() -> drawerOpen = isOpen);
        }
    }

    private static final String MOBILE_DRAWER_SCRIPT = """
            (() => {
                if (!window.JMEAndroid || document.getElementById("jme-mobile-menu")) return;
                const toolbar = document.querySelector(".site-nav .nav-inner") || document.querySelector(".global-navigation");
                if (!toolbar) return;

                const style = document.createElement("style");
                style.textContent = `
                    .jme-native-menu-toggle { display: none; width: 42px; height: 42px; padding: 0; place-items: center; border: 1px solid rgba(255,255,255,.25); border-radius: 10px; background: rgba(96,165,250,.16); color: #fff; font: 24px/1 "Segoe UI",sans-serif; cursor: pointer; }
                    .site-nav .nav-inner { position: relative; }
                    .jme-native-drawer { position: fixed; z-index: 9999; inset: 0; visibility: hidden; pointer-events: none; }
                    .jme-native-drawer.is-open { visibility: visible; pointer-events: auto; }
                    .jme-native-drawer-backdrop { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: rgba(4,12,28,.58); opacity: 0; transition: opacity .32s ease; backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); }
                    .jme-native-drawer.is-open .jme-native-drawer-backdrop { opacity: 1; }
                    .jme-native-drawer-panel { position: absolute; inset: 0 auto 0 0; width: min(84vw,340px); display: flex; flex-direction: column; padding: max(26px,env(safe-area-inset-top)) 18px max(22px,env(safe-area-inset-bottom)); border-right: 1px solid rgba(255,255,255,.18); background: linear-gradient(160deg,#10294c,#0f172a 75%); color: #fff; box-shadow: 16px 0 48px rgba(2,8,23,.28); transform: translateX(-105%); transition: transform .38s cubic-bezier(.2,.75,.25,1); }
                    .jme-native-drawer.is-open .jme-native-drawer-panel { transform: translateX(0); }
                    .jme-native-drawer-heading { display: flex; align-items: center; gap: 12px; padding: 8px 8px 22px; border-bottom: 1px solid rgba(255,255,255,.15); }
                    .jme-native-drawer-icon { width: 44px; height: 44px; display: grid; flex: 0 0 auto; place-items: center; border: 1px solid rgba(255,255,255,.2); border-radius: 12px; background: rgba(96,165,250,.18); font-size: 23px; }
                    .jme-native-drawer-title { margin: 0; color: #fff; font-size: 15px; font-weight: 750; line-height: 1.35; }
                    .jme-native-drawer-caption { margin: 4px 0 0; color: #bfdbfe; font-size: 10px; letter-spacing: .12em; }
                    .jme-native-drawer-links { display: grid; gap: 6px; margin: 18px 0; }
                    .jme-native-drawer-links a { display: flex; align-items: center; gap: 12px; min-height: 49px; padding: 0 12px; border: 1px solid transparent; border-radius: 10px; color: #e6effc; font-size: 14px; font-weight: 650; text-decoration: none; transition: transform .3s ease,background .3s ease,border-color .3s ease; }
                    .jme-native-drawer-links a:hover,.jme-native-drawer-links a:focus-visible { transform: translateX(3px); border-color: rgba(125,211,252,.23); background: rgba(96,165,250,.15); }
                    .jme-native-drawer-links a span { width: 26px; font-size: 18px; text-align: center; }
                    .jme-native-drawer-footer { margin-top: auto; padding: 15px 9px 3px; border-top: 1px solid rgba(255,255,255,.13); color: #cbd5e1; font-size: 11px; }
                    @media (max-width: 850px) {
                        .jme-native-menu-toggle { display: grid; }
                        .site-nav .nav-inner { padding-right: 50px; }
                        .site-nav .nav-inner > .jme-native-menu-toggle { position: absolute; top: 10px; right: 0; z-index: 2; }
                        .global-navigation > .jme-native-menu-toggle { margin-left: auto; flex: 0 0 auto; }
                    }
                    @media (prefers-reduced-motion: reduce) {
                        .jme-native-drawer-panel,.jme-native-drawer-backdrop,.jme-native-drawer-links a { transition-duration: .01ms; }
                    }
                `;
                document.head.append(style);

                const toggle = document.createElement("button");
                toggle.id = "jme-mobile-menu";
                toggle.className = "jme-native-menu-toggle";
                toggle.type = "button";
                toggle.setAttribute("aria-label", "Abrir menú de navegación");
                toggle.setAttribute("aria-expanded", "false");
                toggle.textContent = "☰";

                const drawer = document.createElement("div");
                drawer.className = "jme-native-drawer";
                drawer.innerHTML = `
                    <button class="jme-native-drawer-backdrop" type="button" aria-label="Cerrar menú"></button>
                    <aside class="jme-native-drawer-panel" role="dialog" aria-modal="true" aria-label="Navegación">
                        <div class="jme-native-drawer-heading">
                            <span class="jme-native-drawer-icon" aria-hidden="true">🏫</span>
                            <div><p class="jme-native-drawer-title">Escuela Secundaria<br>José Manuel Estrada N°1</p><p class="jme-native-drawer-caption">PORTAL EDUCATIVO</p></div>
                        </div>
                        <nav class="jme-native-drawer-links" aria-label="Secciones">
                            <a href="alumno.html"><span>⌂</span>Inicio</a>
                            <a href="novedades.html"><span>▤</span>Novedades</a>
                            <a href="cursos.html"><span>▣</span>Cursos</a>
                            <a href="preceptores.html"><span>♙</span>Preceptores</a>
                            <a href="acerca.html"><span>ⓘ</span>Información institucional</a>
                            <a href="index.html"><span>↪</span>Acceso de personal</a>
                        </nav>
                        <div class="jme-native-drawer-footer">Comunidad · Aprendizaje · Información</div>
                    </aside>
                `;
                document.body.append(drawer);

                const backdrop = drawer.querySelector(".jme-native-drawer-backdrop");
                const closeDrawer = () => {
                    drawer.classList.remove("is-open");
                    toggle.setAttribute("aria-expanded", "false");
                    toggle.setAttribute("aria-label", "Abrir menú de navegación");
                    window.JMEAndroid.setDrawerOpen(false);
                };
                const openDrawer = () => {
                    drawer.classList.add("is-open");
                    toggle.setAttribute("aria-expanded", "true");
                    toggle.setAttribute("aria-label", "Cerrar menú de navegación");
                    window.JMEAndroid.setDrawerOpen(true);
                    drawer.querySelector(".jme-native-drawer-links a").focus({preventScroll: true});
                };
                toggle.addEventListener("click", openDrawer);
                backdrop.addEventListener("click", closeDrawer);
                drawer.querySelectorAll("a").forEach(link => link.addEventListener("click", closeDrawer));
                document.addEventListener("keydown", event => {
                    if (event.key === "Escape" && drawer.classList.contains("is-open")) {
                        closeDrawer();
                        toggle.focus({preventScroll: true});
                    }
                });
                window.JMEAndroidShell = {closeDrawer};
                if (toolbar.classList.contains("global-navigation")) toolbar.append(toggle);
                else {
                    const brand = toolbar.querySelector(".brand");
                    brand ? brand.after(toggle) : toolbar.prepend(toggle);
                }
            })();
            """;
}
