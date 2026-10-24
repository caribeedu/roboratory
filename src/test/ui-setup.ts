// jsdom setup for the interface tests: matchers, and the browser pieces jsdom does not have.
import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

// shared CI machines are slower than a laptop: waiting for something to appear gets room, a wrong answer still fails fast
configure({ asyncUtilTimeout: 5000 });

// the welcome room is drawn on a canvas; jsdom has no 2d context, so every drawing call is accepted and ignored
const context = new Proxy({}, {
  get: (_t, prop) => (prop === 'canvas' ? undefined : typeof prop === 'string' ? () => context : undefined),
  set: () => true,
});
HTMLCanvasElement.prototype.getContext = (() => context) as unknown as HTMLCanvasElement['getContext'];

// scrolling panels
Element.prototype.scrollTo = (() => undefined) as Element['scrollTo'];
