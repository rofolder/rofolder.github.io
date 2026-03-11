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
    const response = await fetch(JSON_DATA_URL);
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

async function loadServers(): Promise<DiscordServer[]> {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      return JSON.parse(saved);
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

// ========== 추천 시스템 함수들 ==========
// @ts-ignore
const RECOMMENDATIONS_KEY = 'user_recommendations_v1';
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
    alert('⚠️ 이 서버는 오늘 이미 추천했습니다. 내일 다시 추천할 수 있습니다.');
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
    // 승인된 서버만 표시
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
  const categories = ['전체', '게임', '커뮤니티', '배포', '친목', '방송', '신규', '인기'];
  const filterBar = document.getElementById('filter-bar')!;
  if (!filterBar) return;
  
  filterBar.innerHTML = categories.map(cat => `
    <button class="filter-item ${currentCategory === cat ? 'active' : ''}" data-category="${cat}">
      ${cat}
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
        <p style="margin: 0 0 1rem 0; color: var(--text-secondary); font-size: 0.9rem;">커뮤니티의 활발한 토론</p>
        <button id="show-recent-qa" style="width: 100%; padding: 0.8rem; background: linear-gradient(135deg, #10b981, #34d399); color: white; border: none; border-radius: 0.5rem; cursor: pointer; font-weight: bold;">
          💬 둘러보기
        </button>
      </div>
    </div>

    <div style="margin-bottom: 1.5rem; text-align: center; color: var(--text-secondary); font-size: 0.85rem;">
      <p>📌 욕설, 광고, 부적절한 내용은 삭제될 수 있습니다.</p>
    </div>
  `;

  modal.classList.remove('hidden');
  document.getElementById('close-qa-modal')!.onclick = () => modal.classList.add('hidden');
  
  // Q&A 버튼 이벤트
  document.getElementById('show-ask-form')?.addEventListener('click', () => {
    alert('📝 질문 기능은 곧 오픈될 예정입니다!');
  });
  document.getElementById('show-recent-qa')?.addEventListener('click', () => {
    alert('💬 준비 중인 기능입니다. 곧 만날 수 있습니다!');
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
                <button class="promo-button" id="carousel-promo-btn">🚀 지금 등록하기</button>
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
                <button class="top-recommend-btn" data-id="${server.id}" style="width: 100%; padding: 0.6rem; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; border: none; border-radius: 0.5rem; cursor: pointer; font-weight: bold; font-size: 0.85rem; transition: all 0.3s ease; text-align: center;">
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

  // Top 10 추천 버튼 이벤트
  grid.querySelectorAll('.top-recommend-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = parseInt((e.target as HTMLButtonElement).dataset.id!);
      if (addRecommendation(id)) {
        alert('✅ 추천이 완료되었습니다! 오늘의 인기 서버 순위가 업데이트됩니다.');
        (e.target as HTMLButtonElement).disabled = true;
        (e.target as HTMLButtonElement).style.opacity = '0.5';
        (e.target as HTMLButtonElement).textContent = '✓ 추천됨';
        // 서버 리스트 새로고침
        renderServers();
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
  const promoBtnCarousel = grid.querySelector('#carousel-promo-btn');
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

  if (promoBtnCarousel) {
    promoBtnCarousel.addEventListener('click', openPromoBanner);
  }

  renderPagination();
}

// 홍보 배너 열기
function openPromoBanner() {
  const modal = document.querySelector<HTMLDivElement>('#register-modal-container')!;
  const content = document.getElementById('register-modal-content')!;
  
  content.innerHTML = `
    <button class="modal-close" id="close-promo-modal">&times;</button>
    <h2 style="margin-bottom: 2.5rem; font-size: 1.8rem;">� 서버 등록하기</h2>
    <p style="color: var(--text-secondary); margin-bottom: 2rem; font-size: 1.05rem;">
      당신의 프리미엄 커뮤니티를 RoFolder에 등록하고 더 많은 멤버를 확보하세요!
    </p>
    <form id="promo-form" class="register-form">
      <div class="form-group">
        <label>서버/커뮤니티 이름 *</label>
        <input type="text" id="promo-name" class="form-input" placeholder="예: 풀스택 개발자 커뮤니티" required>
      </div>
      <div class="form-group">
        <label>카테고리 선택 *</label>
        <div id="promo-category-chips" class="category-chips">
          ${config.serverTags.map((tag, idx) => `
            <button type="button" class="chip${idx === 0 ? ' active' : ''}" data-value="${tag.value}">
              ${tag.emoji} ${tag.label}
            </button>
          `).join('')}
        </div>
        <input type="hidden" id="promo-category" value="${config.serverTags[0].value}">
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
        <label>서버/커뮤니티 아이콘 (선택)</label>
        <div style="display: flex; gap: 1rem;">
          <div class="image-preview-container">
            <img id="promo-preview" src="https://api.dicebear.com/7.x/identicon/svg?seed=new" alt="미리보기">
          </div>
          <input type="file" id="promo-icon-upload" accept="image/*" class="form-input" style="flex: 1;">
        </div>
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

  // 아이콘 미리보기
  iconInput.onchange = () => {
    if (iconInput.files && iconInput.files[0]) {
      preview.src = URL.createObjectURL(iconInput.files[0]);
    }
  };

  // 카테고리 칩 선택
  const chips = document.querySelectorAll('#promo-category-chips .chip');
  const catInput = document.getElementById('promo-category') as HTMLInputElement;
  chips.forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      catInput.value = (chip as HTMLButtonElement).dataset.value!;
    });
  });

  // 폼 제출
  form.onsubmit = (e) => {
    e.preventDefault();
    
    const nameInput = (document.getElementById('promo-name') as HTMLInputElement).value.trim();
    const descInput = (document.getElementById('promo-desc') as HTMLTextAreaElement).value.trim();
    const catInput = (document.getElementById('promo-category') as HTMLInputElement).value;
    const linkInput = (document.getElementById('promo-link') as HTMLInputElement).value.trim();
    const contactInput = (document.getElementById('promo-contact') as HTMLInputElement).value.trim();

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

    if (!contactInput || contactInput.length < 3) {
      alert('❌ 문의처를 정확히 입력해주세요.');
      return;
    }

    const isBad = containsForbiddenContent(nameInput) || containsForbiddenContent(descInput);
    if (isBad) {
      alert('⚠️ 부적절한 키워드가 포함되어 있습니다.\n(도박, 성인, 불법 등)');
      return;
    }

    // 새 서버로 등록 (pending 상태)
    const newServer: DiscordServer = {
      id: Date.now(),
      name: nameInput,
      description: descInput,
      category: catInput,
      icon: preview.src && !preview.src.includes('identicon') ? preview.src : 'https://api.dicebear.com/7.x/identicon/svg?seed=' + nameInput,
      tags: ['신규'],
      inviteLink: linkInput,
      status: 'pending',
      createdAt: Date.now()
    };

    servers.unshift(newServer);
    saveServers();

    // Webhook 발송
    if (config.webhookUrl && config.webhookUrl.startsWith('https://discord.com')) {
      fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: '🚀 새로운 홍보 신청',
            description: `**${sanitizeDiscordText(nameInput)}** 커뮤니티의 홍보 신청이 접수되었습니다.`,
            color: 0x6366f1,
            fields: [
              { name: '📂 카테고리', value: catInput, inline: true },
              { name: '📞 문의처', value: escapeHtml(contactInput), inline: true },
              { name: '🔗 초대 링크', value: `[링크 이동](${linkInput})`, inline: true },
              { name: '📝 설명', value: sanitizeDiscordText(descInput) }
            ],
            footer: { text: 'RoFolder Promo System' },
            timestamp: new Date().toISOString()
          }]
        })
      }).catch(err => console.error('Webhook 발송 실패:', err));
    }

    alert('✅ 홍보 신청이 완료되었습니다!\n관리자 검토 후 승인하겠습니다.');
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
      <a href="${escapeHtml(server.inviteLink)}" target="_blank" class="submit-button" style="flex: 1; text-decoration: none; text-align: center; min-width: 150px;">🔗 서버 참가하기</a>
      <button id="detail-recommend-btn" class="submit-button" style="background: linear-gradient(135deg, #fa8231, #f97316); flex: 1; min-width: 150px;" ${!canRecommend(server.id) ? 'disabled style="opacity: 0.5;"' : ''}>👍 추천하기</button>
      <button id="detail-close-btn" class="detail-button" style="width: auto; padding: 0 2rem;">닫기</button>
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

    <div style="display: flex; gap: 1rem; margin-bottom: 2rem; border-bottom: 2px solid var(--accent-color, #6366f1);">
      <button class="admin-tab-btn active" data-tab="pending" style="padding: 0.75rem 1.5rem; background: none; border: none; color: var(--accent-color, #6366f1); font-weight: bold; cursor: pointer; font-size: 1rem;">⏳ 대기 중</button>
      <button class="admin-tab-btn" data-tab="approved" style="padding: 0.75rem 1.5rem; background: none; border: none; color: var(--text-secondary); font-weight: bold; cursor: pointer; font-size: 1rem;">✅ 승인됨</button>
      <button class="admin-tab-btn" data-tab="rejected" style="padding: 0.75rem 1.5rem; background: none; border: none; color: var(--text-secondary); font-weight: bold; cursor: pointer; font-size: 1rem;">❌ 거절됨</button>
      <button class="admin-tab-btn" data-tab="insights" style="padding: 0.75rem 1.5rem; background: none; border: none; color: var(--text-secondary); font-weight: bold; cursor: pointer; font-size: 1rem;">📊 인사이트</button>
    </div>

    <div id="admin-servers-container" style="max-height: 500px; overflow-y: auto; margin-bottom: 2rem;">
      <!-- 서버 목록이 동적으로 채워짐 -->
    </div>

    <div style="display: flex; gap: 1rem; margin-top: 3rem;">
      <button id="admin-logout-btn" class="detail-button" style="flex: 1;">로그아웃</button>
    </div>
  `;

  modal.classList.remove('hidden');
  document.getElementById('close-admin-modal')!.onclick = () => modal.classList.add('hidden');
  document.getElementById('admin-logout-btn')!.onclick = () => {
    sessionStorage.removeItem('admin_token');
    modal.classList.add('hidden');
    alert('✅ 로그아웃 완료');
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
      if (tab === 'insights') {
        renderAdminInsights();
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
  
  if (filteredServers.length === 0) {
    container.innerHTML = `<p style="text-align: center; color: var(--text-secondary); padding: 2rem;">
      ${status === 'pending' ? '대기 중인 서버가' : status === 'approved' ? '승인된 서버가' : '거절된 서버가'} 없습니다.
    </p>`;
    return;
  }

  container.innerHTML = filteredServers.map(server => `
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
          <button class="submit-button approve-btn" data-id="${server.id}" style="flex: 1; background: #10b981; min-width: 120px;">✅ 승인</button>
          <button class="detail-button reject-btn" data-id="${server.id}" style="flex: 1; background: #ef4444; color: white; min-width: 120px;">❌ 거절</button>
        ` : status === 'approved' ? `
          <button class="submit-button edit-btn" data-id="${server.id}" style="flex: 1; background: #3b82f6; min-width: 100px;">✏️ 수정</button>
          <button class="detail-button reject-btn" data-id="${server.id}" style="flex: 1; background: #f59e0b; color: white; min-width: 100px;">⬇️ 거절</button>
          <button class="detail-button delete-btn" data-id="${server.id}" style="flex: 1; background: #ef4444; color: white; min-width: 100px;">🗑️ 삭제</button>
        ` : `
          <button class="submit-button rereview-btn" data-id="${server.id}" style="flex: 1; background: #8b5cf6; min-width: 120px;">🔄 재검토</button>
          <button class="detail-button delete-btn" data-id="${server.id}" style="flex: 1; background: #ef4444; color: white; min-width: 120px;">🗑️ 삭제</button>
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
  }
  
  saveServers();
  
  // 관리자 대시보드 새로고침
  const currentTab = document.querySelector('.admin-tab-btn.active')?.getAttribute('data-tab') as 'pending' | 'approved' | 'rejected' || 'pending';
  renderAdminServersByStatus(currentTab);
  
  alert('✅ 서버 상태가 변경되었습니다.');
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
            &copy; ${currentYear} RoFolder. All rights reserved. | Made with ❤️
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
        <p class="hero-subtitle">가장 세련된 방식으로 디스코드 서버를 탐색하고 홍보하세요. 명품 서버 리스트 로폴더입니다.</p>
        
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
