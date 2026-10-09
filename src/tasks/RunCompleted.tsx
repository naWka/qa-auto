import { useState } from 'react';
import type { AppConfig } from '../content/schema';
import { CodeLab } from '../lab/CodeLab';
import { Icon } from '../components/Icon';
import { U } from '../components/Bi';

/** "See it run": an optional read-only lab for a completed snippet. */
export function RunCompleted({ code, app }: { code: string; app?: AppConfig }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button className="btn btn-soft see-run" onClick={() => setOpen(true)}>
        <Icon name="play" size={16} /> <U k="lesson.runExample" stack={false} />
      </button>
    );
  }
  return <div className="run-completed"><CodeLab code={code} readOnly app={app} browserHeight={360} /></div>;
}
