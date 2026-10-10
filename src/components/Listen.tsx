// Play / stop button for the English audio of a text: an icon, or a small "Listen" link under examples.
import { toggleSpeak, useSpeaking } from '../lib/speech';
import { U } from './Bi';
import { Icon } from './Icon';

export function ListenButton({ text, size, label }: { text: string; size?: number; label?: boolean }) {
  const on = useSpeaking(text);
  const icon = <Icon name={on ? 'stop' : 'volume'} size={label ? 14 : size} />;
  if (label) {
    return <button type="button" className={`link-btn tiny listen ${on ? 'speaking' : ''}`} onClick={() => toggleSpeak(text)} aria-pressed={on}>{icon} <U k="glossary.listen" stack={false} /></button>;
  }
  return <button type="button" className={`icon-btn listen ${on ? 'speaking' : ''}`} onClick={() => toggleSpeak(text)} aria-label={on ? 'Stop' : 'Listen'} title={on ? 'Stop' : 'Listen'}>{icon}</button>;
}
