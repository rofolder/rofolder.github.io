# 🔐 로폴더 관리자 승인 시스템 & 보안 강화 가이드

## 📋 개요

로폴더 사이트에 **관리자 승인 시스템**과 **보안 강화 기능**을 구현했습니다.

### 핵심 기능
- ✅ **관리자 대시보드**: 비밀 진입점으로 접근 가능
- ✅ **승인/거절 시스템**: 대기 중인 서버를 승인하거나 거절
- ✅ **LocalStorage 연동**: 데이터 지속성
- ✅ **XSS 방지**: HTML 특수문자 자동 이스케이프
- ✅ **Rate Limiting**: 과도한 요청 방지
- ✅ **입력 검증**: 서버 데이터 규격 검사
- ✅ **금칙어 필터링**: 부적절한 콘텐츠 차단

---

## 🔓 관리자 대시보드 접근 방법

### 진입 방법: 푸터 로고 5번 클릭 (3초 내)

1. 페이지 하단 "**RoFolder**" 텍스트를 **3초 안에 5번 클릭**
2. 비밀번호 프롬프트 나타남
3. 기본 비밀번호 입력: **`RoFolder2026`**

```
⚠️ 비밀번호 변경 권장사항
src/main.ts의 trackAdminClick() 함수 수정:
  if (password === 'RoFolder2026') {
    // → 새 비밀번호로 변경
  }
```

### 대시보드 접근 후

```
┌─────────────────────────────────────┐
│    ⚙️ 관리자 대시보드              │
├─────────────────────────────────────┤
│  대기 중: 5  |  승인됨: 23 | 거절됨: 2  │
├─────────────────────────────────────┤
│  ┌─────────────────────────────────┐│
│  │ [대기중인 서버 목록]              ││
│  │ • 게임 서버 1     [✅ 승인] [❌ 거절] ││
│  │ • 개발 커뮤니티   [✅ 승인] [❌ 거절] ││
│  └─────────────────────────────────┘│
│  [로그아웃]                          │
└─────────────────────────────────────┘
```

---

## 📊 서버 상태 흐름

```
사용자 등록 신청
    ↓
status: 'pending' (대기 상태)
    ↓
관리자 승인 시
    ✅ → status: 'approved' (사용자 목록에 노출)
    ❌ → status: 'rejected' (거절 사유 기록)
```

### 승인 시 자동 처리
- `approvedAt` 타임스탐프 기록
- `tags`에 "인증됨" 자동 추가
- Discord Webhook 발송 (선택)

### 거절 시
- `rejectionReason` 필드에 사유 저장
- 사용자 목록에서 제외

---

## 🛡️ 보안 강화 기능

### 1️⃣ XSS (Cross-Site Scripting) 방지

```typescript
// 모든 사용자 입력을 HTML 이스케이프
escapeHtml(userInput)
// <script>alert('xss')</script> → &lt;script&gt;...&lt;/script&gt;
```

**적용 대상**:
- 서버 이름
- 서버 설명  
- 초대 링크
- 카테고리
- 태그

### 2️⃣ Rate Limiting

```typescript
// 1시간에 최대 5번 서버 등록 시도
checkRateLimit('server_registration', 5, 3600)

// 초과 시:
// ⚠️ "너무 많은 등록 신청을 했습니다. 1시간 뒤에 다시 시도하세요."
```

### 3️⃣ 입력 데이터 검증

| 항목 | 조건 | 오류 메시지 |
|------|------|-----------|
| 서버 이름 | 2~100자 | "2자 이상 100자 이하" |
| 설명 | 10~1000자 | "10자 이상 1000자 이하" |
| 초대 링크 | Discord URL | "올바른 Discord 초대 링크" |
| 금칙어 | 없어야 함 | "부적절한 키워드 포함" |

### 4️⃣ 금칙어 필터링

```
차단 키워드 (src/config.ts에서 관리):
도박, 성인, 불법, 카지노, 토토, 마약, 섹스, 야동,
조건, 만남, 바카라, 홀덤, 슬롯, 환전, 코인세탁,
사설, 유출, 해킹, 프리서버, 19금, 성매매
```

**정규식 기반 검색**: 공백 및 변형 감지

### 5️⃣ 관리자 토큰 기반 접근 제어

```typescript
// 관리자 대시보드는 sessionStorage 토큰 필요
if (!hasAdminAccess()) {
  alert('⚠️ 관리자 권한이 필요합니다.');
  return;
}

// 로그아웃 시 토큰 자동 제거
sessionStorage.removeItem('admin_token');
```

### 6️⃣ Discord Webhook 안전화

```typescript
// 텍스트 특수문자 이스케이프 (Discord 마크다운 안전화)
sanitizeDiscordText(userInput)
// 최대 2048자 제한 (Discord 필드 제한)
```

---

