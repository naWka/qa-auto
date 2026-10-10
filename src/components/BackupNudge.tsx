// Reminders to save a copy of progress: a home card once a week and a line in the "chapter done" modal.
import { useState } from 'react';
import { uiText } from '../content';
import { Bi, U } from './Bi';
import { Icon } from './Icon';
import { useProgress } from '../store/progress';
import { useSettings } from '../store/settings';
import { backupDue, downloadBackup } from '../store/backup';
import { today } from '../lib/dates';
import { navigate } from '../lib/router';

export function BackupNudge() {
  const p = useProgress();
  const st = useSettings();
  const [saved, setSaved] = useState(false);
  if (saved) return <div className="notice ok" role="status"><Icon name="check" size={16} /> <U k="backup.saved" stack={false} /></div>;
  if (!backupDue(p, st)) return null;
  return (
    <div className="card backup-card">
      <div className="small-card-head"><Icon name="shield" size={18} /> <U k="backup.title" stack={false} /></div>
      <Bi t={uiText('backup.desc')} size="sm" />
      <div className="row gap wrap">
        <button className="btn btn-primary btn-sm" onClick={() => { downloadBackup(); setSaved(true); }}><Icon name="download" size={14} /> <U k="backup.download" stack={false} /></button>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/settings')}><U k="backup.more" stack={false} /></button>
        <button className="btn btn-ghost subtle btn-sm" onClick={() => st.update({ backupNudgedAt: today() })}><U k="backup.later" stack={false} /></button>
      </div>
    </div>
  );
}

export function BackupNote() {
  const [saved, setSaved] = useState(false);
  return (
    <div className="backup-note">
      <Icon name="shield" size={16} />
      <span><U k={saved ? 'backup.saved' : 'backup.chapterNote'} stack={false} /></span>
      {!saved && <button className="btn btn-soft btn-sm" onClick={() => { downloadBackup(); setSaved(true); }}><Icon name="download" size={14} /> <U k="backup.download" stack={false} /></button>}
    </div>
  );
}
