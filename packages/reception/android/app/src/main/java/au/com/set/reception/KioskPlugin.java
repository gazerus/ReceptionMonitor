package au.com.set.reception;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.provider.Settings;
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
