import { useEffect, useState } from 'react';
import type { Task } from '../content/schema';
import { CodeView } from '../components/CodeView';
import { useUiString } from '../components/Bi';
import { ScriptRun } from './ScriptRun';
import { sameAnswer, type KindProps } from './types';

type Input = Extract<Task, { kind: 'input' }>;

export function InputTask({ task, register, phase }: KindProps<Input>) {
  const [value, setValue] = useState('');
  const s = useUiString();
  useEffect(() => {
    register({
      canCheck: value.trim().length > 0,
      check: () => ({ correct: sameAnswer(value, task.answers, task.caseSensitive) }),
      reveal: () => setValue(task.answers[0]),
    });
  });
  const done = phase === 'correct' || phase === 'revealed' || phase === 'final';
  return (
    <div className="task-input">
      {task.code && <CodeView code={task.code} />}
      <input
        className={`text-input mono ${phase === 'wrong' ? 'input-wrong' : ''} ${phase === 'correct' || phase === 'revealed' ? 'input-ok' : ''}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={task.placeholder || s('task.typeHere')}
        disabled={done}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
      />
      {done && phase !== 'correct' && <div className="answer-reveal"><code>{task.answers[0]}</code></div>}
      {task.run === 'script' && task.code && done && <ScriptRun code={task.code} />}
    </div>
  );
}
