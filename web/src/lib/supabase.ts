import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Public anon credentials (safe to ship). Override via VITE_* envs in prod.
const URL = import.meta.env.VITE_SUPABASE_URL || 'https://seolaotjqmyrtujehbfo.supabase.co';
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_XP4UxVBA0H9jNxcdtO9LUQ_ra8dln8n';

export const supabase: SupabaseClient = createClient(URL, ANON, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const IS_LOCAL = ['localhost', '127.0.0.1'].includes(window.location.hostname);
