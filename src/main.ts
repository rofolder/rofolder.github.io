// RoFolder Site - Premium Discord Community Hub (v2.1.0)
// Optimized for Real-time Synchronization and Security
interface DiscordServer {
  id: number;
  name: string;
  category: string;
  description: string;
  icon: string;
  tags: string[];
  inviteLink: string;
  status: 'approved' | 'pending' | 'rejected';
  createdAt?: number; // 등록 요청 시간 (타임스탐프)
  approvedAt?: number; // 승인 시간
  rejectionReason?: string; // 거절 사유
  recommendations?: number; // 추천 수
  clicks?: number; // 클릭 수
  isPartner?: boolean; // 파트너 서버 여부
}

interface AdminStats {
  totalPending: number;
  totalApproved: number;
  totalRejected: number;
  lastUpdated: number;
}

import { config } from './config';
import {
  escapeHtml,
  sanitizeDiscordText,
  hasAdminAccess,
  setAdminToken,
  validateServerData,
} from './security';
import { supabase, isSupabaseConfigured } from './supabase';
import {
  getCurrentIP,
  isIPApproved,
  sendIPApprovalEmail,
  handleIPApprovalCallback,
} from './admin-auth';

// 데이터 관리 (LocalStorage 및 JSON 파일 연동)
const STORAGE_KEY = 'rofolder_servers_v2'; // 버전을 올려서 충돌 방지
const JSON_DATA_URL = '/servers.json';

let serverSubscription: any = null;

async function loadServersFromJSON(): Promise<DiscordServer[]> {
  try {
    const response = await fetch(JSON_DATA_URL + '?t=' + Date.now()); // 캐시 무시
    if (!response.ok) {
      return [];
    }
    const data = await response.json();
    return data.servers || [];
  } catch (e) {
    console.log('JSON 파일 로드 불가, 로컬스토리지 사용');
    return [];
  }
}

async function loadServersFromDB(): Promise<DiscordServer[]> {
  if (!isSupabaseConfigured) return [];
  try {
    const { data, error } = await supabase
      .from('servers')
      .select('*');

    if (error) throw error;
    
    console.log(`📡 [Supabase Query] 진행 완료 (결과 수: ${data?.length || 0})`);
    
    // DB 데이터를 DiscordServer 형식으로 매핑
    return (data || []).map((s: any) => ({
      id: Number(s.id),
      name: s.name,
      category: s.category,
      description: s.description,
      icon: s.icon,
      tags: s.tags || [],
      inviteLink: s.invite_link,
      status: s.status,
      createdAt: s.created_at ? new Date(s.created_at).getTime() : (typeof s.id === 'number' && s.id > 1000000000000 ? s.id : Date.now()),
      approvedAt: s.approved_at ? new Date(s.approved_at).getTime() : undefined,
      rejectionReason: s.rejection_reason,
      recommendations: s.recommendations || 0,
      clicks: s.clicks || 0,
      isPartner: s.is_partner || false
    }));
  } catch (e) {
    console.error('Supabase 데이터 로드 실패:', e);
    return [];
  }
}

async function startRealTimePolling() {
  if (!isSupabaseConfigured || serverSubscription) return;
  
  console.log('📡 [Supabase] 실시간 동기화 시작...');
  
  serverSubscription = supabase
    .channel('servers-changes')
    .on('postgres_changes' as any, { event: '*', table: 'servers', schema: 'public' }, async (payload: any) => {
      console.log('🔄 [Supabase] 데이터 변경 감지:', payload.eventType);
      
      const newServers = await loadServers();
      if (newServers) {
        servers = newServers;
        applyFilters();
        refreshAdminDashboardIfOpen();
        
        // 실시간 갱신 시 간단한 알림 (이미 승인된 것만 등)
        if (payload.eventType === 'INSERT' && payload.new?.status === 'approved') {
          showToast('🔔 새로운 서버가 추가되었습니다!', 'info');
        }
      }
    })
    .subscribe((status) => {
      console.log('📡 [Supabase] 실시간 상태:', status);
    });

  // 백업 시스템 가동 (1시간 주기)
  checkAndRunBackup();
  setInterval(checkAndRunBackup, 60 * 60 * 1000);
  
  // Supabase 실시간 동기화 (마이그레이션 완료)
}

function stopRealTimePolling() {
  if (serverSubscription) {
    serverSubscription = null;
    console.log('⛔ 실시간 동기화 중지됨');
  }
}

// @ts-ignore - 향후 필요시 사용
function _unused_stopRealTimePolling() {
  stopRealTimePolling();
}

function loadServersFromLocal(): DiscordServer[] {
  // [강력 복구] 로컬 스토리지의 모든 키를 전수 조사하여 서버 데이터 탐색
  console.log('🔍 [Recovery] 데이터 전수 조사 시작...');
  const foundServers: DiscordServer[] = [];
  
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    
    try {
      const raw = localStorage.getItem(key);
      if (!raw || !raw.startsWith('[')) continue; // 배열 형태만 확인
      
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].name && (parsed[0].inviteLink || parsed[0].invite_link)) {
        console.log(`✨ [Found] '${key}' 키에서 ${parsed.length}개의 서버 데이터 발견!`);
        
        parsed.forEach((s: any) => {
          // 데이터 형식 표준화
          const normalized: DiscordServer = {
            id: s.id || Math.floor(Math.random() * 1000000),
            name: s.name,
            category: s.category || '기타',
            description: s.description || '',
            icon: s.icon || '',
            tags: s.tags || [],
            inviteLink: s.inviteLink || s.invite_link || '',
            status: s.status || 'pending',
            recommendations: s.recommendations || 0,
            clicks: s.clicks || 0,
            isPartner: s.isPartner || s.is_partner || false
          };
          
          if (!foundServers.some(fs => fs.name === normalized.name)) {
            foundServers.push(normalized);
          }
        });
      }
    } catch (e) {
      // 파싱 실패는 무시
    }
  }

  if (foundServers.length > 0) {
    console.log(`📦 [Migration] 총 ${foundServers.length}개의 서버를 복구하여 v2로 병합합니다.`);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(foundServers));
    return foundServers;
  }
  
  return [];
}

async function loadServers(): Promise<DiscordServer[]> {
  // 1. Supabase에서 먼저 로드 시도
  try {
    const dbServers = await loadServersFromDB();
    if (dbServers && dbServers.length > 0) {
      console.log(`🌐 [DB] ${dbServers.length}개의 서버 로드 성공`);
      // 최신순으로 정렬 (createdAt 내림차순)
      dbServers.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      saveServersToLocal(dbServers);
      return dbServers;
    }
  } catch (e) {
    console.error('Supabase 로드 실패:', e);
  }

  // 2. 실패 시 로컬스토리지 시도
  const saved = loadServersFromLocal();
  if (saved && saved.length > 0) {
    console.log(`📂 [Local] ${saved.length}개의 로컬 데이터 복구`);
    return saved;
  }
  
  // 3. 마지막으로 JSON 파일 시도 (기본 데이터 소진 시)
  const jsonServers = await loadServersFromJSON();
  if (jsonServers.length > 0) {
    console.log('📄 [JSON] 기본 데이터 로드');
    return jsonServers;
  }
  
  console.log('⚠️ [Data] 로드할 수 있는 서버 데이터가 없습니다.');
  return [];
}

async function saveServers() {
  // 로컬 저장
  saveServersToLocal(servers);
  
  // Supabase 동기화 (관리자 동작 등에서만 주로 수동 호출됨)
  // 개별 동작(승인/거절/추가)에서 각각 DB 업데이트를 수행하도록 변경할 예정입니다.
}

function saveServersToLocal(data: DiscordServer[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

async function syncServerToDB(server: DiscordServer) {
  if (!isSupabaseConfigured) return;
  try {
    const updateDoc: any = {
      id: server.id,
      name: server.name,
      category: server.category,
      description: server.description,
      icon: server.icon,
      tags: server.tags,
      invite_link: server.inviteLink,
      status: server.status,
      created_at: server.createdAt ? new Date(server.createdAt) : new Date(),
      approved_at: server.approvedAt ? new Date(server.approvedAt) : null,
      rejection_reason: server.rejectionReason,
      recommendations: server.recommendations || 0,
      clicks: server.clicks || 0,
      is_partner: server.isPartner || false,
      updated_at: new Date()
    };

    const { error } = await supabase
      .from('servers')
      .upsert(updateDoc);

    if (error) throw error;
    console.log(`✅ [Supabase Sync] 완료 (ID: ${server.id})`);
  } catch (e) {
    console.error('❌ [Supabase Sync] 실패:', e);
    // 개별 동기화 실패 시 알림은 일괄 동기화 시 소음이 될 수 있으므로 생략하거나 상세 로깅
  }
}

/**
 * [Batch] 현재 로컬/JSON에 있는 모든 서버를 SQL로 일괄 동기화
 */
async function syncAllServersToDB(silent = false) {
  if (!isSupabaseConfigured || servers.length === 0) return;
  
  if (!silent) {
    const confirmed = await showConfirm(`현재 사이트에 표시된 ${servers.length}개의 서버를\n데이터베이스(SQL)와 동기화하시겠습니까?`);
    if (!confirmed) return;
  }

  showToast('💾 SQL 동기화 시작...', 'info');
  
  let successCount = 0;
  for (const server of servers) {
    try {
      // syncServerToDB가 이미 upsert 방식이므로 안전합니다.
      await syncServerToDB(server);
      successCount++;
    } catch (e) {
      console.error(`[Sync Fail] ID: ${server.id}`, e);
    }
  }

  showToast(`✅ 동기화 완료 (${successCount}/${servers.length}개 성공)`, 'success');
  console.log(`🚀 [Migration] SQL 동기화 완료: ${successCount}/${servers.length}`);
}

// ========== 추천 시스템 관련 상수 및 유저 ID 함수 ==========
const USER_ID_KEY = 'user_id_v1';

// 고유 사용자 ID 생성/가져오기
function getUserId(): string {
  let userId = localStorage.getItem(USER_ID_KEY);
  if (!userId) {
    userId = `user_${Math.random().toString(36).substr(2, 9)}_${Date.now()}`;
    localStorage.setItem(USER_ID_KEY, userId);
  }
  return userId;
}

// ========== 프리미엄 피드백 시스템 ==========

// 커스텀 팝업(Toast) 시스템
function showToast(message: string, type: 'success' | 'error' | 'info' = 'info', center = false) {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast-message ${type} ${center ? 'center' : ''}`;
  
  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  
  if (center) {
    document.body.appendChild(toast);
  } else {
    container.appendChild(toast);
  }

  setTimeout(() => {
    toast.style.animation = center ? 'toastFadeInCenter 0.4s reverse forwards' : 'toastSlideOut 0.5s forwards';
    setTimeout(() => toast.remove(), 500);
  }, 3000);
}

// 기존 alert 대체용 커스텀 대화상자 (confirm용)
async function showConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '10001';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    
    const box = document.createElement('div');
    box.className = 'modal-box glass liquid-glass';
    box.style.maxWidth = '400px';
    box.style.textAlign = 'center';
    box.style.padding = '2.5rem';
    box.style.margin = '0 auto';
    
    box.innerHTML = `
      <h3 style="margin-bottom: 2rem; font-size: 1.3rem; line-height: 1.6;">${message.replace('\n', '<br>')}</h3>
      <div style="display: flex; gap: 1rem; justify-content: center;">
        <button id="confirm-yes" class="submit-button" style="flex: 1; background: var(--accent-color);">확인</button>
        <button id="confirm-no" class="submit-button" style="flex: 1; background: #374151;">취소</button>
      </div>
    `;
    
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    
    box.querySelector('#confirm-yes')!.addEventListener('click', () => { overlay.remove(); resolve(true); });
    box.querySelector('#confirm-no')!.addEventListener('click', () => { overlay.remove(); resolve(false); });
  });
}

// 커스텀 프롬프트 모달 (prompt() 대체)
async function showPromptModal(message: string, placeholder = ''): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'z-index:10001;display:flex;align-items:center;justify-content:center;';
    const box = document.createElement('div');
    box.className = 'modal-box glass liquid-glass';
    box.style.cssText = 'max-width:420px;width:90%;text-align:left;padding:2rem;';
    box.innerHTML = `
      <h3 style="margin:0 0 1.2rem;font-size:1.15rem;line-height:1.6;color:var(--text-primary);">${message}</h3>
      <input id="prompt-input" type="text" class="form-input" placeholder="${placeholder}" style="width:100%;box-sizing:border-box;margin-bottom:1.5rem;">
      <div style="display:flex;gap:1rem;justify-content:flex-end;">
        <button id="prompt-cancel" class="submit-button" style="background:#374151;padding:0.6rem 1.5rem;">취소</button>
        <button id="prompt-ok" class="submit-button" style="padding:0.6rem 1.5rem;">확인</button>
      </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    const input = box.querySelector('#prompt-input') as HTMLInputElement;
    input.focus();
    const ok = () => { overlay.remove(); resolve(input.value.trim() || null); };
    const cancel = () => { overlay.remove(); resolve(null); };
    box.querySelector('#prompt-ok')!.addEventListener('click', ok);
    box.querySelector('#prompt-cancel')!.addEventListener('click', cancel);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') cancel(); });
  });
}

// 이미지 파일을 Base64로 변환 (홍보 신청 시 사용) - PNG 포맷으로 강제 변환 및 리사이징 적용
export function convertImageToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxSize = 256; // 디스코드 썸네일 및 DB 용량 최적화를 위해 256px
        if (width > maxSize || height > maxSize) {
          if (width > height) {
            height = height * (maxSize / width);
            width = maxSize;
          } else {
            width = width * (maxSize / height);
            height = maxSize;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/png'));
        } else {
          resolve(e.target?.result as string);
        }
      };
      img.onerror = () => resolve(e.target?.result as string);
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// 추천 가능 여부 확인 (1일 1회 제한)
function canRecommend(serverId: number): boolean {
  const userId = getUserId();
  const today = new Date().toDateString();
  const key = `rec_${userId}_${serverId}_${today}`;
  return !localStorage.getItem(key);
}

// 추천 추가
function addRecommendation(serverId: number) {
  if (!canRecommend(serverId)) {
    showToast('⚠️ 오늘 이미 추천하신 로샵입니다.', 'error');
    return false;
  }

  const userId = getUserId();
  const today = new Date().toDateString();
  const key = `rec_${userId}_${serverId}_${today}`;
  localStorage.setItem(key, 'true');

  // 서버의 추천 수 증가
  const server = servers.find(s => s.id === serverId);
  if (server) {
    server.recommendations = (server.recommendations || 0) + 1;
    saveServers();
    syncServerToDB(server); // 아토믹 추천 수 증가
    logUserActivity('로샵 추천', server?.name || `ID: ${serverId}`);
    return true;
  }
  return false;
}

// 오늘의 인기 서버 Top 10 가져오기
function getTopServersToday(): DiscordServer[] {
  return servers
    .filter(s => s.status === 'approved')
    .sort((a, b) => {
      // 1순위: 파트너 서버 여부
      if (a.isPartner && !b.isPartner) return -1;
      if (!a.isPartner && b.isPartner) return 1;
      // 2순위: 추천 수
      return (b.recommendations || 0) - (a.recommendations || 0);
    })
    .slice(0, 10);
}

let servers: DiscordServer[] = [];

// 상태 관리
let filteredServers = [...servers];
let currentPage = 1;
const itemsPerPage = 21;
let currentCategory = '전체';
let searchQuery = '';

// 관리자 대시보드 진입 추적
let adminFooterClickCount = 0;
let adminFooterClickTimer: any = null;

// 금칙어 리스트
const forbiddenWords = config.forbiddenKeywords;

// ========== 유틸 함수들 ==========

// 태그 색상 가져오기
function getTagColor(tagValue: string): { color: string; bgColor: string } {
  const tagConfig = [...config.serverTags, ...config.adminOnlyTags].find(t => t.value === tagValue);
  if (tagConfig) {
    return {
      color: tagConfig.color || '#6366f1',
      bgColor: (tagConfig as any).bgColor || `${tagConfig.color}20`
    };
  }
  return { color: '#6366f1', bgColor: '#6366f120' };
}

// 신규 서버 판별 (등록된지 24시간 이내)
const NEW_SERVER_DURATION_MS = 24 * 60 * 60 * 1000; // 24시간

function isNewServer(server: DiscordServer): boolean {
  if (server.status !== 'approved') return false;
  // 승인 시점(approvedAt) 기준으로 24시간 계산
  const referenceTime = server.approvedAt || server.createdAt || 0;
  if (!referenceTime) return false;
  return (Date.now() - referenceTime) < NEW_SERVER_DURATION_MS;
}

// 서버의 동적 태그 목록 생성 (신규 태그 자동 추가/제거)
function getServerTags(server: DiscordServer): string[] {
  const tags = server.tags.filter(t => t !== '신규'); // 기존 정적 '신규' 태그 제거
  if (isNewServer(server)) {
    tags.unshift('신규'); // 신규 태그를 맨 앞에 추가
  }
  return tags;
}

// 고급 콘텐츠 필터링 함수
function containsForbiddenContent(text: string): boolean {
  return forbiddenWords.some(word => {
    const cleanWord = word.toLowerCase().replace(/\s/g, '');
    // 단어 경계를 고려한 검색
    const regex = new RegExp(`\\b${cleanWord}\\b|${cleanWord}`, 'gi');
    return regex.test(text);
  });
}

// DOM 요소 (initLayout에서 초기화됨)
const detailModal = () => document.querySelector<HTMLDivElement>('#detail-modal-container')!;
const registerModal = () => document.querySelector<HTMLDivElement>('#register-modal-container')!;

// 필터링 적용 함수
function applyFilters() {
  filteredServers = servers.filter(s => {
    // 승인된 로샵만 메인 페이지에 표시
    if (s.status !== 'approved') return false;
    
    const isBusinessCategory = currentCategory === '사업팀';
    const isNewCategory = currentCategory === '신규';
    const dynamicTags = getServerTags(s);
    
    let matchCategory = false;
    if (currentCategory === '전체') {
      matchCategory = true;
    } else if (isNewCategory) {
      matchCategory = isNewServer(s);
    } else if (isBusinessCategory) {
      matchCategory = s.category === '사업팀' || dynamicTags.includes('사업팀(로폴더)');
    } else {
      matchCategory = s.category === currentCategory || dynamicTags.includes(currentCategory);
    }
    
    const matchSearch = s.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                        s.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCategory && matchSearch;
  });
  renderFilters();
  renderServers();
}

// 필터 버튼 렌더링
function renderFilters() {
  const categoriesData = [
    { name: '전체', icon: '🏠', className: '' },
    { name: '인기', icon: '🔥', className: 'filter-popular' },
    { name: '신규', icon: '✨', className: 'filter-new' },
    { name: '게임', icon: '🎮', className: '' },
    { name: '개발', icon: '💻', className: '' },
    { name: '판매서버', icon: '💰', className: '' },
    { name: '커뮤니티', icon: '👤', className: '' },
    { name: '파트너', icon: '💎', className: 'filter-partner' },
    { name: '사업팀', icon: '💼', className: 'filter-business' }
  ];
  const filterBar = document.getElementById('filter-bar')!;
  if (!filterBar) return;
  
  filterBar.innerHTML = categoriesData.map(cat => `
    <button class="filter-item ${cat.className} ${currentCategory === cat.name ? 'active' : ''}" data-category="${cat.name}">
      ${cat.name} ${cat.icon}
    </button>
  `).join('');

  filterBar.querySelectorAll('.filter-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = e.target as HTMLButtonElement;
      currentCategory = target.dataset.category!;
      currentPage = 1;
      applyFilters();
    });
  });
}

