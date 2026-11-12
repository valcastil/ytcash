import { supabase } from '@/services/supabase';

// ─── KYC (identity verification) ────────────────────────
// A user is verified either automatically by Didit (ID + face match + liveness)
// or by a KYC admin reviewing uploaded photos. The verified flag itself can only
// be set by the server; see section 11 of supabase/migration.sql.

export const KYC_BUCKET = 'kyc-documents';

export type KycStatus = 'started' | 'pending_review' | 'approved' | 'declined' | 'expired';
export type KycMethod = 'didit' | 'manual';
export type KycDocumentType = 'passport' | 'national_id' | 'drivers_license' | 'other';
export type KycImageKind = 'front' | 'back' | 'selfie';

export const DOCUMENT_TYPES: { value: KycDocumentType; label: string; hasBack: boolean }[] = [
  { value: 'national_id', label: 'National ID', hasBack: true },
  { value: 'passport', label: 'Passport', hasBack: false },
  { value: 'drivers_license', label: "Driver's license", hasBack: true },
  { value: 'other', label: 'Other government ID', hasBack: true },
];

export interface KycVerification {
  id: string;
  user_id: string;
  method: KycMethod;
  status: KycStatus;
  legal_name: string | null;
  date_of_birth: string | null;
  document_type: KycDocumentType | null;
  id_front_path: string | null;
  id_back_path: string | null;
  selfie_path: string | null;
  review_note: string | null;
  /** Result came from the provider's test mode (simulated). */
  is_test: boolean;
  created_at: string;
  submitted_at: string | null;
  decided_at: string | null;
}

const COLUMNS =
  'id, user_id, method, status, legal_name, date_of_birth, document_type, id_front_path, ' +
  'id_back_path, selfie_path, review_note, is_test, created_at, submitted_at, decided_at';

export type KycStartResult =
  | { mode: 'didit'; sessionToken: string; url: string; test: boolean }
  /** Use the in-app manual submission. `reason` says why Didit was not used. */
  | { mode: 'manual'; reason: string }
  | { mode: 'verified' };

const ERROR_MESSAGES: Record<string, string> = {
  NOT_SIGNED_IN: 'Please sign in again to continue.',
  ALREADY_VERIFIED: 'Your identity is already verified.',
  ALREADY_SUBMITTED: 'Your documents are already being reviewed.',
  TOO_MANY_ATTEMPTS: 'You have reached the limit for today. Please try again tomorrow.',
  MANUAL_KYC_DISABLED: 'Verification is temporarily unavailable. Please try again later.',
  KYC_UNAVAILABLE: 'Verification is temporarily unavailable. Please try again later.',
  VERIFICATION_NOT_OPEN: 'This submission has already been handled.',
  INVALID_DETAILS: 'Check your name, date of birth and ID type. You must be 18 or older.',
  MISSING_DOCUMENTS: 'A photo is missing. Retake the photos and try again.',
  REASON_REQUIRED: 'Enter a short reason the user can act on.',
  NOT_ALLOWED: 'You do not have permission to do this.',
};

export function kycErrorMessage(err: unknown): string {
  const raw = (err as { message?: string })?.message ?? '';
  const code = Object.keys(ERROR_MESSAGES).find((key) => raw.includes(key));
  if (code) return ERROR_MESSAGES[code];
  if (raw.includes('kyc_') && (raw.includes('does not exist') || raw.includes('schema cache'))) {
    return 'Verification is not set up on the server yet. Run supabase/migration.sql and try again.';
  }
  return raw || 'Something went wrong. Please try again.';
}

function firstRow<T>(data: T | T[] | null): T | null {
  return (Array.isArray(data) ? data[0] : data) ?? null;
}

// ─── Starting a verification ────────────────────────────

/**
 * Asks the server how this user should verify. The server prefers Didit and answers
 * "manual" when Didit is not set up, has run out of free checks, or is unreachable.
 * If the server function itself is not deployed yet, manual review is used.
 */
export async function startKyc(): Promise<KycStartResult> {
  const { data, error } = await supabase.functions.invoke('kyc', { body: { action: 'start' } });

  if (error) {
    const status: number | undefined = (error as any)?.context?.status;
    if (status === 404) return { mode: 'manual', reason: 'not_deployed' };
    if (status === 429) throw new Error('TOO_MANY_ATTEMPTS');
    if (status === 503) throw new Error('KYC_UNAVAILABLE');
    if (status === 401) throw new Error('NOT_SIGNED_IN');
    throw new Error('We could not reach the verification service. Check your connection and try again.');
  }

  if (data?.mode === 'didit' && typeof data.session_token === 'string' && typeof data.url === 'string') {
    return { mode: 'didit', sessionToken: data.session_token, url: data.url, test: data.test === true };
  }
  if (data?.mode === 'verified') return { mode: 'verified' };
  return { mode: 'manual', reason: typeof data?.reason === 'string' ? data.reason : 'unknown' };
}

