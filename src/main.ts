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

// 초기 샘플 데이터 (빈 배열 - 새로운 서버부터 추가됨)
const initialServers: DiscordServer[] = [];

// 데이터 관리 (LocalStorage 및 JSON 파일 연동)
const STORAGE_KEY = 'rofolder_servers_v1';
const JSON_DATA_URL = '/servers.json';

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

// 실시간 갱신: 주기적으로 servers.json 체크
let pollInterval: number | null = null;

async function startRealTimePolling() {
  if (pollInterval) return; // 이미 실행 중
  
  const pollServersFromJSON = async () => {
    try {
      const jsonServers = await loadServersFromJSON();
      
      // approved 서버만 체크
      const newApprovedServers = jsonServers.filter(s => s.status === 'approved');
      const currentApprovedServers = servers.filter(s => s.status === 'approved');
      
      // 새로운 서버가 추가되었는지 확인
      if (newApprovedServers.length > currentApprovedServers.length) {
        const newServers = newApprovedServers.filter(
          ns => !currentApprovedServers.find(cs => cs.id === ns.id)
        );
        
        // 새 서버들을 서버 목록에 추가 (pending/pending 서버는 제거)
        servers = servers.filter(s => s.status !== 'pending');
        servers.push(...newServers);
        saveServers();
        
        // UI 갱신
        currentPage = 1;
        applyFilters();
        
        console.log(`✨ ${newServers.length}개의 새로운 서버가 추가되었습니다!`);
      }
    } catch (e) {
      console.log('실시간 갱신 중 오류:', e);
    }
  };
  
  // 10초마다 체크
  pollInterval = setInterval(pollServersFromJSON, 10000) as unknown as number;
  console.log('✅ 실시간 갱신 시작됨 (10초마다)');
}

function stopRealTimePolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    console.log('⛔ 실시간 갱신 중지됨');
  }
}

// @ts-ignore - 향후 필요시 사용
function _unused_stopRealTimePolling() {
  stopRealTimePolling();
}

async function loadServers(): Promise<DiscordServer[]> {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      let parsedServers = JSON.parse(saved);
      
      // 사용자 요청: 로폴더 제외 모든 서버 기록 삭제 (1회용 스크립트)
      if (!localStorage.getItem('wiped_test_servers_v1')) {
        parsedServers = parsedServers.filter((s: DiscordServer) => 
          s.name === '로폴더' || s.name === 'RoFolder' || s.name.includes('로폴더')
        );
        localStorage.setItem(STORAGE_KEY, JSON.stringify(parsedServers));
        localStorage.setItem('wiped_test_servers_v1', 'true');
        console.log('로폴더를 제외한 모든 임시 서버 기록이 로컬 저장소에서 삭제되었습니다.');
      }
      
      return parsedServers;
    } catch (e) {
      console.error('LocalStorage 로드 실패');
    }
  }
  
  // JSON 파일에서 추가 데이터 로드
  const jsonServers = await loadServersFromJSON();
  const allServers = [...initialServers, ...jsonServers];
  
  return allServers;
}

function saveServers() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(servers));
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

// 이미지 파일을 Base64로 변환 (홍보 신청 시 사용)
export function convertImageToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
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
    showToast('⚠️ 오늘 이미 추천하신 서버입니다.', 'error');
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
    saveServers(); // saveServers() 대신 saveRecommendation(serverId)가 있었으나, saveServers()가 전체 서버를 저장하므로 더 적합
    logUserActivity('서버 추천', server?.name || `ID: ${serverId}`);
    return true;
  }
  return false;
}

// 오늘의 인기 서버 Top 10 가져오기
function getTopServersToday(): DiscordServer[] {
  return servers
    .filter(s => s.status === 'approved')
    .sort((a, b) => (b.recommendations || 0) - (a.recommendations || 0))
    .slice(0, 10);
}

let servers: DiscordServer[] = [];

// 상태 관리
let filteredServers = [...servers];
let currentPage = 1;
const itemsPerPage = 21;
let currentCategory = '전체';
let searchQuery = '';

