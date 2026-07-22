# Repository Instructions

## Code Review Rules

### Stable public routes

- Flag removal or renaming of an existing public portfolio route without a permanent redirect that preserves inbound links. Safe path: keep the old route or add an explicit redirect in `vercel.json` to the canonical replacement.

### Browser-safe public content

- Flag user-controlled, remote, or generated content rendered through raw HTML or injected into client-side script without sanitization. Safe path: use Astro's escaped text rendering, validate structured data at the boundary, and allow raw markup only from a reviewed static source.

### Server-only configuration

- Flag secrets or private environment values referenced from browser-delivered code or serialized into generated pages. Safe path: read privileged configuration only in server/build contexts and expose a deliberately shaped public value when the UI needs one.

## Review finding lifecycle

- Reply in the original review thread whenever a finding is fixed, blocked, deferred, rejected, or otherwise updated.
- Include the disposition, relevant commit, verification, and any remaining work.
- A finding is incomplete until its thread has a current status reply, even if the code changed or the comment became outdated.
- Do not resolve review threads without explicit authorization.
