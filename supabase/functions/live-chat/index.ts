const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const RETRY_DELAY_MS = 2000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Very short system prompt to save tokens
const SYSTEM_PROMPT = `তুমি RS Anime-এর AI সাপোর্ট "RS Bot"। সংক্ষিপ্ত ও বন্ধুত্বপূর্ণ উত্তর দাও। ইমোজি ব্যবহার করো।
- RS Anime = Hindi Dubbed anime streaming site
- Series ও Movies আছে। 480p-4K quality।
- Premium: bKash দিয়ে কিনতে পারে, ad-free দেখা যায়।
- Admin-এর সাথে কথা বলতে @RS লিখতে বলো।
- Telegram: https://t.me/RS_WONER
- বাটন ফরম্যাট: [BTN:label:LINK:url]
- যোগাযোগ বাটন: [BTN:🛡️ Admin:LINK:https://t.me/RS_WONER]`;

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
      .slice(-4) // Only last 4 messages
      .map((msg: any) => ({
        role: msg.role,
        content: String(msg.content).trim().slice(0, 500),
      }));

    const GROQ_API_KEY = Deno.env.get("GROK_API_KEY");
    if (!GROQ_API_KEY) {
      throw new Error("GROK_API_KEY is not configured");
    }

    const grokMessages = [
      { role: "system", content: SYSTEM_PROMPT },
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
          model: "llama-3.3-70b-versatile",
          messages: grokMessages,
          temperature: 0.5,
          max_tokens: 300, // Short replies to save quota
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
