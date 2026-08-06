/**
 * Lightweight i18n for LAF Agent — English and Korean only.
 *
 * - Default locale follows the OS (`navigator.language`), overridable via the
 *   `language` app setting ('system' | 'en' | 'ko').
 * - `useT()` returns a translator bound to the current locale and re-renders
 *   on change; plain `t()` is for non-component code.
 * - Keys fall back to English, then to the key itself, so untranslated
 *   strings degrade gracefully instead of breaking the UI.
 */

import { create } from 'zustand'

export type Locale = 'en' | 'ko'
export type LanguageSetting = 'system' | Locale

const en = {
  // Onboarding
  'onboarding.welcome.title': 'Welcome to LAF Agent',
  'onboarding.welcome.subtitle': 'A native desktop client for Prime Agent; the AI-powered coding assistant.',
  'onboarding.continue': 'Continue',
  'onboarding.theme.title': 'Choose your theme',
  'onboarding.setup.title': 'Set up LAF Agent',
  'onboarding.setup.subtitle': "Add an AI provider key and you're ready to go.",
  'onboarding.runtime.title': 'Agent runtime',
  'onboarding.runtime.bundled': 'Prime Agent is bundled with the app — nothing to install.',
  'onboarding.auth.title': 'AI provider',
  'onboarding.auth.checking': 'Checking...',
  'onboarding.auth.connected': 'Connected',
  'onboarding.auth.pick': 'Pick a provider and add its API key',
  'onboarding.auth.discoverHint': 'Models are discovered automatically from the endpoint — just paste the key.',
  'onboarding.auth.verifyHint': 'The key is verified against the provider before saving.',
  'onboarding.auth.storageHint': 'Keys are stored locally in ~/.prime/agent/auth.json; custom endpoints in models.json. Nothing is sent anywhere except the provider you choose.',
  'onboarding.auth.connect': 'Connect',
  'onboarding.auth.add': 'Add',
  'onboarding.auth.verifying': 'Verifying…',
  'onboarding.auth.checkAgain': 'Check again',
  'onboarding.auth.connectedModels': '{label} connected — {count} models available',
  'onboarding.launch': 'Launch LAF Agent',
  'onboarding.skipSignIn': 'Skip sign-in for now',
  // Providers
  'providers.title': 'AI providers',
  'providers.desc': 'API keys for the models you use. Add as many as you like.',
  'providers.apiKey': 'API key',
  'providers.models': 'models',
  'providers.remove': 'Remove',
  'providers.preset': 'Endpoint preset',
  'providers.baseUrl': 'OpenAI-compatible base URL',
  'providers.connect': 'Connect',
  'providers.verifying': 'Verifying…',
  'providers.discoverHint': 'Models are discovered automatically from the endpoint — just paste the key.',
  'providers.verifyHint': 'The key is verified against the provider before saving.',
  'providers.connected': '{label} connected — {count} models available',
  'providers.none': 'No providers configured yet.',
  'providers.custom': 'Other',
  'providers.otherEndpoint': 'Other OpenAI-compatible endpoint',
  'providers.searchEndpoint': 'Search providers (DeepSeek, MiniMax, Groq, Ollama…)',
  'providers.getKey': 'Get a key',
  // Web search
  'websearch.title': 'Web search',
  'websearch.desc': 'How the agent reads the web.',
  'websearch.native': 'Built into Anthropic and OpenAI models',
  'websearch.nativeDesc': 'Search runs on the provider\'s servers as part of the model turn — the same way Claude and Codex do it. No search API key, nothing to configure.',
  'websearch.fetch': 'Page reading on every model',
  'websearch.fetchDesc': 'The web_fetch tool retrieves any URL as readable text. It works with every provider and needs no key.',
  'websearch.otherNote': 'Providers without server-side search (OpenAI-compatible endpoints, local servers) can read pages with web_fetch but cannot run open-ended web searches.',
  // Sidebar
  'sidebar.projects': 'PROJECTS',
  'sidebar.chats': 'CHATS',
  'sidebar.newChat': 'New Chat',
  'sidebar.noProjects': 'No projects yet',
  'sidebar.importHint': 'Import a folder to start working with Prime Agent',
  'sidebar.importProject': 'Import Project',
  'sidebar.noChats': 'No chats yet',
  // Chat
  'chat.emptyTitle': 'LAF Agent',
  'chat.placeholder': 'Describe a task or ask anything…',
  'empty.startThread': 'Start a new thread',
  'empty.openProject': 'Open a project to get started',
  'empty.pointHint': 'Point LAF Agent at any folder on your machine. The AI agent works directly with your files, runs commands, and helps you build.',
  'empty.whatYouCanDo': 'WHAT YOU CAN DO',
  'empty.newThread': 'New Thread',
  'feature.sideBySide': 'Side-by-side',
  'feature.sideBySideDesc': 'Two threads side by side',
  'feature.spinThreads': 'Spin threads',
  'feature.spinThreadsDesc': 'Fork and branch conversations',
  'feature.worktrees': 'Git worktrees',
  'feature.worktreesDesc': 'Isolate each thread in its own branch',
  'feature.diffs': 'Inline diffs',
  'feature.diffsDesc': 'Syntax-highlighted code changes',
  'feature.terminal': 'Built-in terminal',
  'feature.terminalDesc': 'Run commands without leaving the app',
  'feature.slash': 'Slash commands',
  'feature.slashDesc': '/goal, /compact, /fork, /plan and more',
  // Chat surface
  'chat.inputPlaceholder': 'Ask anything, @ to mention files, / for commands — Shift+Enter for newline',
  'chat.taskEnded': 'Task ended',
  'chat.approve.askFirst': 'Ask first',
  'chat.approve.askFirstDesc': 'Confirm before running tools',
  'chat.approve.autoRun': 'Auto-run',
  'chat.approve.autoRunDesc': 'Run tools without confirmation',
  'chat.mode.code': 'Code',
  'chat.mode.plan': 'Plan',
  'chat.stop': 'Stop',
  'chat.send': 'Send',
  'chat.thinking': 'Thinking',
  'chat.emptyHint': 'Pick a project and start chatting with Prime Agent',
  // Settings navigation
  'settings.nav.general': 'General',
  'settings.nav.providers': 'Providers',
  'settings.nav.appearance': 'Appearance',
  'settings.nav.keymap': 'Keyboard',
  'settings.nav.advanced': 'Advanced',
  'settings.nav.memory': 'Memory',
  'settings.nav.archives': 'Archives',
  'settings.search': 'Search settings…',
  'settings.restoreDefaults': 'Restore defaults',
  'settings.unsaved': 'You have unsaved changes',
  // Header / menus
  'header.newThread': 'New Thread',
  'header.settings': 'Settings',
  'header.about': 'About',
  // Settings
  'settings.title': 'Settings',
  'settings.configure': 'Configure LAF Agent',
  'settings.language': 'Language',
  'settings.language.desc': 'App display language',
  'settings.language.system': 'System',
  'settings.language.en': 'English',
  'settings.language.ko': '한국어',
  'settings.poweredBy': 'Powered by Prime Agent (PrimeIntellect-ai/prime-agent)',
  // Common
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.close': 'Close',
  'common.back': 'Back',
} as const

