package com.mhlee.drivelog;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** 내 PC의 DriveLog 주행 기록 화면을 앱으로 보여 준다. 연결 주소는 PC 설정 화면의 QR로 등록한다. */
public class MainActivity extends Activity {
    private WebView web;
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("drivelog", MODE_PRIVATE);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#111214"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        web.addJavascriptInterface(new Bridge(), "DL");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                Uri h = Uri.parse(home());
                if (h.getHost() != null && h.getHost().equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (!req.isForMainFrame()) return;
                page("<h2>집 PC에 연결할 수 없어요</h2>"
                        + "<p class='s'>PC와 DriveLog가 켜져 있고 인터넷에 연결돼 있는지 확인하세요.</p>"
                        + "<button onclick=\"location.href='" + home() + "'\">다시 시도</button>"
                        + "<button class='g' onclick='DL.reset()'>연결 주소 바꾸기</button>");
            }
        });

        if (!handle(getIntent())) {
            if (home().isEmpty()) showConnect();
            else if (savedInstanceState != null) web.restoreState(savedInstanceState);
            else web.loadUrl(home());
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handle(intent);
    }

    /** drivelog://connect?u=https://... 로 열리면 주소를 저장하고 연다 */
    private boolean handle(Intent intent) {
        Uri data = intent != null ? intent.getData() : null;
        if (data == null || !"drivelog".equals(data.getScheme())) return false;
        String u = data.getQueryParameter("u");
        if (u == null || !u.startsWith("https://")) return false;
        prefs.edit().putString("url", u).apply();
        web.loadUrl(u);
        return true;
    }

    private String home() { return prefs.getString("url", ""); }

    private void page(String body) {
        String html = "<html><head><meta name='viewport' content='width=device-width'><style>"
                + "body{background:#111214;color:#eceef1;font-family:sans-serif;padding:40px 24px;text-align:center}"
                + ".s{color:#9aa0a8;line-height:1.6}button{display:block;width:100%;margin:12px 0;padding:14px;border:0;border-radius:12px;background:#3e7bfa;color:#fff;font-size:16px}"
                + ".g{background:#2a2d33}input{width:100%;padding:12px;border-radius:10px;border:1px solid #2a2d33;background:#1b1d21;color:#fff;font-size:14px}</style></head><body>"
                + body + "</body></html>";
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    private void showConnect() {
        page("<h2>🚗 주행 기록</h2>"
                + "<p class='s'>PC의 <b>DriveLog 설정</b> 화면 마지막 단계에 있는<br><b>\"앱 설치 후 이 QR로 연결\"</b>을<br>휴대폰 카메라로 찍으면 연결돼요.</p>"
                + "<p class='s' style='margin-top:32px'>또는 주소를 직접 붙여 넣기</p>"
                + "<input id='u' placeholder='https://drivelog.xxxx.ts.net:10000/?k=...'>"
                + "<button onclick='DL.save(document.getElementById(\"u\").value)'>연결</button>");
    }

    private class Bridge {
        @JavascriptInterface
        public void save(String u) {
            final String url = u == null ? "" : u.trim();
            if (!url.startsWith("https://")) return;
            prefs.edit().putString("url", url).apply();
            runOnUiThread(() -> web.loadUrl(url));
        }

        @JavascriptInterface
        public void reset() {
            prefs.edit().remove("url").apply();
            runOnUiThread(MainActivity.this::showConnect);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
