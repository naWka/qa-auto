// Illustrated characters in one soft, flat style: Maya (mentor), teammates, Petal (AI agent), Mochi (cat).
import { story } from '../content';
import { usePrimary } from './Bi';

const OUT = '#4f3f60';

type HairStyle = 'bun' | 'short' | 'long' | 'curly' | 'bob';
interface PersonLook { bg: string; skin: string; hair: string; shirt: string; style: HairStyle; glasses?: boolean; earring?: boolean }

const LOOKS: Record<string, PersonLook> = {
  maya: { bg: '#efe7fd', skin: '#f3cfb3', hair: '#3a2733', shirt: '#b8a6e6', style: 'bun', glasses: true, earring: true },
  leo: { bg: '#e3f1fb', skin: '#d9a77f', hair: '#2d2224', shirt: '#7fa7d6', style: 'short' },
  sofia: { bg: '#fdeef1', skin: '#f6d8c4', hair: '#c98a4b', shirt: '#e8aabb', style: 'long' },
  kai: { bg: '#e6f6ee', skin: '#efc6a0', hair: '#4b3427', shirt: '#9ed8c2', style: 'curly', glasses: true },
  you: { bg: '#fdf0e5', skin: '#f4d2b8', hair: '#6b4436', shirt: '#f6c7a5', style: 'bob' },
};

function Hair({ l }: { l: PersonLook }) {
  switch (l.style) {
    case 'bun':
      return (
        <>
          <circle cx="32" cy="12" r="6.5" fill={l.hair} />
          <ellipse cx="32" cy="28" rx="16" ry="15" fill={l.hair} />
        </>
      );
    case 'long':
      return <path d="M15 31c0-11 7-17 17-17s17 6 17 17v17h-7V35H22v13h-7z" fill={l.hair} />;
    case 'curly':
      return (
        <g fill={l.hair}>
          {[[20, 24], [25, 18], [32, 15], [39, 18], [44, 24], [46, 31], [18, 31]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="6" />)}
        </g>
      );
    case 'bob':
      return <path d="M17 33c0-12 6-18 15-18s15 6 15 18v6h-5v-9H22v9h-5z" fill={l.hair} />;
    default:
      return <path d="M19 28c0-9 5-13 13-13s13 4 13 13c-3-3-7-4-13-4s-10 1-13 4z" fill={l.hair} />;
  }
}

function Bangs({ l }: { l: PersonLook }) {
  if (l.style === 'bun') return <path d="M19.5 29c1.5-8 6.5-12 12.5-12s11 4 12.5 12c-4-4-8-5.5-12.5-5.5S23.5 25 19.5 29z" fill={l.hair} />;
  if (l.style === 'long') return <path d="M19 29c2-8 7-12 13-12s11 4 13 12c-6-2-12-6-15-9-2 4-6 7-11 9z" fill={l.hair} />;
  if (l.style === 'bob') return <path d="M19 30c1-8 6-13 13-13s12 5 13 13c-5-3-9-6-11-9-3 4-9 7-15 9z" fill={l.hair} />;
  return null;
}

export function Person({ who, size = 48, mood = 'idle' }: { who: string; size?: number; mood?: string }) {
  const l = LOOKS[who] ?? LOOKS.you;
  const happy = mood === 'happy' || mood === 'celebrate';
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className="avatar-svg" aria-hidden="true">
      <circle cx="32" cy="32" r="32" fill={l.bg} />
      <clipPath id={`clip-${who}`}><circle cx="32" cy="32" r="32" /></clipPath>
      <g clipPath={`url(#clip-${who})`}>
        <Hair l={l} />
        <path d="M11 66c1-11 9-16 21-16s20 5 21 16z" fill={l.shirt} />
        <rect x="28" y="40" width="8" height="9" rx="3" fill={l.skin} />
        <circle cx="32" cy="31" r="13" fill={l.skin} />
        <Bangs l={l} />
        {happy ? (
          <g stroke={OUT} strokeWidth="1.6" fill="none" strokeLinecap="round">
            <path d="M25.5 31.5q1.8-2 3.6 0M35 31.5q1.8-2 3.6 0" />
          </g>
        ) : (
          <g fill={OUT}>
            <ellipse cx="27.3" cy="31" rx="1.6" ry="1.9" />
            <ellipse cx="36.7" cy="31" rx="1.6" ry="1.9" />
          </g>
        )}
        {l.glasses && (
          <g stroke={OUT} strokeWidth="1.2" fill="none" opacity="0.85">
            <circle cx="27.3" cy="31" r="4.2" />
            <circle cx="36.7" cy="31" r="4.2" />
            <path d="M31.5 31h1" />
          </g>
        )}
        <ellipse cx="23.5" cy="35.5" rx="2.4" ry="1.4" fill="#f2a5b5" opacity="0.6" />
        <ellipse cx="40.5" cy="35.5" rx="2.4" ry="1.4" fill="#f2a5b5" opacity="0.6" />
        <path d={happy ? 'M28 36.5q4 4.5 8 0' : 'M29 37q3 2 6 0'} stroke={OUT} strokeWidth="1.5" fill={happy ? '#fff' : 'none'} strokeLinecap="round" />
        {l.earring && <circle cx="19.5" cy="36" r="1.3" fill="#e8aabb" />}
      </g>
    </svg>
  );
}

