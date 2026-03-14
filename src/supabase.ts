import { createClient } from '@supabase/supabase-js';
import { config } from './config';

// Supabase 클라이언트 초기화
// URL과 Anon Key가 설정되지 않은 경우 클라이언트는 생성되지만 요청은 실패합니다.
export const supabase = createClient(
  config.supabaseUrl,
  config.supabaseAnonKey
);

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
