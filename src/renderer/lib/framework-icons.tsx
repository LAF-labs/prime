import type { FC, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

const NextjsIcon: FC<IconProps> = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <circle cx="12" cy="12" r="12" fill="#000" />
    <path d="M10 8v8l6.5-8H10z" fill="#fff" />
    <path d="M15 8v8" stroke="#fff" strokeWidth="1.5" />
  </svg>
)

const ReactIcon: FC<IconProps> = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <circle cx="12" cy="12" r="12" fill="#20232a" />
    <circle cx="12" cy="12" r="2" fill="#61dafb" />
    <ellipse cx="12" cy="12" rx="8" ry="3" stroke="#61dafb" strokeWidth="1" fill="none" />
    <ellipse cx="12" cy="12" rx="8" ry="3" stroke="#61dafb" strokeWidth="1" fill="none" transform="rotate(60 12 12)" />
    <ellipse cx="12" cy="12" rx="8" ry="3" stroke="#61dafb" strokeWidth="1" fill="none" transform="rotate(120 12 12)" />
  </svg>
)

const VueIcon: FC<IconProps> = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <circle cx="12" cy="12" r="12" fill="#35495e" />
    <path d="M12 17L6 7h3.6L12 11.8 14.4 7H18L12 17z" fill="#41b883" />
    <path d="M12 13.5L9.2 8.5h-1L12 15.5l3.8-7h-1L12 13.5z" fill="#fff" />
  </svg>
)

const SvelteIcon: FC<IconProps> = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <circle cx="12" cy="12" r="12" fill="#ff3e00" />
    <path d="M15.5 6.5c-2-1.5-4.8-1-6 1l-2 3c-1 1.5-.8 3.5.5 4.7" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    <path d="M8.5 17.5c2 1.5 4.8 1 6-1l2-3c1-1.5.8-3.5-.5-4.7" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity=".7" />
  </svg>
)

const AngularIcon: FC<IconProps> = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <circle cx="12" cy="12" r="12" fill="#dd0031" />
    <path d="M12 5l-6 2.5 1 9L12 19l5-2.5 1-9L12 5z" fill="#c3002f" />
    <path d="M12 5l-6 2.5 1 9L12 19l5-2.5 1-9L12 5z" fill="none" stroke="#fff" strokeWidth=".5" />
    <path d="M12 7l-3.5 8h1.3l.7-1.8h3l.7 1.8h1.3L12 7zm0 2.5l1.1 2.7h-2.2L12 9.5z" fill="#fff" />
  </svg>
)

const RustIcon: FC<IconProps> = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <circle cx="12" cy="12" r="12" fill="#000" />
    <circle cx="12" cy="12" r="7" stroke="#f74c00" strokeWidth="1.5" fill="none" />
    <text x="12" y="15.5" textAnchor="middle" fill="#f74c00" fontSize="9" fontWeight="bold" fontFamily="sans-serif">R</text>
  </svg>
)

const GoIcon: FC<IconProps> = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <circle cx="12" cy="12" r="12" fill="#00add8" />
    <text x="12" y="16" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="sans-serif">Go</text>
  </svg>
)

const PythonIcon: FC<IconProps> = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <circle cx="12" cy="12" r="12" fill="#3776ab" />
    <path d="M12 5c-2 0-3.5.5-3.5 2v1.5h3.5v.5H8c-2 0-3 1.2-3 3s1 3 3 3h1v-1.5c0-1.5 1.3-3 3-3h3c1.5 0 2.5-1 2.5-2.5V7c0-1.5-1.5-2-4.5-2zm-2 1.2a.8.8 0 110 1.6.8.8 0 010-1.6z" fill="#ffd43b" />
    <path d="M12 19c2 0 3.5-.5 3.5-2v-1.5H12V15h4c2 0 3-1.2 3-3s-1-3-3-3h-1v1.5c0 1.5-1.3 3-3 3H9c-1.5 0-2.5 1-2.5 2.5V17c0 1.5 1.5 2 5.5 2zm2-1.2a.8.8 0 110-1.6.8.8 0 010 1.6z" fill="#fff" />
  </svg>
)

const RubyIcon: FC<IconProps> = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <circle cx="12" cy="12" r="12" fill="#cc342d" />
    <path d="M7 17l2-10 3 4 4-2-2 8H7z" fill="#fff" opacity=".9" />
    <path d="M9 7l3 4 4-2" stroke="#fff" strokeWidth=".5" fill="none" />
  </svg>
)

const JavaIcon: FC<IconProps> = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <circle cx="12" cy="12" r="12" fill="#f89820" />
    <text x="12" y="16" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="serif">J</text>
  </svg>
)

const TypeScriptIcon: FC<IconProps> = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <circle cx="12" cy="12" r="12" fill="#3178c6" />
    <text x="12" y="16" textAnchor="middle" fill="#fff" fontSize="10" fontWeight="bold" fontFamily="sans-serif">TS</text>
  </svg>
)

const JavaScriptIcon: FC<IconProps> = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <circle cx="12" cy="12" r="12" fill="#f7df1e" />
    <text x="12" y="16" textAnchor="middle" fill="#323330" fontSize="10" fontWeight="bold" fontFamily="sans-serif">JS</text>
  </svg>
)

const PhpIcon: FC<IconProps> = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <circle cx="12" cy="12" r="12" fill="#777bb4" />
    <text x="12" y="15.5" textAnchor="middle" fill="#fff" fontSize="8" fontWeight="bold" fontFamily="sans-serif">php</text>
  </svg>
)

const CppIcon: FC<IconProps> = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <circle cx="12" cy="12" r="12" fill="#00599c" />
    <text x="10" y="16" textAnchor="middle" fill="#fff" fontSize="10" fontWeight="bold" fontFamily="sans-serif">C</text>
    <path d="M15 10v4M13 12h4" stroke="#fff" strokeWidth="1.2" />
  </svg>
)

const DockerIcon: FC<IconProps> = (props) => (
  <svg viewBox="0 0 24 24" fill="none" {...props}>
    <circle cx="12" cy="12" r="12" fill="#2496ed" />
    <g fill="#fff">
      <rect x="5" y="11" width="2.5" height="2" rx=".3" />
      <rect x="8" y="11" width="2.5" height="2" rx=".3" />
      <rect x="11" y="11" width="2.5" height="2" rx=".3" />
      <rect x="8" y="8.5" width="2.5" height="2" rx=".3" />
      <rect x="11" y="8.5" width="2.5" height="2" rx=".3" />
      <rect x="14" y="11" width="2.5" height="2" rx=".3" />
      <rect x="11" y="6" width="2.5" height="2" rx=".3" />
    </g>
    <path d="M18 12.5c1-.5 1.5-1.5 1.5-1.5s-1-.5-2 0c-.5-1-1.5-1.5-1.5-1.5" stroke="#fff" strokeWidth=".5" fill="none" opacity=".6" />
  </svg>
)

/** Map of framework IDs to their inline SVG icon components. */
export const FRAMEWORK_ICONS: Record<string, FC<IconProps>> = {
  nextjs: NextjsIcon,
  react: ReactIcon,
  vue: VueIcon,
  svelte: SvelteIcon,
  angular: AngularIcon,
  rust: RustIcon,
  go: GoIcon,
  python: PythonIcon,
  ruby: RubyIcon,
  java: JavaIcon,
  typescript: TypeScriptIcon,
  javascript: JavaScriptIcon,
  php: PhpIcon,
  cpp: CppIcon,
  docker: DockerIcon,
} as const
