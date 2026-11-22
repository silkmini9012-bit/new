package com.mhlee.drivelog;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** 집 PC의 주행 기록 대시보드를 앱으로 보여 주는 화면 */
public class MainActivity extends Activity {
    private WebView web;
    private String home;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        home = getString(R.string.dashboard_url);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#111214"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);

        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                Uri h = Uri.parse(home);
                if (h.getHost() != null && h.getHost().equals(u.getHost())) return false;
                // 카카오맵/네이버지도/구글지도 등 외부 링크는 해당 앱(또는 브라우저)으로 열기
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception ignored) { }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (!req.isForMainFrame()) return;
                String html = "<html><body style='background:#111214;color:#eceef1;font-family:sans-serif;padding:40px 24px;text-align:center'>"
                        + "<h2>집 PC에 연결할 수 없어요</h2>"
                        + "<p style='color:#9aa0a8;line-height:1.6'>1. 폰에서 <b>Tailscale 앱</b>이 켜져 있는지 확인하세요.<br>"
                        + "2. 집 PC와 Docker Desktop이 켜져 있는지 확인하세요.</p>"
                        + "<button onclick=\"location.href='" + home + "'\" style='margin-top:24px;padding:14px 28px;border:0;border-radius:12px;background:#3e7bfa;color:#fff;font-size:16px'>다시 시도</button>"
                        + "</body></html>";
                view.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
            }
        });

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(home);
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