export function Petal({ size = 48, thinking = false }: { size?: number; thinking?: boolean }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={`avatar-svg ${thinking ? 'petal-thinking' : ''}`} aria-hidden="true">
      <circle cx="32" cy="32" r="32" fill="#eef3ea" />
      <g transform="translate(32 12)">
        {[0, 72, 144, 216, 288].map((a) => <ellipse key={a} cx="0" cy="-4" rx="3" ry="4.5" fill="#e8aabb" transform={`rotate(${a})`} />)}
        <circle r="2.6" fill="#f2dc87" />
      </g>
      <path d="M32 18v6" stroke={OUT} strokeWidth="1.6" />
      <rect x="15" y="24" width="34" height="27" rx="10" fill="#b8a6e6" stroke={OUT} strokeWidth="1.6" />
      <rect x="20" y="29" width="24" height="15" rx="6" fill="#2f2540" />
      {thinking ? (
        <g fill="#9ed8c2" className="petal-dots">
          <circle cx="26" cy="36.5" r="1.8" />
          <circle cx="32" cy="36.5" r="1.8" />
          <circle cx="38" cy="36.5" r="1.8" />
        </g>
      ) : (
        <g fill="#9ed8c2">
          <rect x="25" y="33" width="3.5" height="6" rx="1.7" />
          <rect x="35.5" y="33" width="3.5" height="6" rx="1.7" />
        </g>
      )}
      <circle cx="13" cy="37" r="3" fill="#b8a6e6" stroke={OUT} strokeWidth="1.4" />
      <circle cx="51" cy="37" r="3" fill="#b8a6e6" stroke={OUT} strokeWidth="1.4" />
    </svg>
  );
}

export type MochiMood = 'idle' | 'happy' | 'think' | 'oops' | 'celebrate' | 'sleepy';

