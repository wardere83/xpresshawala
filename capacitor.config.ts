import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Native shell for the XpressTend apps.
 *
 * The web layer is the same build that serves xpresstend.com, so the product
 * stays identical across web, iOS and Android and only has to be QA'd once.
 * Anything that must behave natively — biometric unlock, push, haptics, the
 * splash and status bar — is a real platform API, not a web imitation.
 *
 * `appName` is duplicated from src/config/brand.ts on purpose: the native
 * build reads this file without a bundler, so it cannot import from src/.
 * Keep the two in step when rebranding.
 */
const config: CapacitorConfig = {
  appId: 'com.xpresstend.app',
  appName: 'XpressTend',
  webDir: 'dist',
  // Native HTTP libraries may log response cookies when bridge logging is on.
  loggingBehavior: 'none',

  server: {
    // https rather than the legacy http scheme, so the webview is a secure
    // context: Web Crypto, credential storage and secure cookies need it.
    androidScheme: 'https',
  },

  android: {
    allowMixedContent: false,
    // Match the production bundle and Tailwind's browser requirements.
    minWebViewVersion: 111,
    webContentsDebuggingEnabled: false,
    zoomEnabled: true,
  },

  ios: {
    contentInset: 'never',
    // The Xcode scheme was renamed from the Capacitor default "App" so the
    // IDE toolbar shows the product name; `cap run ios` must follow suit.
    scheme: 'XpressTend',
  },

  plugins: {
    SplashScreen: {
      // Held open until React has painted the first screen, so the app never
      // shows a white flash between the splash and the UI.
      launchAutoHide: false,
      backgroundColor: '#FFFFFF',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
    },
    StatusBar: {
      // Light ground, dark glyphs. The shell re-tints per screen at runtime.
      style: 'LIGHT',
      backgroundColor: '#F5F8F9',
    },
    Keyboard: {
      resize: 'native',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
}

export default config