// 모달 열기 함수들
// 모달 함수들 (하단에 정의됨)

// 커뮤니티 Q&A 모달
function showQAModal() {
  const modal = registerModal();
  const content = document.getElementById('register-modal-content')!;
  
  // Q&A 데이터 로드
  const qaDataStr = localStorage.getItem('rofolder_qa_v1') || '[]';
  let qaData: Array<{ id: number; question: string; answer: string; votes: number; createdAt: number }> = [];
  try {
    qaData = JSON.parse(qaDataStr);
  } catch (e) {
    qaData = [];
  }
  
  // 최근 답변된 Q&A 10개
  const answeredQA = qaData.filter(q => q.answer && q.answer.length > 0)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 10);

  content.innerHTML = `
    <button class="modal-close" id="close-qa-modal" style="position: absolute; top: 1rem; right: 1rem; background: none; border: none; font-size: 1.5rem; color: var(--text-primary); cursor: pointer;">&times;</button>
    <h2 style="margin-bottom: 1.5rem; font-size: 1.8rem;">❓ 커뮤니티 Q&A</h2>
    <p style="color: var(--text-secondary); margin-bottom: 2rem;">
      다른 사용자들과 질문과 답변을 나누는 공간입니다. (익명)
    </p>
    
    <div class="qa-modal-grid">
      <div class="glass qa-card" style="padding: 1.5rem; border-radius: 1rem;">
        <div class="qa-card-content">
          <h3 style="margin: 0 0 0.5rem 0; font-size: 1rem; color: var(--text-primary);">질문 올리기</h3>
          <p style="margin: 0 0 1rem 0; color: var(--text-secondary); font-size: 0.9rem;">로샵 이용이나 등록에 대해 질문하세요</p>
        </div>
        <button id="show-ask-form" style="width: 100%; padding: 0.8rem; background: var(--accent-gradient); color: white; border: none; border-radius: 0.5rem; cursor: pointer; font-weight: bold;">
          ❓ 질문하기
        </button>
      </div>
      <div class="glass qa-card" style="padding: 1.5rem; border-radius: 1rem;">
        <div class="qa-card-content">
          <h3 style="margin: 0 0 0.5rem 0; font-size: 1rem; color: var(--text-primary);">최근 Q&A</h3>
          <p style="margin: 0 0 1rem 0; color: var(--text-secondary); font-size: 0.9rem;">답변된 질문 ${answeredQA.length}개</p>
        </div>
        <button id="show-recent-qa" style="width: 100%; padding: 0.8rem; background: linear-gradient(135deg, #10b981, #34d399); color: white; border: none; border-radius: 0.5rem; cursor: pointer; font-weight: bold;">
          💬 둘러보기
        </button>
      </div>
    </div>

    <div style="margin-bottom: 1.5rem; text-align: center; color: var(--text-secondary); font-size: 0.85rem;">
      <p>📌 욕설, 광고, 부적절한 내용은 삭제될 수 있습니다.</p>
    </div>
    
    <div id="qa-content-area" style="display: none;">
      <!-- 질문 양식 또는 최근 Q&A가 동적으로 표시됨 -->
    </div>
  `;

  modal.classList.remove('hidden');
  document.getElementById('close-qa-modal')!.onclick = () => modal.classList.add('hidden');
  
  // Q&A 버튼 이벤트
  const contentArea = document.getElementById('qa-content-area')!;
  const askBtn = document.getElementById('show-ask-form')!;
  const recentBtn = document.getElementById('show-recent-qa')!;
  
  askBtn.addEventListener('click', () => {
    contentArea.style.display = 'block';
    contentArea.innerHTML = `
      <div style="background: rgba(255,255,255,0.05); padding: 1.5rem; border-radius: 1rem; margin-top: 1.5rem;">
        <h3 style="margin-top: 0; color: var(--text-primary);">✏️ 질문 입력</h3>
        <input type="text" id="qa-question" class="form-input" placeholder="궁금한 점을 입력하세요 (예: 서버 활동도는 어떤가요?)" style="margin-bottom: 1rem;">
        <textarea id="qa-details" class="form-textarea" placeholder="추가 설명 (선택사항)" rows="3" style="margin-bottom: 1rem;"></textarea>
        <div style="text-align: right;">
          <button id="submit-question" class="submit-button" style="padding: 0.8rem 1.5rem;">✅ 등록</button>
        </div>
      </div>
    `;
    
    document.getElementById('submit-question')!.addEventListener('click', () => {
      const question = (document.getElementById('qa-question') as HTMLInputElement).value.trim();
      
      if (!question || question.length < 5) {
        alert('❌ 질문은 5자 이상이어야 합니다.');
        return;
      }
      
      const newQA = {
        id: Date.now(),
        question: escapeHtml(question),
        answer: '',
        votes: 0,
        createdAt: Date.now()
      };
      
      qaData.push(newQA);
      localStorage.setItem('rofolder_qa_v1', JSON.stringify(qaData));
      
      alert('✅ 질문이 등록되었습니다!\n관리자가 답변해드리겠습니다.');
      contentArea.style.display = 'none';
    });
  });
  
  recentBtn.addEventListener('click', () => {
    if (answeredQA.length === 0) {
      contentArea.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 2rem;">아직 답변된 질문이 없습니다.</p>';
      contentArea.style.display = 'block';
      return;
    }
    
    contentArea.style.display = 'block';
    contentArea.innerHTML = `
      <div style="margin-top: 1.5rem; max-height: 400px; overflow-y: auto;">
        ${answeredQA.map(qa => `
          <div class="glass" style="padding: 1rem; margin-bottom: 1rem; border-radius: 0.5rem;">
            <div style="display: flex; justify-content: space-between; align-items: start;">
              <div style="flex: 1;">
                <p style="margin: 0 0 0.5rem 0; color: var(--text-primary); font-weight: bold;">❓ ${qa.question}</p>
                <p style="margin: 0; color: var(--text-secondary); font-size: 0.9rem;">✅ ${qa.answer}</p>
              </div>
              <button class="vote-btn" data-id="${qa.id}" style="background: none; border: none; color: var(--accent-color); cursor: pointer; font-size: 1.2rem; margin-left: 1rem;">👍 ${qa.votes}</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
    
    // 투표 버튼 이벤트
    contentArea.querySelectorAll('.vote-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const qaId = parseInt((btn as HTMLElement).dataset.id!);
        const qa = qaData.find(q => q.id === qaId);
        if (qa) {
          qa.votes++;
          localStorage.setItem('rofolder_qa_v1', JSON.stringify(qaData));
          (btn as HTMLElement).innerText = `👍 ${qa.votes}`;
        }
      });
    });
  });
}

let currentSlide = 0;

// 다음 슬라이드로
function nextSlide() {
  const slides = document.querySelectorAll('.carousel-slide');
  const dots = document.querySelectorAll('.carousel-dot');
  if (slides.length === 0) return;
  
  currentSlide = (currentSlide + 1) % slides.length;
  updateCarousel(slides, dots);
}

// 이전 슬라이드로
function prevSlide() {
  const slides = document.querySelectorAll('.carousel-slide');
  const dots = document.querySelectorAll('.carousel-dot');
  if (slides.length === 0) return;
  
  currentSlide = (currentSlide - 1 + slides.length) % slides.length;
  updateCarousel(slides, dots);
}

// 특정 슬라이드로 이동
function goToSlide(index: number) {
  const slides = document.querySelectorAll('.carousel-slide');
  const dots = document.querySelectorAll('.carousel-dot');
  if (slides.length === 0) return;
  
  currentSlide = index % slides.length;
  updateCarousel(slides, dots);
}

// 캐러셀 업데이트
function updateCarousel(slides: NodeListOf<Element>, dots: NodeListOf<Element>) {
  slides.forEach((slide, idx) => {
    if (idx === currentSlide) {
      slide.classList.add('active');
    } else {
      slide.classList.remove('active');
    }
  });

  dots.forEach((dot, idx) => {
    if (idx === currentSlide) {
      dot.classList.add('active');
    } else {
      dot.classList.remove('active');
    }
  });
}

// 페이지네이션 렌더링
function renderPagination() {
  const container = document.getElementById('pagination-container')!;
  if (!container) return;
  
  const totalPages = Math.ceil(filteredServers.length / itemsPerPage);
  
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = `<div class="pagination-controls">`;
  for (let i = 1; i <= totalPages; i++) {
    if (i <= 3 || i > totalPages - 2 || (i >= currentPage - 1 && i <= currentPage + 1)) {
      html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    } else if (i === 4 || i === totalPages - 2) {
      if (!html.endsWith('<span class="text-muted">...</span>')) {
        html += `<span class="text-muted">...</span>`;
      }
    }
  }
  html += `</div>`;
  
  html += `
    <div class="page-jump">
      <span>페이지 이동:</span>
      <input type="number" id="jump-input" class="jump-input" value="${currentPage}" min="1" max="${totalPages}">
      <span>/ ${totalPages}</span>
    </div>
  `;

  container.innerHTML = html;

  container.querySelectorAll('.page-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      currentPage = parseInt((e.target as HTMLButtonElement).dataset.page!);
      renderServers();
      window.scrollTo({ top: 400, behavior: 'smooth' });
    });
  });

  const jumpInput = document.getElementById('jump-input') as HTMLInputElement;
  if (jumpInput) {
    jumpInput.addEventListener('change', () => {
      let val = parseInt(jumpInput.value);
      if (val >= 1 && val <= totalPages) {
        currentPage = val;
        renderServers();
      }
    });
  }
}

