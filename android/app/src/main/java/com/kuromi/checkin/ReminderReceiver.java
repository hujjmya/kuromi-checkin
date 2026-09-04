package com.kuromi.checkin;

import android.app.Notification;
import android.app.AlarmManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import java.util.Calendar;

public class ReminderReceiver extends BroadcastReceiver {
    private static final String PREFS = "kuromi_native";
    private static final int NOTIFICATION_ID = 7019;

    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction()) || Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(intent.getAction())) schedule(context);
        else maybeNotify(context);
    }

    public static void schedule(Context context) {
        AlarmManager alarm = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        Intent intent = new Intent(context, ReminderReceiver.class);
        PendingIntent pending = PendingIntent.getBroadcast(context, 42, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Calendar next = Calendar.getInstance(); next.set(Calendar.HOUR_OF_DAY, 19); next.set(Calendar.MINUTE, 0); next.set(Calendar.SECOND, 0); next.set(Calendar.MILLISECOND, 0);
        if (next.getTimeInMillis() <= System.currentTimeMillis()) next.add(Calendar.DAY_OF_YEAR, 1);
        if (alarm != null) alarm.setInexactRepeating(AlarmManager.RTC_WAKEUP, next.getTimeInMillis(), AlarmManager.INTERVAL_DAY, pending);
    }

    public static void maybeNotify(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String today = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(new java.util.Date());
        java.util.Calendar now = java.util.Calendar.getInstance();
        if (now.get(java.util.Calendar.HOUR_OF_DAY) < 19) return;
        String completeAt = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(new java.util.Date(prefs.getLong("day_complete_at", 0L)));
        if (prefs.getBoolean("day_complete", false) && today.equals(completeAt)) return;
        if (today.equals(prefs.getString("last_reminder_day", ""))) return;
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(context, "daily_checkin")
                : new Notification.Builder(context);
        Intent open = new Intent(context, MainActivity.class);
        PendingIntent pending = PendingIntent.getActivity(context, 7019, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        builder.setSmallIcon(com.kuromi.checkin.R.mipmap.ic_launcher)
                .setContentTitle("库洛米打卡")
                .setContentText("今天还有打卡任务，记得完成哦～")
                .setAutoCancel(true)
                .setContentIntent(pending)
                .setCategory(Notification.CATEGORY_REMINDER);
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(NOTIFICATION_ID, builder.build());
        prefs.edit().putString("last_reminder_day", today).apply();
    }
}