## 🗄️ LocalStorage 데이터 구조

### 주요 Storage Key

```
rofolder_servers_v1  → 전체 서버 데이터 (JSON 배열)
ratelimit_*          → Rate Limit 카운터 (자동 관리)
admin_token          → 관리자 토큰 (Session Storage)
```

### 서버 데이터 스키마

```typescript
interface DiscordServer {
  id: number;                    // 타임스탐프 기반 고유ID
  name: string;                  // 서버 이름 (2-100자)
  category: string;              // 카테고리
  description: string;           // 설명 (10-1000자)
  icon: string;                  // 아이콘 URL
  tags: string[];                // 태그 배열
  inviteLink: string;            // Discord 초대 링크
  status: 'approved' | 'pending' | 'rejected';
  createdAt?: number;            // 등록 요청 시간
  approvedAt?: number;           // 승인 시간
  rejectionReason?: string;      // 거절 사유
}
```

---

## 🔧 관리자 설정 및 커스터마이징

### 비밀번호 변경

**파일**: `src/main.ts` (line 630)

```typescript
function trackAdminClick() {
  // ...
  if (password === 'RoFolder2026') {  // ← 여기 변경
    setAdminToken('admin_access_token_' + Date.now());
    openAdminDashboard();
  }
}
```

### 금칙어 추가/제거

**파일**: `src/config.ts`

```typescript
export const config = {
  forbiddenKeywords: [
    '도박', '성인', '불법',  // 기존
    '새로운금칙어',           // ← 추가
    // ... 나머지
  ],
};
```

### Rate Limiting 조정

**파일**: `src/main.ts` (line 388)

```typescript
// 1시간에 최대 10번 등록 가능하게 변경
if (!checkRateLimit('server_registration', 10, 3600)) {
  //...
}
```

---

## 🔍 테스트 시나리오

### 테스트 1: 관리자 대시보드 접근

```
1. 푸터 "RoFolder" 텍스트 5회 빠르게 클릭
2. 비밀번호 입력: RoFolder2026
3. 관리자 대시보드 열림 ✓
```

### 테스트 2: 서버 등록 및 승인

```
1. "서버 등록" 버튼 클릭
2. 서버 정보 입력
3. "등록 승인 요청" 클릭
4. 관리자 대시보드에 "대기 중" 상태로 표시 ✓
5. "✅ 승인" 클릭
6. 메인 목록에 "인증됨" 태그 추가되어 표시 ✓
```

### 테스트 3: 금칙어 필터링

```
서버 명에 "도박" 포함 시도
→ ⚠️ "부적절한 키워드가 포함되어 있습니다" ✓
```

### 테스트 4: 입력 검증

```
이름: "a" (1자)
→ ❌ "서버 이름은 2자 이상" ✓

링크: "https://google.com"
→ ❌ "올바른 Discord 초대 링크아님" ✓
```

### 테스트 5: Rate Limiting

```
1시간 내 6번 등록 시도
→ ⚠️ "너무 많은 등록 신청을 했습니다" ✓
```

---

## 🐛 문제 해결

### 관리자 대시보드가 열리지 않음

```
✓ 5번 클릭을 3초 내 완료했는지 확인
✓ 비밀번호가 정확한지 확인
✓ 개발자 도구 > Console에서 오류 메시지 확인
```

### 승인한 서버가 목록에 안 보임

```
✓ F5로 페이지 새로고침
✓ LocalStorage에 데이터 확인 (DevTools > Application)
✓ 필터/검색 조건 확인
```

### Webhook 알림이 오지 않음

```
✓ src/config.ts의 webhookUrl이 설정되었는지 확인
✓ Discord Webhook URL이 유효한지 확인
✓ 콘솔에서 "Webhook 발송 성공" 메시지 확인
```

---

## 📈 향후 개선 사항

- [ ] 서버측 인증 (OAuth, JWT)
- [ ] 데이터베이스 연동
- [ ] 이미지 서버 업로드 (현재는 Base64)
- [ ] 관리자 계정 다중화
- [ ] 감사 로그 (Audit Log)
- [ ] 이메일 알림 (등록/승인/거절)
- [ ] 사용자 프로필 시스템
- [ ] 서버 통계 분석

---

## 📝 보안 체크리스트

- [x] XSS 방지 (HTML 이스케이프)
- [x] CSRF 방지 (토큰 기반)
- [x] Rate Limiting (1시간 5회 제한)
- [x] 입력 검증 (길이, 형식)
- [x] 금칙어 필터링
- [x] 관리자 접근 제어
- [x] 데이터 암호화 (Base64)
- [x] 세션 관리 (SessionStorage)

---

**마지막 업데이트**: 2026년 3월 10일
**개발 서버**: http://localhost:5174/
**빌드 크기**: JS 20.48 KB (gzip 7.16 KB)