// 서버 목록 렌더링
function renderServers() {
  const grid = document.getElementById('server-grid')!;
  if (!grid) return;
  
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const pagedServers = filteredServers.slice(startIndex, endIndex);

  // 엠티 스테이트 (서버가 없을 때)
  if (filteredServers.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <div class="empty-icon">📂</div>
        <h3>아직 등록된 서버가 없습니다</h3>
        <p>당신의 로샵을 첫 번째로 등록해보세요! 전문가들이 기다리고 있습니다.</p>
        <button class="nav-link nav-link-primary" id="empty-register-btn" style="padding: 1rem 3rem; font-size: 1.1rem;">지금 서버 등록하기</button>
      </div>
    `;
    document.getElementById('empty-register-btn')?.addEventListener('click', () => {
      document.getElementById('open-register')?.click();
    });
    return;
  }

  let carouselHTML = '';
  if (currentPage === 1 && filteredServers.length > 0) {
    carouselHTML = `
      <div class="banner-carousel" style="grid-column: 1 / -1;">
        <div class="carousel-container">
          ${config.bannerCarousel.map((banner, idx) => `
            <div class="carousel-slide${idx === 0 ? ' active' : ''}" style="background: ${banner.color};">
              <div class="carousel-content">
                <h2 style="font-size: 2.5rem; margin-bottom: 1rem; color: var(--text-primary);">✨ ${banner.title}</h2>
                <p style="font-size: 1.2rem; color: var(--text-secondary); margin-bottom: 2rem;">${banner.description}</p>
                <button class="promo-button carousel-promo-btn">🚀 지금 등록하기</button>
              </div>
            </div>
          `).join('')}
        </div>
        <div class="carousel-controls">
          <button class="carousel-nav carousel-prev" id="carousel-prev">❮</button>
          <div class="carousel-dots">
            ${config.bannerCarousel.map((_, idx) => `
              <button class="carousel-dot${idx === 0 ? ' active' : ''}" data-slide="${idx}"></button>
            `).join('')}
          </div>
          <button class="carousel-nav carousel-next" id="carousel-next">❯</button>
        </div>
      </div>
    `;
  }

  // [Premium Remake] 실시간 인기 로샵 Top 10 섹션 & 파트너 섹션 (첫 페이지에서만 표시)
  let partnerServersHTML = '';
  let topServersHTML = '';
  
  if (currentPage === 1) {
    const allApproved = servers.filter(s => s.status === 'approved');
    const partners = allApproved.filter(s => s.isPartner || (s.tags && s.tags.includes('파트너'))).sort((a, b) => (b.recommendations || 0) - (a.recommendations || 0));
    const topTen = getTopServersToday().filter(s => !s.isPartner && !(s.tags && s.tags.includes('파트너'))).slice(0, 10); // 파트너 제외한 순수 인기 탑 10

    if (partners.length > 0) {
      partnerServersHTML = `
        <div class="top-servers-section" style="grid-column: 1 / -1; margin-bottom: 3rem; position: relative;">
          <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 1.8rem; padding: 0 1rem;">
            <div>
              <h2 style="font-size: 1.6rem; font-weight: 800; margin-bottom: 0.5rem; color: var(--text-primary); display: flex; align-items: center; gap: 0.8rem;">
                🤝 로폴더 <span style="background: linear-gradient(135deg, #fbbf24, #f59e0b); -webkit-background-clip: text; color: transparent;">공식 파트너</span>
              </h2>
              <p style="margin: 0; font-size: 0.9rem; color: var(--text-secondary);">로폴더가 보증하는 최고의 프리미엄 커뮤니티</p>
            </div>
            <div style="font-size: 0.85rem; color: #fbbf24; font-weight: 600; opacity: 0.8;">
              가로로 밀어서 더보기 ➔
            </div>
          </div>
          <div class="top-10-row">
            ${partners.map((server, idx) => {
              const safeName = escapeHtml(server.name);
              const safeIcon = escapeHtml(server.icon);
              const safeDesc = escapeHtml(server.description);
              
              return `
              <div class="top-10-card stagger-reveal" style="animation-delay: ${idx * 0.08}s; border: 1px solid rgba(251, 191, 36, 0.3); background: var(--card-bg);">
                <div class="top-10-card-header">
                  <img src="${safeIcon}" alt="${safeName}" class="top-10-icon" loading="lazy" onerror="this.src='https://api.dicebear.com/7.x/identicon/svg?seed=${server.id}';">
                  <div style="min-width: 0; flex: 1;">
                    <h4 style="margin: 0; font-size: 1rem; font-weight: 800; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 0.4rem;">
                      ${safeName}
                      <span style="background: linear-gradient(135deg, #fbbf24, #f59e0b); color: #1a1a2e; padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; font-weight: 800; flex-shrink: 0;">PARTNER</span>
                    </h4>
                    <p style="margin: 0.2rem 0 0 0; font-size: 0.8rem; color: var(--accent-color); font-weight: 600;">👍 ${(server.recommendations || 0).toLocaleString()} 추천</p>
                  </div>
                </div>
                <p style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.5; margin: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 2.5rem;">
                  ${safeDesc}
                </p>
                <div class="top-10-btn-group">
                  <button class="top-10-btn top-10-detail-btn" onclick="openDetailModal(${server.id})">🔍 자세히 보기</button>
                  <button class="top-10-btn top-10-join-btn" style="background: linear-gradient(135deg, #fbbf24, #f59e0b);" onclick="window.open('${escapeHtml(server.inviteLink)}', '_blank', 'noopener,noreferrer')">🚀 서버 참가하기</button>
                </div>
              </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    if (topTen.length > 0) {
      topServersHTML = `
        <div class="top-servers-section" style="grid-column: 1 / -1; margin-bottom: 4.5rem; position: relative;">
          <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 1.8rem; padding: 0 1rem;">
            <div>
              <h2 style="font-size: 1.6rem; font-weight: 800; margin-bottom: 0.5rem; color: var(--text-primary); display: flex; align-items: center; gap: 0.8rem;">
                🏆 실시간 인기 <span class="brand-highlight">Top 10</span>
              </h2>
              <p style="margin: 0; font-size: 0.9rem; color: var(--text-secondary);">지금 가장 주목받고 있는 일반 로샵 리스트</p>
            </div>
            <div style="font-size: 0.85rem; color: var(--accent-gradient); font-weight: 600; opacity: 0.8;">
              가로로 밀어서 더보기 ➔
            </div>
          </div>

          <div class="top-10-row">
            ${topTen.map((server, idx) => {
              const safeName = escapeHtml(server.name);
              const safeIcon = escapeHtml(server.icon);
              const safeDesc = escapeHtml(server.description);
              
              return `
              <div class="top-10-card stagger-reveal" style="animation-delay: ${idx * 0.08}s;">
                <div class="top-10-rank">${idx + 1}</div>
                <div class="top-10-card-header">
                  <img src="${safeIcon}" alt="${safeName}" class="top-10-icon" loading="lazy" onerror="this.src='https://api.dicebear.com/7.x/identicon/svg?seed=${server.id}';">
                  <div style="min-width: 0; flex: 1;">
                    <h4 style="margin: 0; font-size: 1rem; font-weight: 800; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 0.4rem;">
                      ${safeName}
                    </h4>
                    <p style="margin: 0.2rem 0 0 0; font-size: 0.8rem; color: var(--accent-color); font-weight: 600;">👍 ${(server.recommendations || 0).toLocaleString()} 추천</p>
                  </div>
                </div>
                <p style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.5; margin: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 2.5rem;">
                  ${safeDesc}
                </p>
                <div class="top-10-btn-group">
                  <button class="top-10-btn top-10-detail-btn" onclick="openDetailModal(${server.id})">
                    🔍 자세히 보기
                  </button>
                  <button class="top-10-btn top-10-join-btn" onclick="window.open('${escapeHtml(server.inviteLink)}', '_blank', 'noopener,noreferrer')">
                    🚀 서버 참가하기
                  </button>
                </div>
              </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }
  }

  grid.innerHTML = carouselHTML + partnerServersHTML + topServersHTML + pagedServers.map((server, idx) => {
    const dynamicTags = getServerTags(server);
    const isNew = isNewServer(server);
    return `
    <div class="server-card glass${isNew ? ' server-card-new' : ''}" data-id="${server.id}" style="animation-delay: ${(currentPage === 1 ? 0.5 : 0) + (idx * 0.05)}s;">
      ${isNew ? '<div class="new-badge-ribbon">⭐ 신규</div>' : ''}
      <div class="server-header">
        <img src="${escapeHtml(server.icon)}" class="server-icon loading" alt="${escapeHtml(server.name)}" onerror="this.src='https://api.dicebear.com/7.x/identicon/svg?seed=${server.id}'; this.classList.remove('loading');" onload="this.classList.remove('loading');">
        <div class="server-info">
          <h3 style="display: flex; align-items: center; gap: 0.4rem;">
            ${escapeHtml(server.name)}
            ${server.isPartner ? `<span style="background: linear-gradient(135deg, #fbbf24, #f59e0b); color: #1a1a2e; padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; font-weight: 800; flex-shrink: 0;">PARTNER</span>` : ''}
          </h3>
          <div class="server-tags">
            ${dynamicTags.map((tag: string) => {
              const tagConfig = [...config.serverTags, ...config.adminOnlyTags].find((t: any) => t.value === tag);
              const isNewTag = tag === '신규';
              return `<span class="server-tag${isNewTag ? ' server-tag-new' : ''}" style="${isNewTag ? `background: ${tagConfig?.bgColor || 'rgba(34,197,94,0.18)'}; color: ${tagConfig?.color || '#22c55e'};` : ''}">${tagConfig?.emoji || '🏷️'} ${escapeHtml(tag)}</span>`;
            }).join('')}
          </div>
        </div>
      </div>
      <p class="server-description">${escapeHtml(server.description)}</p>
      <div class="server-footer">
        <button class="detail-button" data-id="${server.id}">상세 정보 보기</button>
      </div>
    </div>
  `;
  }).join('');

  grid.querySelectorAll('.detail-button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = parseInt((e.target as HTMLButtonElement).dataset.id!);
      openDetailModal(id);
    });
  });

  // 로샵 추천 버튼 이벤트
  grid.querySelectorAll('.recommend-icon-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt((btn as HTMLElement).dataset.id!);
      
      const confirmed = await showConfirm('🌟 이 로샵을 추천하시겠습니까?\n추천은 1일 1회만 가능합니다.');
      if (confirmed) {
        if (addRecommendation(id)) {
          showToast('추천이 완료되었습니다!', 'success');
          renderServers();
        }
      }
    });
  });

  // 더보기 버튼 이벤트
  const showAllBtn = grid.querySelector('#show-top-all-btn');
  if (showAllBtn) {
    showAllBtn.addEventListener('click', () => {
      showTopAllModal();
    });
  }

  // 캐러셀 이벤트
  const prevBtn = grid.querySelector('#carousel-prev');
  const nextBtn = grid.querySelector('#carousel-next');
  const promoBtnsCarousel = grid.querySelectorAll('.carousel-promo-btn');
  const dots = grid.querySelectorAll('.carousel-dot');

  if (prevBtn && nextBtn) {
    prevBtn.addEventListener('click', () => prevSlide());
    nextBtn.addEventListener('click', () => nextSlide());
    
    dots.forEach(dot => {
      dot.addEventListener('click', (e) => {
        const slideIndex = parseInt((e.target as HTMLButtonElement).dataset.slide!);
        goToSlide(slideIndex);
      });
    });

    // 배너 10초마다 자동 스크롤은 init()에서 한 번만 설정합니다.
  }

  if (promoBtnsCarousel.length > 0) {
    promoBtnsCarousel.forEach(btn => {
      btn.addEventListener('click', openPromoBanner);
    });
  }

  renderPagination();

  // 가로 마우스 휠 스크롤 추가 (부드러운 경험을 위한 최적화)
  const top10Row = grid.querySelector('.top-10-row');
  if (top10Row) {
    top10Row.addEventListener('wheel', ((e: WheelEvent) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        // 부드러운 스크롤을 위해 감도 조절 및 scrollBy 활용
        top10Row.scrollBy({
          left: e.deltaY * 1.5,
          behavior: 'auto' // CSS에서 smooth를 처리하므로 여기서는 auto로 넘김
        });
      }
    }) as EventListener, { passive: false });
  }
}

// 홍보 배너 열기
function openPromoBanner() {
  const modal = document.querySelector<HTMLDivElement>('#register-modal-container')!;
  const content = document.getElementById('register-modal-content')!;
  
  content.innerHTML = `
    <button class="modal-close" id="close-promo-modal">&times;</button>
    <h2 style="margin-bottom: 2.5rem; font-size: 1.8rem;">🚀 로샵 등록 신청</h2>
    <p style="color: var(--text-secondary); margin-bottom: 2rem; font-size: 1.05rem;">
      당신의 로샵을 RoFolder에 등록하고 더 많은 유저와 연결되세요!
    </p>
    <form id="promo-form" class="register-form">
      <div class="form-group">
        <label>서버/커뮤니티 아이콘 *</label>
        <div style="display: flex; gap: 1rem;">
          <div class="image-preview-container">
            <img id="promo-preview" src="https://api.dicebear.com/7.x/identicon/svg?seed=new" alt="미리보기">
          </div>
          <input type="file" id="promo-icon-upload" accept=".png,.svg,.webp,image/png,image/svg+xml,image/webp" class="form-input" style="flex: 1;" required>
        </div>
      </div>
      <div class="form-group">
        <label>서버/커뮤니티 이름 *</label>
        <input type="text" id="promo-name" class="form-input" placeholder="예: 풀스택 개발자 커뮤니티" required>
      </div>
      <div class="form-group">
        <label>카테고리 선택 * (중복선택 가능)</label>
        <div id="promo-category-chips" class="category-chips">
          ${config.serverTags.map(tag => `
            <button type="button" class="chip" data-value="${tag.value}">
              ${tag.emoji} ${tag.label}
            </button>
          `).join('')}
        </div>
        <input type="hidden" id="promo-category" value="">
      </div>
      <div class="form-group">
        <label>서버 설명 *</label>
        <textarea id="promo-desc" class="form-textarea" rows="4" placeholder="서버의 특징과 장점을 설명해주세요." required></textarea>
      </div>
      <div class="form-group">
        <label>디스코드 초대 링크 *</label>
        <input type="url" id="promo-link" class="form-input" placeholder="https://discord.gg/..." required>
      </div>
      <div class="form-group">
        <label>문의처 (이메일 또는 디스코드 ID)</label>
        <input type="text" id="promo-contact" class="form-input" placeholder="example@email.com 또는 Discord ID" required>
      </div>
      <div style="display: flex; gap: 1rem;">
        <button type="submit" class="submit-button" style="flex: 1;">✅ 등록 신청</button>
        <button type="button" id="cancel-promo" class="submit-button" style="flex: 1; background: #6b7280; color: white;">취소</button>
      </div>
    </form>
  `;

  modal.classList.remove('hidden');
  document.getElementById('close-promo-modal')!.onclick = () => modal.classList.add('hidden');
  document.getElementById('cancel-promo')!.onclick = () => modal.classList.add('hidden');

  const form = document.getElementById('promo-form') as HTMLFormElement;

  const iconInput = document.getElementById('promo-icon-upload') as HTMLInputElement;
  const preview = document.getElementById('promo-preview') as HTMLImageElement;

  // 선택된 아이콘 파일 저장
  let selectedIconFile: File | null = null;

  // 아이콘 미리보기 및 검증
  iconInput.onchange = async () => {
    if (iconInput.files && iconInput.files[0]) {
      const file = iconInput.files[0];
      const allowedTypes = ['image/png', 'image/svg+xml', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        alert('❌ 지원하지 않는 파일 형식입니다.\\nPNG, SVG, WEBP만 지원합니다.');
        iconInput.value = '';
        selectedIconFile = null;
        preview.src = 'https://api.dicebear.com/7.x/identicon/svg?seed=new';
        return;
      }
      selectedIconFile = file;
      try {
        preview.src = await convertImageToBase64(file);
      } catch (err) {
        preview.src = URL.createObjectURL(file);
      }
    }
  };

  // 카테고리 칩 선택 (중복선택 가능)
  const chips = document.querySelectorAll('#promo-category-chips .chip');
  const catInput = document.getElementById('promo-category') as HTMLInputElement;
  
  const updateCategoryInput = () => {
    const selected = Array.from(chips)
      .filter(c => c.classList.contains('active'))
      .map(c => (c as HTMLButtonElement).dataset.value)
      .join(',');
    catInput.value = selected;
  };
  
  chips.forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      chip.classList.toggle('active');
      updateCategoryInput();
    });
  });

  // 폼 제출
  form.onsubmit = async (e) => {
    e.preventDefault();
    
    const nameInput = (document.getElementById('promo-name') as HTMLInputElement).value.trim();
    const descInput = (document.getElementById('promo-desc') as HTMLTextAreaElement).value.trim();
    const catInput = (document.getElementById('promo-category') as HTMLInputElement).value;
    const linkInput = (document.getElementById('promo-link') as HTMLInputElement).value.trim();
    const contactInput = (document.getElementById('promo-contact') as HTMLInputElement).value.trim();

    // 선택된 카테고리 배열
    const selectedCategories = catInput.split(',').filter(c => c.length > 0);

    // 비정상 활동/도배 감지 로직 (로컬 기준 최근 1분간 5회 이상 등록 시도 시 락다운)
    const nowMs = Date.now();
    const recentAttemptsStr = localStorage.getItem('abnormal_reg_attempts') || '[]';
    let recentAttempts: number[] = [];
    try { recentAttempts = JSON.parse(recentAttemptsStr); } catch(e){}
    
    recentAttempts = recentAttempts.filter(time => nowMs - time < 60000); // 1분 유지
    recentAttempts.push(nowMs);
    localStorage.setItem('abnormal_reg_attempts', JSON.stringify(recentAttempts));

    if (recentAttempts.length >= 5) {
      // 사이트를 보호 모드(로딩 UI)로 강제 덮어쓰기
      document.body.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:white;text-align:center;">
           <div style="font-size:4rem;margin-bottom:1rem;">🚨</div>
           <h2 style="color:#ef4444;margin-bottom:1rem;font-size:2rem;">비정상적인 활동 감지</h2>
           <p style="color:#94a3b8;margin-bottom:2rem;line-height:1.6;font-size:1.1rem;">짧은 시간 내에 너무 많은 등록 요청이 발생하였습니다.<br>보안을 위해 사이트가 보호 모드로 전환되었습니다.</p>
           <div style="border:4px solid rgba(255,255,255,0.1); border-left-color: #ef4444; border-radius: 50%; width: 50px; height: 50px; animation: spin 1s linear infinite;"></div>
           <style>@keyframes spin { 100% { transform: rotate(360deg); } }</style>
        </div>
      `;
      
      // 관리자 멘션 긴급 웹훅 발송
      sendWebhook({
        content: `🚨 <@${config.adminDiscordId}> **[긴급 보안 경보]** 비정상적인 다중 서버 등록 요청(도배)이 감지되어 클라이언트가 차단되었습니다!`
      });
      return;
    }

    // 중복 서버 방지 (이름 또는 링크가 같고, 상태가 거절이 아닌 경우)
    const isDuplicate = servers.some(s => 
      (s.status === 'pending' || s.status === 'approved') && 
      (s.name.toLowerCase() === nameInput.toLowerCase() || s.inviteLink.toLowerCase() === linkInput.toLowerCase())
    );
    if (isDuplicate) {
      alert('❌ 이미 등록되어 있거나 관리자 승인 대기 중인 서버입니다.');
      return;
    }
    
    // 입력 검증
    const validation = validateServerData({
      name: nameInput,
      description: descInput,
      inviteLink: linkInput
    });

    if (!validation.valid) {
      alert('❌ 입력 오류:\n' + validation.errors.join('\n'));
      return;
    }

    if (selectedCategories.length === 0) {
      alert('❌ 카테고리를 최소 1개 이상 선택해주세요.');
      return;
    }

    if (!contactInput || contactInput.length < 3) {
      alert('❌ 문의처를 정확히 입력해주세요.');
      return;
    }

    const isBad = containsForbiddenContent(nameInput) || containsForbiddenContent(descInput);
    if (isBad) {
      alert('⚠️ 부적절한 키워드가 포함되어 있습니다.\n(도박, 성인, 불법 등)');
      return;
    }

    // 아이콘 처리: 파일이 있으면 Base64로 변환, 없으면 기본값
    let iconData = 'https://api.dicebear.com/7.x/identicon/svg?seed=' + nameInput;
    if (selectedIconFile) {
      try {
        iconData = await convertImageToBase64(selectedIconFile);
      } catch (err) {
        console.error('이미지 변환 실패:', err);
        alert('⚠️ 이미지 처리 중 오류가 발생했습니다.');
        return;
      }
    }

    // 새 서버로 등록 (pending 상태)
    const newServer: DiscordServer = {
      id: Date.now(),
      name: nameInput,
      description: descInput,
      category: selectedCategories[0], // 첫 카테고리를 기본값으로
      icon: iconData,
      tags: [...selectedCategories], // 선택된 모든 카테고리를 tags에 추가 (신규 태그는 승인 시 동적으로 추가됨)
      inviteLink: linkInput,
      status: 'pending',
      createdAt: Date.now()
    };

    servers.unshift(newServer);
    saveServers();
    await syncServerToDB(newServer);

    // [Webhook] 등록 요청 전송 (안정성을 위해 이미지 첨부 포함)
    const webhookPayload = {
      content: `<@${config.adminDiscordId}> 🚀 **새로운 서버 등록 요청이 도착했습니다!**`,
      embeds: [{
        title: '💎 RoFolder 서버 등록 요청',
        description: `**${sanitizeDiscordText(nameInput)}** 커뮤니티의 홍보 신청이 접수되었습니다.`,
        color: 0x6366f1,
        thumbnail: { url: 'attachment://icon.png' },
        fields: [
          { name: '🆔 신청 ID', value: `\`${newServer.id}\``, inline: true },
          { name: '⏳ 상태', value: '`승인 대기 중`', inline: true },
          { name: '📂 카테고리', value: `\`${selectedCategories.join(', ')}\``, inline: false },
          { name: '📞 문의처', value: escapeHtml(contactInput), inline: true },
          { name: '🔗 초대 링크', value: `[서버 입장하기](${linkInput})`, inline: true },
          { name: '📝 로샵 소개', value: sanitizeDiscordText(descInput) || '*설명 없음*' },
          { name: '🛠️ 관리자 퀵 액션', value: `[✅ 승인하기](${window.location.origin}${window.location.pathname}?action=approve&id=${newServer.id})\n[❌ 거절하기](${window.location.origin}${window.location.pathname}?action=reject&id=${newServer.id})` }
        ],
        footer: { text: 'RoFolder Premium Management System' },
        timestamp: new Date().toISOString()
      }]
    };

    let webhookSuccess = false;
    if (newServer.icon && newServer.icon.startsWith('data:image')) {
      // 이미지 파일로 전송
      const formData = new FormData();
      formData.append('payload_json', JSON.stringify(webhookPayload));
      
      try {
        const resp = await fetch(newServer.icon);
        const blob = await resp.blob();
        formData.append('file', blob, 'icon.png');
        webhookSuccess = await sendWebhook(formData, true);
      } catch (err) {
        console.error('이미지 웹훅 전송 실패:', err);
        webhookSuccess = await sendWebhook(webhookPayload); // 이미지 없이 재시도
      }
    } else {
      webhookSuccess = await sendWebhook(webhookPayload);
    }

    const successMsg = webhookSuccess 
      ? '✅ 홍보 신청이 완료되었습니다!\n관리자 검토 후 승인하겠습니다.'
      : '✅ 신청이 저장되었습니다.\n(Discord 알림 발송에 실패했습니다. 관리자에게 따로 연락해주세요.)';
    alert(successMsg);
    modal.classList.add('hidden');
    applyFilters();
  }
}

// Top 10 전체 보기 모달
function showTopAllModal() {
  const modal = detailModal();
  const content = document.getElementById('detail-modal-content')!;
  const topServers = getTopServersToday();
  
  content.innerHTML = `
    <button class="modal-close" id="close-detail">&times;</button>
    <h2 style="margin-bottom: 2rem; font-size: 2rem; color: var(--accent-color);">🔥 오늘의 인기 서버 Top ${topServers.length}</h2>
    
    <div style="display: flex; flex-direction: column; gap: 1rem; max-height: 600px; overflow-y: auto;">
      ${topServers.map((server, idx) => `
        <div class="glass" style="padding: 1.2rem; border-radius: 1rem; display: flex; align-items: center; gap: 1.5rem;">
          <div style="position: relative; min-width: 40px; text-align: center;">
            <div style="background: linear-gradient(135deg, #fa8231, #f97316); color: white; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 1.1rem; box-shadow: 0 4px 12px rgba(250, 130, 49, 0.3);">
              ${idx + 1}
            </div>
          </div>
          <img src="${escapeHtml(server.icon)}" alt="${escapeHtml(server.name)}" style="width: 50px; height: 50px; border-radius: 50%; object-fit: cover;" onerror="this.src='https://api.dicebear.com/7.x/identicon/svg?seed=${server.id}';">
          <div style="flex: 1;">
            <h4 style="margin: 0 0 0.3rem 0; color: var(--text-primary); font-size: 1rem; display: flex; align-items: center; gap: 0.4rem;">
              ${escapeHtml(server.name)}
              ${server.isPartner ? `<span style="background: linear-gradient(135deg, #fbbf24, #f59e0b); color: #1a1a2e; padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; font-weight: 800; flex-shrink: 0;">PARTNER</span>` : ''}
            </h4>
            <p style="margin: 0 0 0.5rem 0; color: var(--text-secondary); font-size: 0.85rem;">${escapeHtml(server.description.substring(0, 60))}...</p>
            <div style="display: flex; gap: 1rem; font-size: 0.85rem;">
              ${server.tags.slice(0, 2).map(tag => {
                const { color, bgColor } = getTagColor(tag);
                const tagConfig = [...config.serverTags, ...config.adminOnlyTags].find(t => t.value === tag);
                return `<span style="background: ${bgColor}; color: ${color}; padding: 0.3rem 0.8rem; border-radius: 0.4rem; font-size: 0.8rem;">${tagConfig?.emoji || ''} ${escapeHtml(tag)}</span>`;
              }).join('')}
              <span style="color: #fa8231;">👍 ${server.recommendations || 0}</span>
              <span style="color: var(--text-secondary);">👁️ ${server.clicks || 0}</span>
            </div>
          </div>
          <button class="submit-button" data-id="${server.id}" style="background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 0.7rem 1.5rem; min-width: 100px; border: none; border-radius: 0.5rem; cursor: pointer; font-weight: bold; font-size: 0.9rem;">
            보기
          </button>
        </div>
      `).join('')}
    </div>
  `;
  
  modal.classList.remove('hidden');
  document.getElementById('close-detail')!.onclick = () => modal.classList.add('hidden');
  
  // 보기 버튼 이벤트
  content.querySelectorAll('.submit-button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = parseInt((e.target as HTMLButtonElement).dataset.id!);
      modal.classList.add('hidden');
      openDetailModal(id);
    });
  });
}

// 상세 모달 열기
function openDetailModal(id: number) {
  const server = servers.find(s => s.id === id);
  if (!server) return;

  // 클릭 수 증가
  server.clicks = (server.clicks || 0) + 1;
  saveServers();
  syncServerToDB(server); // 아토믹 클릭 수 증가
  logUserActivity('서버 상세 보기', server.name);

  const modal = detailModal();
  const content = document.getElementById('detail-modal-content')!;
  
  // 태그 색상 적용 (동적 신규 태그 포함)
  const tagHTML = getServerTags(server).map(tag => {
    const tagConfig = [...config.serverTags, ...config.adminOnlyTags].find(t => t.value === tag);
    const { color, bgColor } = getTagColor(tag);
    const isNewTag = tag === '신규';
    return `<span class="server-tag${isNewTag ? ' server-tag-new' : ''}" style="padding: 6px 16px; font-size: 0.95rem; background: ${bgColor}; color: ${color};">${tagConfig?.emoji || ''} ${escapeHtml(tag)}</span>`;
  }).join('');
  
  content.innerHTML = `
    <button class="modal-close" id="close-detail">&times;</button>
    <div class="server-header" style="margin-bottom: 2.5rem; gap: 2rem;">
      <img id="detail-server-icon" src="${escapeHtml(server.icon)}" class="server-icon loading" style="width: 120px; height: 120px; border-radius: 28px;" alt="${escapeHtml(server.name)}" onerror="this.src='https://api.dicebear.com/7.x/identicon/svg?seed=${server.id}'; this.classList.remove('loading');" onload="this.classList.remove('loading');">
      <div style="flex: 1;">
        <h2 style="font-size: 2.2rem; margin-bottom: 0.8rem; display: flex; align-items: center; gap: 0.6rem;">
          ${escapeHtml(server.name)}
          ${server.isPartner ? `<span style="background: linear-gradient(135deg, #fbbf24, #f59e0b); color: #1a1a2e; padding: 4px 10px; border-radius: 6px; font-size: 0.85rem; font-weight: 800; flex-shrink: 0;">PARTNER</span>` : ''}
        </h2>
        <div class="server-tags">
          ${tagHTML}
        </div>
      </div>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1.5rem; margin-bottom: 3rem;">
      <div style="background: rgba(99, 102, 241, 0.1); padding: 1rem; border-radius: 0.75rem;">
        <h4 style="color: var(--text-secondary); margin: 0 0 0.5rem 0; font-size: 0.85rem;">카테고리</h4>
        <p style="font-size: 1.1rem; font-weight: 600; margin: 0; color: var(--text-primary);">${escapeHtml(server.category)}</p>
      </div>
      <div style="background: rgba(250, 130, 49, 0.1); padding: 1rem; border-radius: 0.75rem;">
        <h4 style="color: var(--text-secondary); margin: 0 0 0.5rem 0; font-size: 0.85rem;">👍 추천</h4>
        <p style="font-size: 1.1rem; font-weight: 600; margin: 0; color: #fa8231;">${server.recommendations || 0}명</p>
      </div>
      <div style="background: rgba(59, 130, 246, 0.1); padding: 1rem; border-radius: 0.75rem;">
        <h4 style="color: var(--text-secondary); margin: 0 0 0.5rem 0; font-size: 0.85rem;">👁️ 조회</h4>
        <p style="font-size: 1.1rem; font-weight: 600; margin: 0; color: #3b82f6;">${server.clicks || 0}회</p>
      </div>
    </div>
    <div style="margin-bottom: 4rem;">
      <h4 style="color: var(--text-secondary); margin-bottom: 0.8rem; font-size: 0.9rem;">서버 소개</h4>
      <p style="font-size: 1.15rem; line-height: 1.8; color: var(--text-primary);">${escapeHtml(server.description)}</p>
    </div>
    <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
      <a href="${escapeHtml(server.inviteLink)}" target="_blank" class="submit-button" style="flex: 1; text-decoration: none; text-align: center; min-width: 140px; padding: 0.75rem; border: none; border-radius: 0.5rem; color: white; cursor: pointer; font-weight: bold; height: 44px; display: flex; align-items: center; justify-content: center;">🔗 서버 참가하기</a>
      <button id="detail-recommend-btn" class="submit-button" style="background: linear-gradient(135deg, #fa8231, #f97316); flex: 1; min-width: 140px; padding: 0.75rem; border: none; border-radius: 0.5rem; color: white; cursor: pointer; font-weight: bold; height: 44px;">👍 추천하기</button>
      <button id="detail-close-btn" class="submit-button" style="flex: 1; min-width: 100px; padding: 0.75rem; border: none; border-radius: 0.5rem; color: white; cursor: pointer; font-weight: bold; height: 44px; background: #6b7280;">닫기</button>
    </div>
  `;

  modal.classList.remove('hidden');
  
  // 추천 버튼 이벤트
  const recommendBtn = document.getElementById('detail-recommend-btn') as HTMLButtonElement;
  if (recommendBtn) {
    recommendBtn.addEventListener('click', () => {
      if (addRecommendation(server.id)) {
        showToast('✅ 추천이 완료되었습니다!', 'success');
        recommendBtn.disabled = true;
        recommendBtn.style.opacity = '0.5';
        recommendBtn.textContent = '✓ 추천됨';
        // 상세정보 새로고침 (애니메이션 없이 값만 변경하는 것이 좋지만 일단 재호출)
        openDetailModal(id);
      }
    });
  }
  
  const close = () => modal.classList.add('hidden');
  document.getElementById('close-detail')!.onclick = close;
  document.getElementById('detail-close-btn')!.onclick = close;
}

// 문의 모달 열기
function openInquiryModal() {
  // 디스코드 포럼 채널로 이동시키기
  // config.discordForumUrl에 설정된 링크로 이동
  if (config.discordForumUrl && config.discordForumUrl.includes('/channels/')) {
    window.open(config.discordForumUrl, '_blank');
  } else {
    // 포럼 URL이 없으면 디스코드 커뮤니티로 이동
    window.open(config.discordCommunityUrl, '_blank');
  }
}

// 관리자 대시보드 열기
function openAdminDashboard() {
  if (!hasAdminAccess()) {
    showToast('⚠️ 관리자 권한이 필요합니다.', 'error');
    return;
  }

  const modal = document.querySelector<HTMLDivElement>('#admin-modal-container')!;
  const content = document.getElementById('admin-modal-content')!;
  
  const stats = getAdminStats();
  
  content.innerHTML = `
    <button class="modal-close" id="close-admin-modal">&times;</button>
    <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 2rem;">
      <h2 style="font-size: 2rem; color: var(--accent-color); margin: 0;">⚙️ 관리자 대시보드</h2>
      <button id="admin-refresh-btn" title="데이터 새로고침" style="background: rgba(255,255,255,0.05); border: 1px solid var(--card-border); color: var(--text-secondary); cursor: pointer; font-size: 1.2rem; padding: 0.5rem; border-radius: 12px; display: flex; align-items: center; justify-content: center; transition: all 0.3s ease;">🔄</button>
    </div>
    
    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 2rem; margin-bottom: 3rem;">
      <div class="stat-card">
        <h3 style="color: var(--accent-color); font-size: 2rem;">${stats.totalPending}</h3>
        <p style="color: var(--text-secondary);">대기 중</p>
      </div>
      <div class="stat-card">
        <h3 style="color: #10b981; font-size: 2rem;">${stats.totalApproved}</h3>
        <p style="color: var(--text-secondary);">승인됨</p>
      </div>
      <div class="stat-card">
        <h3 style="color: #ef4444; font-size: 2rem;">${stats.totalRejected}</h3>
        <p style="color: var(--text-secondary);">거절됨</p>
      </div>
    </div>

    <div class="admin-tab-bar">
      <button class="admin-tab-btn active" data-tab="pending">⏳ 대기중 <span class="tab-badge">${stats.totalPending}</span></button>
      <button class="admin-tab-btn" data-tab="approved">✅ 승인됨</button>
      <button class="admin-tab-btn" data-tab="rejected">❌ 거절됨</button>
      <button class="admin-tab-btn" data-tab="all">📋 전체</button>
      <button class="admin-tab-btn" data-tab="qa">💬 Q&A</button>
      <button class="admin-tab-btn" data-tab="insights">📊 인사이트</button>
      <button class="admin-tab-btn" data-tab="accesslog">🔐 접속기록</button>
      <button class="admin-tab-btn" data-tab="userlog">👥 유저활동</button>
      <button class="admin-tab-btn" data-tab="partner">🤝 파트너</button>
    </div>

    <div id="admin-servers-container" style="max-height: 540px; overflow-y: auto; padding-right:0.3rem; margin-bottom: 1.5rem;">
    </div>

    <div style="padding-top:1.2rem;border-top:1px solid rgba(255,255,255,0.08);display:flex;gap:1rem;align-items:center;flex-wrap:wrap;">
      <div style="flex:1;color:var(--text-secondary);font-size:0.82rem;"><span style="color:var(--accent-color);">RoFolder</span> Admin Hub v2.2.0 (Latest)</div>
      <button id="sql-sync-btn" style="padding:0.5rem 1rem;background:rgba(139, 92, 246, 0.15);border:1px solid rgba(139, 92, 246, 0.3);color:#a78bfa;border-radius:0.5rem;cursor:pointer;font-weight:bold;font-size:0.82rem;">🗄️ SQL 동기화</button>
      <button id="webhook-test-btn" style="padding:0.5rem 1rem;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);color:#10b981;border-radius:0.5rem;cursor:pointer;font-weight:bold;font-size:0.82rem;">🔗 웹훅 테스트</button>
      <button id="manual-backup-btn" style="padding:0.5rem 1rem;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.3);color:var(--accent-color);border-radius:0.5rem;cursor:pointer;font-weight:bold;font-size:0.82rem;">📦 지금 백업</button>
      <button id="admin-logout-btn" style="padding:0.5rem 1.2rem;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#f87171;border-radius:0.5rem;cursor:pointer;font-weight:bold;font-size:0.82rem;">🚪 로그아웃</button>
    </div>
  `;

  modal.classList.remove('hidden');
  document.getElementById('close-admin-modal')!.onclick = () => modal.classList.add('hidden');
  document.getElementById('admin-logout-btn')!.onclick = async () => {
    const confirmed = await showConfirm('로그아웃 하시겠습니까?');
    if (confirmed) {
      sessionStorage.removeItem('admin_token');
      modal.classList.add('hidden');
      showToast('로그아웃 완료', 'success');
    }
  };

  const sqlSyncBtn = document.getElementById('sql-sync-btn');
  if (sqlSyncBtn) {
    sqlSyncBtn.onclick = async () => {
      sqlSyncBtn.innerText = '⏳ 동기화 중...';
      await syncAllServersToDB();
      sqlSyncBtn.innerText = '🗄️ SQL 동기화';
    };
  }

  const manualBackupBtn = document.getElementById('manual-backup-btn');
  if (manualBackupBtn) {
    manualBackupBtn.onclick = async () => {
      manualBackupBtn.innerText = '⏳ 백업 중...';
      manualBackupBtn.setAttribute('disabled', 'true');
      await sendServersBackupToDiscord(true);
      manualBackupBtn.innerText = '📦 지금 백업';
      manualBackupBtn.removeAttribute('disabled');
    };
  }

    const testWebhookBtn = document.getElementById('webhook-test-btn');
    if (testWebhookBtn) {
      testWebhookBtn.onclick = async () => {
        testWebhookBtn.innerText = '⏳ 전송 중...';
        const ok = await sendWebhook({ 
          content: '🔔 **[RoFolder]** 웹훅 연결 테스트 성공! (관리자 탭에서 요청됨)',
          embeds: [{
            title: '🔗 연결 확인 완료',
            description: '현재 사이트에서 디스코드 웹훅으로 데이터를 보낼 수 있는 상태입니다.',
            color: 0x10b981,
            timestamp: new Date().toISOString()
          }]
        });
        testWebhookBtn.innerText = '🔗 웹훅 테스트';
        if (ok) showToast('✅ 테스트 메시지가 전송되었습니다.', 'success');
        else showToast('❌ 테스트 전송 실패! (콘솔 확인)', 'error');
      };
    }

    const refreshBtn = document.getElementById('admin-refresh-btn');
    if (refreshBtn) {
      refreshBtn.onclick = async () => {
        refreshBtn.style.transform = 'rotate(360deg)';
        showToast('데이터 동기화 중...', 'info');
        const newServers = await loadServers();
        if (newServers) {
          servers = newServers;
          applyFilters();
          refreshAdminDashboardIfOpen();
          showToast('새로고침 완료', 'success');
        }
        setTimeout(() => { refreshBtn.style.transform = 'rotate(0deg)'; }, 500);
      };
    }

    // Supabase 진단 정보 추가 (모달 하단)
    const serverStats = getAdminStats();
    const diagnosticHtml = `
      <div style="margin-top: 3rem; padding: 1.5rem; background: rgba(0,0,0,0.3); border-radius: 16px; font-family: monospace; font-size: 0.85rem; color: var(--text-secondary); border: 1px solid var(--card-border);">
        <div style="color: var(--accent-color); font-weight: bold; margin-bottom: 0.5rem;">🔍 시스템 진단 정보 (Supabase)</div>
        <div>📡 DB 응답 서버 수: ${servers.length}개</div>
        <div>⏳ 대기 중 서버: ${serverStats.totalPending}개</div>
        <div>🔌 Supabase 설정 상태: ${isSupabaseConfigured ? '✅ 정상' : '❌ 미설정'}</div>
      </div>
    `;
    content.insertAdjacentHTML('beforeend', diagnosticHtml);

  // 탭 전환 로직 (active 클래스 기반으로 통일)
  const tabBtns = content.querySelectorAll<HTMLButtonElement>('.admin-tab-btn');
  const switchTab = (tab: string) => {
    tabBtns.forEach(b => b.classList.remove('active'));
    const active = content.querySelector<HTMLButtonElement>(`.admin-tab-btn[data-tab="${tab}"]`);
    if (active) active.classList.add('active');
    if (tab === 'qa') renderAdminQA();
    else if (tab === 'insights') renderAdminInsights();
    else if (tab === 'all') renderAllServers();
    else if (tab === 'accesslog') renderAdminAccessLog();
    else if (tab === 'userlog') renderUserActivityLog();
    else if (tab === 'partner') renderPartnerTab();
    else renderAdminServersByStatus(tab as 'pending' | 'approved' | 'rejected');
  };
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab!));
  });

  renderAdminServersByStatus('pending');
}

