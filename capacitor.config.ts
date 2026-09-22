import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.lovable.d9496f6fadd2411c96f8fb97b0c234a7",
  appName: "RS ANIME03",
  webDir: "dist",
  android: {
    // Direct http:// media must play without any proxy inside the app.
    allowMixedContent: true,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: "#0b0b12",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
    LocalNotifications: {
      smallIcon: "ic_stat_notification_badge",
      iconColor: "#7c3aed",
    },
  },
};

export default config;
