// Carregamento: um traço correndo pelo símbolo do infinito.
const PATH = 'M24 34c0-12 9.5-21 21-21 12.5 0 19 10.5 25 21s12.5 21 25 21c11.500 0 21-9 21-21s-9.500-21-21-21c-12.500 0-19 10.500-25 21S57.500 55 45 55c-11.500 0-21-9-21-21z';

export default function Loader({ label = 'Carregando', compact = false }: { label?: string; compact?: boolean }) {
  return (
    <div className={compact ? 'inf compact' : 'inf'} role="status" aria-live="polite">
      <svg width="140" height="68" viewBox="0 0 140 68" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="inf-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.15" />
            <stop offset="0.5" stopColor="var(--accent)" />
            <stop offset="1" stopColor="var(--accent-2)" stopOpacity="0.15" />
          </linearGradient>
          <filter id="inf-glow" x="-30%" y="-80%" width="160%" height="260%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>
        <path d={PATH} stroke="var(--accent)" strokeOpacity="0.16" strokeWidth="7" strokeLinecap="round" />
        <path d={PATH} stroke="var(--accent)" strokeWidth="9" strokeLinecap="round" opacity="0.55" filter="url(#inf-glow)" className="inf-run" />
        <path d={PATH} stroke="url(#inf-grad)" strokeWidth="4.5" strokeLinecap="round" className="inf-run" />
      </svg>
      <span>{label}</span>
    </div>
  );
}
