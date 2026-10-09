// Tiny hash router (works on GitHub Pages without server rewrites).
import { useSyncExternalStore } from 'react';

function read(): string {
  const h = window.location.hash.replace(/^#/, '');
  return h || '/';
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export function navigate(path: string, opts: { replace?: boolean } = {}) {
  if (opts.replace) {
    const url = new URL(window.location.href);
    url.hash = path;
    window.location.replace(url.toString());
  } else {
    window.location.hash = path;
  }
}

export interface Route {
  path: string;
  parts: string[];
  query: URLSearchParams;
}

export function useRoute(): Route {
  const raw = useSyncExternalStore(subscribe, read, () => '/');
  const [path, qs = ''] = raw.split('?');
  return { path, parts: path.split('/').filter(Boolean), query: new URLSearchParams(qs) };
}
