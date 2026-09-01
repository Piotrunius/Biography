export default {
  async fetch(request, env) {
    const ALLOWED_ORIGIN = "https://piotrunius.dev";
    const corsHeaders = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
    };

    if (request.method === "OPTIONS")
      return new Response(null, { headers: corsHeaders });

    try {
      // Rate limiting: max 30 requests / 60 seconds / IP
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const rlKey = `RL_discord_${ip}`;
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

      // --- PRIVACY MODE CHECK ---
      const privacyStatus = await env.STATE.get("PRIVACY_MODE");
      if (privacyStatus === "true") {
        return new Response(
          JSON.stringify({ privacyMode: true, message: "Privacy Mode Active" }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const discordId = env.DISCORD_ID;
      if (!discordId) throw new Error("DISCORD_ID is not defined.");

      const res = await fetch(`https://api.lanyard.rest/v1/users/${discordId}`);
      const json = await res.json();
      if (!json.success) throw new Error("Lanyard API could not find user.");

      const data = json.data;
      const statusMap = {
        online: "Online",
        idle: "Idle",
        dnd: "Do Not Disturb",
        offline: "Offline",
      };

      const activities = data.activities
        .filter((a) => a.type !== 2)
        .map((a) => ({
          name: a.name,
          details: a.details || "",
          state: a.state || "",
          largeImage: a.assets?.large_image
            ? a.assets.large_image.startsWith("mp:external")
              ? a.assets.large_image.replace(
                  /mp:external\/.*\/https\//,
                  "https://",
                )
              : `https://cdn.discordapp.com/app-assets/${a.application_id}/${a.assets.large_image}.png`
            : null,
        }));

      const payload = {
        privacyMode: false,
        user: {
          username: data.discord_user.username,
          avatar: `https://cdn.discordapp.com/avatars/${data.discord_user.id}/${data.discord_user.avatar}.png`,
        },
        presence: {
          status: data.discord_status,
          statusText: statusMap[data.discord_status] || "Offline",
          isOnline: data.discord_status !== "offline",
        },
        activities: activities,
        timestamp: new Date().toISOString(),
      };

      return new Response(JSON.stringify(payload), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Discord Worker Error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};
