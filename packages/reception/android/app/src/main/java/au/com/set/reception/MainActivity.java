package au.com.set.reception;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KioskPlugin.class);
        super.onCreate(savedInstanceState);
        // So the boot-launched app is actually visible immediately rather
        // than sitting behind the lock screen -- only fully bypasses an
        // insecure/no lock screen, but that's the expected setup for a
        // fixed kiosk tablet. Harmless if a secure PIN/pattern is set: the
        // OS still requires that to be entered, this just shows the app the
        // moment it is.
        getWindow().addFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
        );
        // Idempotent -- just keeps the daily-restart alarm alive regardless
        // of whether the app was launched fresh, via boot, or by the
        // restart alarm itself.
        ScheduledRestartReceiver.scheduleNext(this);
    }
}
