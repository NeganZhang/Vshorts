# VSHORT — Supabase Setup Guide

## Prerequisites

- A Supabase project (already created)
- Node.js 18+

---

## Step 1: Run the Schema SQL

1. Open your Supabase Dashboard: https://supabase.com/dashboard
2. Go to **SQL Editor** (left sidebar)
3. Click **New query**
4. Copy-paste the entire contents of `supabase/schema.sql`
5. Click **Run** (or Ctrl+Enter)

This creates:
- 3 enums (`subscription_plan`, `subscription_status`, `job_status`)
- 7 tables (`profiles`, `subscriptions`, `projects`, `scripts`, `scenes`, `clips`, `edit_jobs`)
- Indexes on all foreign keys
- RLS policies on every table (users can only access their own data)
- Trigger: auto-creates `profiles` + `subscriptions` row on user signup
- Trigger: auto-updates `updated_at` timestamps

---

## Step 2: Verify the Tables

After running the SQL:
1. Go to **Table Editor** in the dashboard
2. You should see all 7 tables listed
3. Click on `profiles` → should be empty (no users yet)

---

## Step 3: Get Your Keys

Your `.env.local` is already configured with:
```
SUPABASE_URL=https://seolaotjqmyrtujehbfo.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_XP4UxVBA0H9jNxcdtO9LUQ_ra8dln8n
```

If you need the **service role key** (for server-side Stripe webhooks):
1. Go to **Settings → API**
2. Copy the `service_role` key (keep this secret!)
3. Add to `.env.local`:
   ```
   SUPABASE_SERVICE_ROLE_KEY=eyJ...
   ```

---

## Step 4: Enable Email Auth

1. Go to **Authentication → Providers**
2. Make sure **Email** is enabled
3. (Optional) Disable "Confirm email" for faster dev testing:
   - Authentication → Settings → toggle off "Enable email confirmations"

---

## Step 5: Test the Signup Trigger

1. Go to **Authentication → Users**
2. Click **Add user** → enter a test email/password
3. Go to **Table Editor → profiles** → should have a new row with that user's ID
4. Go to **Table Editor → subscriptions** → should have a row with `plan = 'free'`

If both rows appear, the trigger is working.

---

## Step 6: (Optional) Set Up Stripe

To enable paid subscriptions:
1. Create products + prices in Stripe Dashboard
2. Add to `.env.local`:
   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   STRIPE_PRO_PRICE_ID=price_...
   STRIPE_UNLIMITED_PRICE_ID=price_...
   ```
3. Set up Stripe webhook endpoint pointing to `/api/webhooks/stripe`

---

## File Map

```
supabase/schema.sql    ← Run this in SQL Editor (Step 1)
src/lib/supabase.js    ← Supabase client (import in your app)
.env.local             ← Your credentials (already filled)
```

---

## What's Next

After setup, you can start replacing the Express API calls in `public/js/api.js` with direct Supabase client calls:

```js
import supabase from '../src/lib/supabase.js'

// Auth
const { data } = await supabase.auth.signUp({ email, password })
const { data } = await supabase.auth.signInWithPassword({ email, password })

// CRUD (RLS enforces ownership automatically)
const { data } = await supabase.from('projects').select('*')
const { data } = await supabase.from('projects').insert({ name, user_id: user.id })
const { data } = await supabase.from('scripts').select('*').eq('project_id', pid)
```

No need for manual auth headers or ownership middleware — Supabase handles it all via RLS.
