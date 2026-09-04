package com.kuromi.checkin;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.Toast;

import java.io.OutputStream;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.util.Calendar;
import java.util.Locale;
import java.util.TimeZone;

public class MainActivity extends Activity {
    private static final String START_PAGE = "file:///android_asset/index.html";
    private static final int REQUEST_OPEN_BACKUP = 1001;
    private static final int REQUEST_SAVE_BACKUP = 1002;

    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private String pendingBackup;
    private SharedPreferences prefs;
    private static final String PREFS = "kuromi_native";
    private static final String PARENT_SALT = "parent_salt";
    private static final String PARENT_HASH = "parent_hash";
    private static final String FAIL_COUNT = "parent_fail_count";
    private static final String LOCK_UNTIL = "parent_lock_until";
    private static final String TIME_MS = "trusted_time_ms";
    private static final String TIME_SYNC_WALL = "trusted_time_sync_wall";
    private static final String TIME_SYNC_ELAPSED = "trusted_time_sync_elapsed";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        ensureParentPassword();
        createReminderChannel();
        scheduleReminder();
        syncNetworkTimeAsync();
        getWindow().setStatusBarColor(Color.rgb(74, 47, 115));
        getWindow().setNavigationBarColor(Color.rgb(255, 246, 251));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getWindow().getDecorView().setSystemUiVisibility(
                    getWindow().getDecorView().getSystemUiVisibility()
                            | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        webView.setBackgroundColor(Color.rgb(247, 236, 255));
        configureWebView();
        setContentView(webView);

        if (savedInstanceState == null) {
            webView.loadUrl(START_PAGE);
        } else {
            webView.restoreState(savedInstanceState);
        }
        requestNotificationPermissionIfNeeded();
    }

    private void ensureParentPassword() {
        if (prefs.contains(PARENT_HASH)) return;
        byte[] salt = new byte[16];
        new java.security.SecureRandom().nextBytes(salt);
        String saltHex = bytesToHex(salt);
        prefs.edit().putString(PARENT_SALT, saltHex).putString(PARENT_HASH, hashPassword("999000", saltHex)).apply();
    }