// 관리자 대시보드 추적
let adminClickCount = 0;
let adminClickTimer: ReturnType<typeof setTimeout> | null = null;

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
    // 승인된 서버만 메인 페이지에 표시
    // (관리자 대시보드에서는 pending/rejected도 볼 수 있음)
    if (s.status !== 'approved') return false;
    
    const matchCategory = currentCategory === '전체' || 
                          s.category === currentCategory || 
                          s.tags.includes(currentCategory);
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
    { name: '전체', icon: '⌂', className: '' },
    { name: '인기', icon: '★', className: 'filter-popular' },
    { name: '신규', icon: '✦', className: 'filter-new' },
    { name: '게임', icon: '✛', className: '' },
    { name: '커뮤니티', icon: '⚑', className: '' },
    { name: '배포', icon: '⤓', className: '' },
    { name: '친목', icon: '♥', className: '' },
    { name: '방송', icon: '▶', className: '' },
    { name: '파트너', icon: '♚', className: 'filter-partner' }
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
    
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 2rem;">
      <div class="glass" style="padding: 1.5rem; border-radius: 1rem;">
        <h3 style="margin: 0 0 0.5rem 0; font-size: 1rem; color: var(--text-primary);">질문 올리기</h3>
        <p style="margin: 0 0 1rem 0; color: var(--text-secondary); font-size: 0.9rem;">서버에 대해 궁금한 점을 질문하세요</p>
        <button id="show-ask-form" style="width: 100%; padding: 0.8rem; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; border: none; border-radius: 0.5rem; cursor: pointer; font-weight: bold;">
          ❓ 질문하기
        </button>
      </div>
      <div class="glass" style="padding: 1.5rem; border-radius: 1rem;">
        <h3 style="margin: 0 0 0.5rem 0; font-size: 1rem; color: var(--text-primary);">최근 Q&A</h3>
        <p style="margin: 0 0 1rem 0; color: var(--text-secondary); font-size: 0.9rem;">답변된 질문 ${answeredQA.length}개</p>
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

  // 오늘의 인기 서버 Top 5 섹션 (첫 페이지에서만 표시)
  let topServersHTML = '';
  if (currentPage === 1) {
    const topServers = getTopServersToday();
    if (topServers.length > 0) {
      const topFive = topServers.slice(0, 5);
      topServersHTML = `
        <div class="top-servers-section" style="grid-column: 1 / -1; margin-bottom: 3rem;">
          <h2 style="font-size: 1.8rem; margin-bottom: 1.5rem; color: var(--text-primary); display: flex; align-items: center; gap: 0.5rem;">
            🔥 오늘의 인기 서버 Top 5
          </h2>
          <div class="top-servers-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1.2rem; margin-bottom: 1.5rem;">
            ${topFive.map((server, idx) => `
              <div class="top-server-card glass" data-id="${server.id}" style="position: relative; padding: 1.2rem;">
                <div style="position: absolute; top: -8px; right: 1rem; background: linear-gradient(135deg, #fa8231, #f97316); color: white; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 1rem; box-shadow: 0 4px 15px rgba(250, 130, 49, 0.4);">
                  ${idx + 1}
                </div>
                <div style="display: flex; gap: 0.75rem; margin-bottom: 0.8rem;">
                  <img src="${escapeHtml(server.icon)}" alt="${escapeHtml(server.name)}" style="width: 45px; height: 45px; border-radius: 8px; object-fit: cover;" onerror="this.src='https://api.dicebear.com/7.x/identicon/svg?seed=${server.id}';">
                  <div style="flex: 1; min-width: 0;">
                    <h4 style="margin: 0; font-size: 0.95rem; font-weight: bold; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(server.name)}</h4>
                    <p style="margin: 0.2rem 0 0 0; font-size: 0.8rem; color: var(--text-secondary);">${escapeHtml(server.category)}</p>
                  </div>
                </div>
                <p style="font-size: 0.8rem; color: var(--text-secondary); margin: 0.8rem 0; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${escapeHtml(server.description)}</p>
                <div style="display: flex; gap: 0.4rem; margin-bottom: 0.8rem; flex-wrap: wrap;">
                  ${server.tags.slice(0, 2).map(tag => {
                    const tagConfig = [...config.serverTags, ...config.adminOnlyTags].find(t => t.value === tag);
                    const tagColor = tagConfig?.color || '#6366f1';
                    return `<span class="server-tag" style="font-size: 0.7rem; background: ${tagColor}20; color: ${tagColor}; padding: 0.25rem 0.6rem;">${tagConfig?.emoji || ''} ${escapeHtml(tag)}</span>`;
                  }).join('')}
                </div>
                <div style="display: flex; gap: 1rem; font-size: 0.8rem; margin-bottom: 1rem; padding: 0.6rem; background: rgba(99, 102, 241, 0.05); border-radius: 0.5rem;">
                  <span style="flex: 1; text-align: center; color: #fa8231;">👍 ${server.recommendations || 0}</span>
                  <span style="border-left: 1px solid var(--text-secondary, rgba(255,255,255,0.1));"></span>
                  <span style="flex: 1; text-align: center; color: var(--text-secondary);">👁️ ${server.clicks || 0}</span>
                </div>
                <button class="recommend-icon-btn" data-id="${server.id}" style="width: 100%; padding: 0.6rem; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; border: none; border-radius: 0.5rem; cursor: pointer; font-weight: bold; font-size: 0.85rem; transition: all 0.3s ease; text-align: center;">
                  👍 추천
                </button>
              </div>
            `).join('')}
          </div>
          ${topServers.length > 5 ? `
            <button id="show-top-all-btn" style="width: 100%; padding: 0.8rem; background: transparent; border: 2px solid var(--accent-color, #6366f1); color: var(--accent-color, #6366f1); border-radius: 0.5rem; cursor: pointer; font-weight: bold; font-size: 0.95rem; transition: all 0.3s ease;">
              더보기 (${topServers.length - 5}개 더)
            </button>
          ` : ''}
        </div>
      `;
    }
  }

  grid.innerHTML = carouselHTML + topServersHTML + pagedServers.map(server => `
    <div class="server-card glass" data-id="${server.id}">
      <div class="server-header">
        <img src="${escapeHtml(server.icon)}" class="server-icon loading" alt="${escapeHtml(server.name)}" onerror="this.src='https://api.dicebear.com/7.x/identicon/svg?seed=${server.id}'; this.classList.remove('loading');" onload="this.classList.remove('loading');">
        <div class="server-info">
          <h3>${escapeHtml(server.name)}</h3>
          <div class="server-tags">
            ${server.tags.map(tag => `<span class="server-tag">${escapeHtml(tag)}</span>`).join('')}
          </div>
        </div>
      </div>
      <p class="server-description">${escapeHtml(server.description)}</p>
      <div class="server-footer">
        <button class="detail-button" data-id="${server.id}">상세 정보 보기</button>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('.detail-button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = parseInt((e.target as HTMLButtonElement).dataset.id!);
      openDetailModal(id);
    });
  });

  // 카드 추천 버튼 이벤트
  grid.querySelectorAll('.recommend-icon-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt((btn as HTMLElement).dataset.id!);
      
      const confirmed = await showConfirm('🌟 이 서버를 추천하시겠습니까?\n추천은 1일 1회만 가능합니다.');
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

    // 자동 슬라이드 5초마다
    setInterval(() => nextSlide(), 5000);
  }

  if (promoBtnsCarousel.length > 0) {
    promoBtnsCarousel.forEach(btn => {
      btn.addEventListener('click', openPromoBanner);
    });
  }

  renderPagination();
}

// 홍보 배너 열기
function openPromoBanner() {
  const modal = document.querySelector<HTMLDivElement>('#register-modal-container')!;
  const content = document.getElementById('register-modal-content')!;
  
  content.innerHTML = `
    <button class="modal-close" id="close-promo-modal">&times;</button>
    <h2 style="margin-bottom: 2.5rem; font-size: 1.8rem;">🚀 서버 등록하기</h2>
    <p style="color: var(--text-secondary); margin-bottom: 2rem; font-size: 1.05rem;">
      당신의 프리미엄 커뮤니티를 RoFolder에 등록하고 더 많은 멤버를 확보하세요!
    </p>
    <form id="promo-form" class="register-form">
      <div class="form-group">
        <label>서버/커뮤니티 아이콘 (선택)</label>
        <div style="display: flex; gap: 1rem;">
          <div class="image-preview-container">
            <img id="promo-preview" src="https://api.dicebear.com/7.x/identicon/svg?seed=new" alt="미리보기">
          </div>
          <input type="file" id="promo-icon-upload" accept="image/*" class="form-input" style="flex: 1;">
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
  // 이미지를 Base64로 변환하는 함수
  const convertImageToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        resolve(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    });
  };

  const iconInput = document.getElementById('promo-icon-upload') as HTMLInputElement;
  const preview = document.getElementById('promo-preview') as HTMLImageElement;

  // 선택된 아이콘 파일 저장
  let selectedIconFile: File | null = null;

  // 아이콘 미리보기
  iconInput.onchange = () => {
    if (iconInput.files && iconInput.files[0]) {
      selectedIconFile = iconInput.files[0];
      preview.src = URL.createObjectURL(iconInput.files[0]);
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
      tags: ['신규', ...selectedCategories], // 선택된 모든 카테고리를 tags에 추가
      inviteLink: linkInput,
      status: 'pending',
      createdAt: Date.now()
    };

    servers.unshift(newServer);
    saveServers();

    // Webhook 발송 (성공 여부 확인)
    let webhookSuccess = false;
    if (config.webhookUrl && config.webhookUrl.startsWith('https://discord.com')) {
      try {
        const response = await fetch(config.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{
              title: '🚀 새로운 홍보 신청',
              description: `**${sanitizeDiscordText(nameInput)}** 커뮤니티의 홍보 신청이 접수되었습니다.`,
              color: 0x6366f1,
              fields: [
                { name: '📂 카테고리', value: selectedCategories.join(', '), inline: true },
                { name: '📞 문의처', value: escapeHtml(contactInput), inline: true },
                { name: '🔗 초대 링크', value: `[링크 이동](${linkInput})`, inline: true },
                { name: '📝 설명', value: sanitizeDiscordText(descInput) },
                { name: '🛡️ 관리자 동작', value: `[✅ 승인](${window.location.origin}${window.location.pathname}?action=approve&id=${newServer.id}) | [❌ 거절](${window.location.origin}${window.location.pathname}?action=reject&id=${newServer.id})` }
              ],
              footer: { text: 'RoFolder Promo System' },
              timestamp: new Date().toISOString()
            }]
          })
        });
        webhookSuccess = response.ok;
        if (!response.ok) {
          console.error('Webhook 발송 실패:', response.status);
        }
      } catch (err) {
        console.error('Webhook 발송 오류:', err);
      }
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
            <h4 style="margin: 0 0 0.3rem 0; color: var(--text-primary); font-size: 1rem;">${escapeHtml(server.name)}</h4>
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
  logUserActivity('서버 상세 보기', server.name);

  const modal = detailModal();
  const content = document.getElementById('detail-modal-content')!;
  
  // 태그 색상 적용
  const tagHTML = server.tags.map(tag => {
    const tagConfig = [...config.serverTags, ...config.adminOnlyTags].find(t => t.value === tag);
    const { color, bgColor } = getTagColor(tag);
    return `<span class="server-tag" style="padding: 6px 16px; font-size: 0.95rem; background: ${bgColor}; color: ${color};">${tagConfig?.emoji || ''} ${escapeHtml(tag)}</span>`;
  }).join('');
  
  content.innerHTML = `
    <button class="modal-close" id="close-detail">&times;</button>
    <div class="server-header" style="margin-bottom: 2.5rem; gap: 2rem;">
      <img id="detail-server-icon" src="${escapeHtml(server.icon)}" class="server-icon loading" style="width: 120px; height: 120px; border-radius: 28px;" alt="${escapeHtml(server.name)}" onerror="this.src='https://api.dicebear.com/7.x/identicon/svg?seed=${server.id}'; this.classList.remove('loading');" onload="this.classList.remove('loading');">
      <div style="flex: 1;">
        <h2 style="font-size: 2.2rem; margin-bottom: 0.8rem;">${escapeHtml(server.name)}</h2>
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
        alert('✅ 추천이 완료되었습니다!');
        recommendBtn.disabled = true;
        recommendBtn.style.opacity = '0.5';
        recommendBtn.textContent = '✓ 추천됨';
        // 상세정보 새로고침
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
    alert('⚠️ 관리자 권한이 필요합니다.');
    return;
  }

  const modal = document.querySelector<HTMLDivElement>('#admin-modal-container')!;
  const content = document.getElementById('admin-modal-content')!;
  
  const stats = getAdminStats();
  
  content.innerHTML = `
    <button class="modal-close" id="close-admin-modal">&times;</button>
    <h2 style="margin-bottom: 2rem; font-size: 2rem; color: var(--accent-color);">⚙️ 관리자 대시보드</h2>
    
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

    <div style="display: flex; gap: 1rem; margin-bottom: 2rem; border-bottom: 2px solid var(--accent-color, #6366f1); flex-wrap: wrap;">
      <button class="admin-tab-btn active" data-tab="pending" style="padding: 0.75rem 1.5rem; background: none; border: none; color: var(--accent-color, #6366f1); font-weight: bold; cursor: pointer; font-size: 1rem;">⏳ 대기 중</button>
      <button class="admin-tab-btn" data-tab="approved" style="padding: 0.75rem 1.5rem; background: none; border: none; color: var(--text-secondary); font-weight: bold; cursor: pointer; font-size: 1rem;">✅ 승인됨</button>
      <button class="admin-tab-btn" data-tab="rejected" style="padding: 0.75rem 1.5rem; background: none; border: none; color: var(--text-secondary); font-weight: bold; cursor: pointer; font-size: 1rem;">❌ 거절됨</button>
      <button class="admin-tab-btn" data-tab="all" style="padding: 0.75rem 1.5rem; background: none; border: none; color: var(--text-secondary); font-weight: bold; cursor: pointer; font-size: 1rem;">📋 모든 서버</button>
      <button class="admin-tab-btn" data-tab="qa" style="padding: 0.75rem 1.5rem; background: none; border: none; color: var(--text-secondary); font-weight: bold; cursor: pointer; font-size: 1rem;">💬 Q&A 관리</button>
      <button class="admin-tab-btn" data-tab="insights" style="padding: 0.75rem 1.5rem; background: none; border: none; color: var(--text-secondary); font-weight: bold; cursor: pointer; font-size: 1rem;">📊 인사이트</button>
      <button class="admin-tab-btn" data-tab="accesslog" style="padding: 0.75rem 1.5rem; background: none; border: none; color: var(--text-secondary); font-weight: bold; cursor: pointer; font-size: 1rem;">🔐 접속기록</button>
      <button class="admin-tab-btn" data-tab="userlog" style="padding: 0.75rem 1.5rem; background: none; border: none; color: var(--text-secondary); font-weight: bold; cursor: pointer; font-size: 1rem;">👥 유저활동</button>
    </div>

    <div id="admin-servers-container" style="max-height: 500px; overflow-y: auto; margin-bottom: 2rem;">
      <!-- 서버 목록이 동적으로 채워짐 -->
    </div>

    <!-- 관리자 전용 푸터 복구 -->
    <div class="admin-dashboard-footer" style="margin-top: 2rem; padding-top: 2rem; border-top: 1px solid rgba(255, 255, 255, 0.1); display: flex; justify-content: space-between; align-items: center;">
      <div style="color: var(--text-secondary); font-size: 0.85rem;">
        <span style="color: var(--accent-color);">RoFolder</span> Admin Hub v2.0
      </div>
      <div style="display: flex; gap: 1rem;">
        <button id="admin-logout-btn" class="detail-button" style="padding: 0.5rem 1.5rem; font-size: 0.9rem;">로그아웃</button>
      </div>
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

  // 탭 전환 로직
  const tabBtns = content.querySelectorAll('.admin-tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => {
        (b as HTMLElement).style.color = 'var(--text-secondary)';
      });
      (btn as HTMLElement).style.color = 'var(--accent-color, #6366f1)';
      const tab = (btn as HTMLButtonElement).dataset.tab!;
      if (tab === 'qa') {
        renderAdminQA();
      } else if (tab === 'insights') {
        renderAdminInsights();
      } else if (tab === 'all') {
        renderAllServers();
      } else if (tab === 'accesslog') {
        renderAdminAccessLog();
      } else if (tab === 'userlog') {
        renderUserActivityLog();
      } else {
        renderAdminServersByStatus(tab as 'pending' | 'approved' | 'rejected');
      }
    });
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
          <button class="submit-button approve-btn" data-id="${server.id}" style="flex: 1; min-width: 120px; background: #10b981; padding: 0.75rem; border: none; border-radius: 0.5rem; color: white; cursor: pointer; font-weight: bold; height: 44px;">✅ 승인</button>
          <button class="submit-button reject-btn" data-id="${server.id}" style="flex: 1; min-width: 120px; background: #ef4444; padding: 0.75rem; border: none; border-radius: 0.5rem; color: white; cursor: pointer; font-weight: bold; height: 44px;">❌ 거절</button>
        ` : status === 'approved' ? `
          <button class="submit-button edit-btn" data-id="${server.id}" style="flex: 1; min-width: 100px; background: #3b82f6; padding: 0.75rem; border: none; border-radius: 0.5rem; color: white; cursor: pointer; font-weight: bold; height: 44px;">✏️ 수정</button>
          <button class="submit-button reject-btn" data-id="${server.id}" style="flex: 1; min-width: 100px; background: #f59e0b; padding: 0.75rem; border: none; border-radius: 0.5rem; color: white; cursor: pointer; font-weight: bold; height: 44px;">⬇️ 거절</button>
          <button class="submit-button delete-btn" data-id="${server.id}" style="flex: 1; min-width: 100px; background: #ef4444; padding: 0.75rem; border: none; border-radius: 0.5rem; color: white; cursor: pointer; font-weight: bold; height: 44px;">🗑️ 삭제</button>
        ` : `
          <button class="submit-button rereview-btn" data-id="${server.id}" style="flex: 1; min-width: 120px; background: #8b5cf6; padding: 0.75rem; border: none; border-radius: 0.5rem; color: white; cursor: pointer; font-weight: bold; height: 44px;">🔄 재검토</button>
          <button class="submit-button delete-btn" data-id="${server.id}" style="flex: 1; min-width: 120px; background: #ef4444; padding: 0.75rem; border: none; border-radius: 0.5rem; color: white; cursor: pointer; font-weight: bold; height: 44px;">🗑️ 삭제</button>
        `}
      </div>
    </div>
  `).join('');

  // 이벤트 리스너 등록
  container.querySelectorAll('.approve-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = parseInt((e.target as HTMLButtonElement).dataset.id!);
      approveServer(id);
    });
  });

  container.querySelectorAll('.reject-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = parseInt((e.target as HTMLButtonElement).dataset.id!);
      const reason = prompt('거절 사유를 입력해주세요:');
      if (reason) {
        rejectServer(id, reason);
      }
    });
  });

  container.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = parseInt((e.target as HTMLButtonElement).dataset.id!);
      editServer(id);
    });
  });

  container.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = parseInt((e.target as HTMLButtonElement).dataset.id!);
      if (confirm('정말 이 서버를 삭제하시겠습니까?')) {
        deleteServer(id);
      }
    });
  });

  container.querySelectorAll('.rereview-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = parseInt((e.target as HTMLButtonElement).dataset.id!);
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
        alert('✅ JSON이 클립보드에 복사되었습니다!\n\npublic/servers.json에 붙여넣기 → 커밋해주세요.');
      }).catch(() => {
        // 클립보드 복사 실패 시 다운로드
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'servers.json';
        a.click();
        URL.revokeObjectURL(url);
        alert('✅ servers.json이 다운로드되었습니다!\n\npublic/servers.json에 내용을 붙여넣으세요.');
      });
    });
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
          showToast('서버가 삭제되었습니다.', 'success');
          renderAllServers();
        }
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
      const input = container.querySelector(`[data-id="${qaId}"]`) as HTMLInputElement;
      const answer = input.value.trim();
      
      if (!answer || answer.length < 3) {
        alert('❌ 답변은 3자 이상이어야 합니다.');
        return;
      }
      
      const qa = qaData.find(q => q.id === qaId);
      if (qa) {
        qa.answer = escapeHtml(answer);
        localStorage.setItem('rofolder_qa_v1', JSON.stringify(qaData));
        alert('✅ 답변이 저장되었습니다!');
        renderAdminQA();
      }
    });
  });
  
  // 질문 삭제 버튼
  container.querySelectorAll('.delete-qa-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const qaId = parseInt((btn as HTMLElement).dataset.id!);
      if (confirm('이 질문을 삭제하시겠습니까?')) {
        qaData = qaData.filter(q => q.id !== qaId);
        localStorage.setItem('rofolder_qa_v1', JSON.stringify(qaData));
        alert('✅ 질문이 삭제되었습니다!');
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

// 관리자 접속 기록 렌더링
function renderAdminAccessLog() {
  const container = document.getElementById('admin-servers-container')!;
  const logs = getAdminLogs();

  if (logs.length === 0) {
    container.innerHTML = `<p style="text-align: center; color: var(--text-secondary); padding: 2rem;">접속 기록이 없습니다.</p>`;
    return;
  }

  const fmtDate = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
  };

  const getBrowser = (ua: string) => {
    if (ua.includes('Chrome') && !ua.includes('Edg')) return '🌐 Chrome';
    if (ua.includes('Firefox')) return '🦊 Firefox';
    if (ua.includes('Safari') && !ua.includes('Chrome')) return '🧭 Safari';
    if (ua.includes('Edg')) return '🌀 Edge';
    return '🔍 기타';
  };

  const isMobile = (ua: string) => /Mobile|Android|iPhone|iPad/.test(ua);

  container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
      <span style="color: var(--text-secondary); font-size: 0.9rem;">총 ${logs.length}개 · 30일 보관</span>
      <button id="clear-logs-btn" style="background: #ef4444; color: white; border: none; padding: 0.4rem 1rem; border-radius: 0.5rem; cursor: pointer; font-size: 0.85rem;">🗑️ 기록 전체 삭제</button>
    </div>
    <div style="display: flex; flex-direction: column; gap: 0.7rem;">
      ${logs.map((log, i) => `
        <div class="glass" style="padding: 1rem; border-radius: 0.75rem; display: flex; gap: 1rem; align-items: center; border-left: 3px solid ${log.action.includes('성공') ? '#10b981' : '#6366f1'};">
          <div style="font-size: 1.5rem; min-width: 36px; text-align: center;">${isMobile(log.userAgent) ? '📱' : '💻'}</div>
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.3rem;">
              <span style="font-weight: bold; color: var(--text-primary); font-size: 0.95rem;">${escapeHtml(log.action)}</span>
              <span style="background: rgba(99,102,241,0.15); color: #a5b4fc; padding: 0.15rem 0.5rem; border-radius: 0.4rem; font-size: 0.78rem;">#${logs.length - i}</span>
            </div>
            <div style="color: var(--text-secondary); font-size: 0.82rem; display: flex; gap: 1rem; flex-wrap: wrap;">
              <span>🕐 ${fmtDate(log.timestamp)}</span>
              <span>${getBrowser(log.userAgent)}</span>
              <span>📺 ${escapeHtml(log.screen)}</span>
              <span>${isMobile(log.userAgent) ? '📱 모바일' : '🖥️ 데스크톱'}</span>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  document.getElementById('clear-logs-btn')?.addEventListener('click', async () => {
    const confirmed = await showConfirm('접속 기록을 모두 삭제하시겠습니까?');
    if (confirmed) {
      localStorage.removeItem(ADMIN_LOG_KEY);
      showToast('접속 기록이 삭제되었습니다.', 'success');
      renderAdminAccessLog();
    }
  });
}

// 유저 활동 기록 렌더링
function renderUserActivityLog() {
  const container = document.getElementById('admin-servers-container')!;
  const logs = getUserLogs();

  if (logs.length === 0) {
    container.innerHTML = `<p style="text-align: center; color: var(--text-secondary); padding: 2rem;">유저 활동 기록이 없습니다.</p>`;
    return;
  }

  const fmtDate = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
  };

  const getBrowser = (ua: string) => {
    if (ua.includes('Chrome') && !ua.includes('Edg')) return '🌐 Chrome';
    if (ua.includes('Firefox')) return '🦊 Firefox';
    if (ua.includes('Safari') && !ua.includes('Chrome')) return '🧭 Safari';
    if (ua.includes('Edg')) return '🌀 Edge';
    return '🔍 기타';
  };

  const isMobile = (ua: string) => /Mobile|Android|iPhone|iPad/.test(ua);

  container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
      <span style="color: var(--text-secondary); font-size: 0.9rem;">최근 활동 ${logs.length}개 · 30일 보관</span>
      <button id="clear-user-logs-btn" style="background: #ef4444; color: white; border: none; padding: 0.4rem 1rem; border-radius: 0.5rem; cursor: pointer; font-size: 0.85rem;">🗑️ 기록 비우기</button>
    </div>
    <div style="display: flex; flex-direction: column; gap: 0.7rem;">
      ${logs.map((log, i) => {
        let actionColor = '#6366f1';
        if (log.action.includes('추천')) actionColor = '#fa8231';
        if (log.action.includes('상세')) actionColor = '#10b981';
        if (log.action.includes('방문')) actionColor = '#3b82f6';

        return `
          <div class="glass" style="padding: 1rem; border-radius: 0.75rem; display: flex; gap: 1rem; align-items: center; border-left: 3px solid ${actionColor};">
            <div style="font-size: 1.5rem; min-width: 36px; text-align: center;">${isMobile(log.userAgent) ? '📱' : '💻'}</div>
            <div style="flex: 1; min-width: 0;">
              <div style="display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.3rem;">
                <span style="font-weight: bold; color: var(--text-primary); font-size: 0.95rem;">${escapeHtml(log.action)}</span>
                ${log.details ? `<span style="color: var(--accent-color); font-weight: 500;">「${escapeHtml(log.details)}」</span>` : ''}
                <span style="background: rgba(255,255,255,0.05); color: var(--text-muted); padding: 0.15rem 0.5rem; border-radius: 0.4rem; font-size: 0.78rem;">#${logs.length - i}</span>
              </div>
              <div style="color: var(--text-secondary); font-size: 0.82rem; display: flex; gap: 1rem; flex-wrap: wrap;">
                <span>🕐 ${fmtDate(log.timestamp)}</span>
                <span>${getBrowser(log.userAgent)}</span>
                <span>📺 ${escapeHtml(log.screen)}</span>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  document.getElementById('clear-user-logs-btn')?.addEventListener('click', async () => {
    const confirmed = await showConfirm('유저 활동 기록을 모두 삭제하시겠습니까?');
    if (confirmed) {
      localStorage.removeItem(USER_LOG_KEY);
      showToast('유저 활동 기록이 삭제되었습니다.', 'success');
      renderUserActivityLog();
    }
  });
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
  server.tags = Array.from(new Set([...server.tags, '인증됨']));
  
  saveServers();
  
  // 현재 탭의 상태를 유지하며 재렌더링
  const currentTab = document.querySelector('.admin-tab-btn.active')?.getAttribute('data-tab') as 'pending' | 'approved' | 'rejected' || 'pending';
  renderAdminServersByStatus(currentTab);
  
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
  
  // 현재 탭의 상태를 유지하며 재렌더링
  const currentTab = document.querySelector('.admin-tab-btn.active')?.getAttribute('data-tab') as 'pending' | 'approved' | 'rejected' || 'pending';
  renderAdminServersByStatus(currentTab);
  
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
          <input type="file" id="icon-upload" accept="image/*" class="form-input">
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
            <button type="button" class="chip${tag.value === server.category ? ' active' : ''}" data-value="${tag.value}">
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
            <button type="button" class="admin-tag-chip${server.tags.includes(tag.value) ? ' selected' : ''}" data-tag-value="${tag.value}" data-tag-label="${tag.label}">
              ${tag.emoji} ${tag.label}
            </button>
          `).join('')}
        </div>
        <input type="hidden" id="admin-tags" value="${server.tags.filter(t => config.adminOnlyTags.map(a => a.value).includes(t)).join(',')}">
      </div>
      <div style="display: flex; gap: 1rem;">
        <button type="submit" class="submit-button" style="flex: 1;">💾 저장</button>
        <button type="button" id="cancel-edit" class="detail-button" style="flex: 1; background: #6b7280; color: white;">취소</button>
      </div>
    </form>
  `;

  modal.classList.remove('hidden');
  document.getElementById('close-reg-modal')!.onclick = () => modal.classList.add('hidden');
  document.getElementById('cancel-edit')!.onclick = () => modal.classList.add('hidden');

  const form = document.getElementById('edit-form') as HTMLFormElement;
  const iconInput = document.getElementById('icon-upload') as HTMLInputElement;
  const preview = document.getElementById('image-preview') as HTMLImageElement;

  // 아이콘 미리보기
  iconInput.onchange = () => {
    if (iconInput.files && iconInput.files[0]) {
      preview.src = URL.createObjectURL(iconInput.files[0]);
    }
  };

  // 카테고리 칩 선택
  const chips = document.querySelectorAll('.category-chips .chip');
  const catInput = document.getElementById('reg-category') as HTMLInputElement;
  chips.forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      catInput.value = (chip as HTMLButtonElement).dataset.value!;
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
  form.onsubmit = (e) => {
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

    // 관리자 태그 업데이트
    const userTags = server.tags.filter(t => !config.adminOnlyTags.map(a => a.value).includes(t));
    const adminTags = adminTagsInput ? adminTagsInput.split(',').filter(Boolean) : [];
    server.tags = [...new Set([...userTags, ...adminTags])];

    saveServers();
    alert('✅ 서버 정보가 수정되었습니다.');
    modal.classList.add('hidden');
    
    // 관리자 대시보드 새로고침
    const currentTab = document.querySelector('.admin-tab-btn.active')?.getAttribute('data-tab') as 'pending' | 'approved' | 'rejected' || 'approved';
    renderAdminServersByStatus(currentTab);
  };
}

// 서버 삭제
function deleteServer(id: number) {
  const index = servers.findIndex(s => s.id === id);
  if (index === -1) return;

  servers.splice(index, 1);
  saveServers();
  alert('✅ 서버가 삭제되었습니다.');
  
  // 관리자 대시보드 새로고침
  const currentTab = document.querySelector('.admin-tab-btn.active')?.getAttribute('data-tab') as 'pending' | 'approved' | 'rejected' || 'approved';
  renderAdminServersByStatus(currentTab);
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
  
  // 승인된 경우 servers.json 업데이트 (자동 커밋용)
  if (newStatus === 'approved') {
    exportApprovedServersToJSON();
  }
  
  // 관리자 대시보드 새로고침
  const currentTab = document.querySelector('.admin-tab-btn.active')?.getAttribute('data-tab') as 'pending' | 'approved' | 'rejected' || 'pending';
  renderAdminServersByStatus(currentTab);
  
  alert('✅ 서버 상태가 변경되었습니다.');
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
const LOG_EXPIRE_DAYS = 30;

interface AccessLog {
  timestamp: number;
  userAgent: string;
  screen: string;
  action: string;
  details?: string;
}

function logAdminAccess(action = '로그인') {
  let logs: AccessLog[] = [];
  try { logs = JSON.parse(localStorage.getItem(ADMIN_LOG_KEY) || '[]'); } catch {}
  const cutoff = Date.now() - LOG_EXPIRE_DAYS * 24 * 60 * 60 * 1000;
  logs = logs.filter(l => l.timestamp > cutoff);
  logs.unshift({
    timestamp: Date.now(),
    userAgent: navigator.userAgent,
    screen: `${screen.width}x${screen.height}`,
    action
  });
  localStorage.setItem(ADMIN_LOG_KEY, JSON.stringify(logs));
}

function logUserActivity(action: string, details?: string) {
  let logs: AccessLog[] = [];
  try { logs = JSON.parse(localStorage.getItem(USER_LOG_KEY) || '[]'); } catch {}
  const cutoff = Date.now() - LOG_EXPIRE_DAYS * 24 * 60 * 60 * 1000;
  logs = logs.filter(l => l.timestamp > cutoff);
  logs.unshift({
    timestamp: Date.now(),
    userAgent: navigator.userAgent,
    screen: `${screen.width}x${screen.height}`,
    action,
    details
  });
  // 최대 500개까지만 유지 (브라우저 저장소 용량 제한 고려)
  if (logs.length > 500) logs = logs.slice(0, 500);
  localStorage.setItem(USER_LOG_KEY, JSON.stringify(logs));
}

function getAdminLogs(): AccessLog[] {
  try { return JSON.parse(localStorage.getItem(ADMIN_LOG_KEY) || '[]'); } catch { return []; }
}

function getUserLogs(): AccessLog[] {
  try { return JSON.parse(localStorage.getItem(USER_LOG_KEY) || '[]'); } catch { return []; }
}

// 관리자 클릭 추적 (푸터 로고 5번 클릭)
let adminPasswordAttempts = 0;
let adminPasswordLocktime = 0;

function trackAdminClick() {
  // 비밀번호 시도 제한 확인
  if (adminPasswordLocktime > Date.now()) {
    const remainTime = Math.ceil((adminPasswordLocktime - Date.now()) / 1000);
    alert(`🔒 너무 많은 시도가 있었습니다.\n${remainTime}초 후에 다시 시도해주세요.`);
    return;
  }

  adminClickCount++;
  
  if (adminClickTimer) clearTimeout(adminClickTimer);
  adminClickTimer = setTimeout(() => {
    adminClickCount = 0;
  }, 3000);

  if (adminClickCount === 5) {
    adminClickCount = 0;
    const password = prompt('🔐 관리자 비밀번호를 입력하세요:', '');
    if (password) {
      // 비밀번호 검증 (config에서 읽음)
      if (password === config.adminPassword) {
        adminPasswordAttempts = 0; // 정확한 비밀번호 입력
        setAdminToken('admin_access_token_' + Date.now());
        logAdminAccess('로그인 성공');
        openAdminDashboard();
      } else {
        adminPasswordAttempts++;
        
        // 5번 실패 시 30초 잠금
        if (adminPasswordAttempts >= 5) {
          adminPasswordLocktime = Date.now() + 30000; // 30초 잠금
          alert('❌ 비밀번호가 잘못되었습니다.\n너무 많은 시도로 30초간 접근이 제한됩니다.');
        } else {
          alert(`❌ 비밀번호가 잘못되었습니다. (${5 - adminPasswordAttempts}회 시도 남음)`);
        }
      }
    }
  }
}

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
            <h3 id="footer-logo" style="margin: 0 0 0.5rem 0; color: var(--accent-color, #6366f1); font-size: 1.2rem; cursor: pointer;">🌟 ${config.siteName}</h3>
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
  document.getElementById('footer-logo')?.addEventListener('click', trackAdminClick);
  document.getElementById('footer-register')?.addEventListener('click', openPromoBanner);
  document.getElementById('footer-inquiry')?.addEventListener('click', openInquiryModal);
  document.getElementById('footer-qa')?.addEventListener('click', showQAModal);
  document.getElementById('footer-top')?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

// 등록 모달 열기 (홍보 배너와 동일)
function openRegisterModal() {
  openPromoBanner();
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

// 탄력적 커서 로직
function initCursor() {
  const cursor = document.querySelector<HTMLDivElement>('.custom-cursor')!;
  const follower = document.querySelector<HTMLDivElement>('.cursor-follower')!;
  if (!cursor || !follower) return;
  
  cursor.innerHTML = '<span class="cursor-text">GO</span>';

  let mouseX = 0, mouseY = 0;
  let cursorX = 0, cursorY = 0;
  let followerX = 0, followerY = 0;
  let speedX = 0, speedY = 0;

  window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  });

  function animate() {
    const prevX = cursorX;
    const prevY = cursorY;

    cursorX += (mouseX - cursorX) * 0.15;
    cursorY += (mouseY - cursorY) * 0.15;
    followerX += (mouseX - followerX) * 0.08;
    followerY += (mouseY - followerY) * 0.08;

    speedX = cursorX - prevX;
    speedY = cursorY - prevY;
    const angle = Math.atan2(speedY, speedX) * 180 / Math.PI;
    const stretch = Math.min(Math.sqrt(speedX * speedX + speedY * speedY) * 0.1, 1);

    cursor.style.left = `${cursorX}px`;
    cursor.style.top = `${cursorY}px`;
    cursor.style.transform = `translate(-50%, -50%) rotate(${angle}deg) scale(${1 + stretch}, ${1 - stretch * 0.5})`;

    follower.style.left = `${followerX}px`;
    follower.style.top = `${followerY}px`;
    follower.style.transform = `translate(-50%, -50%)`;

    requestAnimationFrame(animate);
  }
  animate();

  document.addEventListener('mouseover', (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.tagName === 'A' || target.closest('.server-card')) {
      cursor.classList.add('hover');
    }
  });

  document.addEventListener('mouseout', (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.tagName === 'A' || target.closest('.server-card')) {
      cursor.classList.remove('hover');
    }
  });
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
      setAdminToken('admin_access_token_' + Date.now());
      logAdminAccess('자동 동작 로그인');
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

// 메인 초기화
async function init() {
  // 서버 데이터 로드
  servers = await loadServers();
  filteredServers = [...servers];
  
  const appElement = document.getElementById('app')!;
  appElement.innerHTML = `
    <header>
      <a href="#" class="logo">
        <img src="${config.siteLogo}" alt="${config.siteName} Logo" class="brand-logo">
        <span>${config.siteName}</span>
      </a>
      <div class="nav-links">
        <a href="${config.originalSiteUrl}" target="_blank" class="nav-link">로폴더 바로가기</a>
        <button id="open-register" class="nav-link nav-link-primary">서버 등록</button>
      </div>
    </header>

    <main>
      <section class="hero">
        <h1 class="hero-title">당신의 가치를 높이는<br>커뮤니티의 모든 것</h1>
        <p class="hero-subtitle">가장 세련된 방식으로 디스코드 서버를 탐색하고 홍보하세요. 사용자를 위한 서버 목록 로폴더입니다.</p>
        
        <div class="search-container glass">
          <input type="text" id="search-input" class="search-input" placeholder="관심 있는 서버 이름을 입력하세요...">
          <button id="search-btn" class="search-button">검색하기</button>
        </div>
      </section>

      <div id="filter-bar" class="filter-bar glass"></div>
      
      <div id="server-grid" class="server-grid"></div>
      
      <div id="pagination-container" class="pagination-container"></div>
    </main>
  `;

  renderFilters();
  renderServers();
  renderFooter();
  setupEventListeners();
  initCursor();
  
  // 방문 기록
  logUserActivity('페이지 방문');
  
  // 실시간 갱신 시작
  startRealTimePolling();
  
  // 관리자 자동 동작 처리
  await handleAdminAutoAction();
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch(err => console.error('초기화 실패:', err));
  
  // 자동 갱신: 30초마다 서버 목록 다시 로드
  setInterval(() => {
    loadServers();
    applyFilters();
    console.log('✅ 서버 목록 자동 갱신 완료');
  }, 30000); // 30초
});