/** Asks the server to re-check undecided Didit sessions (covers a missed result). */
export async function refreshKyc(): Promise<void> {
  await supabase.functions.invoke('kyc', { body: { action: 'refresh' } }).catch(() => null);
}

export async function getLatestVerification(userId: string): Promise<KycVerification | null> {
  const { data, error } = await supabase
    .from('kyc_verifications')
    .select(COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as KycVerification) ?? null;
}

// ─── Manual submission ──────────────────────────────────

export async function startManualKyc(): Promise<KycVerification> {
  const { data, error } = await supabase.rpc('kyc_start_manual');
  if (error) throw error;
  return firstRow<KycVerification>(data)!;
}

function base64ToBytes(base64: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let out = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = alphabet.indexOf(clean[i]);
    const b = alphabet.indexOf(clean[i + 1]);
    const c = i + 2 < clean.length ? alphabet.indexOf(clean[i + 2]) : -1;
    const d = i + 3 < clean.length ? alphabet.indexOf(clean[i + 3]) : -1;
    bytes[out++] = (a << 2) | (b >> 4);
    if (c >= 0) bytes[out++] = ((b & 15) << 4) | (c >> 2);
    if (d >= 0) bytes[out++] = ((c & 3) << 6) | d;
  }
  return bytes.subarray(0, out);
}

/**
 * Uploads one photo into the user's private folder and returns its storage path.
 * Files cannot be replaced once uploaded, so each upload gets a new name.
 */
export async function uploadKycImage(
  userId: string,
  verificationId: string,
  kind: KycImageKind,
  base64Jpeg: string,
): Promise<string> {
  const path = `${userId}/${verificationId}/${kind}-${Date.now()}.jpg`;
  const { error } = await supabase.storage
    .from(KYC_BUCKET)
    .upload(path, base64ToBytes(base64Jpeg), { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  return path;
}

export interface ManualSubmission {
  verificationId: string;
  legalName: string;
  /** YYYY-MM-DD */
  dateOfBirth: string;
  documentType: KycDocumentType;
  idFrontPath: string;
  idBackPath: string | null;
  selfiePath: string;
}

export async function submitManualKyc(input: ManualSubmission): Promise<KycVerification> {
  const { data, error } = await supabase.rpc('kyc_submit_manual', {
    p_verification_id: input.verificationId,
    p_legal_name: input.legalName,
    p_date_of_birth: input.dateOfBirth,
    p_document_type: input.documentType,
    p_id_front_path: input.idFrontPath,
    p_id_back_path: input.idBackPath,
    p_selfie_path: input.selfiePath,
  });
  if (error) throw error;
  return firstRow<KycVerification>(data)!;
}

// ─── Admin review ───────────────────────────────────────

export async function isKycAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('kyc_is_admin');
  return !error && data === true;
}

export async function listPendingReviews(): Promise<KycVerification[]> {
  const { data, error } = await supabase
    .from('kyc_verifications')
    .select(COLUMNS)
    .eq('method', 'manual')
    .eq('status', 'pending_review')
    .order('submitted_at', { ascending: true })
    .limit(50);
  if (error) throw error;
  return (data as unknown as KycVerification[]) ?? [];
}

export async function getVerification(id: string): Promise<KycVerification | null> {
  const { data, error } = await supabase
    .from('kyc_verifications')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as KycVerification) ?? null;
}

/** Short-lived links to a submission's photos. Only KYC admins can create these. */
export async function getDocumentUrls(
  verification: KycVerification,
): Promise<Partial<Record<KycImageKind, string>>> {
  const wanted: [KycImageKind, string | null][] = [
    ['front', verification.id_front_path],
    ['back', verification.id_back_path],
    ['selfie', verification.selfie_path],
  ];
  const urls: Partial<Record<KycImageKind, string>> = {};
  for (const [kind, path] of wanted) {
    if (!path) continue;
    const { data } = await supabase.storage.from(KYC_BUCKET).createSignedUrl(path, 300);
    if (data?.signedUrl) urls[kind] = data.signedUrl;
  }
  return urls;
}

export async function reviewVerification(id: string, approve: boolean, note?: string) {
  const { data, error } = await supabase.rpc('kyc_review', {
    p_verification_id: id,
    p_approve: approve,
    p_note: note?.trim() || null,
  });
  if (error) throw error;
  return firstRow<KycVerification>(data);
}

// ─── Display helpers ────────────────────────────────────

export function documentTypeLabel(type: KycDocumentType | null): string {
  return DOCUMENT_TYPES.find((d) => d.value === type)?.label ?? 'ID';
}

/** Accepts YYYY-MM-DD and checks it is a real date at least 18 years ago. */
export function validateDateOfBirth(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return 'Enter your date of birth as YYYY-MM-DD.';
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return 'That date does not exist.';
  }
  const eighteen = new Date();
  eighteen.setFullYear(eighteen.getFullYear() - 18);
  if (year < 1900 || date > eighteen) return 'You must be 18 or older to verify.';
  return null;
}