    private String hashPassword(String password, String saltHex) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return bytesToHex(digest.digest((saltHex + ":" + password).getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    private String bytesToHex(byte[] bytes) {
        StringBuilder out = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) out.append(String.format(Locale.US, "%02x", b));
        return out.toString();
    }

    private boolean verifyParent(String password) {
        long lockUntil = prefs.getLong(LOCK_UNTIL, 0L);
        if (lockUntil > System.currentTimeMillis()) return false;
        String salt = prefs.getString(PARENT_SALT, "");
        boolean ok = password != null && password.matches("\\d{4,6}")
                && MessageDigest.isEqual(hashPassword(password, salt).getBytes(StandardCharsets.UTF_8), prefs.getString(PARENT_HASH, "").getBytes(StandardCharsets.UTF_8));
        if (ok) {
            prefs.edit().putInt(FAIL_COUNT, 0).apply();
            return true;
        }
        int failures = prefs.getInt(FAIL_COUNT, 0) + 1;
        SharedPreferences.Editor edit = prefs.edit().putInt(FAIL_COUNT, failures);
        if (failures >= 5) edit.putLong(LOCK_UNTIL, System.currentTimeMillis() + 5 * 60 * 1000L).putInt(FAIL_COUNT, 0);
        edit.apply();
        return false;
    }

    private boolean changeParent(String current, String next) {
        if (!verifyParent(current) || next == null || !next.matches("\\d{4,6}")) return false;
        String salt = prefs.getString(PARENT_SALT, "");
        prefs.edit().putString(PARENT_HASH, hashPassword(next, salt)).apply();
        return true;
    }

    private void resetParent() {
        String salt = prefs.getString(PARENT_SALT, "");
        prefs.edit().putString(PARENT_HASH, hashPassword("999000", salt)).putInt(FAIL_COUNT, 0).putLong(LOCK_UNTIL, 0L).apply();
    }

    private long parentLockoutRemaining() { return Math.max(0L, prefs.getLong(LOCK_UNTIL, 0L) - System.currentTimeMillis()); }

    private void syncNetworkTimeAsync() {
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                URL url = new URL("https://worldtimeapi.org/api/timezone/Asia/Shanghai");
                connection = (HttpURLConnection) url.openConnection();
                connection.setConnectTimeout(5000); connection.setReadTimeout(5000); connection.setRequestMethod("GET");
                if (connection.getResponseCode() / 100 != 2) return;
                StringBuilder body = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                    String line; while ((line = reader.readLine()) != null) body.append(line);
                }
                java.util.regex.Matcher matcher = java.util.regex.Pattern.compile("\\\"unixtime\\\"\\s*:\\s*(\\d+)").matcher(body);
                if (!matcher.find()) return;
                long serverMs = Long.parseLong(matcher.group(1)) * 1000L;
                prefs.edit().putLong(TIME_MS, serverMs).putLong(TIME_SYNC_WALL, System.currentTimeMillis()).putLong(TIME_SYNC_ELAPSED, SystemClock.elapsedRealtime()).apply();
            } catch (Exception ignored) {
            } finally { if (connection != null) connection.disconnect(); }
        }, "kuromi-time-sync").start();
    }

    private String trustedTimeState() {
        long nowWall = System.currentTimeMillis();
        long cached = prefs.getLong(TIME_MS, 0L);
        long syncWall = prefs.getLong(TIME_SYNC_WALL, 0L);
        long syncElapsed = prefs.getLong(TIME_SYNC_ELAPSED, 0L);
        long now = cached > 0 && syncElapsed > 0 ? cached + (SystemClock.elapsedRealtime() - syncElapsed) : nowWall;
        long age = cached > 0 ? Math.max(0L, nowWall - syncWall) : Long.MAX_VALUE;
        boolean online = cached > 0 && age <= 30 * 60 * 1000L;
        return String.format(Locale.US, "{\"nowMs\":%d,\"ageMs\":%d,\"online\":%s}", now, age, online ? "true" : "false");
    }

    private void createReminderChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel("daily_checkin", "每日打卡提醒", NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("每天提醒完成打卡");
        manager.createNotificationChannel(channel);
    }

    private void scheduleReminder() {
        AlarmManager alarm = (AlarmManager) getSystemService(ALARM_SERVICE);
        Intent intent = new Intent(this, ReminderReceiver.class);
        PendingIntent pending = PendingIntent.getBroadcast(this, 42, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Calendar next = Calendar.getInstance(); next.set(Calendar.HOUR_OF_DAY, 19); next.set(Calendar.MINUTE, 0); next.set(Calendar.SECOND, 0); next.set(Calendar.MILLISECOND, 0);
        if (next.getTimeInMillis() <= System.currentTimeMillis()) next.add(Calendar.DAY_OF_YEAR, 1);
        alarm.setInexactRepeating(AlarmManager.RTC_WAKEUP, next.getTimeInMillis(), AlarmManager.INTERVAL_DAY, pending);
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33 && !prefs.getBoolean("notification_prompted", false)
                && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            prefs.edit().putBoolean("notification_prompted", true).apply();
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 2001);
        }
    }

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    private void configureWebView() {
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setDatabaseEnabled(true);
        webView.getSettings().setAllowFileAccess(true);
        webView.getSettings().setAllowContentAccess(true);
        webView.getSettings().setAllowFileAccessFromFileURLs(false);
        webView.getSettings().setAllowUniversalAccessFromFileURLs(false);
        webView.getSettings().setBuiltInZoomControls(false);
        webView.getSettings().setDisplayZoomControls(false);
        webView.getSettings().setTextZoom(100);
        webView.addJavascriptInterface(new AndroidBridge(), "AndroidApp");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("file".equals(uri.getScheme())) return false;
                openExternal(uri);
                return true;
            }

        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/json");
                try {
                    startActivityForResult(intent, REQUEST_OPEN_BACKUP);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    toast("没有找到可选择文件的应用");
                    return false;
                }
                return true;
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton("确定", (dialog, which) -> result.confirm())
                        .setOnCancelListener(dialog -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton("确定", (dialog, which) -> result.confirm())
                        .setNegativeButton("取消", (dialog, which) -> result.cancel())
                        .setOnCancelListener(dialog -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onJsPrompt(WebView view, String url, String message,
                                      String defaultValue, JsPromptResult result) {
                EditText input = new EditText(MainActivity.this);
                input.setText(defaultValue == null ? "" : defaultValue);
                input.setSelectAllOnFocus(true);
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setView(input)
                        .setPositiveButton("确定", (dialog, which) -> result.confirm(input.getText().toString()))
                        .setNegativeButton("取消", (dialog, which) -> result.cancel())
                        .setOnCancelListener(dialog -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.deny();
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                return true;
            }
        });
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            toast("无法打开链接");
        }
    }

    private void createBackup(String json, String fileName) {
        pendingBackup = json;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, sanitizeFileName(fileName));
        try {
            startActivityForResult(intent, REQUEST_SAVE_BACKUP);
        } catch (ActivityNotFoundException e) {
            pendingBackup = null;
            toast("没有找到可保存文件的应用");
        }
    }

    private String sanitizeFileName(String value) {
        String name = value == null || value.trim().isEmpty() ? "kuromi-backup.json" : value;
        return name.replaceAll("[\\\\/:*?\"<>|]", "_");
    }

    private void printCurrentPage() {
        PrintManager manager = (PrintManager) getSystemService(Context.PRINT_SERVICE);
        PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter("库洛米打卡表");
        PrintAttributes attributes = new PrintAttributes.Builder()
                .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
                .build();
        manager.print("库洛米打卡", adapter, attributes);
    }

    private void shareText(String text) {
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_TEXT, text);
        startActivity(Intent.createChooser(send, "分享平板链接"));
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_OPEN_BACKUP) {
            Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
            if (fileCallback != null) {
                fileCallback.onReceiveValue(uri == null ? null : new Uri[]{uri});
                fileCallback = null;
            }
            return;
        }
        if (requestCode == REQUEST_SAVE_BACKUP) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingBackup != null) {
                try (OutputStream stream = getContentResolver().openOutputStream(data.getData())) {
                    if (stream == null) throw new IllegalStateException("no-stream");
                    stream.write(pendingBackup.getBytes(StandardCharsets.UTF_8));
                    stream.flush();
                    toast("备份文件已保存");
                } catch (Exception e) {
                    toast("备份保存失败，请重试");
                }
            }
            pendingBackup = null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        webView.evaluateJavascript(
                "(function(){var m=document.querySelector('.modal.open');if(m){m.classList.remove('open');document.body.style.overflow='';return true;}return false;})()",
                value -> {
                    if ("true".equals(value)) return;
                    if (webView.canGoBack()) webView.goBack();
                    else MainActivity.super.onBackPressed();
                });
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidApp");
            webView.destroy();
        }
        super.onDestroy();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (prefs != null) syncNetworkTimeAsync();
        if (prefs != null && !prefs.getBoolean("day_complete", false)) ReminderReceiver.maybeNotify(this);
    }

    private void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    public final class AndroidBridge {
        @JavascriptInterface
        public void saveBackup(String json, String fileName) {
            runOnUiThread(() -> createBackup(json, fileName));
        }

        @JavascriptInterface
        public void printPage() {
            runOnUiThread(MainActivity.this::printCurrentPage);
        }

        @JavascriptInterface
        public void shareText(String text) {
            runOnUiThread(() -> MainActivity.this.shareText(text));
        }

        @JavascriptInterface
        public boolean verifyParentPassword(String password) { return verifyParent(password); }

        @JavascriptInterface
        public long parentLockoutRemainingMs() { return parentLockoutRemaining(); }

        @JavascriptInterface
        public boolean changeParentPassword(String current, String next) { return changeParent(current, next); }

        @JavascriptInterface
        public void resetParentPassword() { resetParent(); }

        @JavascriptInterface
        public String getTrustedTimeState() { return trustedTimeState(); }

        @JavascriptInterface
        public void setDayComplete(boolean complete) {
            prefs.edit().putBoolean("day_complete", complete).putLong("day_complete_at", System.currentTimeMillis()).apply();
            if (!complete) ReminderReceiver.maybeNotify(MainActivity.this);
        }
    }
}
