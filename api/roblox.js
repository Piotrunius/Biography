export default {
  async fetch(request, env) {
    const ALLOWED_ORIGIN = "https://piotrunius.dev";
    const corsHeaders = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS")
      return new Response(null, { headers: corsHeaders });

    try {
      // Rate limiting: max 30 requestów / 60 sekund / IP
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const rlKey = `RL_roblox_${ip}`;
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

      const userId = env.ROBLOX_USER_ID;
      const [presenceRes, thumbRes] = await Promise.all([
        fetch("https://presence.roblox.com/v1/presence/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userIds: [parseInt(userId)] }),
        }),
        fetch(
          `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png`,
        ),
      ]);

      const pData = await presenceRes.json();
      const tData = await thumbRes.json();
      const p = pData.userPresences[0];

      return new Response(
        JSON.stringify({
          privacyMode: false,
          status: p.userPresenceType,
          location: p.lastLocation,
          avatar: tData.data[0]?.imageUrl,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: corsHeaders,
      });
    }
  },
};
