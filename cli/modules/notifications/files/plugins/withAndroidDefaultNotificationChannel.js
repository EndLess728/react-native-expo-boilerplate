const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

/**
 * Writes `com.google.firebase.messaging.default_notification_channel_id` into
 * the Android manifest.
 *
 * Without it, a remote push whose payload carries no `channel_id` lands on a
 * channel Android invents at IMPORTANCE_DEFAULT — which is below the threshold
 * for heads-up, so the notification appears silently in the tray instead of
 * over the screen. Backends often don't send `channel_id`, so the fallback is
 * declared here.
 *
 * The value MUST match `DEFAULT_CHANNEL_ID` in `src/notifications/config.ts`.
 * If the two drift apart, FCM points at a channel the app never creates and
 * every remote notification quietly loses its heads-up treatment — with nothing
 * in the logs to say so.
 *
 * ── Why `tools:replace` is not optional ──────────────────────────────────────
 * `@react-native-firebase/messaging` ships its OWN copy of this meta-data with
 * an EMPTY value. Two manifests declaring the same `meta-data` name with
 * different values is a hard merge conflict, and the build fails at
 * `processDebugMainManifest` rather than picking one:
 *
 *   Attribute meta-data#...default_notification_channel_id@value
 *   value=(general.v1) is also present at [:react-native-firebase_messaging]
 *   value=(). Suggestion: add 'tools:replace="android:value"'.
 *
 * The marker tells the merger this declaration deliberately wins over the
 * library's placeholder, which is exactly the intent.
 */
const CHANNEL_ID = 'general.v1';
const META_DATA_NAME = 'com.google.firebase.messaging.default_notification_channel_id';

module.exports = function withAndroidDefaultNotificationChannel(config) {
  return withAndroidManifest(config, (cfg) => {
    // Guarantees `xmlns:tools` exists on <manifest>. Without the namespace the
    // `tools:replace` attribute below is not merger syntax, just an unknown
    // attribute the build rejects, with an error that doesn't point here.
    cfg.modResults = AndroidConfig.Manifest.ensureToolsAvailable(cfg.modResults);

    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);

    application['meta-data'] = application['meta-data'] ?? [];

    const existing = application['meta-data'].find(
      (item) => item.$?.['android:name'] === META_DATA_NAME,
    );

    if (existing) {
      existing.$['android:value'] = CHANNEL_ID;
      existing.$['tools:replace'] = 'android:value';
    } else {
      application['meta-data'].push({
        $: {
          'android:name': META_DATA_NAME,
          'android:value': CHANNEL_ID,
          'tools:replace': 'android:value',
        },
      });
    }

    return cfg;
  });
};
