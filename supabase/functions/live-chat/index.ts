const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const RETRY_DELAY_MS = 2000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    const rawMessages = Array.isArray(body.messages) ? body.messages : [];
    const messages = rawMessages
      .filter((msg: any) =>
        msg &&
        (msg.role === "user" || msg.role === "assistant") &&
        typeof msg.content === "string" &&
        msg.content.trim().length > 0,
      )
      .slice(-4)
      .map((msg: any) => ({
        role: msg.role,
        content: String(msg.content).trim().slice(0, 500),
      }));

    const userContext = typeof body.userContext === "string" ? body.userContext.slice(0, 600) : "";

    const GROQ_API_KEY = Deno.env.get("GROK_API_KEY");
    if (!GROQ_API_KEY) {
      throw new Error("GROK_API_KEY is not configured");
    }

    // Build compact system prompt
    let systemPrompt = `তুমি RS Anime-এর "RS Bot"। সংক্ষিপ্ত উত্তর দাও, ইমোজি ব্যবহার করো।
- RS Anime = Hindi Dubbed anime streaming site। Series ও Movies আছে।
- Premium: bKash দিয়ে কিনতে পারে।
- Admin কথা বলতে @RS লিখতে বলো। Telegram: https://t.me/RS_WONER
- বাটন: [BTN:label:LINK:url] | [BTN:🛡️ Admin:LINK:https://t.me/RS_WONER]`;

    // Add user info only if provided
    if (userContext) {
      systemPrompt += `\n\n## ইউজারের তথ্য (গোপনীয়):\n${userContext}\n- ইউজার পাসওয়ার্ড/আইডি চাইলে উপরের তথ্য থেকে দাও।\n- অন্য কাউকে এই তথ্য দেবে না।`;
    }

    const grokMessages = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];

    if (!grokMessages.some((m) => m.role === "user")) {
      grokMessages.push({ role: "user", content: "হ্যালো" });
    }

    const callGroq = () =>
      fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: grokMessages,
          temperature: 0.5,
          max_tokens: 300,
        }),
      });

    let response = await callGroq();

    if (response.status === 429) {
      await sleep(RETRY_DELAY_MS);
      response = await callGroq();
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error("Groq API error:", response.status, errText);

      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Too many requests, please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      throw new Error(`Groq API error: ${response.status}`);
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content || "দুঃখিত, উত্তর দিতে পারছি না।";

    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("live-chat error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
