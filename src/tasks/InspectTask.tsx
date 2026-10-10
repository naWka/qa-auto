import { useEffect, useState } from 'react';
import type { Task } from '../content/schema';
import { BiInline } from '../components/Bi';
import { Icon } from '../components/Icon';
import { Inspector } from '../lab/Inspector';
import { accessibleName, getRole } from '../emulator';
import type { KindProps } from './types';

type Inspect = Extract<Task, { kind: 'inspect' }>;

function describe(el: Element): string {
  const role = getRole(el);
  const name = role ? accessibleName(el) : '';
  const tag = el.tagName.toLowerCase();
  return `<${tag}>${role ? ` · ${role}` : ''}${name ? ` "${name.slice(0, 40)}"` : ''}`;
}

export function InspectTask({ task, register, phase }: KindProps<Inspect>) {
  const [picked, setPicked] = useState<Element | null>(null);
  const [force, setForce] = useState<string | null>(null);
  const done = phase === 'correct' || phase === 'revealed' || phase === 'final';

  useEffect(() => {
    register({
      canCheck: !!picked,
      check: () => {
        const ok = !!picked && picked.matches(task.target);
        return {
          correct: ok,
          feedback: !ok && picked
            ? { en: `You picked \`${describe(picked)}\`. Look again at the question — which element fits it exactly?`, ru: `Ты выбрал{а|} \`${describe(picked)}\`. Перечитай вопрос: какой элемент подходит точно?` }
            : undefined,
        };
      },
      reveal: () => setForce(task.target),
    });
  });

  return (
    <div className="task-inspect">
      <div className="task-hint-line"><Icon name="inspect" size={14} /> <BiInline t={
        task.view === 'dom' ? { en: 'Pick the element: click it on the page or in the Elements tree.', ru: 'Выбери элемент: нажми на него на странице или в дереве Elements.' }
          : task.view === 'aria' ? { en: 'Pick the element: click it on the page or in the agent’s snapshot.', ru: 'Выбери элемент: нажми на него на странице или в снимке агента.' }
            : { en: 'Pick the element: click it on the page, in the Elements tree or in the agent’s snapshot.', ru: 'Выбери элемент: нажми на него на странице, в дереве Elements или в снимке агента.' }} stack={false} /></div>
      <Inspector
        app={task.app}
        view={task.view}
        show={done ? ['attributes', 'role', 'name', 'locator'] : task.show}
        onSelect={setPicked}
        forceSelect={force}
        locked={done}
      />
      {picked && !done && <div className="ins-picked"><Icon name="target" size={14} /> <code>{describe(picked)}</code></div>}
    </div>
  );
}
