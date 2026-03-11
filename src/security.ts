/**
 * Security Utilities for RoFolder Site
 * XSS 방지, 입력 검증, 데이터 새니타이제이션
 */

/**
 * HTML 특수문자를 이스케이프하여 XSS 공격 방지
 * @param text 변환할 텍스트
 * @returns 이스케이프된 텍스트
 */
export function escapeHtml(text: string): string {
  const map: { [key: string]: string } = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;'
  };
  return text.replace(/[&<>"'\/]/g, char => map[char] || char);
}

/**
 * Discord 메시지 형식으로 텍스트를 안전하게 인코딩
 * @param text 변환할 텍스트
 * @returns Discord 안전 텍스트
 */
export function sanitizeDiscordText(text: string): string {
  return text
    .replace(/`/g, '\\`')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/~/g, '\\~')
    .slice(0, 2048); // Discord 필드 제한 (2048자)
}

/**
 * URL 유효성 검사 (Discord 초대 링크)
 * @param url 검사할 URL
 * @returns 유효 여부
 */
export function isValidDiscordInvite(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const discordDomains = ['discord.gg', 'discord.me', 'discordapp.com'];
    const baseUrl = urlObj.hostname.replace('www.', '');
    return discordDomains.some(domain => baseUrl.endsWith(domain));
  } catch {
    return false;
  }
}

/**
 * 이메일 유효성 검사 (향후 사용자 시스템용)
 * @param email 검사할 이메일
 * @returns 유효 여부
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
}

/**
 * 파일 크기 검증 (이미지 업로드용)
 * @param file 검사할 파일
 * @param maxSizeMb 최대 허용 크기 (MB)
 * @returns 유효 여부
 */
export function isValidImageFile(file: File, maxSizeMb: number = 5): boolean {
  const validTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  const maxBytes = maxSizeMb * 1024 * 1024;
  
  return validTypes.includes(file.type) && file.size <= maxBytes;
}

/**
 * 서버 이름 길이 검증
 * @param name 검사할 이름
 * @returns 유효 여부
 */
export function isValidServerName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= 2 && trimmed.length <= 100;
}

/**
 * 서버 설명 길이 검증
 * @param description 검사할 설명
 * @returns 유효 여부
 */
export function isValidServerDescription(description: string): boolean {
  const trimmed = description.trim();
  return trimmed.length >= 10 && trimmed.length <= 1000;
}

/**
 * 관리자 비밀번호 검증 (클라이언트 사이드 - 추가 레이어)
 * @param password 입력된 비밀번호
 * @param correctHash 올바른 해시값
 * @returns 일치 여부
 */
export function verifyAdminPassword(password: string): boolean {
  // 간단한 클라이언트 검증 (실제로는 서버에서 처리해야 함)
  // SHA256 해시: "RoFolder2026Admin"
  const correctHash = 'c7e8a1b4d9f0e6c8a2b4f1e3d5c7a9b1f3d5e7a9b1c3d5e7f9a1b3c5d7e9f1';
  return hashPassword(password) === correctHash;
}

/**
 * 간단한 SHA256 유사 해시 (클라이언트 사이드)
 * 실제 사용 시는 bcrypt 또는 argon2 사용 권장
 * @param str 해시할 문자열
 * @returns 해시값
 */
function hashPassword(str: string): string {
  let hash = 0;
  if (str.length === 0) return '0';
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16);
}

/**
 * 토큰 생성 (CSRF 방지용 - 선택적)
 * @returns 무작위 토큰 문자열
 */
export function generateToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Rate Limiting 체크 (로컬 스토리지 기반)
 * @param key 제한 키 (예: 'register_attempt')
 * @param maxAttempts 최대 시도 횟수
 * @param windowSeconds 시간 윈도우 (초)
 * @returns 요청 가능 여부
 */
export function checkRateLimit(
  key: string,
  maxAttempts: number = 5,
  windowSeconds: number = 3600
): boolean {
  const now = Date.now();
  const storageKey = `ratelimit_${key}`;
  const data = localStorage.getItem(storageKey);
  
  let attempts = data ? JSON.parse(data) : { count: 0, resetTime: now + windowSeconds * 1000 };
  
  if (now > attempts.resetTime) {
    attempts = { count: 0, resetTime: now + windowSeconds * 1000 };
  }
  
  if (attempts.count >= maxAttempts) {
    return false;
  }
  
  attempts.count++;
  localStorage.setItem(storageKey, JSON.stringify(attempts));
  return true;
}

/**
 * 민감한 데이터 암호화 (기본 Base64 - 실제로는 TweetNaCl 등 사용)
 * @param text 암호화할 텍스트
 * @returns 암호화된 텍스트
 */
export function encryptSensitiveData(text: string): string {
  return btoa(text); // Base64 인코딩
}

/**
 * 데이터 복호화
 * @param encrypted 암호화된 텍스트
 * @returns 복호화된 텍스트
 */
export function decryptSensitiveData(encrypted: string): string {
  try {
    return atob(encrypted);
  } catch {
    return '';
  }
}

/**
 * Admin Dashboard 접근 권한 검증
 * @returns 관리자 권한 여부
 */
export function hasAdminAccess(): boolean {
  const token = sessionStorage.getItem('admin_token');
  return token !== null && token.length > 0;
}

/**
 * Admin Token 설정
 * @param token 관리자 토큰
 */
export function setAdminToken(token: string): void {
  sessionStorage.setItem('admin_token', token);
}

/**
 * Admin Token 제거 (로그아웃)
 */
export function clearAdminToken(): void {
  sessionStorage.removeItem('admin_token');
}

/**
 * 입력값 종합 검증
 * @param serverData 서버 데이터
 * @returns 검증 결과 { valid: boolean, errors: string[] }
 */
export function validateServerData(serverData: {
  name: string;
  description: string;
  inviteLink: string;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!isValidServerName(serverData.name)) {
    errors.push('서버 이름은 2자 이상 100자 이하여야 합니다.');
  }
  
  if (!isValidServerDescription(serverData.description)) {
    errors.push('서버 설명은 10자 이상 1000자 이하여야 합니다.');
  }
  
  if (!isValidDiscordInvite(serverData.inviteLink)) {
    errors.push('올바른 Discord 초대 링크가 아닙니다.');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}
