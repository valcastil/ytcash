// Starts or refreshes a user's identity verification.
// Deploy:  supabase functions deploy kyc
import { createKycHandler } from '../_shared/handlers.ts';
import { createDb, loadEnv } from '../_shared/runtime.ts';

Deno.serve(createKycHandler(loadEnv(), createDb(), fetch));
