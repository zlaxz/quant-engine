import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

// Debug logging
console.log('[Supabase] URL configured:', !!supabaseUrl, supabaseUrl?.substring(0, 30));
console.log('[Supabase] Key configured:', !!supabaseAnonKey, supabaseAnonKey?.substring(0, 20));

// Simple direct initialization
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key'
);

// Test connection on load
supabase.from('workspaces').select('id').limit(1).then(({ data, error }) => {
  if (error) {
    console.error('[Supabase] Connection test FAILED:', error.message);
  } else {
    console.log('[Supabase] Connection test SUCCESS, found workspace:', data?.[0]?.id);
  }
});