// 상태별로 서버 목록 렌더링
function renderAdminServersByStatus(status: 'pending' | 'approved' | 'rejected') {
  const container = document.getElementById('admin-servers-container')!;
  const filteredServers = servers.filter(s => s.status === status);
  
  // Approved 탭일 때 JSON 내보내기 버튼 추가
  let headerHTML = '';
  if (status === 'approved' && filteredServers.length > 0) {
    headerHTML = `
      <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem;">
        <button id="export-servers-json-btn" class="submit-button" style="flex: 1; padding: 0.5rem;">
          📥 JSON 내보내기 (servers.json에 복사)
        </button>
      </div>
    `;
  }
  
  if (filteredServers.length === 0) {
    container.innerHTML = `<p style="text-align: center; color: var(--text-secondary); padding: 2rem;">
      ${status === 'pending' ? '대기 중인 서버가' : status === 'approved' ? '승인된 서버가' : '거절된 서버가'} 없습니다.
    </p>`;
    return;
  }

  container.innerHTML = headerHTML + filteredServers.map(server => `
    <div class="server-card glass" style="margin-bottom: 1.5rem;">
      <div class="server-header">
        <img src="${escapeHtml(server.icon)}" class="server-icon" alt="${escapeHtml(server.name)}" style="width: 80px; height: 80px;">
        <div class="server-info" style="flex: 1;">
          <h3>${escapeHtml(server.name)}</h3>
          <div class="server-tags">
            <span class="server-tag">📂 ${escapeHtml(server.category)}</span>
            ${server.tags.map(tag => `<span class="server-tag">${escapeHtml(tag)}</span>`).join('')}
          </div>
        </div>
      </div>
      <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 1rem;">
        📝 ${escapeHtml(server.description)}
      </p>
      <p style="color: var(--text-muted); font-size: 0.8rem; margin-bottom: 1.5rem;">
        🔗 ${escapeHtml(server.inviteLink)}
      </p>
      ${status === 'rejected' && server.rejectionReason ? `
        <p style="color: #ef4444; font-size: 0.85rem; margin-bottom: 1rem; background: rgba(239, 68, 68, 0.1); padding: 0.5rem; border-radius: 0.5rem;">
          📋 거절 사유: ${escapeHtml(server.rejectionReason)}
        </p>
      ` : ''}
      <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
        ${status === 'pending' ? `
          <button class="submit-button approve-btn" data-id="${server.id}" style="flex: 1; min-width: 100px; background: #10b981; padding: 0.75rem; border: none; border-radius: 0.5rem; color: white; cursor: pointer; font-weight: bold; height: 44px;">✅ 승인</button>
          <button class="submit-button edit-btn" data-id="${server.id}" style="flex: 1; min-width: 100px; background: #3b82f6; padding: 0.75rem; border: none; border-radius: 0.5rem; color: white; cursor: pointer; font-weight: bold; height: 44px;">✏️ 수정</button>
          <button class="submit-button reject-btn" data-id="${server.id}" style="flex: 1; min-width: 100px; background: #ef4444; padding: 0.75rem; border: none; border-radius: 0.5rem; color: white; cursor: pointer; font-weight: bold; height: 44px;">❌ 거절</button>
        ` : status === 'approved' ? `
          <button class="submit-button toggle-partner-btn" data-id="${server.id}" style="flex: 1; min-width: 100px; background: ${server.isPartner ? '#6b7280' : 'linear-gradient(135deg, #fbbf24, #f59e0b)'}; padding: 0.75rem; border: none; border-radius: 0.5rem; color: white; cursor: pointer; font-weight: bold; height: 44px;">${server.isPartner ? '🤝 파트너 해제' : '🤝 파트너 지정'}</button>
          <button class="submit-button edit-btn" data-id="${server.id}" style="flex: 1; min-width: 100px; background: #3b82f6; padding: 0.75rem; border: none; border-radius: 0.5rem; color: white; cursor: pointer; font-weight: bold; height: 44px;">✏️ 수정</button>
          <button class="submit-button reject-btn" data-id="${server.id}" style="flex: 1; min-width: 100px; background: #f59e0b; padding: 0.75rem; border: none; border-radius: 0.5rem; color: white; cursor: pointer; font-weight: bold; height: 44px;">⬇️ 거절</button>
          <button class="submit-button delete-btn" data-id="${server.id}" style="flex: 1; min-width: 100px; background: #ef4444; padding: 0.75rem; border: none; border-radius: 0.5rem; color: white; cursor: pointer; font-weight: bold; height: 44px;">🗑️ 삭제</button>
        ` : `
          <button class="submit-button edit-btn" data-id="${server.id}" style="flex: 1; min-width: 100px; background: #3b82f6; padding: 0.75rem; border: none; border-radius: 0.5rem; color: white; cursor: pointer; font-weight: bold; height: 44px;">✏️ 수정</button>
          <button class="submit-button rereview-btn" data-id="${server.id}" style="flex: 1; min-width: 100px; background: #8b5cf6; padding: 0.75rem; border: none; border-radius: 0.5rem; color: white; cursor: pointer; font-weight: bold; height: 44px;">🔄 재검토</button>
          <button class="submit-button delete-btn" data-id="${server.id}" style="flex: 1; min-width: 100px; background: #ef4444; padding: 0.75rem; border: none; border-radius: 0.5rem; color: white; cursor: pointer; font-weight: bold; height: 44px;">🗑️ 삭제</button>
        `}
      </div>
    </div>
  `).join('');

  // 이벤트 리스너 등록
  container.querySelectorAll('.toggle-partner-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = parseInt((e.currentTarget as HTMLButtonElement).dataset.id!);
      const server = servers.find(s => s.id === id);
      if (server) {
        server.isPartner = !server.isPartner;
        if (server.isPartner && !server.tags.includes('파트너')) {
          server.tags.push('파트너');
        } else if (!server.isPartner) {
          server.tags = server.tags.filter(t => t !== '파트너');
        }
        saveServers();
        await syncServerToDB(server); // SQL에 자동 입력되게
        renderAdminServersByStatus('approved');
        renderServers(); // 메인 페이지 동기화
        const actionStr = server.isPartner ? '지정' : '해제';
        showToast(`🤝 파트너로 ${actionStr}되었습니다. (SQL 동기화 완료)`, 'success');
      }
    });
  });

  container.querySelectorAll('.approve-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = parseInt((e.currentTarget as HTMLButtonElement).dataset.id!);
      approveServer(id);
    });
  });

  container.querySelectorAll('.reject-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = parseInt((e.currentTarget as HTMLButtonElement).dataset.id!);
      const reason = await showPromptModal('거절 사유를 입력해주세요:', '예: 서버 규칙 위반');
      if (reason) {
        rejectServer(id, reason);
      }
    });
  });

  container.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = parseInt((e.currentTarget as HTMLButtonElement).dataset.id!);
      editServer(id);
    });
  });

  container.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = parseInt((e.currentTarget as HTMLButtonElement).dataset.id!);
      const confirmed = await showConfirm('정말 이 서버를 삭제하시겠습니까?');
      if (confirmed) {
        deleteServer(id);
      }
    });
  });

  container.querySelectorAll('.rereview-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = parseInt((e.currentTarget as HTMLButtonElement).dataset.id!);
      updateServerStatus(id, 'pending');
    });
  });

  // JSON 내보내기 버튼 핸들러
  const exportBtn = document.getElementById('export-servers-json-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const approvedServers = servers.filter(s => s.status === 'approved');
      const jsonData = {
        servers: approvedServers
      };
      const jsonString = JSON.stringify(jsonData, null, 2);
      
      // 클립보드에 복사
      navigator.clipboard.writeText(jsonString).then(() => {
        showToast('✅ JSON이 클립보드에 복사되었습니다!', 'success');
      }).catch(() => {
        // 클립보드 복사 실패 시 다운로드
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'servers.json';
        a.click();
        URL.revokeObjectURL(url);
        showToast('✅ servers.json이 다운로드되었습니다!', 'success');
      });
    });
  }

  updateAdminTabBadges();
}

