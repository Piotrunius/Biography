export default {
  async fetch(request, env) {
    const ALLOWED_ORIGIN = "https://piotrunius.dev";

    const corsHeaders = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: corsHeaders,
      });
    }

    try {
      // 1. IP lockout — blokada po 5 nieudanych próbach przez 15 minut
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const lockKey = `ADMIN_FAIL_${ip}`;
      const now = Date.now();
      let lockData = null;
      try {
        lockData = await env.STATE.get(lockKey, { type: "json" });
      } catch (_) {}

      if (lockData?.lockedUntil && lockData.lockedUntil > now) {
        const remaining = Math.ceil((lockData.lockedUntil - now) / 60_000);
        return new Response(
          JSON.stringify({
            success: false,
            message: `Too many attempts. Try again in ${remaining} minute(s).`,
          }),
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // 2. Opóźnienie brute-force (1–3 sekundy)
      const delay = Math.floor(Math.random() * 2000) + 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));

      const { password, action } = await request.json();

      // 3. Weryfikacja hasła
      if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
        const attempts = (lockData?.count || 0) + 1;
        const newLock =
          attempts >= 5
            ? { count: attempts, lockedUntil: now + 15 * 60_000 }
            : { count: attempts, lockedUntil: null };
        await env.STATE.put(lockKey, JSON.stringify(newLock), {
          expirationTtl: 900,
        });

        return new Response(
          JSON.stringify({ success: false, message: "Access Denied" }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // 4. Reset licznika po poprawnym haśle
      await env.STATE.delete(lockKey);

      // 5. Logika przełączania
      let newState;
      const current = await env.STATE.get("PRIVACY_MODE");

      if (action === "toggle") {
        newState = current === "true" ? "false" : "true";
      } else if (action === "enable" || action === "on") {
        newState = "true";
      } else if (action === "disable" || action === "off") {
        newState = "false";
      } else {
        return new Response(
          JSON.stringify({ success: false, message: "Invalid command" }),
          {
            status: 400,
            headers: corsHeaders,
          },
        );
      }

      await env.STATE.put("PRIVACY_MODE", newState);

      return new Response(
        JSON.stringify({
          success: true,
          privacyMode: newState === "true",
          message: `System updated. Privacy Mode: ${newState === "true" ? "ON" : "OFF"}`,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    } catch (e) {
      return new Response(
        JSON.stringify({ success: false, message: "Server Error" }),
        {
          status: 500,
          headers: corsHeaders,
        },
      );
    }
  },
};
