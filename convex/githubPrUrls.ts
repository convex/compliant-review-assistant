// Keep historical rows usable after the GitHub organization rename, without
// rewriting the database or relying on GitHub's redirects.
export function currentPrUrl(url: string): string {
  return url.replace(
    /^https:\/\/github\.com\/get-convex\//,
    "https://github.com/convex/"
  );
}

export function equivalentPrUrls(url: string): string[] {
  const current = currentPrUrl(url);
  const legacy = current.replace(
    /^https:\/\/github\.com\/convex\//,
    "https://github.com/get-convex/"
  );
  return current === legacy ? [current] : [current, legacy];
}
