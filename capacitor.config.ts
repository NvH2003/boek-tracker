import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.boektracker.app",
  appName: "Boek Tracker",
  webDir: "dist",
  server: {
    androidScheme: "https"
  }
};

export default config;
