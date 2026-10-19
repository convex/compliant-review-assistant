import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { currentPrUrl, equivalentPrUrls } from "./githubPrUrls";

async function findReleasePrByUrl(ctx: QueryCtx, url: string) {
  for (const candidate of equivalentPrUrls(url)) {
    const pr = await ctx.db
      .query("release_prs")
      .withIndex("byUrl", (q) => q.eq("url", candidate))
      .unique();
    if (pr) return pr;
  }
  return null;
}

export const updateLatestReleasePR = internalMutation({
  // Validators for arguments.
  args: {
    requestor: v.string(),
    latestPrUrl: v.string(),
  },
  handler: async (ctx, args) => {
    if (await findReleasePrByUrl(ctx, args.latestPrUrl)) {
      return;
    }
    await ctx.db.insert("release_prs", {
      url: currentPrUrl(args.latestPrUrl),
      requestor: args.requestor,
    });

    await ctx.scheduler.runAfter(0, internal.vesta.postToVestabuddy, {
      requestor: args.requestor,
    });
  },
});

export const markApproved = internalMutation({
  args: {
    approver: v.string(),
    prUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const releasePr = await findReleasePrByUrl(ctx, args.prUrl);
    if (!releasePr) return;

    if (releasePr.approver) {
      console.log(
        `PR ${args.prUrl} was already approved by ${releasePr.approver}.
         Too late to mark as approved by ${args.approver}`
      );
      return;
    }

    await ctx.db.patch(releasePr._id, { approver: args.approver });

    /*
     * this got rather annoying
    await ctx.scheduler.runAfter(0, internal.vesta.postToVestabuddy, {
      requestor: releasePr.requestor,
      approver: args.approver,
    });
    */
  },
});

export const getLatestReleasePR = internalQuery({
  args: {},

  handler: async (ctx) => {
    return ctx.db
      .query("release_prs")
      .order("desc")
      .first();
  },
});

export const highScores = internalQuery({
  args: {},

  handler: async (ctx) => {
    const approvals = await ctx.db.query("release_prs").collect();
    const approverCounts = approvals.reduce(
      (acc: Record<string, number>, { approver }) => {
        if (approver !== undefined) {
          acc[approver] = (acc[approver] || 0) + 1;
        }
        return acc;
      },
      {}
    );
    const sortedApprovers = Object.entries(approverCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const requestors = await ctx.db.query("release_prs").collect();
    const requestor_counts = requestors.reduce(
      (acc: Record<string, number>, { requestor }) => {
        if (requestor !== undefined) {
          acc[requestor] = (acc[requestor] || 0) + 1;
        }
        return acc;
      },
      {}
    );
    const sortedRequestors = Object.entries(requestor_counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    return { sortedApprovers, sortedRequestors };
  },
});
