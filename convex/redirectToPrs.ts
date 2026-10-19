import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { currentPrUrl } from "./githubPrUrls";

export const redirectToLatestPr = httpAction(async (ctx) => {
  const latestPr = await ctx.runQuery(
    internal.releasePrs.getLatestReleasePR,
    {}
  );

  if (latestPr) {
    return Response.redirect(currentPrUrl(latestPr.url), 302);
  } else {
    return new Response(null, {
      status: 404,
    });
  }
});
