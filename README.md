# Convex + TypeScript + ESLint + Vite + React + Clerk + Tailwind + shadcn/ui

This template provides a minimal setup to get Convex working, with TypeScript,
ESLint and React using [Vite](https://vitejs.dev/). It uses [Clerk](https://clerk.dev/) for user authentication.

Start by editing `convex/myFunctions.ts` and interact with your React app.

See Convex docs at https://docs.convex.dev/home

## Setting up

```
npm create convex@latest -t react-vite-clerk-shadcn
```

Then:

1. Follow steps 1 to 3 in the [Clerk onboarding guide](https://docs.convex.dev/auth/clerk#get-started)
2. Paste the Issuer URL as `CLERK_JWT_ISSUER_DOMAIN` to your dev deployment environment variable settings on the Convex dashboard (see [docs](https://docs.convex.dev/auth/clerk#configuring-dev-and-prod-instances))
3. Paste your publishable key as `VITE_CLERK_PUBLISHABLE_KEY="<your publishable key>"` to the `.env.local` file in this directory.

If you want to sync Clerk user data via webhooks, check out this [example repo](https://github.com/thomasballinger/convex-clerk-users-table/).

## Automatic backend deployment

The [Deploy Convex workflow](.github/workflows/deploy-convex.yml) deploys the
backend on every push to `main`. It installs dependencies from the lockfile and
runs `convex deploy` with backend TypeScript checking enabled. Deployments run
one at a time, without cancelling a deployment already in progress.

Before merging the workflow:

1. In the [Convex dashboard](https://dashboard.convex.dev), select this project's
   **production** deployment and generate a production deploy key in its settings.
2. Add it to this GitHub repository under **Settings → Secrets and variables →
   Actions → New repository secret**, named `CONVEX_DEPLOY_KEY`.

This is the only GitHub secret the workflow needs. Keep runtime environment
variables (`CLERK_JWT_ISSUER_DOMAIN`, `GITHUB_CREATE_WEBHOOK_SECRET`,
`GITHUB_READ_TOKEN`, and `VESTABUDDY_KEY`) configured on the production Convex
deployment.

You can also run the workflow manually from GitHub Actions with `main` selected.
It deploys the backend only; it does not publish the frontend or run data migrations.
See [Convex's production deployment guide](https://docs.convex.dev/production/overview)
and [deploy key documentation](https://docs.convex.dev/cli/deploy-key-types).
