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

      const rawUserId = env.ROBLOX_USER_ID || "962249141";
      const userId = parseInt(rawUserId, 10);

      const robloxHeaders = {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "application/json",
      };

      // 1. Resolve avatar (cached in KV to avoid Roblox 429 rate limits)
      let avatar = null;
      try {
        avatar = await env.STATE.get("ROBLOX_AVATAR");
      } catch (_) {}

      const fetchThumbPromise = (async () => {
        if (avatar) return avatar;
        try {
          const res = await fetch(
            `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png`,
            { headers: robloxHeaders },
          );
          if (res.ok) {
            const data = await res.json();
            const fetched =
              Array.isArray(data?.data) && data.data.length > 0
                ? data.data[0]?.imageUrl
                : null;
            if (fetched) {
              try {
                await env.STATE.put("ROBLOX_AVATAR", fetched, {
                  expirationTtl: 604800, // 7 days
                });
              } catch (_) {}
              return fetched;
            }
          } else {
            console.warn(`Roblox thumbnail API returned HTTP ${res.status}`);
          }
        } catch (e) {
          console.error("Roblox thumbnail fetch error:", e);
        }
        return (
          avatar ||
          "https://tr.rbxcdn.com/30DAY-AvatarHeadshot-7C93DDB1F9A5537F7B4E7C6FF1C5A3B2-Png/150/150/AvatarHeadshot/Png/noFilter"
        );
      })();

      // 2. Resolve presence (with KV cache fallback on failure/rate limit)
      const fetchPresencePromise = (async () => {
        try {
          const res = await fetch(
            "https://presence.roblox.com/v1/presence/users",
            {
              method: "POST",
              headers: {
                ...robloxHeaders,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ userIds: [userId] }),
            },
          );
          if (res.ok) {
            const data = await res.json();
            const p =
              Array.isArray(data?.userPresences) && data.userPresences.length > 0
                ? data.userPresences[0]
                : null;
            if (p) {
              const state = {
                status: p.userPresenceType,
                location: p.lastLocation || "Offline",
                game: p.userPresenceType === 2 ? p.lastLocation : null,
              };
              try {
                await env.STATE.put(
                  "ROBLOX_PRESENCE_CACHE",
                  JSON.stringify(state),
                  {
                    expirationTtl: 300, // 5 min TTL
                  },
                );
              } catch (_) {}
              return state;
            }
          } else {
            console.warn(`Roblox presence API returned HTTP ${res.status}`);
          }
        } catch (e) {
          console.error("Roblox presence fetch error:", e);
        }

        // Fallback to cached presence if live call fails
        try {
          const cached = await env.STATE.get("ROBLOX_PRESENCE_CACHE", {
            type: "json",
          });
          if (cached) return cached;
        } catch (_) {}

        return { status: 0, location: "Offline", game: null };
      })();

      const [resolvedAvatar, resolvedPresence] = await Promise.all([
        fetchThumbPromise,
        fetchPresencePromise,
      ]);

      return new Response(
        JSON.stringify({
          privacyMode: false,
          status: resolvedPresence.status,
          location: resolvedPresence.location,
          game: resolvedPresence.game,
          avatar: resolvedAvatar,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    } catch (err) {
      console.error("Roblox worker error:", err);
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};
