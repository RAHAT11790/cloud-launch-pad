import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.d9496f6fadd2411c96f8fb97b0c234a7',
  appName: 'rsanime03',
  webDir: 'dist',
  server: {
    url: 'https://d9496f6f-add2-411c-96f8-fb97b0c234a7.lovableproject.com?forceHideBadge=true',
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
