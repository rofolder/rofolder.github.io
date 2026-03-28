import { config } from './config';

// ===== 설정 =====
const EMAILJS_SERVICE_ID = config.emailjsServiceId;
const EMAILJS_PUBLIC_KEY = config.emailjsPublicKey;
const EMAILJS_TEMPLATE_ID = config.emailjsTemplateId;
const ADMIN_EMAIL = config.adminEmail;
const SITE_URL = 'https://rofolder.kro.kr';

// ===== 스토리지 키 =====
const IP_WHITELIST_KEY = 'rofolder_admin_ips_v1';
const IP_TOKEN_KEY = 'rofolder_ip_tokens_v1';
const SESSION_IP_KEY = 'rofolder_session_ip';

// ===== 타입 =====
interface ApprovedIP {
  ip: string;
  approvedAt: number;
  expiresAt: number; // 90일 후 만료
}

interface IPToken {
  ip: string;
  token: string;
  createdAt: number;
  expiresAt: number; // 10분 후 만료
}

// ===== EmailJS 동적 로드 =====
let emailjsLoaded = false;
async function loadEmailJS(): Promise<void> {
  if (emailjsLoaded || (window as any).emailjs) {
    emailjsLoaded = true;
    return;
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js';
    script.onload = () => {
      (window as any).emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
      emailjsLoaded = true;
      resolve();
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// ===== IP 감지 =====
export async function getCurrentIP(): Promise<string> {
  try {
    const res = await fetch('https://api.ipify.org?format=json', { cache: 'no-store' });
    const data = await res.json();
    return data.ip || 'unknown';
  } catch {
    return 'unknown';
  }
}

// ===== IP 화이트리스트 관리 =====
function getApprovedIPs(): ApprovedIP[] {
  try {
    const raw = localStorage.getItem(IP_WHITELIST_KEY);
    if (!raw) return [];
    const list: ApprovedIP[] = JSON.parse(raw);
    const now = Date.now();
    // 만료된 항목 제거
    return list.filter(item => item.expiresAt > now);
  } catch {
    return [];
  }
}

export function isIPApproved(ip: string): boolean {
  if (ip === 'unknown') return false;
  const session = sessionStorage.getItem(SESSION_IP_KEY);
  if (session === ip) return true; // 세션 내 이미 승인됨
  const list = getApprovedIPs();
  return list.some(item => item.ip === ip);
}

export function approveIPByToken(ip: string, token: string): boolean {
  try {
    const raw = localStorage.getItem(IP_TOKEN_KEY);
    if (!raw) return false;
    const tokens: IPToken[] = JSON.parse(raw);
    const now = Date.now();
    const match = tokens.find(t => t.ip === ip && t.token === token && t.expiresAt > now);
    if (!match) return false;

    // IP를 화이트리스트에 추가 (90일)
    const list = getApprovedIPs();
    list.push({ ip, approvedAt: now, expiresAt: now + 90 * 24 * 60 * 60 * 1000 });
    localStorage.setItem(IP_WHITELIST_KEY, JSON.stringify(list));

    // 사용된 토큰 제거
    const updated = tokens.filter(t => !(t.ip === ip && t.token === token));
    localStorage.setItem(IP_TOKEN_KEY, JSON.stringify(updated));

    // 세션에도 기록
    sessionStorage.setItem(SESSION_IP_KEY, ip);
    console.log(`✅ [Auth] IP ${ip} 화이트리스트 승인 완료`);
    return true;
  } catch {
    return false;
  }
}

// ===== 토큰 생성 =====
function generateToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ===== EmailJS 이메일 전송 =====
export async function sendIPApprovalEmail(ip: string): Promise<boolean> {
  if (!EMAILJS_TEMPLATE_ID) {
    console.warn('⚠️ [Auth] EmailJS Template ID가 설정되지 않았습니다. VITE_EMAILJS_TEMPLATE_ID를 설정해주세요.');
    return false;
  }

  try {
    await loadEmailJS();

    const token = generateToken();
    const now = Date.now();
    const approveUrl = `${SITE_URL}/?approve_ip=${encodeURIComponent(ip)}&token=${token}`;

    // 토큰 저장 (10분 유효)
    const raw = localStorage.getItem(IP_TOKEN_KEY);
    const tokens: IPToken[] = raw ? JSON.parse(raw) : [];
    tokens.push({ ip, token, createdAt: now, expiresAt: now + 10 * 60 * 1000 });
    localStorage.setItem(IP_TOKEN_KEY, JSON.stringify(tokens));

    // EmailJS 전송
    const result = await (window as any).emailjs.send(
      EMAILJS_SERVICE_ID,
      EMAILJS_TEMPLATE_ID,
      {
        to_email: ADMIN_EMAIL,
        ip_address: ip,
        approve_url: approveUrl,
        request_time: new Date().toLocaleString('ko-KR'),
        expires_in: '10분',
      }
    );

    console.log(`📧 [Auth] 승인 이메일 전송 완료 → ${ADMIN_EMAIL}`, result);
    return true;
  } catch (err) {
    console.error('❌ [Auth] 이메일 전송 실패:', err);
    return false;
  }
}

// ===== URL 파라미터로 IP 승인 처리 (페이지 로드 시 호출) =====
export function handleIPApprovalCallback(): boolean {
  const params = new URLSearchParams(window.location.search);
  const ip = params.get('approve_ip');
  const token = params.get('token');

  if (!ip || !token) return false;

  // URL 파라미터 즉시 제거 (보안)
  const url = new URL(window.location.href);
  url.searchParams.delete('approve_ip');
  url.searchParams.delete('token');
  window.history.replaceState({}, '', url.toString());

  const success = approveIPByToken(decodeURIComponent(ip), token);
  if (success) {
    console.log(`🔓 [Auth] IP ${ip} 승인 완료`);
  } else {
    console.warn(`⚠️ [Auth] IP ${ip} 승인 실패 (토큰 만료/불일치)`);
  }
  return success;
}
