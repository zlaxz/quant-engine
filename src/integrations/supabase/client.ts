import { createClient } from '@supabase/supabase-js';

// IMPORTANT: Set these environment variables in your .env file:
// VITE_SUPABASE_URL=your_supabase_project_url
// VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  const errorMsg = '❌ Missing Supabase environment variables. Please set:\n' +
    '   VITE_SUPABASE_URL\n' +
    '   VITE_SUPABASE_PUBLISHABLE_KEY\n' +
    'in your .env file';
  console.error(errorMsg);
  throw new Error(errorMsg);
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
