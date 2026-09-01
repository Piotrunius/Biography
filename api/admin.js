function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

async function verifyPassword(password, storedHash) {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("crypto.subtle is not available");
  }
  const encoder = new TextEncoder();
  const passwordHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(password)),
  );
  const storedBytes = hexToBytes(storedHash);
  return constantTimeEqual(passwordHash, storedBytes);
}

export default {
  async fetch(request, env) {
    const ALLOWED_ORIGIN = "https://piotrunius.dev";

    const corsHeaders = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
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
      // 1. IP lockout - block after 5 failed attempts for 15 minutes
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

      // 2. Brute-force delay (1-3 seconds)
      const delay = Math.floor(Math.random() * 2000) + 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));

      const { password, action } = await request.json();

      // 3. Password verification
      if (
        !env.ADMIN_PASSWORD ||
        !(await verifyPassword(password, env.ADMIN_PASSWORD))
      ) {
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

      // 4. Reset counter after correct password
      await env.STATE.delete(lockKey);

      // 5. Toggle logic
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
