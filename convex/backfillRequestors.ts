import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { Octokit } from "@octokit/rest";

export const backfill = internalAction({
  args: {},
  handler: async (ctx) => {
    for (const row of await ctx.runMutation(
      internal.backfillRequestors.backfillFetcher
    )) {
      if (row.requestor) {
        continue;
      }

      const { author, firstApprover } = await fetchPRDetails(row.url);
      await ctx.runMutation(internal.backfillRequestors.backfillWriter, {
        id: row._id,
        author,
        firstApprover,
      });
    }
  },
});

export const backfillFetcher = internalMutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("release_prs")
      .withIndex("by_creation_time")
      .order("desc")
      .collect();
  },
});

export const backfillWriter = internalMutation({
  args: {
    id: v.id("release_prs"),
    author: v.string(),
    firstApprover: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.patch(args.id, {
      requestor: args.author,
      approver: args.firstApprover,
    });
  },
});

async function fetchPRDetails(prUrl: string) {
  const token = process.env.GITHUB_READ_TOKEN;
  const octokit = new Octokit({ auth: token });

  const match = prUrl.match(
    /https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/
  );
  if (!match) {
    throw new Error("Invalid URL");
  }

  const [, owner, repo, pullNumber] = match;

  // Fetch PR details
  const { data: prData } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: +pullNumber,
  });
  const author = prData.user.login;

  // Fetch PR reviews
  const { data: reviews } = await octokit.pulls.listReviews({
    owner,
    repo,
    pull_number: +pullNumber,
  });
  const approvedReviews = reviews.filter(
    (review) => review.state === "APPROVED"
  );
  const firstApprover =
    approvedReviews.length > 0 ? approvedReviews[0].user!.login : undefined;

  return { author, firstApprover };
}
