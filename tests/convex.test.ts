import { createHmac } from "node:crypto";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { currentPrUrl, equivalentPrUrls } from "../convex/githubPrUrls";

const mocks = vi.hoisted(() => ({
  getPr: vi.fn(),
  listReviews: vi.fn(),
  postMessage: vi.fn(),
}));

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(() => ({
    pulls: { get: mocks.getPr, listReviews: mocks.listReviews },
  })),
}));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: vi.fn(() => ({ mutation: mocks.postMessage })),
}));

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const secret = "test-webhook-secret";
const currentUrl = "https://github.com/convex/convex-backend/pull/123";
const legacyUrl = currentUrl.replace("/convex/", "/get-convex/");
let t: TestConvex<typeof schema>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubEnv("GITHUB_CREATE_WEBHOOK_SECRET", secret);
  vi.stubEnv("VESTABUDDY_KEY", "");
  t = convexTest(schema, modules);
});

afterEach(async () => {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function openedPr(owner = "convex") {
  return {
    action: "opened",
    pull_request: {
      html_url: `https://github.com/${owner}/convex-backend/pull/123`,
      user: { login: "requestor" },
      base: {
        label: `${owner}:release`,
        ref: "release",
        repo: { id: 1234, owner: { login: owner } },
      },
      head: {
        label: `${owner}:main`,
        ref: "main",
        repo: { id: 1234 },
      },
    },
  };
}

async function deliver(event: string, payload: unknown, signingKey = secret) {
  const body = JSON.stringify(payload);
  return t.fetch("/onPullRequestReview", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-hub-signature-256":
        "sha256=" + createHmac("sha256", signingKey).update(body).digest("hex"),
    },
  });
}

const rows = () => t.run((ctx) => ctx.db.query("release_prs").collect());

describe("GitHub webhook", () => {
  it.each(["convex", "get-convex"])(
    "records main → release PRs from %s and notifies Vesta once",
    async (owner) => {
      vi.stubEnv("VESTABUDDY_KEY", "vesta-test-key");
      const payload = openedPr(owner);
      expect((await deliver("pull_request", payload)).status).toBe(200);
      expect((await deliver("pull_request", payload)).status).toBe(200);
      expect(await rows()).toMatchObject([
        { url: currentUrl, requestor: "requestor" },
      ]);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(mocks.postMessage).toHaveBeenCalledTimes(1);
      expect(mocks.postMessage).toHaveBeenCalledWith(expect.anything(), {
        message: "requestor asks - Plz review: go/ship",
        duration: 60,
        serviceKey: "vesta-test-key",
      });
    }
  );

  it.each(["fork", "other organization", "other base", "other head", "closed"])(
    "ignores %s PRs",
    async (kind) => {
      const payload = openedPr(kind === "other organization" ? "other" : "convex");
      if (kind === "fork") payload.pull_request.head.repo.id = 9999;
      if (kind === "other base") payload.pull_request.base.ref = "main";
      if (kind === "other head") payload.pull_request.head.ref = "feature";
      if (kind === "closed") payload.action = "closed";
      expect((await deliver("pull_request", payload)).status).toBe(200);
      expect(await rows()).toEqual([]);
    }
  );

  it("rejects an invalid signature before writing", async () => {
    await expect(deliver("pull_request", openedPr(), "wrong-secret"))
      .rejects.toThrow("Mismatched signatures");
    expect(await rows()).toEqual([]);
  });

  it.each(["ping", "push"])("acknowledges %s without writing", async (event) => {
    expect((await deliver(event, {})).status).toBe(200);
    expect(await rows()).toEqual([]);
  });

  it("matches a review under the new organization to a historical row", async () => {
    await t.run((ctx) => ctx.db.insert("release_prs", {
      url: legacyUrl,
      requestor: "requestor",
    }));
    expect((await deliver("pull_request_review", {
      action: "submitted",
      review: { state: "approved", user: { login: "reviewer" } },
      pull_request: { html_url: currentUrl },
    })).status).toBe(200);
    expect(await rows()).toMatchObject([{ approver: "reviewer" }]);
  });

  it.each(["commented", "changes_requested"])("ignores a %s review", async (state) => {
    await t.run((ctx) => ctx.db.insert("release_prs", { url: currentUrl }));
    await deliver("pull_request_review", {
      action: "submitted",
      review: { state, user: { login: "reviewer" } },
      pull_request: { html_url: currentUrl },
    });
    expect((await rows())[0].approver).toBeUndefined();
  });
});

