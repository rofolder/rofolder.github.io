/**
 * RoFolder Site Configuration
 * 
 * 민감한 정보는 .env 파일에서 환경 변수로 관리됩니다.
 * .env.example을 참고하여 .env 파일을 설정하세요.
 */

export const config = {
  // Discord 웹후크 URL - 환경 변수에서 읽음
  webhookUrl: import.meta.env.VITE_WEBHOOK_URL || '',
  adminWebhookUrl: import.meta.env.VITE_ADMIN_WEBHOOK_URL || '',
  
  // 사이트 정보
  siteName: 'RoFolder',
  siteLogo: '/logo.png',
  
  // 배너 캐러셀 설정
  bannerCarousel: [
    {
      title: 'RoFolder에 오신 것을 환영합니다',
      description: '프리미엄 디스코드 커뮤니티를 찾고 계신가요?',
      color: 'linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(139, 92, 246, 0.2))'
    },
    {
      title: '당신의 서버를 홍보하세요',
      description: 'RoFolder에 등록하고 더 많은 멤버를 모집하세요',
      color: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(34, 197, 94, 0.2))'
    },
    {
      title: '최고의 커뮤니티를 발견하세요',
      description: '개발, RP, 게임 등 다양한 서버를 한곳에서',
      color: 'linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(236, 72, 153, 0.2))'
    },
    {
      title: '프리미엄 멤버십',
      description: '인기 태그와 상단 노출로 더 많은 관심을 받으세요',
      color: 'linear-gradient(135deg, rgba(251, 146, 60, 0.2), rgba(249, 115, 22, 0.2))'
    }
  ],
  
  // 홍보 설정
  promoEnabled: true, // 홍보 기능 활성화 여부
  promoTitle: '🎯 RoFolder 팀 홍보하기',
  promoDescription: '당신의 커뮤니티를 프리미움 서버 리스트에 나타내세요!',
  
  // 서버 태그 목록 (사용자가 선택 가능)
  serverTags: [
    { emoji: '💻', label: '개발', value: '개발', color: '#6366f1', bgColor: 'rgba(99, 102, 241, 0.15)' },
    { emoji: '🎭', label: 'RP', value: 'RP', color: '#a855f7', bgColor: 'rgba(168, 85, 247, 0.15)' },
    { emoji: '❤️', label: '밀심', value: '밀심', color: '#ec4899', bgColor: 'rgba(236, 72, 153, 0.15)' },
    { emoji: '🪖', label: '밀리터리', value: '밀리터리', color: '#64748b', bgColor: 'rgba(100, 116, 139, 0.15)' },
    { emoji: '💰', label: '판매서버', value: '판매서버', color: '#f59e0b', bgColor: 'rgba(245, 158, 11, 0.15)' },
    { emoji: '🎁', label: '무료배포', value: '무료배포', color: '#10b981', bgColor: 'rgba(16, 185, 129, 0.15)' },
    { emoji: '🎉', label: '이벤트', value: '이벤트', color: '#f97316', bgColor: 'rgba(249, 115, 22, 0.15)' },
    { emoji: '👥', label: '커뮤니티', value: '커뮤니티', color: '#06b6d4', bgColor: 'rgba(6, 182, 212, 0.15)' },
    { emoji: '🏙️', label: '도시RP', value: '도시RP', color: '#8b5cf6', bgColor: 'rgba(139, 92, 246, 0.15)' },
    { emoji: '🎮', label: '게임', value: '게임', color: '#ef4444', bgColor: 'rgba(239, 68, 68, 0.15)' },
    { emoji: '🌍', label: '외국서버', value: '외국서버', color: '#14b8a6', bgColor: 'rgba(20, 184, 166, 0.15)' },
    { emoji: '💼', label: '사업팀', value: '사업팀', color: '#3b82f6', bgColor: 'rgba(59, 130, 246, 0.15)' },
  ],
  
  // 운영자만 선택 가능한 태그
  adminOnlyTags: [
    { emoji: '⭐', label: '인기', value: '인기', color: '#fa8231', bgColor: 'rgba(250, 130, 49, 0.15)' },
    { emoji: '✅', label: '인증됨', value: '인증됨', color: '#10b981', bgColor: 'rgba(16, 185, 129, 0.15)' },
  ],
  
  // 금칙어 목록 (서버 등록 시 필터링)
  forbiddenKeywords: [
    '도박', '성인', '불법', '카지노', '토토', '마약', '섹스', '야동', '조건', '만남',
    '바카라', '홀덤', '슬롯', '환전', '코인세탁', '사설', '유출', '해킹', '프리서버',
    '19금', '성매매'
  ],
  
  // 원본 사이트 URL
  originalSiteUrl: 'https://discord.gg/MAynjVRSuH',
  
  // 개발자 연락처 (푸터용)
  contactEmail: import.meta.env.VITE_CONTACT_EMAIL || 'contact@example.com',
  
  // 문의 이메일 (사용자 문의 접수용)
  inquiryWebhookUrl: import.meta.env.VITE_CONTACT_EMAIL || '',
  
  // 디스코드 및 SNS 링크
  discordCommunityUrl: import.meta.env.VITE_DISCORD_COMMUNITY_URL || 'https://discord.gg/rofolder',
  discordForumUrl: import.meta.env.VITE_DISCORD_FORUM_URL || 'https://discord.com/channels/YOUR_SERVER_ID/YOUR_FORUM_CHANNEL_ID',
  twitterUrl: import.meta.env.VITE_TWITTER_URL || 'https://twitter.com/rofolder',
  
  // 관리자 비밀번호
  adminPassword: import.meta.env.VITE_ADMIN_PASSWORD || 'RoFolder2026'
};
