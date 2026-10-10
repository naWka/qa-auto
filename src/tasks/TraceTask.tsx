import { useEffect, useState } from 'react';
import type { Task } from '../content/schema';
import { BiInline, U } from '../components/Bi';
import { Icon } from '../components/Icon';
import { TraceViewer, type TraceEntry } from '../lab/TraceViewer';
import { OptionList } from './ChoiceTask';
import type { KindProps } from './types';

type Trace = Extract<Task, { kind: 'trace' }>;

export function TraceTask({ task, register, phase }: KindProps<Trace>) {
  const [picked, setPicked] = useState<TraceEntry | null>(null);
  const [opt, setOpt] = useState<Set<number>>(new Set());
  const [revealLine, setRevealLine] = useState<number | null>(null);
  const done = phase === 'correct' || phase === 'revealed' || phase === 'final';
  const answers = Array.isArray(task.answer) ? task.answer : [task.answer];

  useEffect(() => {
    register({
      canCheck: !!picked && (!task.options?.length || opt.size > 0),
      check: () => {
        const stepOk = !!picked && !picked.file && picked.line !== undefined && answers.includes(picked.line);
        const optOk = !task.options?.length || [...opt].every((i) => task.options![i].correct);
        let feedback;
        if (!stepOk && picked) {
          feedback = picked.status === 'failed'
            ? { en: 'That action is where the test noticed the problem. Is that where it went wrong — or did something earlier set it up? Compare the After snapshots.', ru: 'Здесь тест заметил проблему. Но именно здесь всё пошло не так — или раньше что-то к этому привело? Сравни снимки After.' }
            : { en: 'This action looks fine in its snapshot. Walk through the actions one by one and compare Before and After.', ru: 'На снимке этого действия всё в порядке. Пройди действия по одному и сравни Before и After.' };
        } else if (stepOk && !optOk) {
          feedback = { en: 'Right action! Now look again at the diagnosis.', ru: 'Действие верное! Теперь ещё раз посмотри на диагноз.' };
        }
        return { correct: stepOk && optOk, feedback };
      },
      reveal: () => {
        setRevealLine(answers[0]);
        const i = task.options?.findIndex((o) => o.correct) ?? -1;
        if (i >= 0) setOpt(new Set([i]));
      },
    });
  });

  const pseudo = task.options ? { id: task.id, kind: 'choice' as const, prompt: task.prompt, options: task.options } : null;
  return (
    <div className="task-trace">
      <div className="task-hint-line"><Icon name="target" size={14} /> <BiInline t={{ en: 'Click the action where things went wrong.', ru: 'Нажми на действие, где всё пошло не так.' }} stack={false} /></div>
      <TraceViewer code={task.code} app={task.app} files={task.files} taskMode onSelect={setPicked} selectLine={revealLine} locked={done} />
      {picked && <div className="ins-picked"><Icon name="target" size={14} /> <code>{picked.title}{picked.line ? ` · line ${picked.line}` : ''}</code></div>}
      {pseudo && (
        <div className="trace-diagnosis">
          <div className="task-hint-line"><U k="task.diagnosis" stack={false} /></div>
          <OptionList task={pseudo} selected={opt} toggle={(i) => !done && setOpt(new Set([i]))} phase={phase} showAll={done} />
        </div>
      )}
    </div>
  );
}
