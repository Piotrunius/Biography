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
      const rlKey = `RL_steam_${ip}`;
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

      const privacyStatus = await env.STATE.get("PRIVACY_MODE");
      if (privacyStatus === "true") {
        return new Response(
          JSON.stringify({
            privacyMode: true,
            message: "Privacy Mode Active",
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const res = await fetch(
        `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${env.STEAM_API_KEY}&steamids=${env.STEAM_ID}`,
      );
      const data = await res.json();
      const player = data.response.players[0];

      return new Response(
        JSON.stringify({
          privacyMode: false,
          name: player.personaname,
          state: player.personastate,
          game: player.gameextrainfo,
          avatar: player.avatarfull,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    } catch (err) {
      console.error("Steam worker error:", err);
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: corsHeaders,
      });
    }
  },
};