// 관리자 탭 뱃지 실시간 업데이트
function updateAdminTabBadges() {
  const stats = getAdminStats();
  
  // 탭 뱃지 업데이트
  const pendingBadge = document.querySelector('.admin-tab-btn[data-tab="pending"] .tab-badge');
  if (pendingBadge) pendingBadge.textContent = stats.totalPending.toString();
  
  // 메인 통계 카드 스타일 컨테이너 업데이트
  const statCards = document.querySelectorAll('.stat-card h3');
  if (statCards.length >= 3) {
    statCards[0].textContent = stats.totalPending.toString();
    statCards[1].textContent = stats.totalApproved.toString();
    statCards[2].textContent = stats.totalRejected.toString();
  }
}

// 모든 서버 목록 렌더링 (상태 무관)
function renderAllServers() {
  const container = document.getElementById('admin-servers-container')!;

  if (servers.length === 0) {
    container.innerHTML = `<p style="text-align: center; color: var(--text-secondary); padding: 2rem;">등록된 서버가 없습니다.</p>`;
    return;
  }

  const statusBadge = (s: DiscordServer) => {
    if (s.status === 'approved') return `<span style="background: rgba(16,185,129,0.2); color: #10b981; padding: 0.2rem 0.6rem; border-radius: 0.5rem; font-size: 0.8rem;">✅ 승인</span>`;
    if (s.status === 'pending')  return `<span style="background: rgba(99,102,241,0.2); color: #6366f1; padding: 0.2rem 0.6rem; border-radius: 0.5rem; font-size: 0.8rem;">⏳ 대기</span>`;
    return `<span style="background: rgba(239,68,68,0.2); color: #ef4444; padding: 0.2rem 0.6rem; border-radius: 0.5rem; font-size: 0.8rem;">❌ 거절</span>`;
  };

  container.innerHTML = `
    <div style="margin-bottom: 1rem; color: var(--text-secondary); font-size: 0.9rem;">총 ${servers.length}개의 서버</div>
    ${servers.map(server => `
      <div class="server-card glass" style="margin-bottom: 1rem; padding: 1.2rem; border-radius: 1rem;">
        <div style="display: flex; align-items: center; gap: 1rem;">
          <img src="${escapeHtml(server.icon)}" alt="${escapeHtml(server.name)}" style="width: 56px; height: 56px; border-radius: 12px; object-fit: cover;" onerror="this.src='https://api.dicebear.com/7.x/identicon/svg?seed=${server.id}';">
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.4rem; flex-wrap: wrap;">
              <h4 style="margin: 0; font-size: 1rem; color: var(--text-primary);">${escapeHtml(server.name)}</h4>
              ${statusBadge(server)}
              <span style="background: rgba(255,255,255,0.07); color: var(--text-secondary); padding: 0.2rem 0.6rem; border-radius: 0.5rem; font-size: 0.8rem;">📂 ${escapeHtml(server.category)}</span>
            </div>
            <p style="margin: 0; color: var(--text-secondary); font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(server.description)}</p>
          </div>
          <button class="all-delete-btn" data-id="${server.id}" style="flex-shrink: 0; background: #ef4444; color: white; border: none; padding: 0.5rem 1rem; border-radius: 0.5rem; cursor: pointer; font-weight: bold; font-size: 0.85rem;">🗑️ 삭제</button>
        </div>
      </div>
    `).join('')}
  `;

  container.querySelectorAll('.all-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = parseInt((e.target as HTMLButtonElement).dataset.id!);
      const server = servers.find(s => s.id === id);
      const confirmed = await showConfirm(`"${server?.name}" 서버를 삭제하시겠습니까?`);
      if (confirmed) {
        const idx = servers.findIndex(s => s.id === id);
        if (idx !== -1) {
          servers.splice(idx, 1);
          saveServers();
          
          // DB 삭제 (Supabase)
          if (isSupabaseConfigured) {
            supabase.from('servers').delete().eq('id', id).then(({ error }) => {
              if (error) console.error('❌ [Supabase Delete] 실패:', error);
              refreshAdminDashboardIfOpen();
            });
          }
          
          showToast('서버가 삭제되었습니다.', 'success');
          renderAllServers();
        }
      }
    });
  });
}

// 🤝 파트너 서버 관리 탭
function renderPartnerTab() {
  const container = document.getElementById('admin-servers-container')!;
  const partnerServers = servers.filter(s => s.status === 'approved' && (s.isPartner === true || (s.tags && s.tags.includes('파트너'))));
  const availableServers = servers.filter(s => s.status === 'approved' && !(s.isPartner === true || (s.tags && s.tags.includes('파트너'))));

  container.innerHTML = `
    <div style="margin-bottom: 2rem;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.2rem;">
        <h3 style="color: var(--accent-color); margin: 0; font-size: 1.1rem;">🎖️ 현재 파트너 (${partnerServers.length}개)</h3>
        <span style="color:var(--text-muted);font-size:0.8rem;">파트너 서버는 메인 Top 10에 우선 노출됩니다</span>
      </div>
      ${partnerServers.length === 0 
        ? '<p style="color: var(--text-secondary); text-align: center; padding: 2rem;">지정된 파트너 서버가 없습니다.</p>' 
        : partnerServers.map(server => `
        <div class="server-card glass" style="margin-bottom: 1rem; border-left: 3px solid #fbbf24;">
          <div class="server-header" style="margin-bottom: 0.75rem;">
            <img src="${escapeHtml(server.icon)}" class="server-icon" alt="${escapeHtml(server.name)}" style="width: 56px; height: 56px;" onerror="this.src='https://api.dicebear.com/7.x/identicon/svg?seed=${server.id}'">
            <div class="server-info" style="flex: 1;">
              <h3 style="font-size: 1rem; display: flex; align-items: center; gap: 0.5rem;">
                ${escapeHtml(server.name)}
                <span style="background: linear-gradient(135deg, #fbbf24, #f59e0b); color: #1a1a2e; padding: 2px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 700;">PARTNER</span>
              </h3>
              <p style="color: var(--text-secondary); font-size: 0.8rem; margin: 0.25rem 0 0;">${escapeHtml(server.category)} · 👍 ${server.recommendations || 0} · 👁️ ${server.clicks || 0}</p>
            </div>
          </div>
          <button class="partner-remove-btn submit-button" data-id="${server.id}" style="width: 100%; background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.3); padding: 0.5rem; border-radius: 0.5rem; cursor: pointer; font-weight: bold; font-size: 0.85rem;">
            ❌ 파트너 해제
          </button>
        </div>
      `).join('')}
    </div>

    <div>
      <h3 style="color: var(--text-primary); margin-bottom: 1.2rem; font-size: 1.1rem;">➕ 승인된 서버에서 파트너 지정</h3>
      ${availableServers.length === 0 
        ? '<p style="color: var(--text-secondary); text-align: center; padding: 2rem;">파트너로 지정할 수 있는 승인된 서버가 없습니다.</p>' 
        : availableServers.map(server => `
        <div class="server-card glass" style="margin-bottom: 0.75rem; padding: 0.75rem 1rem;">
          <div style="display: flex; align-items: center; gap: 1rem;">
            <img src="${escapeHtml(server.icon)}" style="width: 40px; height: 40px; border-radius: 12px;" alt="${escapeHtml(server.name)}" onerror="this.src='https://api.dicebear.com/7.x/identicon/svg?seed=${server.id}'">
            <div style="flex: 1; min-width: 0;">
              <h4 style="font-size: 0.9rem; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(server.name)}</h4>
              <span style="color: var(--text-muted); font-size: 0.75rem;">${escapeHtml(server.category)}</span>
            </div>
            <button class="partner-add-btn submit-button" data-id="${server.id}" style="background: linear-gradient(135deg, #fbbf24, #f59e0b); color: #1a1a2e; border: none; padding: 0.4rem 1rem; border-radius: 0.5rem; cursor: pointer; font-weight: bold; font-size: 0.8rem; white-space: nowrap;">
              🤝 지정
            </button>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  // 파트너 추가 버튼
  container.querySelectorAll('.partner-add-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = parseInt((e.currentTarget as HTMLButtonElement).dataset.id!);
      const server = servers.find(s => s.id === id);
      if (server) {
        server.isPartner = true;
        if (!server.tags.includes('파트너')) {
          server.tags.push('파트너');
        }
        saveServers();
        await syncServerToDB(server);
        showToast(`🤝 "${server.name}"이(가) 파트너로 지정되었습니다!`, 'success');
        renderPartnerTab();
        renderServers(); // 메인 페이지 동기화
      }
    });
  });

  // 파트너 해제 버튼
  container.querySelectorAll('.partner-remove-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = parseInt((e.currentTarget as HTMLButtonElement).dataset.id!);
      const server = servers.find(s => s.id === id);
      if (server) {
        server.isPartner = false;
        server.tags = server.tags.filter(t => t !== '파트너');
        saveServers();
        await syncServerToDB(server);
        showToast(`❌ "${server.name}" 파트너가 해제되었습니다.`, 'info');
        renderPartnerTab();
        renderServers(); // 메인 페이지 동기화
      }
    });
  });
}

// Q&A 관리 렌더링
function renderAdminQA() {
  const container = document.getElementById('admin-servers-container')!;
  const qaDataStr = localStorage.getItem('rofolder_qa_v1') || '[]';
  let qaData: Array<{ id: number; question: string; answer: string; votes: number; createdAt: number }> = [];
  try {
    qaData = JSON.parse(qaDataStr);
  } catch (e) {
    qaData = [];
  }
  
  // 답변 안 된 질문 우선
  const unanswered = qaData.filter(q => !q.answer || q.answer.length === 0).sort((a, b) => b.createdAt - a.createdAt);
  const answered = qaData.filter(q => q.answer && q.answer.length > 0).sort((a, b) => b.votes - a.votes);
  
  container.innerHTML = `
    <div style="margin-bottom: 2rem;">
      <h3 style="color: var(--text-primary); margin-bottom: 1rem;">❓ 미답변 질문 (${unanswered.length}개)</h3>
      ${unanswered.length === 0 ? '<p style="color: var(--text-secondary);">모든 질문이 답변되었습니다!</p>' : ''}
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        ${unanswered.map(qa => `
          <div class="glass" style="padding: 1.5rem; border-radius: 0.75rem;">
            <p style="margin: 0 0 1rem 0; color: var(--text-primary); font-weight: bold;">❓ ${qa.question}</p>
            <div style="display: flex; gap: 1rem;">
              <input type="text" class="qa-answer-input" data-id="${qa.id}" placeholder="답변을 입력하세요..." style="flex: 1; padding: 0.75rem; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); border-radius: 0.5rem; color: var(--text-primary);">
              <button class="submit-qa-btn" data-id="${qa.id}" style="padding: 0.75rem 1.5rem; background: var(--accent-color); color: white; border: none; border-radius: 0.5rem; cursor: pointer; font-weight: bold;">✅ 저장</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
    
    </div>
    
    <div>
      <h3 style="color: var(--text-primary); margin-bottom: 1rem;">✅ 답변된 질문 (${answered.length}개)</h3>
      <div style="display: flex; flex-direction: column; gap: 1rem; max-height: 400px; overflow-y: auto;">
        ${answered.length === 0 ? '<p style="color: var(--text-secondary);">아직 답변된 질문이 없습니다.</p>' : ''}
        ${answered.map(qa => `
          <div class="glass" style="padding: 1rem; border-radius: 0.75rem;">
            <p style="margin: 0 0 0.5rem 0; color: var(--text-primary); font-weight: bold;">❓ ${qa.question}</p>
            <p style="margin: 0 0 0.5rem 0; color: var(--text-secondary);">✅ ${qa.answer}</p>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="color: var(--text-secondary); font-size: 0.85rem;">👍 추천 ${qa.votes}회</span>
              <button class="delete-qa-btn" data-id="${qa.id}" style="background: #ef4444; color: white; border: none; padding: 0.5rem 1rem; border-radius: 0.25rem; cursor: pointer; font-size: 0.85rem;">🗑️ 삭제</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  
  // 답변 저장 버튼
  container.querySelectorAll('.submit-qa-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const qaId = parseInt((btn as HTMLElement).dataset.id!);
      const input = container.querySelector<HTMLInputElement>(`.qa-answer-input[data-id="${qaId}"]`)!;
      const answer = input.value.trim();
      if (!answer || answer.length < 3) {
        showToast('❌ 답변은 3자 이상이어야 합니다.', 'error');
        return;
      }
      const qa = qaData.find(q => q.id === qaId);
      if (qa) {
        qa.answer = escapeHtml(answer);
        localStorage.setItem('rofolder_qa_v1', JSON.stringify(qaData));
        showToast('✅ 답변이 저장되었습니다!', 'success');
        renderAdminQA();
      }
    });
  });
  
  // 질문 삭제 버튼
  container.querySelectorAll('.delete-qa-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const qaId = parseInt((btn as HTMLElement).dataset.id!);
      const confirmed = await showConfirm('이 질문을 삭제하시겠습니까?');
      if (confirmed) {
        qaData = qaData.filter(q => q.id !== qaId);
        localStorage.setItem('rofolder_qa_v1', JSON.stringify(qaData));
        showToast('✅ 질문이 삭제되었습니다!', 'success');
        renderAdminQA();
      }
    });
  });
}

// 인사이트 렌더링 (클릭/추천 통계)
function renderAdminInsights() {
  const container = document.getElementById('admin-servers-container')!;
  
  // 통계 계산
  const totalClicks = servers.reduce((sum, s) => sum + (s.clicks || 0), 0);
  const totalRecommendations = servers.reduce((sum, s) => sum + (s.recommendations || 0), 0);
  const approvedServers = servers.filter(s => s.status === 'approved');
  const avgClicksPerServer = approvedServers.length > 0 ? Math.round(totalClicks / approvedServers.length) : 0;
  const avgRecommendationsPerServer = approvedServers.length > 0 ? Math.round(totalRecommendations / approvedServers.length) : 0;
  
  // 상단 3개 서버별 통계
  const topByClicks = [...servers]
    .filter(s => s.status === 'approved')
    .sort((a, b) => (b.clicks || 0) - (a.clicks || 0))
    .slice(0, 3);
  
  const topByRecommendations = [...servers]
    .filter(s => s.status === 'approved')
    .sort((a, b) => (b.recommendations || 0) - (a.recommendations || 0))
    .slice(0, 3);
  
  const insightsHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.5rem; margin-bottom: 2rem;">
      <div class="stat-card glass" style="padding: 2rem; border-radius: 1rem; background: rgba(99, 102, 241, 0.1); backdrop-filter: blur(10px);">
        <h4 style="color: var(--text-secondary); font-size: 0.9rem; margin: 0 0 0.5rem 0;">📊 총 클릭 수</h4>
        <h3 style="color: #3b82f6; font-size: 2.5rem; margin: 0;">${totalClicks.toLocaleString()}</h3>
        <p style="color: var(--text-secondary); font-size: 0.85rem; margin: 0.5rem 0 0 0;">평균: ${avgClicksPerServer}회/서버</p>
      </div>
      
      <div class="stat-card glass" style="padding: 2rem; border-radius: 1rem; background: rgba(250, 130, 49, 0.1); backdrop-filter: blur(10px);">
        <h4 style="color: var(--text-secondary); font-size: 0.9rem; margin: 0 0 0.5rem 0;">👍 총 추천 수</h4>
        <h3 style="color: #fa8231; font-size: 2.5rem; margin: 0;">${totalRecommendations.toLocaleString()}</h3>
        <p style="color: var(--text-secondary); font-size: 0.85rem; margin: 0.5rem 0 0 0;">평균: ${avgRecommendationsPerServer}회/서버</p>
      </div>
      
      <div class="stat-card glass" style="padding: 2rem; border-radius: 1rem; background: rgba(16, 185, 129, 0.1); backdrop-filter: blur(10px);">
        <h4 style="color: var(--text-secondary); font-size: 0.9rem; margin: 0 0 0.5rem 0;">✅ 승인된 서버</h4>
        <h3 style="color: #10b981; font-size: 2.5rem; margin: 0;">${approvedServers.length}</h3>
        <p style="color: var(--text-secondary); font-size: 0.85rem; margin: 0.5rem 0 0 0;">총 ${servers.length}개 중</p>
      </div>
    </div>
    
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-bottom: 2rem;">
      <div>
        <h3 style="color: var(--text-primary); margin-bottom: 1rem; font-size: 1.1rem;">👁️ 인기 클릭 Top 3</h3>
        <div style="display: flex; flex-direction: column; gap: 1rem;">
          ${topByClicks.length > 0 ? topByClicks.map((server, idx) => `
            <div class="glass" style="padding: 1rem; border-radius: 0.75rem; display: flex; align-items: center; gap: 1rem;">
              <img src="${escapeHtml(server.icon)}" alt="${escapeHtml(server.name)}" style="width: 45px; height: 45px; border-radius: 50%; object-fit: cover;" onerror="this.src='https://api.dicebear.com/7.x/identicon/svg?seed=${server.id}';">
              <div style="flex: 1;">
                <p style="margin: 0; color: var(--text-primary); font-weight: bold;">${idx + 1}. ${escapeHtml(server.name)}</p>
                <p style="margin: 0.25rem 0 0 0; color: var(--text-secondary); font-size: 0.9rem;">👁️ ${(server.clicks || 0).toLocaleString()} 클릭</p>
              </div>
            </div>
          `).join('') : '<p style="color: var(--text-secondary);">데이터 없음</p>'}
        </div>
      </div>
      
      <div>
        <h3 style="color: var(--text-primary); margin-bottom: 1rem; font-size: 1.1rem;">👍 추천 순위 Top 3</h3>
        <div style="display: flex; flex-direction: column; gap: 1rem;">
          ${topByRecommendations.length > 0 ? topByRecommendations.map((server, idx) => `
            <div class="glass" style="padding: 1rem; border-radius: 0.75rem; display: flex; align-items: center; gap: 1rem;">
              <img src="${escapeHtml(server.icon)}" alt="${escapeHtml(server.name)}" style="width: 45px; height: 45px; border-radius: 50%; object-fit: cover;" onerror="this.src='https://api.dicebear.com/7.x/identicon/svg?seed=${server.id}';">
              <div style="flex: 1;">
                <p style="margin: 0; color: var(--text-primary); font-weight: bold;">${idx + 1}. ${escapeHtml(server.name)}</p>
                <p style="margin: 0.25rem 0 0 0; color: var(--text-secondary); font-size: 0.9rem;">👍 ${(server.recommendations || 0).toLocaleString()} 추천</p>
              </div>
            </div>
          `).join('') : '<p style="color: var(--text-secondary);">데이터 없음</p>'}
        </div>
      </div>
    </div>
    
    <h3 style="color: var(--text-primary); margin-bottom: 1rem; font-size: 1.1rem;">📈 전체 서버 성능 현황</h3>
    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; max-height: 400px; overflow-y: auto;">
      ${servers.filter(s => s.status === 'approved').map((server) => `
        <div class="glass" style="padding: 1rem; border-radius: 0.75rem; position: relative;">
          <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem;">
            <img src="${escapeHtml(server.icon)}" alt="${escapeHtml(server.name)}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover;" onerror="this.src='https://api.dicebear.com/7.x/identicon/svg?seed=${server.id}';">
            <h4 style="margin: 0; color: var(--text-primary); font-size: 0.95rem; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(server.name)}</h4>
          </div>
          <div style="display: flex; gap: 1rem; justify-content: space-between; padding: 0.75rem; background: rgba(99, 102, 241, 0.05); border-radius: 0.5rem;">
            <div style="text-align: center;">
              <p style="margin: 0; color: var(--text-secondary); font-size: 0.8rem;">클릭</p>
              <p style="margin: 0.25rem 0 0 0; color: #3b82f6; font-weight: bold; font-size: 1.1rem;">${(server.clicks || 0).toLocaleString()}</p>
            </div>
            <div style="border-left: 1px solid var(--text-secondary, rgba(255,255,255,0.1));"></div>
            <div style="text-align: center;">
              <p style="margin: 0; color: var(--text-secondary); font-size: 0.8rem;">추천</p>
              <p style="margin: 0.25rem 0 0 0; color: #fa8231; font-weight: bold; font-size: 1.1rem;">${(server.recommendations || 0).toLocaleString()}</p>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
  
  container.innerHTML = insightsHTML;
}




// 대기 중인 서버 목록 렌더링 (레거시 - 호환성 유지)
// @ts-ignore
function renderPendingServers() {
  renderAdminServersByStatus('pending');
}

// 서버 승인
function approveServer(id: number) {
  const server = servers.find(s => s.id === id);
  if (!server) return;

  server.status = 'approved';
  server.approvedAt = Date.now();
  // 신규 태그는 동적으로 계산되므로 정적으로 추가하지 않음
  // 기존 '신규' 정적 태그가 있으면 제거
  server.tags = server.tags.filter(t => t !== '신규');
  
  saveServers();
  syncServerToDB(server); // DB 동기화
  
  // 현재 탭의 상태를 유지하며 재렌더링
  const currentTab = document.querySelector('.admin-tab-btn.active')?.getAttribute('data-tab') as 'pending' | 'approved' | 'rejected' || 'pending';
  renderAdminServersByStatus(currentTab);
  updateAdminTabBadges();
  
  // Discord Webhook으로 승인 알림 (선택)
  if (config.webhookUrl && config.webhookUrl.startsWith('https://discord.com')) {
    fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          title: '✅ 서버 승인됨',
          description: `**${escapeHtml(server.name)}**이 승인되었습니다.`,
          color: 0x10b981,
          fields: [
            { name: '카테고리', value: escapeHtml(server.category) },
            { name: '초대 링크', value: `[링크](${server.inviteLink})` }
          ],
          footer: { text: 'RoFolder Admin System' },
          timestamp: new Date().toISOString()
        }]
      })
    }).catch(e => console.error('Webhook 실패:', e));
  }
}

