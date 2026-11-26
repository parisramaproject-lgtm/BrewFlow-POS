import type { StoreVideoItem } from '../types';

export interface ParsedVideoSource {
  ok: true;
  source_type: 'mp4' | 'youtube' | 'upload';
  url: string;
  embed_url?: string;
}

export interface ParsedVideoError {
  ok: false;
  reason: string;
}

const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

export function extractYouTubeVideoId(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl.trim());
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();

    if (host === 'youtu.be') {
      const candidate = parsed.pathname.split('/').filter(Boolean)[0] ?? '';
      return YOUTUBE_ID_REGEX.test(candidate) ? candidate : null;
    }

    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      const vParam = parsed.searchParams.get('v');
      if (vParam && YOUTUBE_ID_REGEX.test(vParam)) return vParam;

      const segments = parsed.pathname.split('/').filter(Boolean);
      if (
        segments.length >= 2 &&
        (segments[0] === 'embed' || segments[0] === 'shorts' || segments[0] === 'live') &&
        YOUTUBE_ID_REGEX.test(segments[1])
      ) {
        return segments[1];
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Pure helper: validates & normalizes video URLs for Store TV Display.
 * Supports YouTube links, direct MP4/WebM/OGG URLs, and safe local object URLs.
 */
export function parseStoreVideoUrl(rawUrl: string): ParsedVideoSource | ParsedVideoError {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { ok: false, reason: 'URL video wajib diisi.' };
  }

  if (trimmed.startsWith('blob:')) {
    return { ok: true, source_type: 'upload', url: trimmed };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      ok: false,
      reason: 'Format URL tidak valid. Gunakan link https:// (MP4/WebM atau YouTube).',
    };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      ok: false,
      reason: 'Protokol URL tidak didukung. Gunakan tautan https:// atau http://.',
    };
  }

  const ytId = extractYouTubeVideoId(trimmed);
  if (ytId) {
    return {
      ok: true,
      source_type: 'youtube',
      url: trimmed,
      embed_url: `https://www.youtube.com/embed/${ytId}?autoplay=1&mute=1&loop=1&playlist=${ytId}&rel=0&modestbranding=1`,
    };
  }

  return {
    ok: true,
    source_type: 'mp4',
    url: trimmed,
  };
}

export const INITIAL_STORE_VIDEOS: StoreVideoItem[] = [
  {
    id: 'vid-coffee-espresso',
    title: 'Signature Espresso & Pour Over Showcase',
    subtitle: 'Promo Kopi Susu Gula Aren · Freshly Roasted Every Morning',
    source_type: 'mp4',
    url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
    is_active: true,
    show_promo_ticker: true,
    created_by_name: 'Budi Santoso',
    created_at: '2026-11-20T08:00:00.000Z',
  },
  {
    id: 'vid-artisan-ambience',
    title: 'BrewFlow Store Ambience & Seasonal Menu',
    subtitle: 'Daftar Member Baru — Dapatkan Bonus Poin & Promo Eksklusif',
    source_type: 'mp4',
    url: 'https://www.w3schools.com/html/mov_bbb.mp4',
    is_active: true,
    show_promo_ticker: true,
    created_by_name: 'Rina Wijaya',
    created_at: '2026-11-22T09:30:00.000Z',
  },
];
