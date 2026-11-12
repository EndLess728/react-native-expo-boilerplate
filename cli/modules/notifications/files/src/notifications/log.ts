/**
 * Dev-only notification tracing.
 *
 * One helper rather than scattered `console.log`s so every entry point prints
 * the same shape — which is what makes the Metro output readable when a single
 * push produces several lines (received → displayed → pressed → routed).
 *
 * Stripped from release builds by the `__DEV__` guard: notification payloads
 * routinely carry user-scoped ids, and a release build should not be writing
 * those to the device log where any other app with log access can read them.
 *
 * The background handler runs in a headless JS runtime with no component tree —
 * `console.log` still reaches Metro from there, which is the only visibility
 * you get into a notification that arrived while the app was killed.
 */
export function logNotification(event: string, detail?: unknown): void {
  if (!__DEV__) return;

  if (detail === undefined) {
    console.log(`🔔 [notifications] ${event}`);
    return;
  }

  console.log(`🔔 [notifications] ${event}`, detail);
}

/**
 * The bits of an FCM message worth seeing, flattened.
 *
 * Logging the raw `RemoteMessage` buries the two things you actually check —
 * the display block and the data block — under transport metadata, and on
 * Android it carries native objects that stringify to `[object Object]`.
 *
 * `notification` being `undefined` here is the single most useful signal in the
 * whole module: it means the payload was data-only, which is silently dropped
 * on a killed Android app. If a push works in the foreground and vanishes when
 * the app is closed, this line is where you find out why.
 */
export function describeRemoteMessage(message: {
  messageId?: string;
  from?: string;
  sentTime?: number;
  notification?: { title?: string; body?: string };
  data?: Record<string, unknown>;
}) {
  return {
    messageId: message.messageId,
    from: message.from,
    sentAt: message.sentTime ? new Date(message.sentTime).toLocaleTimeString() : undefined,
    // Present = the OS will draw this itself in background/killed states.
    // Absent = data-only, and Android drops it when the app is not running.
    notification: message.notification
      ? { title: message.notification.title, body: message.notification.body }
      : '⚠ NONE — data-only, dropped on killed Android',
    data: message.data ?? {},
  };
}
