import { supabase } from '@/services/supabase';

// ─── Withdrawals ────────────────────────────────────────
// A request holds the money straight away. A reviewer then sends the payout by
// hand and marks it paid, or rejects it and the money returns to the wallet.
// All of that happens in database functions (section 12 of supabase/migration.sql).

export type WithdrawalMethod = 'gcash' | 'maya' | 'bank';
export type WithdrawalStatus = 'pending' | 'paid' | 'rejected' | 'cancelled';

export const WITHDRAWAL_METHODS: { value: WithdrawalMethod; label: string; numberLabel: string; placeholder: string }[] = [
  { value: 'gcash', label: 'GCash', numberLabel: 'GCASH MOBILE NUMBER', placeholder: '09XX XXX XXXX' },
  { value: 'maya', label: 'Maya', numberLabel: 'MAYA MOBILE NUMBER', placeholder: '09XX XXX XXXX' },
  { value: 'bank', label: 'Bank account', numberLabel: 'ACCOUNT NUMBER', placeholder: 'Account number' },
];

export interface Withdrawal {
  id: string;
  user_id: string;
  user_name: string;
  amount: number;
  fee: number;
  method: WithdrawalMethod;
  account_name: string;
  account_number: string;
  bank_name: string | null;
  status: WithdrawalStatus;
  payout_reference: string | null;
  admin_note: string | null;
  created_at: string;
  decided_at: string | null;
}

const COLUMNS =
  'id, user_id, user_name, amount, fee, method, account_name, account_number, bank_name, status, ' +
  'payout_reference, admin_note, created_at, decided_at';

const ERROR_MESSAGES: Record<string, string> = {
  NOT_SIGNED_IN: 'Please sign in again to continue.',
  WITHDRAWALS_DISABLED: 'Withdrawals are not available right now.',
  KYC_REQUIRED: 'Verify your identity before withdrawing. Open Account, then Identity Verification.',
  INVALID_AMOUNT: 'Enter an amount between ₱100 and ₱50,000.',
  INVALID_ACCOUNT: 'Check the account name and number.',
  TOO_MANY_PENDING: 'You already have 3 withdrawals waiting. Wait for one to finish or cancel it.',
  DAILY_LIMIT_REACHED: "You have reached today's withdrawal limit. Try again tomorrow.",
  INSUFFICIENT_BALANCE: 'Your wallet balance is too low for this amount.',
  WITHDRAWAL_NOT_OPEN: 'This withdrawal has already been handled.',
  REFERENCE_REQUIRED: 'Enter the reference number of the transfer you sent.',
  REASON_REQUIRED: 'Enter a short reason the user can act on.',
  NOT_ALLOWED: 'You do not have permission to do this.',
};

export function withdrawalErrorMessage(err: unknown): string {
  const raw = (err as { message?: string })?.message ?? '';
  const code = Object.keys(ERROR_MESSAGES).find((key) => raw.includes(key));
  if (code) return ERROR_MESSAGES[code];
  if (raw.includes('withdrawal') && (raw.includes('does not exist') || raw.includes('schema cache'))) {
    return 'Withdrawals are not set up on the server yet. Run supabase/migration.sql and try again.';
  }
  return raw || 'Something went wrong. Please try again.';
}

function toWithdrawal(row: any): Withdrawal {
  return { ...row, amount: Number(row.amount), fee: Number(row.fee) };
}

function single(data: any): any {
  return Array.isArray(data) ? data[0] : data;
}

export interface WithdrawalInput {
  amount: number;
  method: WithdrawalMethod;
  accountName: string;
  accountNumber: string;
  bankName?: string;
}

export async function requestWithdrawal(input: WithdrawalInput): Promise<Withdrawal> {
  const { data, error } = await supabase.rpc('wallet_request_withdrawal', {
    p_amount: input.amount,
    p_method: input.method,
    p_account_name: input.accountName,
    p_account_number: input.accountNumber,
    p_bank_name: input.method === 'bank' ? input.bankName ?? null : null,
  });
  if (error) throw error;
  return toWithdrawal(single(data));
}

export async function cancelWithdrawal(id: string): Promise<Withdrawal> {
  const { data, error } = await supabase.rpc('wallet_cancel_withdrawal', { p_id: id });
  if (error) throw error;
  return toWithdrawal(single(data));
}

export async function listMyWithdrawals(userId: string): Promise<Withdrawal[]> {
  const { data, error } = await supabase
    .from('withdrawal_requests')
    .select(COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw error;
  return (data ?? []).map(toWithdrawal);
}

// ─── Reviewer ───────────────────────────────────────────

export async function listPendingWithdrawals(): Promise<Withdrawal[]> {
  const { data, error } = await supabase
    .from('withdrawal_requests')
    .select(COLUMNS)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(50);
  if (error) throw error;
  return (data ?? []).map(toWithdrawal);
}

export async function markWithdrawalPaid(id: string, reference: string): Promise<Withdrawal> {
  const { data, error } = await supabase.rpc('wallet_review_withdrawal', {
    p_id: id,
    p_paid: true,
    p_reference: reference.trim(),
    p_note: null,
  });
  if (error) throw error;
  return toWithdrawal(single(data));
}

export async function rejectWithdrawal(id: string, reason: string): Promise<Withdrawal> {
  const { data, error } = await supabase.rpc('wallet_review_withdrawal', {
    p_id: id,
    p_paid: false,
    p_reference: null,
    p_note: reason.trim(),
  });
  if (error) throw error;
  return toWithdrawal(single(data));
}

// ─── Display helpers ────────────────────────────────────

export function methodLabel(w: Pick<Withdrawal, 'method' | 'bank_name'>): string {
  if (w.method === 'bank') return w.bank_name ?? 'Bank';
  return w.method === 'gcash' ? 'GCash' : 'Maya';
}

/** Shows only the last four digits, e.g. "•••• 4567". */
export function maskAccount(accountNumber: string): string {
  return `•••• ${accountNumber.slice(-4)}`;
}

export const WITHDRAWAL_STATUS_LABEL: Record<WithdrawalStatus, string> = {
  pending: 'Waiting for payout',
  paid: 'Paid',
  rejected: 'Rejected · refunded',
  cancelled: 'Cancelled · refunded',
};