export function Mochi({ mood = 'idle', size = 72 }: { mood?: MochiMood; size?: number }) {
  const eyes = {
    idle: <g fill={OUT}><ellipse cx="33" cy="36" rx="2.2" ry="2.6" /><ellipse cx="47" cy="36" rx="2.2" ry="2.6" /><circle cx="33.8" cy="35" r=".7" fill="#fff" /><circle cx="47.8" cy="35" r=".7" fill="#fff" /></g>,
    happy: <g stroke={OUT} strokeWidth="2" fill="none" strokeLinecap="round"><path d="M30 37q3-3.5 6 0M44 37q3-3.5 6 0" /></g>,
    celebrate: <g fill="#f2dc87" stroke={OUT} strokeWidth="1"><path d="M33 32l1.2 2.6 2.8.3-2.1 1.9.6 2.8-2.5-1.4-2.5 1.4.6-2.8-2.1-1.9 2.8-.3z" /><path d="M47 32l1.2 2.6 2.8.3-2.1 1.9.6 2.8-2.5-1.4-2.5 1.4.6-2.8-2.1-1.9 2.8-.3z" /></g>,
    think: <g fill={OUT}><ellipse cx="34" cy="34.5" rx="2.2" ry="2.6" /><ellipse cx="48" cy="34.5" rx="2.2" ry="2.6" /></g>,
    oops: <g stroke={OUT} strokeWidth="1.8" fill="none" strokeLinecap="round"><path d="M30.5 34.5l4 2-4 2M49.5 34.5l-4 2 4 2" /></g>,
    sleepy: <g stroke={OUT} strokeWidth="2" fill="none" strokeLinecap="round"><path d="M30 37q3 2.5 6 0M44 37q3 2.5 6 0" /></g>,
  }[mood];
  return (
    <svg viewBox="0 0 80 80" width={size} height={size} className={`mochi mochi-${mood}`} role="img" aria-label="Mochi the cat">
      <path d="M58 64c10-2 14-10 10-18" stroke="#f0b48c" strokeWidth="6" fill="none" strokeLinecap="round" className="mochi-tail" />
      <ellipse cx="40" cy="62" rx="20" ry="13" fill="#fff4e8" stroke={OUT} strokeWidth="1.8" />
      <g className="mochi-head">
        <path d="M24 30L22 13l14 9z" fill="#fff4e8" stroke={OUT} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M56 30l2-17-14 9z" fill="#f6c7a5" stroke={OUT} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M25.5 26l-1-8 6 4z" fill="#f2a5b5" />
        <path d="M54.5 26l1-8-6 4z" fill="#f2a5b5" />
        <ellipse cx="40" cy="37" rx="20" ry="16.5" fill="#fff4e8" stroke={OUT} strokeWidth="1.8" />
        <path d="M44 21.5c6 .5 12 4 14.5 10-4-2-9-3-14.5-2.5z" fill="#f6c7a5" />
        {eyes}
        <ellipse cx="29" cy="42" rx="3" ry="1.8" fill="#f2a5b5" opacity=".7" />
        <ellipse cx="51" cy="42" rx="3" ry="1.8" fill="#f2a5b5" opacity=".7" />
        <path d="M38.6 40.5h2.8l-1.4 1.6z" fill="#e48aa0" />
        <path d={mood === 'oops' ? 'M37 45.5q3-2 6 0' : 'M36.5 43q1.75 1.8 3.5 0q1.75 1.8 3.5 0'} stroke={OUT} strokeWidth="1.4" fill="none" strokeLinecap="round" />
        <g stroke={OUT} strokeWidth=".9" opacity=".55" strokeLinecap="round">
          <path d="M22 40l-7-1M22 43l-7 1.5M58 40l7-1M58 43l7 1.5" />
        </g>
      </g>
      <ellipse cx="32" cy="73" rx="5" ry="3" fill="#fff4e8" stroke={OUT} strokeWidth="1.5" />
      <ellipse cx="48" cy="73" rx="5" ry="3" fill="#fff4e8" stroke={OUT} strokeWidth="1.5" />
      {mood === 'happy' && (
        <g className="mochi-hearts" fill="#e8aabb">
          <path d="M66 18c-2-3-6-1-4 2l4 4 4-4c2-3-2-5-4-2z" />
          <path d="M12 24c-1.5-2.2-4.5-.8-3 1.5l3 3 3-3c1.5-2.3-1.5-3.7-3-1.5z" />
        </g>
      )}
      {mood === 'celebrate' && (
        <g className="mochi-sparkles" fill="#f2dc87" stroke={OUT} strokeWidth=".8">
          <path d="M66 12l1.5 3.5 3.5 1.5-3.5 1.5L66 22l-1.5-3.5L61 17l3.5-1.5z" />
          <path d="M12 16l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z" />
          <path d="M70 34l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
        </g>
      )}
      {mood === 'oops' && <path d="M60 22c2 3 3 5 0 6.5S56 26 60 22z" fill="#a9cbeb" stroke={OUT} strokeWidth=".9" className="mochi-drop" />}
      {mood === 'sleepy' && <text x="58" y="20" fill={OUT} fontFamily="Nunito, sans-serif" fontWeight="800" fontSize="11" className="mochi-z">z z</text>}
      {mood === 'think' && <g fill={OUT} opacity=".6"><circle cx="62" cy="22" r="2" /><circle cx="67" cy="15" r="2.6" /><circle cx="73" cy="7" r="3.2" /></g>}
    </svg>
  );
}

export function Avatar({ who, size = 44, mood }: { who: string; size?: number; mood?: string }) {
  if (who === 'petal') return <Petal size={size} thinking={mood === 'think'} />;
  if (who === 'mochi') return <Mochi size={size} mood={(mood as MochiMood) || 'idle'} />;
  return <Person who={who} size={size} mood={mood} />;
}

export function useCharacterName() {
  const primary = usePrimary();
  return (who: string) => {
    const c = story.characters[who];
    if (!c) return who;
    return typeof c.name === 'string' ? c.name : primary(c.name);
  };
}
