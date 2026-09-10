package au.com.set.reception;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.os.Process;
import java.util.Calendar;

/**
 * Restarts the app once a day (default 6am, outside monitoring hours) to
 * clear out any accumulated WebView/JS memory pressure from being left
 * running for days at a time. Observed in practice: the clock and buttons
 * froze solid while the camera preview kept playing -- consistent with a
 * long garbage-collection pause or similar JS-thread hang rather than the
 * app being killed outright, which nothing running in JS (including a
 * remote "wake" message) can recover from on its own. A clean process
 * restart sidesteps needing to diagnose the exact leak.
 */
public class ScheduledRestartReceiver extends BroadcastReceiver {
    private static final int RESTART_HOUR = 6;

    @Override
    public void onReceive(Context context, Intent intent) {
        scheduleNext(context);
        restartNow(context);
    }

    /**
     * Relaunches MainActivity and kills this process shortly after -- the
     * same recovery used for the daily scheduled restart, also called
     * on-demand by KioskPlugin.restartApp() for the JS-side "no video frames
     * in N seconds" watchdog, since a frozen JS thread can't recover itself.
     */
    static void restartNow(Context context) {
        Intent launch = new Intent(context, MainActivity.class);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        context.startActivity(launch);

        // Give the freshly launched activity a moment to actually come up
        // before killing this process out from under it.
        new Handler(Looper.getMainLooper()).postDelayed(
            () -> Process.killProcess(Process.myPid()),
            1500
        );
    }

    /** Called on every app launch (MainActivity.onCreate) as well as by this receiver itself, so the schedule is always live regardless of how the app was started. */
    static void scheduleNext(Context context) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;

        Calendar next = Calendar.getInstance();
        next.set(Calendar.HOUR_OF_DAY, RESTART_HOUR);
        next.set(Calendar.MINUTE, 0);
        next.set(Calendar.SECOND, 0);
        next.set(Calendar.MILLISECOND, 0);
        if (!next.after(Calendar.getInstance())) {
            next.add(Calendar.DAY_OF_MONTH, 1);
        }

        Intent intent = new Intent(context, ScheduledRestartReceiver.class);
        PendingIntent pendingIntent = PendingIntent.getBroadcast(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        // setAndAllowWhileIdle rather than the exact variant -- a few
        // minutes of slop before opening hours is fine, and it needs no
        // extra permission (the exact-alarm API requires
        // SCHEDULE_EXACT_ALARM on Android 12+).
        alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next.getTimeInMillis(), pendingIntent);
    }
}
