import { useEffect, useRef, useState } from 'react';
import type { Task } from '../content/schema';
import { U } from '../components/Bi';
import { BrowserFrame } from '../lab/BrowserFrame';
import { AUT_DIR } from '../lab/useRunner';
import { openPreview, outline, BASE_URL } from '../emulator';
import { OptionList } from './ChoiceTask';
import type { KindProps } from './types';

type Pick = Extract<Task, { kind: 'pick-locator' }>;

export function PickLocatorTask({ task, register, phase, exam }: KindProps<Pick>) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [revealed, setRevealed] = useState(false);
  const route = task.app?.route || '/';

  useEffect(() => {
    let alive = true;
    if (!frame.current) return;
    openPreview(frame.current, AUT_DIR, { ...task.app, route }).then((doc) => {
      if (!alive || !doc || !task.target) return;
      const el = doc.querySelector(task.target);
      el?.scrollIntoView({ block: 'center' });
      setTimeout(() => outline(doc, el, '?'), 80);
    });
    return () => { alive = false; };
  }, [task.id]);

  useEffect(() => {
    register({
      canCheck: selected.size > 0,
      check: () => ({ correct: [...selected].every((i) => task.options[i].correct) }),
      reveal: () => setRevealed(true),
    });
  });

  const showAll = phase === 'correct' || revealed || phase === 'revealed' || (exam && phase === 'final');
  return (
    <div className="task-pick">
      <BrowserFrame ref={frame} url={BASE_URL + route} height={300} />
      <div className="task-hint-line"><U k="task.chooseOne" stack={false} /></div>
      <OptionList task={task} selected={selected} toggle={(i) => setSelected(new Set([i]))} phase={phase} showAll={showAll} />
    </div>
  );
}
