package au.com.set.reception;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.WindowManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Wraps Android's built-in Screen Pinning (Activity.startLockTask()), which
 * needs no Device Owner provisioning or ADB step -- just a one-time system
 * confirmation dialog the first time it's used. Weaker than Device Owner
 * (exitable via the OS's own hold-Back+Recents gesture) but requires nothing
 * beyond installing the app.
 */
@CapacitorPlugin(name = "Kiosk")
public class KioskPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity available");
            return;
        }
        try {
            activity.startLockTask();
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to start screen pinning: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity available");
            return;
        }
        try {
            activity.stopLockTask();
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to stop screen pinning: " + e.getMessage());
        }
    }

    @PluginMethod
    public void isActive(PluginCall call) {
        Activity activity = getActivity();
        ActivityManager am = activity == null
            ? null
            : (ActivityManager) activity.getSystemService(Context.ACTIVITY_SERVICE);
        boolean active = am != null && am.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE;
        JSObject ret = new JSObject();
        ret.put("active", active);
        call.resolve(ret);
    }

    /**
     * Forces the screen back on right now, in case it's gone dark despite
     * the JS-side keep-awake flag -- most commonly caused by Android/OEM
     * battery optimization pausing the app in the background, which a
     * remote viewer has no other way to recover from short of someone
     * physically walking over and tapping the tablet.
     */
    @PluginMethod
    public void wake(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity available");
            return;
        }
        activity.runOnUiThread(() -> activity.getWindow().addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
        ));

        // Window flags are good at preventing sleep or showing the app the
        // instant a lock screen clears, but aren't reliably forceful enough
        // to pull the screen out of an already-asleep state on every
        // device/OEM power-management implementation. A real PowerManager
        // wake lock with ACQUIRE_CAUSES_WAKEUP is the more explicit,
        // historically dependable API for that specific case -- observed in
        // practice: the app itself stayed alive with the screen off (camera
        // kept streaming), but this wake call alone wasn't turning the
        // display back on.
        PowerManager powerManager = (PowerManager) activity.getSystemService(Context.POWER_SERVICE);
        if (powerManager != null) {
            @SuppressWarnings("deprecation")
            PowerManager.WakeLock wakeLock = powerManager.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP | PowerManager.ON_AFTER_RELEASE,
                "au.com.set.reception:wake-screen"
            );
            wakeLock.acquire(10_000);
        }

        call.resolve();
    }

    /**
     * Whether "Display over other apps" is granted -- this is what exempts
     * BootReceiver's startActivity() call from Android's background
     * activity start restriction. Without it, the app's process still
     * starts at boot (confirmed via Logcat: camera/WebRTC come up fine),
     * but its window is never actually shown until someone taps the icon
     * themselves, which defeats the point of an unattended kiosk display.
     */
    @PluginMethod
    public void isOverlayGranted(PluginCall call) {
        Activity activity = getActivity();
        boolean granted = activity != null
            && (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(activity));
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    /** Deep link to the "Display over other apps" grant screen for this app specifically. */
    @PluginMethod
    public void openOverlaySettings(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity available");
            return;
        }
        try {
            Intent intent = new Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + activity.getPackageName())
            );
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to open overlay settings: " + e.getMessage());
        }
    }

    /** Best-effort deep link into Android's security settings, in case screen pinning has been disabled by a device policy. */
    @PluginMethod
    public void openSecuritySettings(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity available");
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_SECURITY_SETTINGS);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to open security settings: " + e.getMessage());
        }
    }
}
