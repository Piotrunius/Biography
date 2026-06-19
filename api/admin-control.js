export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const allowedOrigins = [
      "https://piotrunius.github.io",
      "https://piotrunius.dev",
      "http://127.0.0.1:5500"
    ];
    
    // Choose allowed origin dynamically
    const corsOrigin = allowedOrigins.includes(origin) ? origin : "https://piotrunius.dev";
    
    const corsHeaders = {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    try {
      // 1. OCHRONA PRZED BRUTE-FORCE (Opóźnienie)
      // Każde zapytanie czeka losowo od 1 do 3 sekund przed odpowiedzią.
      const delay = Math.floor(Math.random() * 2000) + 1000;
      await new Promise(resolve => setTimeout(resolve, delay));

      const { password, action } = await request.json();

      // 2. Weryfikacja hasła
      if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
        return new Response(JSON.stringify({ success: false, message: "Access Denied" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 3. Logika przełączania
      let newState;
      const current = await env.STATE.get("PRIVACY_MODE");

      if (action === "toggle") {
        newState = current === "true" ? "false" : "true";
      } else if (action === "enable" || action === "on") {
        newState = "true";
      } else if (action === "disable" || action === "off") {
        newState = "false";
      } else {
        return new Response(JSON.stringify({ success: false, message: "Invalid command" }), {
          status: 400,
          headers: corsHeaders
        });
      }
      
      await env.STATE.put("PRIVACY_MODE", newState);

      return new Response(JSON.stringify({ 
        success: true, 
        privacyMode: newState === "true",
        message: `System updated. Privacy Mode: ${newState === "true" ? "ON" : "OFF"}` 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });

    } catch (e) {
      return new Response(JSON.stringify({ success: false, message: "Server Error" }), { 
        status: 500, 
        headers: corsHeaders 
      });
    }
  }
};
