# Canvas UI attribution

The muted portfolio visual system adapts two techniques from
[Canvas UI](https://github.com/DavidHDev/canvas-ui) at upstream commit
`f3062667812366775b23fc0eabf40842355fa712`:

- restrained grain and scanline math from `VHSVanilla.ts`; and
- the 4×4 Bayer threshold post-process from `DitheredObjectVanilla.ts`.

The adapted shaders live in `src/scripts/device-renderer.ts`. They are limited
to the device displays and a small status object, use the portfolio's shared
Three.js renderer, load no remote model or texture, and leave semantic HTML as
the authoritative fallback.

## MIT + Commons Clause License Condition v1.0

Copyright (c) 2026 David Haz

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, and distribute the Software **as part of
an application, website, or product**, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

### Commons Clause Restriction

You may use this Software, including for any commercial purpose, **so long as
you do not sell, sublicense, or redistribute the components themselves -
whether alone, in a bundle, or as a ported version.**

### No Warranty

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
