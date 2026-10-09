import { forwardRef } from 'react';
import { Icon } from '../components/Icon';
import { U } from '../components/Bi';

/** Fake browser chrome around the Bloomly iframe. */
export const BrowserFrame = forwardRef<HTMLIFrameElement, { url: string; height?: number; busy?: boolean; className?: string; toolbar?: React.ReactNode }>(
  function BrowserFrame({ url, height = 440, busy, className = '', toolbar }, ref) {
    const blank = url === 'about:blank';
    return (
      <div className={`browser ${className}`}>
        <div className="browser-bar">
          <span className="browser-dots" aria-hidden="true"><i /><i /><i /></span>
          <div className="browser-url" title={url}>
            <Icon name={blank ? 'globe' : 'lock'} size={14} />
            <span>{url}</span>
            {busy && <span className="browser-busy" aria-hidden="true" />}
          </div>
          {toolbar}
        </div>
        <div className="browser-viewport" style={{ height }}>
          <iframe ref={ref} title="Bloomly — app under test" src="about:blank" />
          {blank && !busy && (
            <div className="browser-blank">
              <Icon name="globe" size={28} />
              <U k="browser.blank" />
            </div>
          )}
        </div>
      </div>
    );
  },
);
