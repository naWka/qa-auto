// Short, soft celebrations. Skipped when the user turned them off or prefers reduced motion.
import confetti from 'canvas-confetti';
import { useSettings } from '../store/settings';

const PASTEL = ['#b8a6e6', '#e8aabb', '#f6c7a5', '#9ed8c2', '#a9cbeb', '#f2dc87'];

function allowed() {
  if (!useSettings.getState().celebrations) return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let heart: confetti.Shape | null = null;
function heartShape() {
  if (!heart) heart = confetti.shapeFromPath({ path: 'M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10z' });
  return heart;
}

export function originOf(el?: Element | null): { x: number; y: number } {
  if (!el) return { x: 0.5, y: 0.6 };
  const r = el.getBoundingClientRect();
  return { x: (r.left + r.width / 2) / window.innerWidth, y: (r.top + r.height / 2) / window.innerHeight };
}

export function sparkles(from?: Element | null) {
  if (!allowed()) return;
  confetti({ particleCount: 26, spread: 70, startVelocity: 22, scalar: 0.7, ticks: 90, origin: originOf(from), colors: PASTEL, shapes: ['star', 'circle'], disableForReducedMotion: true });
}

export function hearts(from?: Element | null) {
  if (!allowed()) return;
  confetti({ particleCount: 22, spread: 80, startVelocity: 26, scalar: 1.3, ticks: 120, gravity: 0.7, origin: originOf(from), colors: ['#e8aabb', '#f4adc3', '#b8a6e6'], shapes: [heartShape()], disableForReducedMotion: true });
}

export function confettiBurst() {
  if (!allowed()) return;
  const base = { spread: 75, ticks: 160, gravity: 0.9, colors: PASTEL, scalar: 0.95, disableForReducedMotion: true };
  confetti({ ...base, particleCount: 70, origin: { x: 0.2, y: 0.7 }, angle: 60 });
  confetti({ ...base, particleCount: 70, origin: { x: 0.8, y: 0.7 }, angle: 120 });
  setTimeout(() => confetti({ ...base, particleCount: 30, origin: { x: 0.5, y: 0.5 }, shapes: [heartShape()], scalar: 1.4 }), 220);
}
