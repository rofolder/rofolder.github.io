import { createClient } from '@supabase/supabase-js';
import { config } from './config';

// Supabase 설정 유효성 검사
const isSupabaseConfigured = Boolean(config.supabaseUrl && config.supabaseAnonKey && config.supabaseUrl !== 'https://your-project-id.supabase.co');

// Supabase 클라이언트 초기화
// 설정이 없으면 null을 반환하여 사이트 전체가 멈추는 것을 방지합니다.
export const supabase = isSupabaseConfigured 
  ? createClient(config.supabaseUrl, config.supabaseAnonKey)
  : null as any; // 타입 호환성을 위해 any 사용

export { isSupabaseConfigured };

// 데이터베이스 테이블 타입 정의 (필요시 상세화)
export type Tables = {
  servers: {
    Row: {
      id: number;
      name: string;
      category: string;
      description: string;
      icon: string;
      tags: string[];
      invite_link: string;
      status: 'approved' | 'pending' | 'rejected';
      created_at: string;
      approved_at: string | null;
      rejection_reason: string | null;
      recommendations: number;
      clicks: number;
    };
    Insert: Omit<Tables['servers']['Row'], 'created_at'> & { created_at?: string };
    Update: Partial<Tables['servers']['Row']>;
  };
  logs: {
    Row: {
      id: string;
      timestamp: string;
      type: 'admin' | 'user';
      action: string;
      user_agent: string;
      screen: string;
      details: string | null;
    };
    Insert: Omit<Tables['logs']['Row'], 'id'>;
  };
};
