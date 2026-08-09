export default {
  async fetch(request, env) {
    const ALLOWED_ORIGIN = "https://piotrunius.dev";
    const corsHeaders = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Rate limiting: max 30 requestów / 60 sekund / IP
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const rlKey = `RL_spotify_${ip}`;
      const rlNow = Date.now();
      let rl = null;
      try { rl = await env.STATE.get(rlKey, { type: "json" }); } catch (_) {}
      if (rl && rlNow - rl.w < 60_000) {
        if (rl.c >= 30) {
          return new Response(JSON.stringify({ error: "Too Many Requests" }), {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        await env.STATE.put(rlKey, JSON.stringify({ c: rl.c + 1, w: rl.w }), { expirationTtl: 120 });
      } else {
        await env.STATE.put(rlKey, JSON.stringify({ c: 1, w: rlNow }), { expirationTtl: 120 });
      }

      // 1) Privacy mode check
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

      // Helper: base64 for Basic auth (btoa exists in Workers)
      const base64 = (str) =>
        typeof btoa === "function"
          ? btoa(str)
          : Buffer.from(str).toString("base64");

      // 2) Get cached token from KV if valid
      let tokenData = null;
      try {
        tokenData = await env.STATE.get("SPOTIFY_TOKEN", { type: "json" });
      } catch (e) {
        // KV might not support type option in some environments; ignore and parse below
        const raw = await env.STATE.get("SPOTIFY_TOKEN");
        if (raw) {
          try {
            tokenData = JSON.parse(raw);
          } catch (err) {
            tokenData = null;
          }
        }
      }

      const now = Date.now();
      let accessToken =
        tokenData &&
        tokenData.access_token &&
        tokenData.expires_at &&
        tokenData.expires_at > now + 5000
          ? tokenData.access_token
          : null;

      // 3) Refresh token if we don't have a valid one
      if (!accessToken) {
        const clientId = env.SPOTIFY_CLIENT_ID;
        const clientSecret = env.SPOTIFY_CLIENT_SECRET;
        const refreshToken = env.SPOTIFY_REFRESH_TOKEN;

        if (!clientId || !clientSecret || !refreshToken) {
          throw new Error("Spotify credentials not configured");
        }

        const auth = base64(`${clientId}:${clientSecret}`);
        const tokenResponse = await fetch(
          "https://accounts.spotify.com/api/token",
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${auth}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              grant_type: "refresh_token",
              refresh_token: refreshToken,
            }),
          },
        );

        const tokenText = await tokenResponse.text();
        if (!tokenResponse.ok) {
          throw new Error(
            `Token fetch failed [${tokenResponse.status}]: ${tokenText}`,
          );
        }

        const fresh = JSON.parse(tokenText);
        accessToken = fresh.access_token;
        const expiresIn = fresh.expires_in || 3600;
        const expires_at = Date.now() + expiresIn * 1000;

        // Cache token in KV (best-effort)
        try {
          const storeObj = {
            access_token: accessToken,
            expires_at,
          };
          // store as JSON string
          await env.STATE.put("SPOTIFY_TOKEN", JSON.stringify(storeObj));
        } catch (e) {
          // swallow caching errors (don't fail entire request)
          console.warn("Failed to cache Spotify token:", e);
        }
      }

      // 4) Query Spotify currently-playing
      const nowPlayingRes = await fetch(
        "https://api.spotify.com/v1/me/player/currently-playing",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      // 204 = no content (not currently playing)
      if (nowPlayingRes.status === 204) {
        return new Response(
          JSON.stringify({ isPlaying: false, privacyMode: false }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const songText = await nowPlayingRes.text();
      if (!nowPlayingRes.ok) {
        throw new Error(
          `Spotify API failed [${nowPlayingRes.status}]: ${songText}`,
        );
      }

      const song = JSON.parse(songText);

      // Defensively extract fields (some fields may be null)
      const item = song && song.item ? song.item : null;
      if (!item) {
        return new Response(
          JSON.stringify({ isPlaying: false, privacyMode: false }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const title = item.name || "";
      const artist = Array.isArray(item.artists)
        ? item.artists
            .map((a) => a.name)
            .filter(Boolean)
            .join(", ")
        : item.artists && item.artists.name
          ? item.artists.name
          : "";
      const album = (item.album && item.album.name) || "";
      const albumArt =
        (item.album &&
          item.album.images &&
          item.album.images[0] &&
          item.album.images[0].url) ||
        "";
      const externalUrl =
        (item.external_urls && item.external_urls.spotify) || "";
      const trackUrl = externalUrl || item.uri || "";

      const progressMs = song.progress_ms ?? song.progressMs ?? 0;
      const durationMs = item.duration_ms ?? item.durationMs ?? 0;

      const responsePayload = {
        privacyMode: false,
        isPlaying: !!song.is_playing,
        title,
        artist,
        album,
        albumArt,
        url: externalUrl,
        songUrl: trackUrl,
        progressMs,
        durationMs,
      };

      return new Response(JSON.stringify(responsePayload), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err) {
      // Keep the error message concise
      const errMsg = err && err.message ? err.message : String(err);
      return new Response(JSON.stringify({ error: errMsg }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};
