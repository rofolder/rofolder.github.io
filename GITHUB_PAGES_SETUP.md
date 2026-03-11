# RoFolder GitHub Pages 배포 가이드

## 📌 개요
RoFolder-Site를 GitHub Pages로 배포하는 방법입니다. 정적 사이트 호스팅에 완벽하게 최적화되어 있습니다.

---

## 🚀 배포 단계

### 1단계: GitHub 저장소 준비

```bash
# 로컬 저장소 초기화 (이미 git init이 되어 있다면 스킵)
git init

# GitHub 원격 저장소 추가
git remote add origin https://github.com/YOUR_USERNAME/rofolder-site.git
```

### 2단계: 배포 전 설정

#### vite.config.ts 확인
```typescript
export default defineConfig({
  base: '/',  // 루트 도메인에 배포하는 경우
  // 또는 서브 디렉토리: base: '/rofolder-site/',
})
```

#### package.json에 deploy 스크립트 추가 (선택)
```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "deploy": "npm run build && git add dist -f && git commit -m 'Deploy' && git push"
  }
}
```

### 3단계: 빌드 및 배포

#### 옵션 A: GitHub Pages 자동 배포 (권장)

**.github/workflows/deploy.yml** 파일 생성:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches:
      - main

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'

      - name: Install dependencies
        run: npm install

      - name: Build
        run: npm run build

      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
```

#### 옵션 B: 수동 배포

```bash
# 1. 빌드
npm run build

# 2. dist 폴더를 gh-pages 브랜치로 배포
git add dist -f
git commit -m "Build: Deploy to gh-pages"
git push origin `git subtree split --prefix dist main`:gh-pages --force
```

또는 **gh-pages** npm 패키지 사용:

```bash
# 설치
npm install --save-dev gh-pages

# package.json에 추가
"deploy": "npm run build && gh-pages -d dist"

# 실행
npm run deploy
```

### 4단계: GitHub 저장소 설정

1. GitHub 저장소 → **Settings** 접속
2. **Pages** 메뉴 선택
3. **Build and deployment** 섹션:
   - **Source**: "GitHub Actions" 선택 (또는 "Deploy from a branch")
   - **Branch**: `gh-pages` 선택 (또는 `main`의 `/docs`)

### 5단계: 커스텀 도메인 (선택)

1. 도메인 DNS 설정:
   ```
   185.199.108.153
   185.199.109.153
   185.199.110.153
   185.199.111.153
   ```

2. GitHub 저장소 Settings → Pages → **Custom domain** 입력

---

## 🔐 환경 변수 설정

Discord Webhook URL 등 민감한 정보는 GitHub Secrets로 관리합니다:

1. 저장소 → **Settings** → **Secrets and variables** → **Actions**
2. **New repository secret** 클릭
3. 이름: `DISCORD_WEBHOOK_URL`, 값: Webhook URL 입력

### 빌드 시 환경 변수 주입

**.github/workflows/deploy.yml** 수정:

```yaml
      - name: Build
        run: npm run build
        env:
          VITE_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}
```

**src/config.ts** 에서 사용:

```typescript
export const config = {
  webhookUrl: import.meta.env.VITE_WEBHOOK_URL || '/api/webhook',
  // ...
}
```

---

## ✅ 배포 확인

1. GitHub Actions 탭에서 배포 상태 확인
2. 저장소 Settings → Pages에서 배포 URL 확인
3. 배포된 사이트 접속:
   ```
   https://YOUR_USERNAME.github.io/rofolder-site
   또는
   https://your-custom-domain.com
   ```

---

## 🛡️ 보안 체크리스트

- [ ] Discord Webhook URL을 GitHub Secrets에 저장
- [ ] `.env` 파일을 `.gitignore`에 추가
- [ ] `dist/` 폴더를 `.gitignore`에 추가 (gh-pages 브랜치 제외)
- [ ] "admin" 패스워드를 코드에서 하드코딩하지 않음
- [ ] HTTPS 강제 적용 (GitHub Pages는 자동)
- [ ] 정기적으로 의존성 업데이트 (`npm audit`)

### 현재 구현된 보안 조치

✅ **XSS 방지**: `escapeHtml()` 함수로 모든 사용자 입력 검증
✅ **Rate Limiting**: 5회/시간 등록 상한제
✅ **금칙어 필터**: 부적절한 콘텐츠 자동 차단
✅ **Input Validation**: 길이, 포맷 검사
✅ **Admin 토큰**: SessionStorage에 암호화 저장 (재시작 시 초기화)

---

## 📊 배포 아키텍처

```
┌─────────────────────┐
│   Local Repository  │
│  (main branch)      │
└──────────┬──────────┘
           │
           ├─→ npm run build
           │   (Vite bundling)
           │
           ├─→ dist/ 폴더 생성
           │
           └─→ git push
               │
               ├─→ GitHub Actions 트리거
               │
               ├─→ npm install
               │
               ├─→ npm run build
               │
               └─→ gh-pages 브랜치 배포
                   │
                   └─→ GitHub Pages 서빙
                       │
                       └─→ https://username.github.io
```

---

## 🧪 로컬 테스트

배포 전 프로덕션 빌드 최적화 확인:

```bash
# 프로덕션 빌드
npm run build

# 빌드 결과물 로컬 서버에서 테스트
npm run preview
```

---

## 📌 주의사항

1. **JSON 파일 로드**: `public/` 폴더의 파일들이 정적으로 제공됩니다
2. **API 요청**: GitHub Pages는 백엔드 없이 정적 호스팅이므로, Discord Webhook 사용 권장
3. **CORS**: 외부 API 호출 시 CORS 에러 주의
4. **캐싱**: 배포 후 캐시 삭제 (GitHub Pages 자동 처리)

---

## 🔄 업데이트 및 유지보수

```bash
# 새로운 변경사항 배포
git add .
git commit -m "Feature: Add new feature"
git push origin main

# GitHub Actions이 자동으로 빌드/배포
```

---

## 💡 추가 권장사항

- **CDN 추가**: Cloudflare 무료 CDN으로 배포 가속화
- **모니터링**: Sentry로 에러 추적
- **분석**: Google Analytics 또는 Plausible 추가
- **백업**: 정기적으로 로컬스토리지 데이터 백업

---

문제 발생 시:
- GitHub Actions 로그 확인: `Actions` 탭
- 로컬 빌드 오류 확인: `npm run build`
- 캐시 삭제 후 재배포: `git clean -fdx && npm install && npm run build`