// 서버 거절
function rejectServer(id: number, reason: string) {
  const server = servers.find(s => s.id === id);
  if (!server) return;

  server.status = 'rejected';
  server.rejectionReason = reason;
  saveServers();
  syncServerToDB(server); // DB 동기화
  
  // 현재 탭의 상태를 유지하며 재렌더링
  const currentTab = document.querySelector('.admin-tab-btn.active')?.getAttribute('data-tab') as 'pending' | 'approved' | 'rejected' || 'pending';
  renderAdminServersByStatus(currentTab);
  updateAdminTabBadges();
  
  alert('✅ 서버가 거절되었습니다.');
}

// 서버 수정
function editServer(id: number) {
  const server = servers.find(s => s.id === id);
  if (!server) return;

  const modal = document.querySelector<HTMLDivElement>('#register-modal-container')!;
  const content = document.getElementById('register-modal-content')!;
  
  content.innerHTML = `
    <button class="modal-close" id="close-reg-modal">&times;</button>
    <h2 style="margin-bottom: 2.5rem; font-size: 1.8rem;">✏️ 서버 정보 수정</h2>
    <form id="edit-form" class="register-form">
      <div style="display: flex; gap: 2rem; align-items: flex-end; margin-bottom: 1rem;">
        <div class="form-group">
          <label>서버 아이콘</label>
          <div class="image-preview-container">
            <img id="image-preview" src="${escapeHtml(server.icon)}" alt="미리보기" onerror="this.src='https://api.dicebear.com/7.x/identicon/svg?seed=${server.id}'">
          </div>
        </div>
        <div class="form-group" style="flex: 1;">
          <label>아이콘 변경</label>
          <input type="file" id="icon-upload" accept=".png,.svg,.webp,image/png,image/svg+xml,image/webp" class="form-input">
        </div>
      </div>
      <div class="form-group">
        <label>서버 이름</label>
        <input type="text" id="reg-name" class="form-input" value="${escapeHtml(server.name)}" required>
      </div>
      <div class="form-group">
        <label>카테고리 선택</label>
        <div id="category-chips" class="category-chips">
          ${config.serverTags.map((tag) => `
            <button type="button" class="chip${(server.tags || []).includes(tag.value) || tag.value === server.category ? ' active' : ''}" data-value="${tag.value}">
              ${tag.emoji} ${tag.label}
            </button>
          `).join('')}
        </div>
        <input type="hidden" id="reg-category" value="${server.category}">
      </div>
      <div class="form-group">
        <label>서버 설명</label>
        <textarea id="reg-desc" class="form-textarea" rows="4" required>${escapeHtml(server.description)}</textarea>
      </div>
      <div class="form-group">
        <label>디스코드 초대 링크</label>
        <input type="url" id="reg-link" class="form-input" value="${escapeHtml(server.inviteLink)}" required>
      </div>
      <div class="form-group">
        <label>🏆 관리자 태그 선택</label>
        <div class="admin-tag-selector">
          ${config.adminOnlyTags.map(tag => `
            <button type="button" class="admin-tag-chip${(server.tags || []).includes(tag.value) ? ' selected' : ''}" data-tag-value="${tag.value}" data-tag-label="${tag.label}">
              ${tag.emoji} ${tag.label}
            </button>
          `).join('')}
        </div>
        <input type="hidden" id="admin-tags" value="${(server.tags || []).filter(t => config.adminOnlyTags.map(a => a.value).includes(t)).join(',')}">
      </div>
      <div style="display: flex; gap: 1rem;">
        <button type="submit" class="submit-button" style="flex: 1;">💾 저장</button>
        <button type="button" id="cancel-edit" class="detail-button" style="flex: 1; background: #6b7280; color: white;">취소</button>
      </div>
    </form>
  `;

  const adminModal = document.getElementById('admin-modal-container');
  if (adminModal) adminModal.style.display = 'none'; // 관리자 창 뒤로 숨김

  modal.classList.remove('hidden');
  
  const close = () => {
    modal.classList.add('hidden');
    if (adminModal) adminModal.style.display = ''; // 관리자 창 복구
  };
  
  document.getElementById('close-reg-modal')!.onclick = close;
  document.getElementById('cancel-edit')!.onclick = close;

  const form = document.getElementById('edit-form') as HTMLFormElement;
  const iconInput = document.getElementById('icon-upload') as HTMLInputElement;
  const preview = document.getElementById('image-preview') as HTMLImageElement;

  // 아이콘 미리보기 및 검증
  iconInput.onchange = async () => {
    if (iconInput.files && iconInput.files[0]) {
      const file = iconInput.files[0];
      const allowedTypes = ['image/png', 'image/svg+xml', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        alert('❌ 지원하지 않는 파일 형식입니다.\\nPNG, SVG, WEBP만 지원합니다.');
        iconInput.value = '';
        return;
      }
      try {
        preview.src = await convertImageToBase64(file);
      } catch (err) {
        preview.src = URL.createObjectURL(file);
      }
    }
  };

  // 카테고리 칩 다중 선택 (토글 방식)
  const chips = document.querySelectorAll('.category-chips .chip');
  const catInput = document.getElementById('reg-category') as HTMLInputElement;
  chips.forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      chip.classList.toggle('active');
      
      const selected = Array.from(chips)
        .filter(c => c.classList.contains('active'))
        .map(c => (c as HTMLButtonElement).dataset.value!);
      
      // 첫 번째 선택된 카테고리를 메인 카테고리로 설정
      if (selected.length > 0) {
        catInput.value = selected[0];
      }
    });
  });

  // 관리자 태그 선택
  const adminTagChips = document.querySelectorAll('.admin-tag-chip');
  const adminTagsInput = document.getElementById('admin-tags') as HTMLInputElement;
  adminTagChips.forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      chip.classList.toggle('selected');
      const selectedTags = Array.from(adminTagChips)
        .filter(c => c.classList.contains('selected'))
        .map(c => (c as HTMLButtonElement).dataset.tagValue!);
      adminTagsInput.value = selectedTags.join(',');
    });
  });

  // 폼 제출
  form.onsubmit = async (e) => {
    e.preventDefault();
    
    const nameInput = (document.getElementById('reg-name') as HTMLInputElement).value.trim();
    const descInput = (document.getElementById('reg-desc') as HTMLTextAreaElement).value.trim();
    const catInput = (document.getElementById('reg-category') as HTMLInputElement).value;
    const linkInput = (document.getElementById('reg-link') as HTMLInputElement).value.trim();
    const adminTagsInput = (document.getElementById('admin-tags') as HTMLInputElement).value;

    // 입력 검증
    const validation = validateServerData({
      name: nameInput,
      description: descInput,
      inviteLink: linkInput
    });

    if (!validation.valid) {
      alert('❌ 입력 오류:\n' + validation.errors.join('\n'));
      return;
    }

    const isBad = containsForbiddenContent(nameInput) || containsForbiddenContent(descInput);
    if (isBad) {
      alert('⚠️ 부적절한 키워드가 포함되어 있습니다.\n(도박, 성인, 불법 등)');
      return;
    }

    // 서버 정보 업데이트
    server.name = nameInput;
    server.description = descInput;
    server.category = catInput;
    server.inviteLink = linkInput;
    if (preview.src && !preview.src.includes('identicon')) {
      server.icon = preview.src;
    }

    // 선택된 모든 카테고리 태그 모으기
    const selectedCategoryTags = Array.from(document.querySelectorAll('.category-chips .chip.active'))
      .map(c => (c as HTMLButtonElement).dataset.value!);

    // 관리자 태그 업데이트
    const adminTags = adminTagsInput ? adminTagsInput.split(',').filter(Boolean) : [];
    
    // 최종 태그 조합 (카테고리 + 관리자 태그 + '인증됨' 등 기존 특수 태그 유지)
    // 단, config.serverTags와 config.adminOnlyTags에 정의된 것들은 새로 선택된 걸로 덮어씀
    const otherTags = server.tags.filter(t => 
      !config.serverTags.some(s => s.value === t) && 
      !config.adminOnlyTags.some(a => a.value === t)
    );
    
    server.tags = [...new Set([...otherTags, ...selectedCategoryTags, ...adminTags])];

    // 파트너 상태 명시적 동기화
    server.isPartner = adminTags.includes('파트너');

    saveServers();
    await syncServerToDB(server); // DB 동기화
    alert('✅ 서버 정보가 수정되었습니다.');
    
    // 닫기 작업: 수정 폼 숨기고, 관리자 창 복구
    modal.classList.add('hidden');
    if (adminModal) adminModal.style.display = '';
    
    // 관리자 대시보드 새로고침
    const currentTab = document.querySelector('.admin-tab-btn.active')?.getAttribute('data-tab') as 'pending' | 'approved' | 'rejected' || 'approved';
    renderAdminServersByStatus(currentTab);
    renderServers(); // 메인 페이지 동기화
  };
}

// 서버 삭제 (로컬 + Supabase 동시 삭제)
async function deleteServer(id: number) {
  const server = servers.find(s => s.id === id);
  if (!server) return;

  const index = servers.indexOf(server);
  servers.splice(index, 1);
  saveServers();
  
  // DB 삭제 (Supabase) — 반드시 DB에서도 제거
  if (isSupabaseConfigured) {
    try {
      const { error } = await supabase.from('servers').delete().eq('id', id);
      if (error) {
        console.error('❌ [Supabase Delete] 실패:', error);
        showToast('⚠️ 로컬에서는 삭제되었으나 DB 동기화에 실패했습니다.', 'error');
      } else {
        console.log(`✅ [Supabase Delete] 서버 ID ${id} DB에서 삭제 완료`);
        showToast('✅ 서버가 완전히 삭제되었습니다. (로컬 + DB)', 'success');
      }
    } catch (e) {
      console.error('❌ [Supabase Delete] 예외 발생:', e);
      showToast('⚠️ DB 삭제 중 오류가 발생했습니다.', 'error');
    }
  } else {
    showToast('✅ 서버가 삭제되었습니다. (로컬)', 'success');
  }
  
  // 관리자 대시보드 새로고침
  const currentTab = document.querySelector('.admin-tab-btn.active')?.getAttribute('data-tab') as 'pending' | 'approved' | 'rejected' || 'approved';
  renderAdminServersByStatus(currentTab);
  updateAdminTabBadges();
  renderServers(); // 메인 페이지 동기화
}

// 서버 상태 변경
function updateServerStatus(id: number, newStatus: 'pending' | 'approved' | 'rejected') {
  const server = servers.find(s => s.id === id);
  if (!server) return;

  server.status = newStatus;
  if (newStatus === 'pending') {
    delete server.approvedAt;
    delete server.rejectionReason;
  } else if (newStatus === 'approved') {
    server.approvedAt = Date.now();
  }
  
  saveServers();
  syncServerToDB(server); // DB 동기화
  
  // 승인된 경우 servers.json 업데이트 (자동 커밋용)
  if (newStatus === 'approved') {
    exportApprovedServersToJSON();
  }
  
  alert('✅ 서버 상태가 변경되었습니다.');
  updateAdminTabBadges();
  renderServers(); // 메인 페이지 동기화
}

// Approved 서버들을 JSON 형식으로 내보내기 (DevTools용)
function exportApprovedServersToJSON() {
  const approvedServers = servers.filter(s => s.status === 'approved');
  const jsonData = {
    servers: approvedServers
  };
  
  // 콘솔에 출력 (DevTools에서 복사할 수 있도록)
  console.log('📋 다음을 servers.json으로 저장하세요:');
  console.log(JSON.stringify(jsonData, null, 2));
  
  // localStorage에도 임시 저장
  localStorage.setItem('exported_servers_json', JSON.stringify(jsonData, null, 2));
}

// 관리자 통계 조회
function getAdminStats(): AdminStats {
  return {
    totalPending: servers.filter(s => s.status === 'pending').length,
    totalApproved: servers.filter(s => s.status === 'approved').length,
    totalRejected: servers.filter(s => s.status === 'rejected').length,
    lastUpdated: Date.now()
  };
}

// ========== 관리자 접속 기록 시스템 ==========
const ADMIN_LOG_KEY = 'rofolder_admin_log_v1';
const USER_LOG_KEY = 'rofolder_user_log_v1';

interface AccessLog {
  timestamp: string | number;
  userAgent: string;
  screen: string;
  action: string;
  details?: string;
  ip?: string;
  type?: string;
}

async function logAdminAccess(action = '로그인') {
  const ip = await getCurrentIP().catch(() => 'Unknown');
  const logData = {
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    screen: `${screen.width}x${screen.height}`,
    ip,
    action,
    type: 'admin'
  };

  // 1. 로컬 저장 (백업)
  let localLogs: any[] = [];
  try { localLogs = JSON.parse(localStorage.getItem(ADMIN_LOG_KEY) || '[]'); } catch {}
  localLogs.unshift(logData);
  if (localLogs.length > 500) localLogs = localLogs.slice(0, 500);
  localStorage.setItem(ADMIN_LOG_KEY, JSON.stringify(localLogs));

  // 2. Supabase 동기화
  if (isSupabaseConfigured) {
    try {
      await supabase.from('logs').insert(logData);
    } catch (e) {
      // logs 테이블이 없는 경우(404)를 포함하여 에러가 발생해도 사이트 동작에는 지장 없게 처리
      if (!String(e).includes('404')) {
        console.warn('활동 로그 DB 저장 스킵 (테이블 확인 필요)');
      }
    }
  }
}

async function logUserActivity(action: string, details?: string) {
  const logData = {
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    screen: `${screen.width}x${screen.height}`,
    action,
    details: details || null,
    type: 'user'
  };

  // 1. 로컬 저장 (백업)
  let localLogs: any[] = [];
  try { localLogs = JSON.parse(localStorage.getItem(USER_LOG_KEY) || '[]'); } catch {}
  localLogs.unshift(logData);
  if (localLogs.length > 500) localLogs = localLogs.slice(0, 500);
  localStorage.setItem(USER_LOG_KEY, JSON.stringify(localLogs));

  // 2. Supabase 동기화
  if (isSupabaseConfigured) {
    try {
      await supabase.from('logs').insert(logData);
    } catch (e) {
      // logs 테이블이 없는 경우(404)를 포함하여 에러가 발생해도 사이트 동작에는 지장 없게 처리
      if (!String(e).includes('404')) {
        console.warn('활동 로그 DB 저장 스킵 (테이블 확인 필요)');
      }
    }
  }
}

