import { useEffect, useMemo, useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Task } from '../content/schema';
import { CodeLine } from '../components/CodeView';
import { Icon } from '../components/Icon';
import { U, useUiString } from '../components/Bi';
import { RunCompleted } from './RunCompleted';
import { shuffle, type KindProps } from './types';

type Parsons = Extract<Task, { kind: 'parsons' }>;

function LineContent({ text, code }: { text: string; code: boolean }) {
  return code ? <CodeLine code={text} /> : <span className="parsons-text">{text}</span>;
}

function SortableLine({ id, text, code, state, onUp, onDown, onRemove, locked }: {
  id: number; text: string; code: boolean; state: string; locked: boolean;
  onUp: () => void; onDown: () => void; onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `l${id}`, disabled: locked });
  const s = useUiString();
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`parsons-line placed ${state} ${isDragging ? 'dragging' : ''}`}>
      <span className="drag-handle" {...attributes} {...listeners} aria-label="drag"><Icon name="menu" size={16} /></span>
      <span className="parsons-content"><LineContent text={text} code={code} /></span>
      {!locked && (
        <span className="parsons-actions">
          <button type="button" className="icon-btn sm" onClick={onUp} aria-label="up"><Icon name="arrowUp" size={14} /></button>
          <button type="button" className="icon-btn sm" onClick={onDown} aria-label="down"><Icon name="arrowDown" size={14} /></button>
          <button type="button" className="icon-btn sm" onClick={onRemove} aria-label={s('common.back')}><Icon name="x" size={14} /></button>
        </span>
      )}
    </li>
  );
}

export function ParsonsTask({ task, register, phase, exam }: KindProps<Parsons>) {
  const all = useMemo(() => [...task.lines, ...(task.distractors || [])], [task.id]);
  const initial = useMemo(() => shuffle(all.map((_, i) => i)), [task.id]);
  const [placed, setPlaced] = useState<number[]>([]);
  const [marks, setMarks] = useState<Record<number, 'ok' | 'bad'>>({});
  const isCode = task.code !== false;
  const locked = phase === 'correct' || phase === 'revealed' || phase === 'final';
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const n = task.lines.length;
  const orders = useMemo(() => [task.lines.map((_, i) => i), ...(task.alt || [])], [task.id]);

  useEffect(() => {
    register({
      canCheck: placed.length >= n,
      check: () => {
        const ok = orders.some((o) => o.length === placed.length && o.every((v, i) => v === placed[i]));
        // mark against the closest accepted order
        let best = orders[0];
        let bestScore = -1;
        for (const o of orders) {
          const score = placed.filter((v, i) => o[i] === v).length;
          if (score > bestScore) { bestScore = score; best = o; }
        }
        const m: Record<number, 'ok' | 'bad'> = {};
        placed.forEach((v, i) => { m[v] = best[i] === v ? 'ok' : 'bad'; });
        setMarks(m);
        return {
          correct: ok,
          feedback: !ok && placed.some((v) => v >= n)
            ? { en: 'One of the lines you used is extra — it doesn’t belong in this test.', ru: 'Одна из строк лишняя — ей не место в этом тесте.' }
            : undefined,
        };
      },
      reveal: () => {
        setPlaced(task.lines.map((_, i) => i));
        setMarks({});
      },
    });
  });

  const add = (i: number) => { if (!locked) { setPlaced((p) => [...p, i]); setMarks({}); } };
  const remove = (i: number) => { setPlaced((p) => p.filter((x) => x !== i)); setMarks({}); };
  const move = (i: number, d: number) => {
    setPlaced((p) => {
      const k = p.indexOf(i);
      const j = k + d;
      if (j < 0 || j >= p.length) return p;
      return arrayMove(p, k, j);
    });
    setMarks({});
  };
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const a = Number(String(active.id).slice(1));
    const b = Number(String(over.id).slice(1));
    setPlaced((p) => arrayMove(p, p.indexOf(a), p.indexOf(b)));
    setMarks({});
  };

  const available = initial.filter((i) => !placed.includes(i));
  const assembled = placed.filter((i) => i < n).map((i) => task.lines[i]).join('\n');

  return (
    <div className="task-parsons">
      <div className="task-hint-line"><U k="task.orderHint" stack={false} />{task.distractors?.length ? <> · <U k="task.extraLines" stack={false} /></> : null}</div>
      <div className="parsons-cols">
        <div className="parsons-col">
          <div className="parsons-col-title"><U k="task.available" stack={false} /></div>
          <ul className="parsons-pool">
            {available.map((i) => (
              <li key={i}>
                <button type="button" className="parsons-line pool" onClick={() => add(i)} disabled={locked}>
                  <span className="parsons-content"><LineContent text={all[i]} code={isCode} /></span>
                  <Icon name="chevronRight" size={16} />
                </button>
              </li>
            ))}
            {available.length === 0 && <li className="parsons-empty">✓</li>}
          </ul>
        </div>
        <div className="parsons-col">
          <div className="parsons-col-title"><U k="task.yourOrder" stack={false} /></div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={placed.map((i) => `l${i}`)} strategy={verticalListSortingStrategy}>
              <ol className={`parsons-answer ${isCode ? 'is-code' : ''}`}>
                {placed.map((i) => (
                  <SortableLine key={i} id={i} text={all[i]} code={isCode} locked={locked}
                    state={phase === 'correct' || phase === 'revealed' ? 'ok' : marks[i] === 'bad' ? 'bad' : marks[i] === 'ok' ? 'ok' : ''}
                    onUp={() => move(i, -1)} onDown={() => move(i, 1)} onRemove={() => remove(i)} />
                ))}
                {placed.length === 0 && <li className="parsons-drop">…</li>}
              </ol>
            </SortableContext>
          </DndContext>
        </div>
      </div>
      {task.checks && isCode && (phase === 'correct' || phase === 'revealed') && !exam && <RunCompleted code={assembled} app={task.app} files={task.files} />}
    </div>
  );
}
