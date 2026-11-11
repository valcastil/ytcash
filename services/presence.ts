// ─── Online presence helpers ────────────────────────────
// Presence is carried over a private Supabase Realtime channel (no table needed).
// Everything another client sends is treated as untrusted and validated here.

export const ONLINE_CHANNEL = 'online-users';

/**
 * Coordinates are rounded before they ever leave the device.
 * 2 decimal places ≈ 1.1 km, so a pin shows a neighbourhood, never an address.
 */
export const LOCATION_DECIMALS = 2;

const MAX_NAME_LENGTH = 24;

/** What each device announces about itself on the presence channel. */
export interface PresencePayload {
  user_id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  online_at: string;
  platform: string;
}

/** A validated, de-duplicated online user (one entry per account). */
export interface OnlineUser {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  onlineAt: string;
}

export interface Coords {
  lat: number;
  lng: number;
}

export function roundCoord(value: number): number {
  const factor = 10 ** LOCATION_DECIMALS;
  return Math.round(value * factor) / factor;
}

export function roundCoords(lat: number, lng: number): Coords {
  return { lat: roundCoord(lat), lng: roundCoord(lng) };
}

/** Only the first name is shared with other users — never email or phone. */
export function publicDisplayName(fullName: string | null | undefined): string {
  const first = (fullName ?? '').trim().split(/\s+/)[0] ?? '';
  return first.slice(0, MAX_NAME_LENGTH) || 'YTCash user';
}

function validCoord(value: unknown, limit: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit
    ? value
    : null;
}

function cleanName(value: unknown): string {
  if (typeof value !== 'string') return 'YTCash user';
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH) || 'YTCash user';
}

/**
 * Turns the raw presence state ({ key: [meta, ...] }) into a clean list.
 * A user signed in on several devices appears once, using their newest entry.
 */
export function parsePresenceState(state: Record<string, unknown>): OnlineUser[] {
  const users: OnlineUser[] = [];

  for (const [key, metas] of Object.entries(state)) {
    if (!Array.isArray(metas) || metas.length === 0) continue;

    let newest: Record<string, unknown> | null = null;
    for (const meta of metas) {
      if (!meta || typeof meta !== 'object') continue;
      const candidate = meta as Record<string, unknown>;
      if (!newest || String(candidate.online_at ?? '') > String(newest.online_at ?? '')) {
        newest = candidate;
      }
    }
    if (!newest) continue;

    const lat = validCoord(newest.lat, 90);
    const lng = validCoord(newest.lng, 180);
    const hasLocation = lat !== null && lng !== null;

    users.push({
      id: key,
      name: cleanName(newest.name),
      // Re-round on receipt so a modified client cannot publish a precise position.
      lat: hasLocation ? roundCoord(lat) : null,
      lng: hasLocation ? roundCoord(lng) : null,
      onlineAt: typeof newest.online_at === 'string' ? newest.online_at : '',
    });
  }

  return users.sort((a, b) => a.name.localeCompare(b.name));
}
