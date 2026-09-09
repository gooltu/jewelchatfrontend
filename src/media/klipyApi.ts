import type { PickerMediaItem } from '@components/design-system';
import { env } from '@config/env';

/** Klipy (klipy.com) GIF/sticker API. Response shape: `{ result, data: { data:
 * [...], current_page, per_page, has_next } }`, each item `{ id, slug,
 * title, type, file: { hd/md/sm/xs: { gif?, webp?, jpg?, png?, mp4?, webm? } },
 * tags }`. Stickers carry `png` where GIFs carry `jpg` in `file.hd`, but both
 * also carry `gif` — always send the `.gif` variant so `MessageBubble`
 * renders every sticker/GIF the same way (a remote `Image` URI streamed
 * straight from Klipy's CDN, nothing downloaded or cached locally). */

const BASE_URL = 'https://api.klipy.com/api/v1';

type MediaKind = 'gifs' | 'stickers';

interface KlipyFileVariant {
  url: string;
  width: number;
  height: number;
}

interface KlipyFileSizeTier {
  gif?: KlipyFileVariant;
  webp?: KlipyFileVariant;
  jpg?: KlipyFileVariant;
  png?: KlipyFileVariant;
  mp4?: KlipyFileVariant;
  webm?: KlipyFileVariant;
}

interface KlipyItem {
  id: number;
  slug: string;
  title: string;
  type: string;
  file: {
    hd: KlipyFileSizeTier;
    md: KlipyFileSizeTier;
    sm: KlipyFileSizeTier;
    xs: KlipyFileSizeTier;
  };
}

interface KlipyResponse {
  result: boolean;
  data: {
    data: KlipyItem[];
    current_page: number;
    per_page: number;
    has_next: boolean;
  };
}

function mapItem(item: KlipyItem): PickerMediaItem {
  const preview = item.file.sm?.webp ?? item.file.sm?.gif ?? item.file.hd.webp;
  const full = item.file.hd.gif ?? item.file.hd.webp;
  const fallback = preview ?? full;
  if (!fallback) {
    throw new Error(`Klipy item ${item.id} has no usable image variant`);
  }
  return {
    id: item.id,
    previewUri: (preview ?? fallback).url,
    fullUri: (full ?? fallback).url,
  };
}

async function fetchMedia(kind: MediaKind, query: string): Promise<PickerMediaItem[]> {
  if (!env.klipyApiKey) {
    throw new Error('Missing EXPO_PUBLIC_KLIPY_API_KEY — set it before using stickers/GIFs');
  }
  const trimmed = query.trim();
  const endpoint = trimmed ? 'search' : 'trending';
  const params = new URLSearchParams({ per_page: '30' });
  if (trimmed) params.set('q', trimmed);

  const response = await fetch(`${BASE_URL}/${env.klipyApiKey}/${kind}/${endpoint}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Klipy request failed (${response.status})`);
  }
  const json: KlipyResponse = await response.json();
  if (!json.result) {
    throw new Error('Klipy request was not successful');
  }
  return json.data.data.map(mapItem);
}

/** `query === ''` returns trending GIFs; otherwise searches. */
export function fetchGifs(query: string): Promise<PickerMediaItem[]> {
  return fetchMedia('gifs', query);
}

/** `query === ''` returns trending stickers; otherwise searches. */
export function fetchStickers(query: string): Promise<PickerMediaItem[]> {
  return fetchMedia('stickers', query);
}
