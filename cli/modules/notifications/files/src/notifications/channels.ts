import { Platform } from 'react-native';
import notifee from 'react-native-notify-kit';

import { CHANNELS, DEPRECATED_CHANNEL_IDS, PRIMARY_CHANNEL_ID } from './config';

/**
 * Creates every channel in `config.ts` and deletes any retired ones.
 *
 * Runs at startup, unconditionally, and long before permission is requested —
 * which is not incidental. On Android 13+ the OS refuses to show the
 * notification permission prompt until the app has at least one channel, so a
 * `requestPermission()` call that beats this one silently resolves as denied
 * and the user never sees a dialog. Moving this later, or making it lazy,
 * reintroduces that bug in a form that looks like a permissions problem.
 *
 * `createChannel` is idempotent: for an existing channel Android updates only
 * the name and description and ignores everything else, so re-running this on
 * every launch is how copy changes ship without a version bump.
 *
 * No-op on iOS, which has no channel concept.
 */
export async function createChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Promise.all(
    DEPRECATED_CHANNEL_IDS.map((id) =>
      // A channel that was never created on this device throws; that is the
      // normal case for a fresh install, so it is swallowed rather than
      // failing the whole startup path.
      notifee.deleteChannel(id).catch(() => undefined),
    ),
  );

  await Promise.all(
    CHANNELS.map((channel) =>
      notifee.createChannel({
        id: channel.id,
        name: channel.name,
        description: channel.description,
        importance: channel.importance,
        vibration: channel.vibration,
        sound: channel.sound,
      }),
    ),
  );
}

/**
 * Whether the user has muted `PRIMARY_CHANNEL_ID` specifically.
 *
 * This is the failure mode no permission API reports: app-level permission
 * granted, `authorizationStatus` AUTHORIZED, and those notifications silently
 * never appear because the channel itself is set to importance NONE. Checking
 * it is the only way the banner can tell the user what is actually wrong.
 *
 * Which channel that is belongs to `config.ts` — this file only asks the OS.
 *
 * Always false on iOS — there are no channels to mute.
 */
export async function isPrimaryChannelBlocked(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;

  try {
    return await notifee.isChannelBlocked(PRIMARY_CHANNEL_ID);
  } catch {
    // Never block the UI on a diagnostic. If the check itself fails, report
    // "not blocked" and let the ordinary permission state stand.
    return false;
  }
}