export type I18nKey = keyof typeof en

const ko: Record<I18nKey, string> = {
  'onboarding.welcome.title': 'LAF Agent에 오신 것을 환영합니다',
  'onboarding.welcome.subtitle': 'Prime Agent를 위한 네이티브 데스크톱 클라이언트 — AI 코딩 어시스턴트.',
  'onboarding.continue': '계속',
  'onboarding.theme.title': '테마를 선택하세요',
  'onboarding.setup.title': 'LAF Agent 설정',
  'onboarding.setup.subtitle': 'AI 프로바이더 키만 추가하면 바로 사용할 수 있습니다.',
  'onboarding.runtime.title': '에이전트 런타임',
  'onboarding.runtime.bundled': 'Prime Agent가 앱에 내장되어 있습니다 — 별도 설치가 필요 없습니다.',
  'onboarding.auth.title': 'AI 프로바이더',
  'onboarding.auth.checking': '확인 중...',
  'onboarding.auth.connected': '연결됨',
  'onboarding.auth.pick': '프로바이더를 선택하고 API 키를 입력하세요',
  'onboarding.auth.discoverHint': '엔드포인트에서 모델을 자동으로 불러옵니다 — 키만 붙여넣으세요.',
  'onboarding.auth.verifyHint': '저장 전에 프로바이더에서 키를 검증합니다.',
  'onboarding.auth.storageHint': '키는 ~/.prime/agent/auth.json에, 커스텀 엔드포인트는 models.json에 로컬 저장됩니다. 선택한 프로바이더 외에는 어디에도 전송되지 않습니다.',
  'onboarding.auth.connect': '연결',
  'onboarding.auth.add': '추가',
  'onboarding.auth.verifying': '검증 중…',
  'onboarding.auth.checkAgain': '다시 확인',
  'onboarding.auth.connectedModels': '{label} 연결됨 — 사용 가능한 모델 {count}개',
  'onboarding.launch': 'LAF Agent 시작',
  'onboarding.skipSignIn': '로그인은 나중에 하기',
  'providers.title': 'AI 프로바이더',
  'providers.desc': '사용할 모델의 API 키입니다. 여러 개를 등록할 수 있습니다.',
  'providers.apiKey': 'API 키',
  'providers.models': '개 모델',
  'providers.remove': '삭제',
  'providers.preset': '엔드포인트 프리셋',
  'providers.baseUrl': 'OpenAI 호환 base URL',
  'providers.connect': '연결',
  'providers.verifying': '검증 중…',
  'providers.discoverHint': '엔드포인트에서 모델을 자동으로 불러옵니다 — 키만 붙여넣으세요.',
  'providers.verifyHint': '저장 전에 프로바이더에서 키를 검증합니다.',
  'providers.connected': '{label} 연결됨 — 사용 가능한 모델 {count}개',
  'providers.none': '등록된 프로바이더가 없습니다.',
  'providers.custom': '기타',
  'providers.otherEndpoint': '기타 OpenAI 호환 엔드포인트',
  'providers.searchEndpoint': '프로바이더 검색 (DeepSeek, MiniMax, Groq, Ollama…)',
  'providers.getKey': '키 발급',
  'websearch.title': '웹 검색',
  'websearch.desc': '에이전트가 웹을 읽는 방식입니다.',
  'websearch.native': 'Anthropic·OpenAI 모델에 내장',
  'websearch.nativeDesc': '검색이 모델 턴의 일부로 제공사 서버에서 실행됩니다 — Claude와 Codex가 쓰는 방식과 동일합니다. 검색 API 키가 필요 없고 설정할 것도 없습니다.',
  'websearch.fetch': '모든 모델에서 페이지 읽기',
  'websearch.fetchDesc': 'web_fetch 도구가 어떤 URL이든 읽을 수 있는 텍스트로 가져옵니다. 모든 프로바이더에서 키 없이 동작합니다.',
  'websearch.otherNote': '서버사이드 검색이 없는 프로바이더(OpenAI 호환 엔드포인트, 로컬 서버)는 web_fetch로 페이지를 읽을 수는 있지만 자유 웹 검색은 할 수 없습니다.',
  'sidebar.projects': '프로젝트',
  'sidebar.chats': '채팅',
  'sidebar.newChat': '새 채팅',
  'sidebar.noProjects': '프로젝트가 없습니다',
  'sidebar.importHint': '폴더를 가져와 Prime Agent와 작업을 시작하세요',
  'sidebar.importProject': '프로젝트 가져오기',
  'sidebar.noChats': '채팅이 없습니다',
  'chat.emptyTitle': 'LAF Agent',
  'chat.placeholder': '작업을 설명하거나 무엇이든 물어보세요…',
  'empty.startThread': '새 스레드 시작',
  'empty.openProject': '프로젝트를 열어 시작하세요',
  'empty.pointHint': '컴퓨터의 어떤 폴더든 LAF Agent에 연결하세요. AI 에이전트가 파일을 직접 다루고, 명령을 실행하며, 개발을 돕습니다.',
  'empty.whatYouCanDo': '할 수 있는 것',
  'empty.newThread': '새 스레드',
  'feature.sideBySide': '나란히 보기',
  'feature.sideBySideDesc': '두 스레드를 나란히 배치',
  'feature.spinThreads': '스레드 분기',
  'feature.spinThreadsDesc': '대화를 포크하고 분기',
  'feature.worktrees': 'Git 워크트리',
  'feature.worktreesDesc': '스레드마다 별도 브랜치로 격리',
  'feature.diffs': '인라인 diff',
  'feature.diffsDesc': '문법 강조된 코드 변경',
  'feature.terminal': '내장 터미널',
  'feature.terminalDesc': '앱을 벗어나지 않고 명령 실행',
  'feature.slash': '슬래시 명령',
  'feature.slashDesc': '/goal, /compact, /fork, /plan 등',
  'chat.inputPlaceholder': '무엇이든 물어보세요. @로 파일 언급, /로 명령 — Shift+Enter로 줄바꿈',
  'chat.taskEnded': '작업 종료됨',
  'chat.approve.askFirst': '확인 후 실행',
  'chat.approve.askFirstDesc': '도구 실행 전에 확인합니다',
  'chat.approve.autoRun': '자동 실행',
  'chat.approve.autoRunDesc': '확인 없이 도구를 실행합니다',
  'chat.mode.code': '코드',
  'chat.mode.plan': '계획',
  'chat.stop': '중지',
  'chat.send': '전송',
  'chat.thinking': '생각 중',
  'chat.emptyHint': '프로젝트를 선택하고 Prime Agent와 대화를 시작하세요',
  'settings.nav.general': '일반',
  'settings.nav.providers': '프로바이더',
  'settings.nav.appearance': '외형',
  'settings.nav.keymap': '단축키',
  'settings.nav.advanced': '고급',
  'settings.nav.memory': '메모리',
  'settings.nav.archives': '보관함',
  'settings.search': '설정 검색…',
  'settings.restoreDefaults': '기본값 복원',
  'settings.unsaved': '저장하지 않은 변경사항이 있습니다',
  'header.newThread': '새 스레드',
  'header.settings': '설정',
  'header.about': '정보',
  'settings.title': '설정',
  'settings.configure': 'LAF Agent 설정',
  'settings.language': '언어',
  'settings.language.desc': '앱 표시 언어',
  'settings.language.system': '시스템',
  'settings.language.en': 'English',
  'settings.language.ko': '한국어',
  'settings.poweredBy': 'Powered by Prime Agent (PrimeIntellect-ai/prime-agent)',
  'common.cancel': '취소',
  'common.save': '저장',
  'common.close': '닫기',
  'common.back': '뒤로',
}

