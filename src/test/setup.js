// Shared jsdom shims for the HUD test suites.
//
// jsdom implements neither scrollIntoView nor matchMedia; both are no-ops in a
// test and throwing on them hides the assertion the test actually cares about.
import { vi } from 'vitest';

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
}

if (typeof window !== 'undefined' && !window.matchMedia) {
    window.matchMedia = (query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    });
}
