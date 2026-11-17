// Clerk -> Convex JWT validation. Create a "convex" JWT template in Clerk and set
// CLERK_JWT_ISSUER_DOMAIN in the Convex deployment env (see README).
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};
