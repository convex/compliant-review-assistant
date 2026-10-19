import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

export const handleGithubPullRequestWebhook = httpAction(
  async ({ runMutation }, request) => {
    // console.log("Got request", request);
    const payload = await request.text();

    const signingSecret = process.env.GITHUB_CREATE_WEBHOOK_SECRET;
    if (!signingSecret) {
      throw Error("Missing github create webhook signing secret");
    }
    const headerSignatureWithPrefix = request.headers.get(
      "X-Hub-Signature-256"
    );
    if (!headerSignatureWithPrefix) {
      throw Error("Missing signature in header");
    }
    // "sha256=xyz" => "xyz";
    const calculatedSignature = await hmacSha256(signingSecret, payload);
    if (headerSignatureWithPrefix !== `sha256=${calculatedSignature}`) {
      throw Error("Mismatched signatures!");
    }

    const githubEvent = request.headers.get("x-github-event");
    if (!githubEvent) {
      throw Error("Missing event!");
    }
    if (githubEvent === "ping" || githubEvent === "push") {
      return new Response(null, {
        status: 200,
      });
    } else if (githubEvent === "pull_request") {
      const json = JSON.parse(payload);
      const pr = json.pull_request;
      const owner = pr.base.repo.owner.login;
      if (
        json.action === "opened" &&
        (owner === "convex" || owner === "get-convex") &&
        pr.base.ref === "release" &&
        pr.head.ref === "main" &&
        pr.head.repo?.id === pr.base.repo.id &&
        pr.user?.login
      ) {
        await runMutation(internal.releasePrs.updateLatestReleasePR, {
          requestor: json.pull_request.user.login,
          latestPrUrl: json.pull_request.html_url,
        });
      } else {
        //console.log("Ignoring unrecognized PR event to ", json.number);
      }
      return new Response(null, {
        status: 200,
      });
    } else if (githubEvent === "pull_request_review") {
      const json = JSON.parse(payload);
      if (json.action === "submitted" && json.review.state == "approved") {
        const approver = json.review.user.login;
        const prUrl = json.pull_request.html_url;
        console.log(`PR ${prUrl} approved by ${approver}`);
        await runMutation(internal.releasePrs.markApproved, {
          approver,
          prUrl,
        });
      }
      return new Response(null, {
        status: 200,
      });
    } else {
      console.error(`Unrecognized github event: ${githubEvent}`);
      return new Response(null, {
        status: 200,
      });
    }
  }
);

async function hmacSha256(key: string, content: string) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    {
      name: "HMAC",
      hash: { name: "SHA-256" },
    },
    false,
    ["sign", "verify"]
  );
  const digest = await crypto.subtle.sign(
    {
      name: "HMAC",
      hash: { name: "SHA-256" },
    },
    cryptoKey,
    enc.encode(content)
  );
  const digestBytes = new Uint8Array(digest);
  // Use prototype.map so that we can change the type from number -> string.
  return Array.prototype.map
    .call(digestBytes, (x) => x.toString(16).padStart(2, "0"))
    .join("");
}
