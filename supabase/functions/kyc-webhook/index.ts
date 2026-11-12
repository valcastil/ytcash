// Receives verification results from Didit.
// Didit cannot send a Supabase JWT, so deploy without JWT checks; every request
// is authenticated by its HMAC signature instead:
//   supabase functions deploy kyc-webhook --no-verify-jwt
import { createWebhookHandler } from '../_shared/handlers.ts';
import { createDb, loadEnv } from '../_shared/runtime.ts';

Deno.serve(createWebhookHandler(loadEnv(), createDb(), () => Math.floor(Date.now() / 1000)));
