// Android app boot: dark status bar, splash hand-off, hardware back button and
// notification permission priming. No-ops on the web build.
import { isNativeApp } from "@/lib/nativeRuntime";

export const bootNativeApp = () => {
  if (!isNativeApp()) return;

  // The app is always dark-themed on Android.
  try { document.documentElement.classList.add("dark", "native-app"); } catch {}

  void (async () => {
    try {
      const { StatusBar, Style } = await import("@capacitor/status-bar");
      await StatusBar.setStyle({ style: Style.Dark });
      await StatusBar.setBackgroundColor({ color: "#0b0b12" });
    } catch {}

    try {
      const { SplashScreen } = await import("@capacitor/splash-screen");
      window.setTimeout(() => { void SplashScreen.hide(); }, 450);
    } catch {}

    try {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      const current = await LocalNotifications.checkPermissions();
      if (current.display !== "granted") await LocalNotifications.requestPermissions();
    } catch {}

    try {
      const { App } = await import("@capacitor/app");
      App.addListener("backButton", ({ canGoBack }) => {
        if (canGoBack || window.history.length > 1) window.history.back();
        else void App.exitApp();
      });
    } catch {}
  })();
};
