import type { LinkKind } from '@mysticals/core/logic/meeting'

// Inline 16px icons for event links (no icon library in the app). Monochrome ones follow currentColor.
export function LinkIcon({ kind, size = 14 }: { kind: LinkKind; size?: number }): React.JSX.Element {
  const svg = (children: React.ReactNode): React.JSX.Element => (
    <svg className="link-icon" viewBox="0 0 16 16" width={size} height={size} aria-hidden>
      {children}
    </svg>
  )
  switch (kind) {
    case 'meet':
      // Google Meet's camera in its four colours.
      return svg(
        <>
          <path fill="#00832d" d="M10 6.2 12.9 4c.4-.3 1.1 0 1.1.5v7c0 .5-.7.8-1.1.5L10 9.8z" />
          <path fill="#0066da" d="M1 5.2V10.8h3V5.2z" />
          <path fill="#e94235" d="M4 2 1 5.2h3z" />
          <path fill="#2684fc" d="M4 2v3.2h6V3.3C10 2.6 9.4 2 8.7 2z" />
          <path fill="#00ac47" d="M4 10.8V14h4.7c.7 0 1.3-.6 1.3-1.3v-1.9z" />
          <path fill="#ffba00" d="M1 10.8v1.9c0 .7.6 1.3 1.3 1.3H4v-3.2z" />
          <path fill="#00832d" d="M10 5.2H4v5.6h6z" />
        </>
      )
    case 'zoom':
    case 'teams':
    case 'video':
      return svg(
        <>
          <rect x="1.5" y="4" width="9" height="8" rx="1.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M10.5 7 14.5 4.6v6.8L10.5 9z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </>
      )
    case 'map':
      return svg(
        <>
          <path
            d="M8 14.5s4.5-4.3 4.5-7.8a4.5 4.5 0 0 0-9 0c0 3.5 4.5 7.8 4.5 7.8z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <circle cx="8" cy="6.7" r="1.6" fill="currentColor" />
        </>
      )
    default:
      return svg(
        <path
          d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.4-2.4a2.6 2.6 0 0 0-3.7-3.7l-.8.8M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.1 9.2a2.6 2.6 0 0 0 3.7 3.7l.8-.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      )
  }
}
