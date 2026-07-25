// src/components/deadcode/radar-sweep.tsx
export function RadarSweep({ className = '' }: { className?: string }) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      <svg
        viewBox="0 0 600 600"
        className="absolute left-1/2 top-1/2 h-[900px] w-[900px] -translate-x-1/2 -translate-y-1/2 opacity-[0.14]"
      >
        <defs>
          <radialGradient id="sweep-fade" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="hsl(155 45% 55%)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="hsl(155 45% 55%)" stopOpacity="0" />
          </radialGradient>
        </defs>
        {[120, 200, 280].map((r) => (
          <circle
            key={r}
            cx="300"
            cy="300"
            r={r}
            fill="none"
            stroke="hsl(155 30% 50%)"
            strokeWidth="1"
            strokeOpacity="0.35"
          />
        ))}
        <g style={{ transformOrigin: '300px 300px', animation: 'radar-spin 8s linear infinite' }}>
          <path d="M300,300 L300,20 A280,280 0 0,1 480,120 Z" fill="url(#sweep-fade)" />
        </g>
      </svg>
      <style>{`
        @keyframes radar-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="radar-spin"] { animation: none !important; }
        }
      `}</style>
    </div>
  )
}