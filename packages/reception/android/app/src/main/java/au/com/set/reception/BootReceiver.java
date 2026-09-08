package au.com.set.reception;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Launches the app straight after the tablet powers back on, so it doesn't
 * sit on the lock screen/home screen unattended after a dead battery or
 * power cut -- combined with the kiosk-lock preference already re-arming
 * itself on launch (see kiosk.ts), this gets the tablet back to a locked,
 * monitoring state with nobody needing to touch it.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        Intent launch = new Intent(context, MainActivity.class);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(launch);
    }
}
