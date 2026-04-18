import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL
  ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  ?? process.env.SUPABASE_URL

const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY
  ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ?? process.env.SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabaseAnon) {
  console.warn(
    'Supabase credentials missing. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in .env.local'
  )
}

/**
 * Supabase client (browser-side, uses anon/publishable key).
 * Auth tokens are managed automatically via Supabase Auth.
 * RLS policies enforce row-level access — no manual ownership checks needed.
 */
export const supabase = createClient(supabaseUrl, supabaseAnon, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
})

export default supabase
