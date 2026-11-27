import type { AppNotification } from '../types';

export type NotificationPermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

const BROADCAST_CHANNEL_NAME = 'brewflow_ops_notifications_v1';

export function getBrowserNotificationPermission(): NotificationPermissionState {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported';
  }
  return Notification.permission as NotificationPermissionState;
}

export async function requestBrowserNotificationPermission(): Promise<NotificationPermissionState> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported';
  }
  try {
    const result = await Notification.requestPermission();
    return result as NotificationPermissionState;
  } catch {
    return getBrowserNotificationPermission();
  }
}

/**
 * Plays a gentle two-tone operational chime using Web Audio API (no external audio assets needed).
 */
export function playNotificationChime(): void {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const playTone = (freq: number, start: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.09, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + duration);
    };

    playTone(880, now, 0.14);
    playTone(1174.66, now + 0.12, 0.18);
    window.setTimeout(() => {
      void ctx.close();
    }, 500);
  } catch {
    // Ignore autoplay or Web Audio restrictions
  }
}

/**
 * Dispatches an OS / PWA notification via the active Service Worker registration
 * (best for installed mobile/desktop PWAs) with fallback to the standard Web Notification API.
 */
export async function showDevicePushNotification(params: {
  title: string;
  body: string;
  tag?: string;
  playSound?: boolean;
}): Promise<boolean> {
  if (params.playSound) {
    playNotificationChime();
  }

  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return false;
  }
  if (Notification.permission !== 'granted') {
    return false;
  }

  const options: NotificationOptions = {
    body: params.body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: params.tag,
  };

  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration && typeof registration.showNotification === 'function') {
        await registration.showNotification(params.title, options);
        return true;
      }
    }
  } catch {
    // Fall back to direct Notification constructor
  }

  try {
    new Notification(params.title, options);
    return true;
  } catch {
    return false;
  }
}

/**
 * Broadcasts an operational event across open tabs/windows on the same origin
 * so Owner & Cashier windows stay instantly synchronized alongside localStorage & Supabase.
 */
export function broadcastOperationalEvent(notification: AppNotification): void {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    channel.postMessage({ type: 'NEW_NOTIFICATION', payload: notification });
    channel.close();
  } catch {
    // Ignore BroadcastChannel errors
  }
}

export function subscribeOperationalBroadcast(
  onNotification: (notification: AppNotification) => void
): () => void {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return () => {};
  }
  try {
    const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    channel.onmessage = (event: MessageEvent<{ type?: string; payload?: AppNotification }>) => {
      if (event.data?.type === 'NEW_NOTIFICATION' && event.data.payload) {
        onNotification(event.data.payload);
      }
    };
    return () => channel.close();
  } catch {
    return () => {};
  }
}