async function getAdminLogs(): Promise<AccessLog[]> {
  if (!isSupabaseConfigured) return [];
  try {
    const { data, error } = await supabase
      .from('logs')
      .select('*')
      .eq('type', 'admin')
      .order('timestamp', { ascending: false })
      .limit(500);

    if (error) throw error;
      
    return (data || []).map((l: any) => ({
      timestamp: new Date(l.timestamp).getTime(),
      userAgent: l.userAgent || 'Unknown',
      screen: l.screen || 'Unknown',
      action: l.action || 'Unknown',
      details: l.details,
      ip: l.ip || 'Unknown'
    }));
  } catch {
    try { return JSON.parse(localStorage.getItem(ADMIN_LOG_KEY) || '[]'); } catch { return []; }
  }
}

async function getUserLogs(): Promise<AccessLog[]> {
  if (!isSupabaseConfigured) return [];
  try {
    const { data, error } = await supabase
      .from('logs')
      .select('*')
      .eq('type', 'user')
      .order('timestamp', { ascending: false })
      .limit(500);

    if (error) throw error;
      
    return (data || []).map((l: any) => ({
      timestamp: new Date(l.timestamp).getTime(),
      userAgent: l.userAgent || l.userAgent || 'Unknown',
      screen: l.screen || 'Unknown',
      action: l.action || 'Unknown',
      details: l.details
    }));
  } catch {
    try { return JSON.parse(localStorage.getItem(USER_LOG_KEY) || '[]'); } catch { return []; }
  }
}

