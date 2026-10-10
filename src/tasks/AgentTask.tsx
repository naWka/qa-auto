import { useEffect, useState } from 'react';
import type { Task } from '../content/schema';
import { Bi, U, useLang } from '../components/Bi';
import { SPEC_FILE } from '../emulator';
import { CodeView } from '../components/CodeView';
import { Icon } from '../components/Icon';
import { Petal } from '../components/Characters';
import { CodeLab, FilesView } from '../lab/CodeLab';
import type { KindProps } from './types';

type Agent = Extract<Task, { kind: 'agent' }>;
type Response = Agent['responses'][number];

export function pickResponse(task: Agent, chosen: Set<string>): Response {
  return task.responses.find((r) => r.when.every((b) => chosen.has(b)) && !(r.unless || []).some((b) => chosen.has(b)))
    ?? task.responses[task.responses.length - 1];
}

export function bestBlocks(task: Agent): Set<string> {
  const best = task.responses.find((r) => r.best);
  return new Set([...task.blocks.filter((b) => b.locked).map((b) => b.id), ...(best?.when || [])]);
}

export function AgentTask({ task, register, phase }: KindProps<Agent>) {
  const { lang } = useLang();
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(task.blocks.filter((b) => b.locked).map((b) => b.id)));
  const [thinking, setThinking] = useState(false);
  const [response, setResponse] = useState<Response | null>(null);
  const [sentWith, setSentWith] = useState<Set<string>>(new Set());
  const locked = phase === 'correct' || phase === 'revealed' || phase === 'final' || thinking;

  useEffect(() => {
    register({
      canCheck: !thinking,
      checkLabel: 'task.sendPrompt',
      check: async () => {
        setThinking(true);
        setResponse(null);
        await new Promise((r) => setTimeout(r, 1300));
        const r = pickResponse(task, chosen);
        setThinking(false);
        setResponse(r);
        setSentWith(new Set(chosen));
        return { correct: !!r.best };
      },
      reveal: () => {
        const best = bestBlocks(task);
        setChosen(best);
        setResponse(pickResponse(task, best));
        setSentWith(best);
      },
    });
  });

  const toggle = (id: string) => {
    if (locked) return;
    setChosen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const missing = response && !response.best
    ? Object.entries(task.missing || {}).filter(([id]) => !sentWith.has(id))
    : [];

  return (
    <div className="task-agent">
      <div className="agent-simulated"><Icon name="info" size={14} /> <U k="task.simulated" stack={false} /></div>
      <div className="task-hint-line"><U k="task.composePrompt" stack={false} /></div>
      <div className="prompt-blocks">
        {task.blocks.map((b) => {
          const on = chosen.has(b.id);
          return (
            <button key={b.id} type="button" className={`prompt-block ${on ? 'on' : ''} ${b.locked ? 'locked' : ''}`} onClick={() => !b.locked && toggle(b.id)} disabled={locked && !on} aria-pressed={on}>
              <span className="pb-check">{on ? <Icon name="check" size={14} strokeWidth={2.6} /> : null}</span>
              <span className="pb-text">
                {lang !== 'ru' && <span className="pb-en">{b.text}</span>}
                {lang !== 'en' && <span className={lang === 'ru' ? 'pb-en' : 'pb-ru'}>{b.ru}</span>}
              </span>
              {b.locked && <Icon name="lock" size={14} />}
            </button>
          );
        })}
      </div>
      <div className="prompt-preview">
        <div className="prompt-preview-label"><Icon name="chat" size={14} /> <U k="task.promptPreview" stack={false} /></div>
        <p>{task.blocks.filter((b) => chosen.has(b.id)).map((b) => b.text).join(' ')}</p>
      </div>
      {thinking && (
        <div className="agent-thinking"><Petal size={40} thinking /> <U k="task.agentThinking" stack={false} /></div>
      )}
      {response && !thinking && (
        <div className={`agent-response ${response.best ? 'best' : ''}`}>
          <div className="agent-msg">
            <Petal size={40} />
            <div className="agent-bubble">
              <div className="mentor-name">Petal</div>
              <Bi t={response.message} />
            </div>
          </div>
          <FilesView files={response.files} />
          <CodeView code={response.code} label={SPEC_FILE} />
          {missing.length > 0 && (
            <div className="agent-missing">
              <div className="report-sub"><Icon name="bulb" size={14} /> <U k="task.missingBlocks" stack={false} /></div>
              <ul>{missing.map(([id, t]) => <li key={id}><Bi t={t} size="sm" /></li>)}</ul>
            </div>
          )}
          <details className="agent-run">
            <summary><Icon name="play" size={15} /> <U k="task.run" stack={false} /></summary>
            <CodeLab code={response.code} readOnly app={task.app} files={response.files ?? task.files} browserHeight={340} />
          </details>
        </div>
      )}
    </div>
  );
}
