package au.com.set.reception;

import android.Manifest;
import android.os.Bundle;
import androidx.core.app.ActivityCompat;
import com.getcapacitor.BridgeActivity;

/**
 * Capacitor's WebView only grants a getUserMedia() request if the
 * corresponding Android runtime permission is already held — it doesn't
 * prompt for CAMERA/RECORD_AUDIO on its own the way a plugin like
 * @capacitor/camera would. This app talks to the camera/mic directly
 * through daily-js's WebRTC calls, so we ask for both up front at launch.
 */
public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    ActivityCompat.requestPermissions(
        this,
        new String[] {Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO},
        1001);
  }
}
