import { createClient } from '@supabase/supabase-js';
import { config } from './config';

// Supabase 클라이언트 초기화
export const supabase = createClient(
  config.supabaseUrl || '',
  config.supabaseAnonKey || ''
);

/**
 * Supabase 설정 여부 확인
 */
export const isSupabaseConfigured = Boolean(
  config.supabaseUrl && 
  config.supabaseAnonKey &&
  config.supabaseUrl !== 'your-supabase-url'
);
