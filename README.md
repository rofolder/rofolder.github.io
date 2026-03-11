# 로폴더 (RoFolder) - Midnight Premium 사이트 리뉴얼

> "당신의 가치를 높이는 커뮤니티의 모든 것"

🎨 **Midnight Premium Aesthetic** 기반 프리미엄 디스코드 서버 네트워크 플랫폼

---

## 📋 프로젝트 개요

기존의 rofolder.kro.kr 사이트를 "클래식하고 멋진" 감성으로 완전히 재구축했습니다.

### 핵심 기능

✨ **디자인**
- Midnight Premium 컨셉: 어두운 배경(#0d0d0d) + Electric Indigo 포인트
- Glassmorphism UI: 투명도와 블러를 활용한 고급스러운 디자인
- Elastic Cursor: 마우스 움직임에 반응하는 탄력적인 커서

🔍 **서버 관리**
- **Dynamic Grid**: 21개 단위 페이지네이션
- **Smart Pagination**: 페이지 번호 직접 입력 이동 기능
- **Real-time Search**: 실시간 검색 필터링

📝 **서버 등록 시스템**
- Registration Modal with Image Preview
- 카테고리 Chip UI 선택
- Abuse Prevention: 금칙어 자동 필터링
- Discord Webhook 통합 (관리자 알림)

---

## 🛠️ 기술 스택

```
Frontend:
- TypeScript
- Vanilla CSS (no frameworks)
- Vite (build tool)

Design:
- Google Fonts 'Outfit'
- CSS3 (Glassmorphism, Animations)
- Responsive Design
```

---

## 📁 프로젝트 구조

```
rofolder-site/
├── src/
│   ├── main.ts              # 메인 애플리케이션 로직
│   ├── counter.ts           # 유틸리티 함수
│   ├── config.ts            # 설정 파일 (Webhook URL, 금칙어 등)
│   └── style.css            # 전역 스타일
├── public/
│   ├── servers.json         # 외부 서버 데이터 (JSON 형식)
│   ├── logo.svg             # 사이트 로고 (SVG)
│   └── logo.png             # 로고 (향후 PNG 제공 시)
├── index.html               # HTML 진입점
├── package.json             # NPM 패키지 설정
├── tsconfig.json            # TypeScript 설정
└── dist/                    # 빌드 출력 디렉토리
```

---

## 🚀 사용 방법

### 1. 설치

```bash
npm install
```

### 2. 개발 서버 실행

```bash
npm run dev
```

브라우저에서 `http://localhost:5173` 접속

### 3. 프로덕션 빌드

```bash
npm run build
```

더 자세한 서빙을 원하면:
```bash
npm run preview
```

---

## ⚙️ 설정 가이드

### Discord Webhook 설정

서버 등록 신청 시 Discord 채널로 자동 알림을 받으려면:

1. [Discord Developer Portal](https://discord.com/developers) 접속
2. 계정 → Webhooks 생성
3. `src/config.ts` 파일 수정:

```typescript
export const config = {
  webhookUrl: 'https://discord.com/api/webhooks/YOUR_ID/YOUR_TOKEN',
  // ... 나머지 설정
};
```

⚠️ **주의**: 본인의 Webhook URL을 노출하지 마세요!

### 로고 업데이트

PNG 파일 로고를 제공받으면:

1. `public/logo.png` 파일 추가
2. `src/config.ts` 수정:
   ```typescript
   siteLogo: '/logo.png',  // logo.svg → logo.png
   ```

### 금칙어 필터링 커스터마이징

`src/config.ts`의 `forbiddenKeywords` 배열을 수정하여 추가 차단 키워드 설정 가능

---

## 📊 데이터 관리

### 초기 데이터

3개의 샘플 서버가 기본으로 제공됩니다:
- 게임 커뮤니티 공간
- 개발자 네트워킹
- 음악 창작 협력실

### 외부 데이터 추가

`public/servers.json`에 서버 데이터 추가 가능:

```json
{
  "servers": [
    {
      "id": 4,
      "name": "새로운 서버",
      "category": "게임",
      "description": "서버 설명",
      "icon": "https://...",
      "tags": ["신규"],
      "inviteLink": "https://discord.gg/...",
      "status": "approved"
    }
  ]
}
```

### 로컬스토리지

사용자가 등록한 서버는 자동으로 LocalStorage에 저장됩니다:
- Key: `rofolder_servers_v1`
- 브라우저 개발자 도구 → Application → Local Storage에서 확인 가능

---

## 🎨 디자인 상세

### 색상 체계

```css
--bg-color: #0d0d0d              /* 기본 배경 (거의 검은색) */
--accent-color: #6366f1          /* 강조색 (Electric Indigo) */
--text-primary: #f8fafc          /* 주요 텍스트 (흰색) */
--text-secondary: #94a3b8        /* 보조 텍스트 (라이트 그레이) */
--text-muted: #4b5563            /* 약한 텍스트 (다크 그레이) */
```

### 애니메이션

- **Fade In**: 요소 로드 시 자연스러운 등장
- **Modal Transition**: 모달 열 때 크기 조정 + 페이드
- **Hover Effects**: 버튼, 카드 호버 애니메이션
- **Smooth Page Transitions**: 페이지 이동 시 부드러운 전환

---

## ✅ 검증 체크리스트

- [x] 초기 샘플 데이터 (3개) 로드
- [x] JSON 파일 데이터 병합 기능
- [x] 페이지네이션 (21개 항목)
- [x] 직접 페이지 이동 기능
- [x] Real-time Search
- [x] 금칙어 필터링 (도박, 성인, 불법 등)
- [x] 모달 시스템 (상세, 등록)
- [x] 이미지 업로드 미리보기
- [x] Discord Webhook 통합
- [x] Footer 구현
- [x] Logo/Favicon 설정
- [x] TypeScript 컴파일 성공
- [x] Vite 빌드 성공

---

## 🔧 트러블슈팅

### 1. "npm: 스크립트를 실행할 수 없습니다" 에러

**해결책**: PowerShell 실행 정책 변경
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
```

### 2. JSON 파일을 찾을 수 없음

**해결책**: `/public` 폴더에 `servers.json` 파일 확인
```json
{ "servers": [] }
```

### 3. Webhook 알림이 오지 않음

**확인사항**:
- Discord Webhook URL이 유효한지 확인
- `src/config.ts`에 올바르게 입력되었는지 확인
- 브라우저 콘솔에서 에러 메시지 확인

---

## 📝 라이선스

© 2026 RoFolder Site. All rights reserved.

---

## 💡 향후 개선 사항

- [ ] 데이터베이스 연동 (MongoDB 등)
- [ ] 사용자 인증 시스템
- [ ] 서버 평점/리뷰 기능
- [ ] 관리자 대시보드
- [ ] 모바일 앱 (React Native)
- [ ] 다국어 지원 (i18n)

---

**개발**: Midnight Premium Aesthetic Experience
**마지막 수정**: 2026년 3월 10일
