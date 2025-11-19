import { createClient } from '@supabase/supabase-js';

// IMPORTANT: Set these environment variables in your .env.local file:
// VITE_SUPABASE_URL=your_supabase_project_url
// VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    '❌ Missing Supabase environment variables. Please set:\n' +
    '   VITE_SUPABASE_URL\n' +
    '   VITE_SUPABASE_ANON_KEY\n' +
    'in your .env.local file'
  );
}

export const supabase = createClient(
  supabaseUrl || '',
  supabaseAnonKey || ''
);