describe("release PR queries and mutations", () => {
  it("deduplicates an old PR even after a newer PR has been recorded", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("release_prs", { url: legacyUrl, requestor: "original" });
      await ctx.db.insert("release_prs", { url: currentUrl + "4", requestor: "newer" });
    });
    await t.mutation(internal.releasePrs.updateLatestReleasePR, {
      latestPrUrl: currentUrl,
      requestor: "redelivery",
    });
    expect(await rows()).toHaveLength(2);
    expect(await t.query(internal.releasePrs.getLatestReleasePR, {}))
      .toMatchObject({ requestor: "newer" });
    expect(mocks.postMessage).not.toHaveBeenCalled();
  });

  it("matches old review URLs to new rows and preserves the first approver", async () => {
    await t.run((ctx) => ctx.db.insert("release_prs", { url: currentUrl }));
    for (const approver of ["first", "second"]) {
      await t.mutation(internal.releasePrs.markApproved, { prUrl: legacyUrl, approver });
    }
    expect(await rows()).toMatchObject([{ approver: "first" }]);
  });

  it("ignores reviews for untracked PRs", async () => {
    await t.mutation(internal.releasePrs.markApproved, { prUrl: currentUrl, approver: "other" });
    expect(await rows()).toEqual([]);
  });

  it("preserves historical approval and requestor scores", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("release_prs", { url: legacyUrl, approver: "first", requestor: "author" });
      await ctx.db.insert("release_prs", { url: currentUrl, approver: "first" });
      await ctx.db.insert("release_prs", { url: currentUrl + "4", approver: "second", requestor: "author" });
    });
    expect(await t.query(internal.releasePrs.highScores, {})).toEqual({
      sortedApprovers: [{ name: "first", count: 2 }, { name: "second", count: 1 }],
      sortedRequestors: [{ name: "author", count: 2 }],
    });
  });
});

describe("redirectLatest", () => {
  it.each([legacyUrl, currentUrl])("redirects %s to the current organization", async (url) => {
    await t.run((ctx) => ctx.db.insert("release_prs", { url }));
    const response = await t.fetch("/redirectLatest");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(currentUrl);
  });

  it("returns 404 when there are no release PRs", async () => {
    expect((await t.fetch("/redirectLatest")).status).toBe(404);
  });
});

describe("backfill", () => {
  it("keeps a recorded approval when backfill finds no approver", async () => {
    const id = await t.run((ctx) => ctx.db.insert("release_prs", {
      url: legacyUrl,
      approver: "recorded-reviewer",
    }));
    await t.mutation(internal.backfillRequestors.backfillWriter, { id, author: "author" });
    expect(await rows()).toMatchObject([{ requestor: "author", approver: "recorded-reviewer" }]);
  });

  it.each([legacyUrl, currentUrl])("fetches %s from the current GitHub organization", async (url) => {
    mocks.getPr.mockResolvedValue({ data: { user: { login: "author" } } });
    mocks.listReviews.mockResolvedValue({ data: [
      { state: "COMMENTED", user: { login: "commenter" } },
      { state: "APPROVED", user: { login: "first" } },
      { state: "APPROVED", user: { login: "second" } },
    ] });
    await t.run((ctx) => ctx.db.insert("release_prs", { url }));
    await t.action(internal.backfillRequestors.backfill, {});
    const args = { owner: "convex", repo: "convex-backend", pull_number: 123 };
    expect(mocks.getPr).toHaveBeenCalledWith(args);
    expect(mocks.listReviews).toHaveBeenCalledWith(args);
    expect(await rows()).toMatchObject([{ url, requestor: "author", approver: "first" }]);
    await t.action(internal.backfillRequestors.backfill, {});
    expect(mocks.getPr).toHaveBeenCalledTimes(1);
  });

  it("leaves the approver unset when there are no approvals", async () => {
    mocks.getPr.mockResolvedValue({ data: { user: { login: "author" } } });
    mocks.listReviews.mockResolvedValue({ data: [] });
    await t.run((ctx) => ctx.db.insert("release_prs", { url: legacyUrl }));
    await t.action(internal.backfillRequestors.backfill, {});
    expect(await rows()).toMatchObject([{ requestor: "author" }]);
    expect((await rows())[0].approver).toBeUndefined();
  });
});

it("skips Vesta posting when no service key is configured", async () => {
  await t.action(internal.vesta.postToVestabuddy, { requestor: "author" });
  expect(mocks.postMessage).not.toHaveBeenCalled();
});

it("leaves other GitHub organizations and lookalike hosts untouched", () => {
  for (const url of [
    "https://github.com/other/convex-backend/pull/123",
    "https://github.com/get-convex-extra/convex-backend/pull/123",
    "https://example.com/get-convex/convex-backend/pull/123",
  ]) {
    expect(currentPrUrl(url)).toBe(url);
    expect(equivalentPrUrls(url)).toEqual([url]);
  }
});
