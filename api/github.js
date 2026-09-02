export default {
  async fetch(request, env) {
    const ALLOWED_ORIGIN = "https://piotrunius.dev";
    const corsHeaders = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
    };

    if (request.method === "OPTIONS")
      return new Response(null, { headers: corsHeaders });

    try {
      // 1. Rate limiting: max 30 requests / 60 seconds / IP
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const rlKey = `RL_github_${ip}`;
      const now = Date.now();
      let rl = null;
      try {
        rl = await env.STATE.get(rlKey, { type: "json" });
      } catch (_) {}
      if (rl && now - rl.w < 60_000) {
        if (rl.c >= 30) {
          return new Response(JSON.stringify({ error: "Too Many Requests" }), {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        await env.STATE.put(rlKey, JSON.stringify({ c: rl.c + 1, w: rl.w }), {
          expirationTtl: 120,
        });
      } else {
        await env.STATE.put(rlKey, JSON.stringify({ c: 1, w: now }), {
          expirationTtl: 120,
        });
      }

      // 2. Check privacy mode from KV database
      const privacyStatus = await env.STATE.get("PRIVACY_MODE");

      if (privacyStatus === "true") {
        return new Response(
          JSON.stringify({
            privacyMode: true,
            message: "Privacy Mode Active",
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const gUser = env.GITHUB_USERNAME || "Piotrunius";
      const gHeaders = {
        Authorization: `token ${env.GITHUB_TOKEN}`,
        "User-Agent": "Cloudflare-Worker",
        Accept: "application/vnd.github.v3+json",
      };

      // 2. Fetch resources
      const [uR, reposR, starredR] = await Promise.all([
        fetch(`https://api.github.com/user`, { headers: gHeaders }),
        fetch(
          `https://api.github.com/user/repos?per_page=50&sort=updated&visibility=all`,
          {
            headers: gHeaders,
          },
        ),
        fetch(`https://api.github.com/user/starred?per_page=30`, {
          headers: { ...gHeaders, Accept: "application/vnd.github.star+json" },
        }),
      ]);

      const uJ = await uR.json();
      const repos = await reposR.json();
      const starred = await starredR.json();

      // 2b. Fetch accurate contribution count via GraphQL calendar.
      // The REST /search/commits endpoint has a notoriously stale index that
      // lags days-to-weeks behind, so we use the contribution calendar instead
      // (GraphQL counts commits/PRs/issues across the last 12 months).
      const gql = await fetch(`https://api.github.com/graphql`, {
        method: "POST",
        headers: { ...gHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `
            query($login: String!) {
              user(login: $login) {
                contributionsCollection {
                  totalCommitContributions
                  totalPullRequestReviewContributions
                  totalPullRequestContributions
                  totalIssueContributions
                  totalRepositoryContributions
                }
              }
            }
          `,
          variables: { login: gUser },
        }),
      });
      let totalCommits = 0;
      if (gql.ok) {
        const gqlJson = await gql.json();
        const contribs = gqlJson?.data?.user?.contributionsCollection || {};
        totalCommits =
          (contribs.totalCommitContributions || 0) +
          (contribs.totalPullRequestContributions || 0) +
          (contribs.totalIssueContributions || 0);
      }
      // 4. Fetch recent commits (only public repos)
      const publicRepos = Array.isArray(repos)
        ? repos.filter((r) => !r.private).slice(0, 5)
        : [];
      const commitPromises = publicRepos.map(async (repo) => {
        try {
          const res = await fetch(
            `https://api.github.com/repos/${repo.owner.login}/${repo.name}/commits?author=${gUser}&per_page=5`,
            { headers: gHeaders },
          );
          if (!res.ok) return [];
          const commits = await res.json();
          return commits.map((c) => ({
            message: c.commit.message.split("\n")[0],
            repo: repo.name,
            author: gUser,
            date: c.commit.author.date,
            url: c.html_url,
          }));
        } catch (e) {
          return [];
        }
      });

      const allCommitsArrays = await Promise.all(commitPromises);
      const recentCommitsList = allCommitsArrays
        .flat()
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 15);

      // 5. Build final payload
      const payload = {
        privacyMode: false,
        summary: {
          projects: Array.isArray(repos) ? repos.length : 0,
          followers: uJ.followers || 0,
          commits: totalCommits,
        },
        projects: Array.isArray(repos)
          ? repos.map((r) => ({
              name: r.name,
              description: r.description || "No description provided.",
              lang: r.language || "Mixed",
              url: r.html_url,
              fork: r.fork || false,
            }))
          : [],
        starred: Array.isArray(starred)
          ? starred.map((i) => ({
              name: i.repo?.name,
              owner: i.repo?.owner?.login,
              description: i.repo?.description,
              stars: i.repo?.stargazers_count,
              language: i.repo?.language || "Code",
              url: i.repo?.html_url,
            }))
          : [],
        recentCommits: recentCommitsList,
        lastUpdate: new Date().toISOString(),
      };

      return new Response(JSON.stringify(payload), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: "GitHub Worker Error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};
