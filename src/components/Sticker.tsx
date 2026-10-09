// Collectible sticker: die-cut white border, soft shadow, slight tilt, glossy highlight.
import { Icon } from './Icon';

const FILL: Record<string, [string, string]> = {
  lavender: ['#d9cdf7', '#9b84dd'],
  rose: ['#f8d3de', '#d47a96'],
  peach: ['#fbdcc6', '#e0915e'],
  mint: ['#c9eddf', '#56b08e'],
  sky: ['#d3e5f6', '#6f9fd0'],
  butter: ['#f8ecb6', '#d1ac2c'],
};

export function Sticker({ icon, color, size = 96, locked = false, tilt = 0, label }: { icon: string; color: string; size?: number; locked?: boolean; tilt?: number; label?: string }) {
  const [light, dark] = FILL[color] || FILL.lavender;
  const id = `g-${icon}-${color}`;
  return (
    <div className={`sticker ${locked ? 'sticker-locked' : ''}`} style={{ width: size, height: size, transform: `rotate(${tilt}deg)` }} role="img" aria-label={label}>
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
        <defs>
          <radialGradient id={id} cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="45%" stopColor={light} />
            <stop offset="100%" stopColor={dark} stopOpacity="0.55" />
          </radialGradient>
        </defs>
        <path d="M50 4c9 0 13 6 20 8s13 1 17 8 1 13 3 20 8 11 6 19-9 9-12 15-2 13-9 16-12-1-19 2-10 8-17 6-8-8-15-10-14-2-17-9 1-13-1-20-8-11-6-18 9-9 12-15 2-13 9-16 12 1 19-2 7-9 14-9z" fill="#fff" />
        <path d="M50 11c7.5 0 11 5 17 6.7s11 .8 14.3 6.7.8 11 2.5 17 6.7 9.2 5 15.9-7.5 7.5-10 12.5-1.7 10.9-7.5 13.4-10-.8-15.9 1.7-8.4 6.7-14.3 5-6.7-6.7-12.5-8.4-11.7-1.7-14.3-7.5.8-10.9-.8-16.7-6.7-9.2-5-15 7.5-7.5 10-12.5 1.7-10.9 7.5-13.4 10 .8 15.9-1.7 5.9-7.5 11.7-7.5z" fill={`url(#${id})`} />
        <ellipse cx="36" cy="28" rx="16" ry="7" fill="#fff" opacity="0.35" transform="rotate(-25 36 28)" />
      </svg>
      <span className="sticker-icon" style={{ color: locked ? 'var(--ink-3)' : '#3a2e48' }}>
        <Icon name={locked ? 'lock' : icon} size={size * 0.38} strokeWidth={2} />
      </span>
    </div>
  );
}