const DICTS: Record<Locale, Record<I18nKey, string>> = { en, ko }

export const detectSystemLocale = (): Locale => {
  try {
    const lang = navigator.language || ''
    return lang.toLowerCase().startsWith('ko') ? 'ko' : 'en'
  } catch {
    return 'en'
  }
}

export const resolveLocale = (setting: LanguageSetting | undefined | null): Locale => {
  if (setting === 'en' || setting === 'ko') return setting
  return detectSystemLocale()
}

interface I18nState {
  locale: Locale
  setLocale: (locale: Locale) => void
}

export const useI18nStore = create<I18nState>((set) => ({
  locale: detectSystemLocale(),
  setLocale: (locale) => set((s) => (s.locale === locale ? s : { locale })),
}))

const format = (template: string, vars?: Record<string, string | number>): string => {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`))
}

/** Translate outside React components (reads the store imperatively). */
export const t = (key: I18nKey, vars?: Record<string, string | number>): string => {
  const { locale } = useI18nStore.getState()
  return format(DICTS[locale][key] ?? en[key] ?? key, vars)
}

/** Hook: returns a translator bound to the current locale (re-renders on change). */
export const useT = () => {
  const locale = useI18nStore((s) => s.locale)
  return (key: I18nKey, vars?: Record<string, string | number>): string =>
    format(DICTS[locale][key] ?? en[key] ?? key, vars)
}
