# Mashhad film gateway

The owner selected the existing https://iraqaistudio.com/ Pages site. Its release sets the public VITE_FILM_API_ORIGIN=https://scan.iraqaistudio.com. Caddy forwards only /api/mashhad-film and /api/mashhad-film/access on scan to this loopback service. Strict preflight allows the exact customer origin plus an optional explicitly configured MASHHAD_FILM_ADMIN_ORIGIN=https://scan.iraqaistudio.com. The separate administrator release is https://scan.iraqaistudio.com/reels-admin/. Every POST from that origin requires a server-verified super-admin and only admin.* operations (plus the access check); customer commands are rejected even for the owner. No cookies or wildcard origins are enabled. The Pages /admin/ copy remains compatible. No root DNS change is required. The older studio-domain Caddy example is not the activation plan for this deployment.

Node 24 loopback service. It does not import the Modal SDK, create an Image/Volume or start GPU resources. Startup/health checks never contact a provider. The browser uses the one existing Mashhad Clerk/Convex bearer session; no new login form, cookies or provider credentials are introduced.

Each request resolves the existing authenticated `publishingUsers:profile` Convex query. That deployed query enforces the signed issuer, membership/ban state and owner-derived role. The gateway never trusts a frontend actor/admin/email field and has no owner credential fallback. Film tenants use a separate `mashhad-<verified-user-id>` namespace. An optional server-only mapping retains the previous owner's film records without mapping customer identities together.

The existing film bridge's operation validation, HTTPS HMAC, redacted DTOs and uncertain-result semantics are preserved. Exactly one upstream bridge attempt is made, with the original request ID. Paid actions still require explicit approval and the engine's wallet/availability/duplicate guards. No new text cleanup policy is enabled. Model weights remain on their existing persistent Volumes.

## Local checks

`npm run film:gateway:check` exercises real loopback HTTP and mock provider boundaries. `npm run film:engine:check` runs the preserved Node engine tests. Neither launches a cloud task. Tests do not prove live Clerk admission, PostgreSQL or GPU capacity.

Configure the variable names in `.env.example` using a private root-readable EnvironmentFile, then explicitly start `node services/film-gateway/server.mjs`. The service binds only 127.0.0.1, port 3480 by default. Direct Node TLS bypass is forbidden. Existing internal CA trust may be reused through NODE_EXTRA_CA_CERTS.

The browser POST routes are `/api/mashhad-film` and `/api/mashhad-film/access`. They require exact configured Origin, JSON, bearer credentials and verified membership. The access endpoint only returns ID/admin status; it cannot grant roles. Customer and administrator UI builds remain separate. Signed media/reference tickets use the existing engine's ownership and expiration checks.

Reels subscription/quota/publishing data remain in the current system. Film rental wallet, projects, model account secrets and generated files remain in the existing dedicated film PostgreSQL/data directories. Do not migrate or clear either set merely to deploy this gateway.
