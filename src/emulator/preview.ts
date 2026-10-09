// Opens Bloomly in an iframe without running a test (for previews, inspector, pick-locator).
import { makeCtx, type AppSetup } from './runner';

export function openPreview(frame: HTMLIFrameElement, autDir: string, app: AppSetup & { route?: string } = {}): Promise<Document | null> {
  const ctx = makeCtx(app);
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { resolve(frame.contentDocument); } catch { resolve(null); }
    };
    ctx.onReady = () => setTimeout(finish, 60);
    window.__bloomlyCtx = ctx;
    const src = `${autDir}index.html?preview=${Date.now()}#${app.route || '/'}`;
    try { frame.contentWindow!.location.replace(src); } catch { frame.src = src; }
    setTimeout(finish, 3000);
  });
}

/** Draws a soft outline around elements in the previewed app. */
export function outline(doc: Document, el: Element | null, label?: string) {
  doc.querySelectorAll('[data-preview-outline]').forEach((n) => n.remove());
  if (!el) return;
  const r = el.getBoundingClientRect();
  const box = doc.createElement('div');
  box.setAttribute('data-preview-outline', '');
  box.style.cssText = `position:fixed;left:${r.left - 4}px;top:${r.top - 4}px;width:${r.width + 8}px;height:${r.height + 8}px;border:2px dashed #b85574;border-radius:8px;background:rgba(232,170,187,.18);pointer-events:none;z-index:2147483646`;
  if (label) {
    const tag = doc.createElement('div');
    tag.textContent = label;
    tag.style.cssText = 'position:absolute;left:-2px;bottom:100%;margin-bottom:3px;background:#b85574;color:#fff;font:600 11px/1.3 ui-monospace,Menlo,monospace;padding:2px 6px;border-radius:5px;white-space:nowrap';
    box.appendChild(tag);
  }
  doc.body.appendChild(box);
}
