import type { AuthConfig } from 'convex/server';
// No issuer means no accepted identities. All data functions still requireOwner.
export default { providers: process.env.CLERK_JWT_ISSUER_DOMAIN ? [{ domain: process.env.CLERK_JWT_ISSUER_DOMAIN, applicationID:'convex' }] : [] } satisfies AuthConfig;