// 관리자 접속 기록 렌더링
async function renderAdminAccessLog() {
  const container = document.getElementById('admin-servers-container')!;
  let logs = await getAdminLogs();
  
  // 7일 지난 로그 자동 삭제
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const initialLength = logs.length;
  logs = logs.filter(l => {
    const ts = typeof l.timestamp === 'string' ? new Date(l.timestamp).getTime() : l.timestamp;
    return ts > sevenDaysAgo;
  });
  
  if (logs.length < initialLength) {
    localStorage.setItem(ADMIN_LOG_KEY, JSON.stringify(logs));
  }
  
  if (logs.length === 0) {
    container.innerHTML = `<p style="text-align: center; color: var(--text-secondary); padding: 2rem;">최근 7일간 접속 기록이 없습니다.</p>`;
    return;
  }
  
  const maskIP = (ip?: string) => {
    if (!ip || ip === 'Unknown') return 'IP 기록 없음';
    const parts = ip.split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.***.***`;
    return ip.substring(0, Math.min(ip.length, 8)) + '...';
  };

  const getDeviceLabel = (ua: string) => {
    const isMobile = /Mobile|Android|iPhone|iPad/i.test(ua);
    let browser = '기타 브라우저';
    if (ua.includes('Edg')) browser = 'Edge';
    else if (ua.includes('Chrome')) browser = 'Chrome';
    else if (ua.includes('Firefox')) browser = 'Firefox';
    else if (ua.includes('Safari')) browser = 'Safari';
    
    return `${isMobile ? '📱 모바일' : '💻 PC'} (${browser})`;
  };

  container.innerHTML = `
    <div style="margin-bottom: 1rem; color: var(--text-secondary); font-size: 0.9rem;">총 ${logs.length}건의 접속 기록 (7일 보관)</div>
    <div style="display: flex; flex-direction: column; gap: 0.8rem;">
      ${logs.map(log => `
        <div class="glass" style="padding: 1rem; border-radius: 0.8rem; display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem;">
          <div style="flex: 1;">
            <div style="font-weight: bold; color: var(--text-primary); margin-bottom: 0.4rem; display: flex; align-items: center; gap: 0.5rem;">
              <span>${escapeHtml(log.action)}</span>
              <span style="font-size: 0.75rem; padding: 0.2rem 0.6rem; background: rgba(99,102,241,0.15); border-radius: 1rem; color: var(--accent-color);">
                ${maskIP(log.ip)}
              </span>
            </div>
            <div style="font-size: 0.85rem; color: var(--text-secondary); display: flex; gap: 0.8rem; align-items: center;">
              <span>${getDeviceLabel(log.userAgent)}</span>
              <span style="font-size: 0.8rem; opacity: 0.7;">해상도: ${escapeHtml(log.screen)}</span>
            </div>
          </div>
          <div style="text-align: right; font-size: 0.85rem; color: var(--text-muted); white-space: nowrap;">
            ${new Date(log.timestamp).toLocaleString('ko-KR')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// 유저 활동 및 인사이트 렌더링
async function renderUserActivityLog() {
  const container = document.getElementById('admin-servers-container')!;
  const logs = await getUserLogs();
  
  if (logs.length === 0) {
    container.innerHTML = `<p style="text-align: center; color: var(--text-secondary); padding: 2rem;">유저 활동 기록이 없습니다.</p>`;
    return;
  }
  
  // 인사이트 계산
  const totalVisits = logs.filter(l => l.action.includes('방문')).length;
  const serverViews = logs.filter(l => l.action.includes('상세 보기'));
  
  const viewCounts: Record<string, number> = {};
  serverViews.forEach(v => {
    if (v.details) viewCounts[v.details] = (viewCounts[v.details] || 0) + 1;
  });
  
  const topServer = Object.entries(viewCounts).sort((a, b) => b[1] - a[1])[0];
  const topServerName = topServer ? topServer[0] : '발견안됨';
  const topServerViews = topServer ? topServer[1] : 0;
  
  container.innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 2rem;">
      <div class="glass" style="padding: 1.5rem; border-radius: 1rem; text-align: center;">
        <h4 style="color: var(--text-secondary); margin: 0 0 0.5rem 0;">총 페이지 방문</h4>
        <div style="font-size: 2rem; color: #3b82f6; font-weight: bold;">${totalVisits}회</div>
      </div>
      <div class="glass" style="padding: 1.5rem; border-radius: 1rem; text-align: center;">
        <h4 style="color: var(--text-secondary); margin: 0 0 0.5rem 0;">가장 조회수 높은 서버</h4>
        <div style="font-size: 1.3rem; color: #fa8231; font-weight: bold; margin-bottom: 0.2rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(topServerName)}</div>
        <div style="font-size: 0.9rem; color: var(--text-muted);">${topServerViews}회 조회됨</div>
      </div>
    </div>
    
    <div style="margin-bottom: 1rem; color: var(--text-secondary); font-size: 0.9rem;">최근 활동 기록 (최대 50건)</div>
    <div style="display: flex; flex-direction: column; gap: 0.8rem;">
      ${logs.slice(0, 50).map(log => `
        <div class="glass" style="padding: 1rem; border-radius: 0.8rem; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: bold; color: var(--text-primary); margin-bottom: 0.3rem;">
              ${escapeHtml(log.action)} ${log.details ? `<span style="color: var(--accent-color);">(${escapeHtml(log.details)})</span>` : ''}
            </div>
            <div style="font-size: 0.8rem; color: var(--text-secondary);">${escapeHtml(log.userAgent)}</div>
          </div>
          <div style="text-align: right; font-size: 0.85rem; color: var(--text-muted);">
            <div>${new Date(log.timestamp).toLocaleString('ko-KR')}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// 관리자 클릭 추적 (푸터 로고 5번 클릭)
let adminPasswordAttempts = 0;
let adminPasswordLocktime = 0;

// 관리자 로그인 프롬프트 열기 (커스텀 모달 방식 - 강화됨)
function openAdminLoginPrompt() {
  console.log('🛡️ [Admin] 로그인 모달 열기 시도');
  
  // 비밀번호 시도 제한 확인
  if (adminPasswordLocktime > Date.now()) {
    const remainTime = Math.ceil((adminPasswordLocktime - Date.now()) / 1000);
    alert(`🔒 접근 제한: ${remainTime}초 후에 다시 시도해주세요.`);
    return;
  }

  const modal = registerModal();
  const content = document.getElementById('register-modal-content');
  
  if (!modal || !content) {
    console.error('❌ Admin Modal Container not found!');
    const fallbackPassword = prompt('⚠️ 모달 시스템에 문제가 있어 대체창을 엽니다.\n관리자 비밀번호를 입력하세요:', '');
    if (fallbackPassword === config.adminPassword) {
      setAdminToken('admin_access_token_' + Date.now());
      openAdminDashboard();
    }
    return;
  }
  
  content.innerHTML = `
    <button class="modal-close" id="close-admin-login-modal" style="position: absolute; top: 1rem; right: 1rem; background: none; border: none; font-size: 1.5rem; color: var(--text-primary); cursor: pointer; z-index: 100;">&times;</button>
    <div style="text-align: center; padding: 2rem 1rem;">
      <div style="font-size: 3.5rem; margin-bottom: 1.5rem; filter: drop-shadow(0 0 15px var(--accent-color));">🔐</div>
      <h2 style="margin-bottom: 0.5rem; font-size: 1.8rem; background: var(--accent-gradient); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">관리자 인증</h2>
      <p style="color: var(--text-secondary); margin-bottom: 2.5rem; font-size: 0.95rem;">보안을 위해 관리자 비밀번호를 입력해주세요.</p>
      
      <div style="max-width: 320px; margin: 0 auto;">
        <input type="password" id="admin-p-input" class="form-input" placeholder="••••••••" style="text-align: center; font-size: 1.5rem; letter-spacing: 0.4rem; padding: 1.2rem; border-radius: 1rem; background: rgba(255,255,255,0.03);">
        <button id="admin-l-submit" class="submit-button" style="width: 100%; margin-top: 1.5rem; padding: 1rem; font-size: 1.1rem; border-radius: 1rem;">접속하기</button>
      </div>
    </div>
  `;

  modal.classList.remove('hidden');
  modal.style.display = 'flex'; // 확실히 보이게 처리
  
  const passwordInput = document.getElementById('admin-p-input') as HTMLInputElement;
  if (passwordInput) passwordInput.focus();

  const handleLogin = () => {
    const password = passwordInput.value;
    if (password === config.adminPassword) {
      const adminName = prompt('관리자 접속을 위해 식별용 이름을 입력해주세요 (예: 서하로):', '관리자');
      adminPasswordAttempts = 0;
      setAdminToken('admin_access_token_' + Date.now());
      sessionStorage.setItem('admin_token', 'admin_access_token_' + Date.now()); // 이중 확인 (무결성)
      logAdminAccess(`로그인 - ${adminName || '익명'}`);
      modal.classList.add('hidden');
      modal.style.display = 'none';
      showToast('🔓 관리자 인증 성공!', 'success');
      
      // 자동 동기화 체크 (Supabase가 비어있는데 로컬 데이터가 있는 경우)
      setTimeout(async () => {
        const dbCount = servers.filter(s => s.status === 'approved').length;
        if (dbCount === 0 && servers.length > 0) {
          const migrate = await showConfirm(`[데이터 이전 알림]\n현재 데이터베이스(SQL)가 비어있습니다.\n기본 로컬 데이터(${servers.length}개)를 SQL로 이전하시겠습니까?`);
          if (migrate) {
            await syncAllServersToDB(true);
          }
        }
      }, 1000);

      setTimeout(() => openAdminDashboard(), 300);
    } else {
      adminPasswordAttempts++;
      if (adminPasswordAttempts >= 5) {
        adminPasswordLocktime = Date.now() + 30000;
        alert('❌ 30초간 접근이 제한됩니다.');
        modal.classList.add('hidden');
        modal.style.display = 'none';
      } else {
        alert(`❌ 틀렸습니다. (${5 - adminPasswordAttempts}회 남음)`);
      }
    }
  };

  const submitBtn = document.getElementById('admin-l-submit');
  if (submitBtn) submitBtn.onclick = handleLogin;
  
  if (passwordInput) {
    passwordInput.onkeydown = (e) => {
      if (e.key === 'Enter') handleLogin();
    };
  }
  
  const closeBtn = document.getElementById('close-admin-login-modal');
  if (closeBtn) closeBtn.onclick = () => {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  };
}

// 관리자 클릭 추적 (레거시 - 호환성 유지용)
// 더 이상 사용되지 않음 (openAdminLoginPrompt로 대체)

// 푸터 렌더링
function renderFooter() {
  const footerContainer = document.getElementById('footer-container');
  if (!footerContainer) return;
  
  const currentYear = new Date().getFullYear();
  footerContainer.innerHTML = `
    <div style="background: linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(139, 92, 246, 0.1)); border-top: 1px solid rgba(255, 255, 255, 0.1); padding: 4rem 2rem 2rem;">
      <div style="max-width: 1400px; margin: 0 auto;">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 2rem; margin-bottom: 3rem;">
          <div>
            <h3 id="footer-logo" title="RoFolder Home" style="margin: 0 0 0.5rem 0; color: var(--accent-color, #6366f1); font-size: 1.2rem; cursor: pointer; user-select: none;">🌟 ${config.siteName}</h3>
            <p style="margin: 0 0 1rem 0; color: var(--text-secondary); font-size: 0.9rem; line-height: 1.5;">
              프리미엄 디스코드 커뮤니티 허브
            </p>
            <span style="color: var(--text-secondary); font-size: 0.8rem;">📧 ${config.contactEmail}</span>
          </div>
          
          <div>
            <h4 style="margin: 0 0 0.75rem 0; color: var(--text-primary); font-size: 0.95rem;">소개</h4>
            <div style="display: flex; flex-direction: column; gap: 0.5rem;">
              <a href="${config.discordCommunityUrl}" target="_blank" style="color: var(--accent-color); text-decoration: none; font-size: 0.85rem;">💬 디스코드</a>
              <a href="${config.twitterUrl}" target="_blank" style="color: var(--accent-color); text-decoration: none; font-size: 0.85rem;">𝕏 Twitter</a>
              <button id="footer-qa" style="background: none; border: none; color: var(--accent-color); cursor: pointer; text-align: left; font-size: 0.85rem; padding: 0;">❓ Q&A</button>
            </div>
          </div>
          
          <div>
            <h4 style="margin: 0 0 0.75rem 0; color: var(--text-primary); font-size: 0.95rem;">커뮤니티</h4>
            <div style="display: flex; flex-direction: column; gap: 0.5rem;">
              <button id="footer-inquiry" style="background: none; border: none; color: var(--accent-color); cursor: pointer; text-align: left; font-size: 0.85rem; padding: 0;">💌 문의 및 건의</button>
              <button id="footer-register" style="background: none; border: none; color: var(--accent-color); cursor: pointer; text-align: left; font-size: 0.85rem; padding: 0; font-weight: bold;">📝 서버 등록</button>
              <button id="footer-top" style="background: none; border: none; color: var(--accent-color); cursor: pointer; text-align: left; font-size: 0.85rem; padding: 0;">⬆️ 맨 위로</button>
            </div>
          </div>
          
          <div>
            <h4 style="margin: 0 0 0.75rem 0; color: var(--text-primary); font-size: 0.95rem;">법률</h4>
            <div style="display: flex; flex-direction: column; gap: 0.5rem;">
              <a href="#" style="color: var(--accent-color); text-decoration: none; font-size: 0.85rem;">📋 이용약관</a>
              <a href="#" style="color: var(--accent-color); text-decoration: none; font-size: 0.85rem;">🔒 개인정보</a>
            </div>
          </div>
        </div>
        
        <div style="border-top: 1px solid rgba(255, 255, 255, 0.1); padding-top: 1.5rem; text-align: center;">
          <p style="margin: 0; color: var(--text-secondary); font-size: 0.8rem;">
            &copy; ${currentYear} RoFolder. All rights reserved. | Make haro
          </p>
        </div>
      </div>
    </div>
  `;
  
  // 푸터 이벤트
  const footerLogo = document.getElementById('footer-logo');
  if (footerLogo) {
    footerLogo.onclick = () => {
      adminFooterClickCount++;
      if (adminFooterClickTimer) clearTimeout(adminFooterClickTimer);
      
      adminFooterClickTimer = setTimeout(() => {
        adminFooterClickCount = 0;
      }, 3000);

      if (adminFooterClickCount === 3) {
        adminFooterClickCount = 0;
        initiateDiscordLogin();
      }
    };
  }

  document.getElementById('footer-register')?.addEventListener('click', openPromoBanner);
  document.getElementById('footer-inquiry')?.addEventListener('click', openInquiryModal);
  document.getElementById('footer-qa')?.addEventListener('click', showQAModal);
  document.getElementById('footer-top')?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

// 등록 모달 열기 (홍보 배너와 동일)
function openRegisterModal() {
  openPromoBanner();
}

// 통합 웹훅 전송 함수 (상세 로그 포함)
async function sendWebhook(payload: any, isFile = false) {
  if (!config.webhookUrl || !config.webhookUrl.startsWith('https://discord.com')) {
    console.error('❌ [Webhook] URL이 설정되지 않았거나 올바르지 않습니다.');
    return false;
  }

  try {
    let response;
    if (isFile) {
      // payload가 FormData인 경우
      response = await fetch(config.webhookUrl, {
        method: 'POST',
        body: payload
      });
    } else {
      // payload가 JSON 객체인 경우
      response = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    if (okResp(response)) {
      console.log('✅ [Webhook] 전송 성공');
      return true;
    } else {
      const errorText = await response.text();
      console.error(`❌ [Webhook] Discord 거절 (상태: ${response.status})`);
      console.error('메시지:', errorText);
      return false;
    }
  } catch (error) {
    console.error('❌ [Webhook] 네트워크 오류 발생:', error);
    return false;
  }
}

function okResp(res: Response) {
  return res.ok || res.status === 204;
}

// 서버 데이터 자동 백업 (3시간 주기)
async function sendServersBackupToDiscord(isManual = false) {
  if (!config.webhookUrl) return;
  
  try {
    const backupData = {
      servers: servers
    };
    
    const jsonBlob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const formData = new FormData();
    
    const title = isManual ? '📦 **[수동 백업]**' : '📦 **[자동 백업]**';
    formData.append('content', `${title} 로폴더 서버 목록 데이터 (총 ${servers.length}개)`);
    formData.append('file', jsonBlob, 'servers.json');
    
    const success = await sendWebhook(formData, true);
    
    if (success) {
      if (!isManual) localStorage.setItem('rofolder_last_backup', new Date().getTime().toString());
      if (isManual) showToast('✅ 백업 파일이 웹훅으로 전송되었습니다.', 'success');
    } else {
      if (isManual) showToast('❌ 백업 전송 실패!', 'error');
    }
  } catch (error) {
    console.error('❌ [Backup] 백업 중 오류 발생:', error);
    if (isManual) showToast('❌ 백업 중 오류 발생', 'error');
  }
}

function checkAndRunBackup() {
  const lastBackup = localStorage.getItem('rofolder_last_backup');
  const now = new Date().getTime();
  const threeHours = 3 * 60 * 60 * 1000;
  
  if (!lastBackup || (now - parseInt(lastBackup)) > threeHours) {
    console.log('⏰ [Backup] 3시간이 경과하여 자동 백업을 시작합니다...');
    sendServersBackupToDiscord();
  } else {
    const nextBackup = (threeHours - (now - parseInt(lastBackup))) / (1000 * 60);
    console.log(`⏳ [Backup] 다음 자동 백업까지 약 ${Math.round(nextBackup)}분 남았습니다.`);
  }
}

// 이벤트 리스너 설정
function setupEventListeners() {
  const openRegBtn = document.getElementById('open-register');
  if (openRegBtn) openRegBtn.onclick = () => openRegisterModal();

  const inquiryLink = document.getElementById('inquiry-link');
  if (inquiryLink) {
    inquiryLink.onclick = (e) => {
      e.preventDefault();
      openInquiryModal();
    };
  }

  const headerQABtn = document.getElementById('header-qa-btn');
  if (headerQABtn) {
    headerQABtn.onclick = (e) => {
      e.preventDefault();
      showQAModal();
    };
  }

  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  const searchBtn = document.getElementById('search-btn');

  if (searchBtn && searchInput) {
    searchBtn.onclick = () => {
      searchQuery = searchInput.value;
      currentPage = 1;
      applyFilters();
    };

    searchInput.onkeyup = (e) => {
      searchQuery = searchInput.value;
      if (e.key === 'Enter') {
        currentPage = 1;
      }
      applyFilters();
    };
  }

  window.onclick = (e) => {
    if (e.target === detailModal()) detailModal().classList.add('hidden');
    if (e.target === registerModal()) registerModal().classList.add('hidden');
  };
}



// 관리자 웹후크 자동 동작 처리
async function handleAdminAutoAction() {
  const urlParams = new URLSearchParams(window.location.search);
  const action = urlParams.get('action');
  const serverIdStr = urlParams.get('id');
  
  if (!action || !serverIdStr) return;
  
  const serverId = parseInt(serverIdStr);
  const server = servers.find(s => s.id === serverId);
  
  if (!server) {
    showToast('해당 서버를 찾을 수 없습니다.', 'error');
    window.history.replaceState({}, document.title, window.location.pathname);
    return;
  }
  
  // 관리자 권한 확인 및 요청
  if (!hasAdminAccess()) {
    const password = prompt('🔐 관리자 전용 동작입니다. 비밀번호를 입력하세요:', '');
    if (password === config.adminPassword) {
      const adminName = prompt('관리자 식별용 이름을 입력해주세요:', '자동승인기본');
      setAdminToken('admin_access_token_' + Date.now());
      logAdminAccess(`자동 동작 로그인 - ${adminName || '익명'}`);
    } else {
      alert('❌ 비밀번호가 틀렸거나 취소되었습니다.');
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }
  }
  
  // 동작 수행
  if (action === 'approve') {
    if (server.status === 'approved') {
      showToast('이미 승인된 서버입니다.', 'info');
    } else {
      const confirmed = await showConfirm(`"${server.name}" 서버를 승인하시겠습니까?`);
      if (confirmed) {
        approveServer(serverId);
        showToast('서버가 승인되었습니다.', 'success');
        openAdminDashboard();
      }
    }
  } else if (action === 'reject') {
    if (server.status === 'rejected') {
      showToast('이미 거절된 서버입니다.', 'info');
    } else {
      const reason = prompt(`"${server.name}" 서버의 거절 사유를 입력하세요:`, '');
      if (reason) {
        rejectServer(serverId, reason);
        showToast('서버가 거절되었습니다.', 'info');
        openAdminDashboard();
      }
    }
  }
  
  // URL 파라미터 제거 (재실행 방지)
  window.history.replaceState({}, document.title, window.location.pathname);
}

async function init() {
  // 0. 테마 초기화 (localStorage에서 복원)
  const savedTheme = localStorage.getItem('rofolder-theme') || 'obsidian';
  if (savedTheme !== 'obsidian') {
    document.documentElement.setAttribute('data-theme', savedTheme);
  }

  // 0-1. 프리미엄 배경 주입
  const bg = document.createElement('div');
  bg.className = 'background-mesh';
  bg.innerHTML = `
    <div class="mesh-blob mesh-1"></div>
    <div class="mesh-blob mesh-2"></div>
    <div class="mesh-blob mesh-3"></div>
    <div class="noise-overlay"></div>
  `;
  document.body.prepend(bg);

  // IP 승인 URL 콜백 처리 (?approve_ip=IP&token=TOKEN)
  if (handleIPApprovalCallback()) {
    showToast('✅ IP 승인 완료! 디스코드 인증을 진행해주세요.', 'success');
    setTimeout(() => initiateDiscordLogin(), 1500);
  }

  // 디스코드 OAuth2 콜백 확인 (#access_token=...)
  handleOAuthCallback();

  // 서버 데이터 로드
  servers = await loadServers();
  filteredServers = [...servers];
  
  const appElement = document.getElementById('app')!;
  appElement.innerHTML = `
    <header>
      <div style="display:flex;align-items:center;gap:0.75rem;">
        <div class="theme-toggle-wrapper">
          <button class="theme-toggle-btn" id="theme-toggle-btn" title="테마 변경">🎨</button>
          <div class="theme-panel" id="theme-panel">
            <div class="theme-panel-title">테마 선택</div>
            <div class="theme-swatch-grid">
              <div class="theme-swatch-item">
                <div class="theme-swatch" data-theme="obsidian" style="background:linear-gradient(135deg,#03040a,#6366f1);"></div>
                <span class="theme-swatch-label">옵시디안</span>
              </div>
              <div class="theme-swatch-item">
                <div class="theme-swatch" data-theme="ivory" style="background:linear-gradient(135deg,#faf8f5,#6366f1);"></div>
                <span class="theme-swatch-label">아이보리</span>
              </div>
              <div class="theme-swatch-item">
                <div class="theme-swatch" data-theme="midnight" style="background:linear-gradient(135deg,#0a0a0a,#ffffff);"></div>
                <span class="theme-swatch-label">미드나잇</span>
              </div>
              <div class="theme-swatch-item">
                <div class="theme-swatch" data-theme="olive" style="background:linear-gradient(135deg,#1a1f16,#8b9a6b);"></div>
                <span class="theme-swatch-label">올리브</span>
              </div>
              <div class="theme-swatch-item">
                <div class="theme-swatch" data-theme="earth" style="background:linear-gradient(135deg,#1c1714,#a0785a);"></div>
                <span class="theme-swatch-label">어스</span>
              </div>
              <div class="theme-swatch-item">
                <div class="theme-swatch" data-theme="forest" style="background:linear-gradient(135deg,#0d1a0d,#4caf50);"></div>
                <span class="theme-swatch-label">포레스트</span>
              </div>
              <div class="theme-swatch-item">
                <div class="theme-swatch" data-theme="sage" style="background:linear-gradient(135deg,#f5f0eb,#6b8f6b);"></div>
                <span class="theme-swatch-label">세이지</span>
              </div>
            </div>
          </div>
        </div>
        <a href="#" class="logo">
          <img src="${config.siteLogo}" alt="${config.siteName} Logo" class="brand-logo">
          <span>${config.siteName}</span>
        </a>
      </div>
      <div class="nav-links">
        <a href="#" class="nav-link nav-link-qa" id="header-qa-btn">Q&A</a>
        <a href="${config.originalSiteUrl}" target="_blank" class="nav-link">커뮤니티</a>
        <button id="open-register" class="nav-link nav-link-primary">로샵 등록</button>
      </div>
    </header>

    <main>
      <section class="hero">
        <div class="about-badge">PREMIUM RO-SHOP PLATFORM</div>
        <h1 class="hero-title">당신의 가치를 높이는<br><span class="brand-highlight">로샵</span> 탐색의 모든 것</h1>
        <p class="hero-subtitle">로폴더는 로블록스 유저들을 위한 <span class="brand-highlight">로샵(Ro-Shop)</span> 탐색 전용 플랫폼입니다. 수많은 샵 사이에서 원하는 제품과 서비스를 가장 스마트하게 찾아보세요.</p>
        
        <div class="search-container glass">
          <input type="text" id="search-input" class="search-input" placeholder="찾고 싶은 로샵 테마나 이름을 입력하세요...">
          <button id="search-btn" class="search-button">찾아보기</button>
        </div>
      </section>

      <!-- 브랜드 소개 섹션 -->
      <section class="about-section stagger-reveal">
        <div class="about-header">
          <h2 class="about-title">로폴더는 어떤 공간인가요?</h2>
          <p class="about-desc">단순히 샵을 나열하는 것에 그치지 않고, 유저가 '진정으로 찾고 싶어 하는' 퀄리티 있고 희소성 있는 로샵을 연결합니다.</p>
        </div>
        
        <div class="features-grid">
          <div class="feature-card glass">
            <div class="feature-icon">🔍</div>
            <h3>스마트한 로샵 검색</h3>
            <p>'군사', '차량', '건물' 등 특정 테마의 로샵을 직접 검색하거나 카테고리별로 쉽게 둘러볼 수 있어 원하는 상품을 빠르게 찾을 수 있습니다.</p>
          </div>
          <div class="feature-card glass">
            <div class="feature-icon">⚡</div>
            <h3>획기적인 시간 절약</h3>
            <p>수많은 서버를 일일이 들어가고 광고 채널을 헤맬 필요 없이, 로폴더 한 곳에서 퀄리티 높은 로샵을 비교하고 바로 선택하세요.</p>
          </div>
          <div class="feature-card glass">
            <div class="feature-icon">💎</div>
            <h3>운영자와 유저의 상생</h3>
            <p>유저는 명확한 정보를 얻고, 운영자는 자신의 로샵을 효과적으로 소개하며 협업의 기회를 얻을 수 있는 필수 플랫폼입니다.</p>
          </div>
        </div>
      </section>

      <div class="section-title-wrap">
        <h2 class="section-title">🌐 전체 <span class="brand-highlight">로샵 탐색</span></h2>
        <span class="section-subtitle">다양한 카테고리의 샵들을 둘러보세요.</span>
      </div>

      <div id="filter-bar" class="filter-bar glass"></div>
      
      <div id="server-grid" class="server-grid"></div>
      
      <div id="pagination-container" class="pagination-container"></div>
    </main>
  `;

  renderServers();
  renderFooter();

  // 테마 토글 이벤트 핸들러
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  const themePanel = document.getElementById('theme-panel');
  if (themeToggleBtn && themePanel) {
    // 토글 버튼 클릭
    themeToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      themePanel.classList.toggle('open');
    });

    // 스와치 클릭 → 테마 적용
    themePanel.querySelectorAll('.theme-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        const themeId = (swatch as HTMLElement).dataset.theme || 'obsidian';
        
        // 옵시디안(기본)이면 data-theme 속성 제거
        if (themeId === 'obsidian') {
          document.documentElement.removeAttribute('data-theme');
        } else {
          document.documentElement.setAttribute('data-theme', themeId);
        }
        
        // localStorage에 저장
        localStorage.setItem('rofolder-theme', themeId);
        
        // 활성 스와치 업데이트
        themePanel.querySelectorAll('.theme-swatch').forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        
        // 패널 닫기
        themePanel.classList.remove('open');
        
        showToast(`🎨 테마가 변경되었습니다: ${themeId}`, 'success');
      });
    });

    // 현재 테마에 active 클래스 적용
    const currentTheme = localStorage.getItem('rofolder-theme') || 'obsidian';
    const activeSwatch = themePanel.querySelector(`.theme-swatch[data-theme="${currentTheme}"]`);
    if (activeSwatch) activeSwatch.classList.add('active');

    // 패널 외부 클릭 시 닫기
    document.addEventListener('click', (e) => {
      if (!themePanel.contains(e.target as Node) && e.target !== themeToggleBtn) {
        themePanel.classList.remove('open');
      }
    });
  }
  
  // 1. 이벤트 리스너 등록
  setupEventListeners();
  
  // 2. 나머지 초기화
  logUserActivity('페이지 방문');
  startRealTimePolling();
  
  // 3. 관리자 자동 동작
  try {
    await handleAdminAutoAction();
  } catch (e) {
    console.error('관리자 자동 동작 처리 중 오류:', e);
  }

  // 배너 10초마다 자동 스크롤 (중복 생성 방지를 위해 init에서 단 한 번만 설정)
  setInterval(() => {
    const carousel = document.querySelector('.banner-carousel');
    if (carousel) nextSlide();
  }, 10000);
}

// 관리자 대시보드가 열려있다면 내용 갱신
function refreshAdminDashboardIfOpen() {
  const dashboard = document.querySelector('#admin-modal-container:not(.hidden)');
  if (dashboard) {
    const currentTab = dashboard.querySelector('.admin-tab-btn.active')?.getAttribute('data-tab');
    if (currentTab === 'pending' || currentTab === 'approved' || currentTab === 'rejected') {
      renderAdminServersByStatus(currentTab);
    } else if (currentTab === 'all') {
      renderAllServers();
    }
    updateAdminTabBadges();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch(err => console.error('초기화 실패:', err));
  
  // 서버 데이터 해시 생성 (변경 감지용)
  function getServersHash(data: DiscordServer[]): string {
    return data.map(s => `${s.id}:${s.status}:${s.recommendations}:${s.clicks}`).join('|');
  }

  let lastServersHash = '';

  // 자동 갱신: 120초마다 서버 목록 다시 로딩 (변경이 있을 때만 DOM 갱신)
  setInterval(async () => {
    try {
      const newServers = await loadServers();
      if (newServers && newServers.length > 0) {
        newServers.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        
        const newHash = getServersHash(newServers);
        if (newHash !== lastServersHash) {
          // 데이터가 실제로 변경된 경우에만 갱신
          servers = newServers;
          lastServersHash = newHash;
          applyFilters();
          refreshAdminDashboardIfOpen();
          console.log('✅ [Heartbeat] 데이터 변경 감지 → UI 갱신');
        } else {
          console.log('💤 [Heartbeat] 변경 없음 — 건너뜀');
        }
      }
    } catch (e) {
      console.error('⚠️ [Heartbeat] 동기화 실패:', e);
    }
  }, 120000); // 120초 (성능 최적화: 불필요한 DOM 재구축 방지)
});

// ---------------------------------------------------------
// [4단계 보안] IP → 이메일 → Discord OAuth2 → 비밀번호
// ---------------------------------------------------------

/** 1단계: IP 확인 후 이메일 승인 또는 Discord 로그인으로 분기 */
async function initiateAdminAuth() {
  showToast('🔐 관리자 진입 시도 중...', 'success');

  const ip = await getCurrentIP();
  const ipAlreadyApproved = isIPApproved(ip);

  if (ipAlreadyApproved) {
    // IP 이미 승인됨 → Discord 단계로
    showToast('✅ IP 인증 완료. 디스코드 인증을 시작합니다.', 'success');
    setTimeout(() => initiateDiscordLogin(), 800);
  } else {
    // 새 IP → 이메일 발송
    showIPApprovalUI(ip);
  }
}

/** 알 수 없는 IP 감지 시 화면에 대기 UI 표시 */
async function showIPApprovalUI(ip: string) {
  const overlay = document.createElement('div');
  overlay.id = 'ip-approval-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99998;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.85);backdrop-filter:blur(12px);';
  overlay.innerHTML = `
    <div style="max-width:480px;width:90%;background:rgba(15,15,25,0.95);border:1px solid rgba(99,102,241,0.3);border-radius:1.5rem;padding:2.5rem;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.6);">
      <div style="font-size:3rem;margin-bottom:1rem;">🔒</div>
      <h2 style="font-size:1.4rem;color:#f8fafc;margin-bottom:0.8rem;">새 기기 감지됨</h2>
      <p style="color:#94a3b8;margin-bottom:1.5rem;font-size:0.95rem;">
        현재 IP <code style="background:rgba(99,102,241,0.2);padding:0.2rem 0.5rem;border-radius:0.3rem;color:#a5b4fc;">${ip}</code> 가<br>
        관리자 접근 목록에 없습니다.
      </p>
      <div id="ip-send-status" style="color:#94a3b8;font-size:0.9rem;margin-bottom:1.5rem;">승인 요청 이메일 전송 중...</div>
      <button id="ip-overlay-close" style="padding:0.6rem 1.5rem;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.1);color:#94a3b8;border-radius:0.5rem;cursor:pointer;font-size:0.9rem;">닫기</button>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('ip-overlay-close')!.onclick = () => overlay.remove();

  const statusEl = document.getElementById('ip-send-status')!;
  const sent = await sendIPApprovalEmail(ip);
  if (sent) {
    statusEl.innerHTML = `✅ <strong style="color:#a5b4fc;">${config.adminEmail}</strong>으로<br>승인 이메일을 발송했습니다.<br><span style="font-size:0.82rem;color:#64748b;margin-top:0.5rem;display:block;">이메일의 [IP 승인] 버튼을 클릭하면 이 기기에서 관리자 접근이 허용됩니다.</span>`;
  } else {
    statusEl.innerHTML = '❌ 이메일 전송에 실패했습니다. 콘솔을 확인해주세요.';
  }
}

/** 2단계: Discord OAuth2 시작 */
function initiateDiscordLogin() {
  const clientId = config.discordClientId;
  // 디스코드 포털에 등록된 정확한 Redirect URI로 고정 (오류 방지)
  const redirectUri = encodeURIComponent('https://rofolder.kro.kr/');
  const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=token&scope=identify`;
  showToast('🎮 디스코드 인증을 시작합니다...', 'success');
  setTimeout(() => { window.location.href = authUrl; }, 900);
}

/** 3단계: Discord OAuth2 콜백 처리 → 비밀번호 단계 진행 */
async function handleOAuthCallback() {
  const hash = window.location.hash;
  if (!hash.includes('access_token=')) return;

  const params = new URLSearchParams(hash.substring(1));
  const token = params.get('access_token');
  if (!token) return;

  // 토큰 주소창에서 제거
  window.history.replaceState({}, document.title, window.location.pathname);
  showToast('⏳ 디스코드 ID 확인 중...', 'success');

  try {
    const res = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const user = await res.json();

    if (user.id === config.adminDiscordId) {
      showToast(`✅ ${user.username}님 인증 성공! 비밀번호를 입력해주세요.`, 'success');
      setTimeout(() => openAdminLoginPrompt(), 800);
    } else {
      showToast('❌ 관리자 계정이 아닙니다.', 'error');
    }
  } catch {
    showToast('❌ 디스코드 인증에 실패했습니다.', 'error');
  }
}

// ---------------------------------------------------------
// [관리자 시크릿 진입로] 전역 독립 실행
// ---------------------------------------------------------
(function() {
  const trigger = () => {
    if (typeof initiateAdminAuth === 'function') initiateAdminAuth();
  };

  // URL 파라미터 감지 (?admin)
  const checkUrl = () => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('admin')) {
      console.log('📡 [Admin] URL 파라미터로 진입 감지');
      setTimeout(trigger, 800);
    }
  };

  // 단축키: Alt+Shift+A 또는 Ctrl+Shift+L
  window.addEventListener('keydown', (e) => {
    const k = e.keyCode || e.which;
    if ((e.altKey && e.shiftKey && k === 65) || (e.ctrlKey && e.shiftKey && k === 76)) {
      e.preventDefault();
      trigger();
    }
  }, true);

  // 콘솔 진입 (개발용)
  (window as any).openAdmin = trigger;

  if (document.readyState === 'complete') checkUrl();
  else window.addEventListener('load', checkUrl);
})();

// 글로벌 이벤트 노출 (Vite 모듈에서 인라인 이벤트 작동을 위함)
Object.assign(window, {
  openDetailModal,
  editServer,
  closeAdminModal: () => document.getElementById('admin-modal-container')?.classList.add('hidden')
});
