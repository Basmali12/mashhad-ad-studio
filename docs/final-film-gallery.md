# Final film library

`FilmFiles.tsx` displays only `kind=film`, `index=merged` exports via
`finalFilmFiles.ts`; the server additionally admits only completed projects.
Scene artifacts remain in the generation pipeline and are never separate library cards.

`FilmThumbnail.tsx` requests existing authenticated media only near the viewport,
captures a silent WebP thumbnail in memory, and releases the video element.
The explicit cover click opens `FilmDialog` with the full final MP4. Download
and confirmed permanent deletion remain independent actions. Existing seven-day
retention and tenant authorization are unchanged.

The optional preview video route in `vite.preview.config.ts` is localhost-only,
requires an operator-provided local path, and is absent from production builds.
Preview sample metadata is illustrative, not evidence of a customer's completed film.

This frontend release does not deploy the independent scene-pacing/visual-world
backend drafts or restart any cloud/film service.
