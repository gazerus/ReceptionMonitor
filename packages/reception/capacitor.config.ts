import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "au.com.set.reception",
  appName: "SET Reception Monitor",
  webDir: "dist",
  // Kiosk tablet: keep the WebView backgrounded state minimal so the
  // camera/Daily connection isn't torn down by the OS while the app
  // is the sole thing running on the device.
  android: {
    allowMixedContent: false,
  },
};

export default config;
