import type { ReactNode } from 'react';
import type { Line, TS } from '../content/schema';
import { Bi } from './Bi';
import { Avatar, Mochi, type MochiMood, useCharacterName } from './Characters';

/** Maya speaking (speech bubble) with Mochi reacting next to her. */
export function Mentor({ t, vars, mood = 'idle', who = 'maya', children, compact, showMochi = true }: {
  t?: TS;
  vars?: Record<string, string | number>;
  mood?: MochiMood;
  who?: string;
  children?: ReactNode;
  compact?: boolean;
  showMochi?: boolean;
}) {
  const name = useCharacterName();
  return (
    <div className={`mentor ${compact ? 'mentor-compact' : ''} mentor-${mood}`}>
      <div className="mentor-avatar">
        <Avatar who={who} size={compact ? 40 : 52} mood={mood === 'happy' || mood === 'celebrate' ? 'happy' : 'idle'} />
      </div>
      <div className="mentor-bubble">
        <div className="mentor-name">{name(who)}</div>
        {t && <Bi t={t} vars={vars} />}
        {children}
      </div>
      {showMochi && !compact && (
        <div className="mentor-mochi" aria-hidden="true">
          <Mochi mood={mood} size={64} />
        </div>
      )}
    </div>
  );
}

/** Story dialogue: chat-like lines with avatars. */
export function Dialogue({ lines }: { lines: Line[] }) {
  const name = useCharacterName();
  return (
    <div className="dialogue">
      {lines.map((l, i) => (
        <div key={i} className={`dl-line ${l.who === 'you' ? 'dl-you' : ''}`} style={{ animationDelay: `${i * 90}ms` }}>
          <div className="dl-avatar"><Avatar who={l.who} size={40} mood={l.mood} /></div>
          <div className="dl-bubble">
            <div className="dl-name">{name(l.who)}</div>
            <Bi t={l.text} />
          </div>
        </div>
      ))}
    </div>
  );
}
