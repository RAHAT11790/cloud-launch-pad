const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const RETRY_DELAY_MS = 2000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type ChatMessage = { role: "user" | "assistant"; content: string };

const extractField = (context: string, label: string) => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = context.match(new RegExp(`^${escaped}:\\s*(.+)$`, "mi"));
  return match?.[1]?.trim() || "";
};

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[!?.,/\\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const hasAny = (text: string, patterns: string[]) => patterns.some((pattern) => text.includes(pattern));

const buildDirectReply = (userMessage: string, userContext: string) => {
  if (!userContext) return null;

  const text = normalize(userMessage);
  const name = extractField(userContext, "ইউজার নাম") || "আপনি";
  const email = extractField(userContext, "ইমেইল");
  const password = extractField(userContext, "বর্তমান পাসওয়ার্ড");
  const premiumStatus = extractField(userContext, "প্রিমিয়াম স্ট্যাটাস");
  const premiumExpiry = extractField(userContext, "প্রিমিয়াম মেয়াদ");
  const deviceLimit = extractField(userContext, "ডিভাইস লিমিট");
  const activeDevices = extractField(userContext, "সক্রিয় ডিভাইস");

  const asksPassword = hasAny(text, ["password", "pass", "পাসওয়ার্ড", "পাস", "id pass", "আইডি পাস"]);
  const asksEmail = hasAny(text, ["email", "gmail", "mail", "ইমেইল", "id", "আইডি"]);
  const asksPremium = hasAny(text, ["premium", "প্রিমিয়াম", "subscription", "সাবস্ক্রিপশন"]);
  const asksExpiry = hasAny(text, ["expire", "expiry", "দিন বাকি", "মেয়াদ", "কত দিন", "valid"]);
  const asksDevices = hasAny(text, ["device", "ডিভাইস", "limit", "লিমিট"]);

  if (asksPassword && asksEmail) {
    return `${name}, আপনার লগইন তথ্য:\n• ইমেইল/আইডি: ${email || "পাওয়া যায়নি"}\n• পাসওয়ার্ড: ${password || "সেট করা নেই"} 🔐`;
  }

  if (asksPassword) {
    return password
      ? `${name}, আপনার বর্তমান পাসওয়ার্ড: ${password} 🔐`
      : `${name}, আপনার অ্যাকাউন্টে কোনো পাসওয়ার্ড সেট করা নেই।`;
  }

  if (asksEmail) {
    return email
      ? `${name}, আপনার লগইন ইমেইল/আইডি: ${email} 📩`
      : `${name}, আপনার লগইন ইমেইল/আইডি পাওয়া যায়নি।`;
  }

  if (asksPremium || asksExpiry || asksDevices) {
    const parts = [
      premiumStatus ? `• ${premiumStatus}` : "",
      premiumExpiry ? `• ${premiumExpiry}` : "",
      deviceLimit ? `• ডিভাইস লিমিট: ${deviceLimit}` : "",
      activeDevices ? `• সক্রিয় ডিভাইস: ${activeDevices}` : "",
    ].filter(Boolean);

    if (parts.length > 0) {
      return `${name}, আপনার প্রিমিয়াম তথ্য:\n${parts.join("\n")} ✨`;
    }
  }

  return null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    const rawMessages = Array.isArray(body.messages) ? body.messages : [];
    const messages: ChatMessage[] = rawMessages
      .filter((msg: any) =>
        msg &&
        (msg.role === "user" || msg.role === "assistant") &&
        typeof msg.content === "string" &&
        msg.content.trim().length > 0,
      )
      .slice(-2)
      .map((msg: any) => ({
        role: msg.role,
        content: String(msg.content).trim().slice(0, 280),
      }));

    const userContext = typeof body.userContext === "string" ? body.userContext.slice(0, 600) : "";
    const latestUserMessage = [...messages].reverse().find((msg) => msg.role === "user")?.content || "হ্যালো";

    const directReply = buildDirectReply(latestUserMessage, userContext);
    if (directReply) {
      return new Response(JSON.stringify({ reply: directReply, source: "local" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const GROQ_API_KEY = Deno.env.get("GROK_API_KEY");
    if (!GROQ_API_KEY) {
      throw new Error("GROQ_API_KEY is not configured");
    }

    let systemPrompt = `তুমি RS Anime-এর "RS Bot"। খুব সংক্ষিপ্ত, কাজে লাগে এমন উত্তর দাও। ইমোজি ব্যবহার করো।
- RS Anime একটি Hindi Dubbed anime streaming site।
- Premium bKash দিয়ে কেনা যায়।
- Admin-এর সাথে কথা বলতে @RS লিখতে বলো।
- Telegram: https://t.me/RS_WONER
- বাটন ফরম্যাট: [BTN:label:LINK:url]`;

    if (userContext) {
      systemPrompt += `\n- যদি ইউজার তার নিজের অ্যাকাউন্ট, পাসওয়ার্ড, ইমেইল, প্রিমিয়াম বা ডিভাইস সম্পর্কে জিজ্ঞাসা করে, নিচের তথ্যই শুধু ব্যবহার করবে:\n${userContext}`;
    }

    const groqMessages = [{ role: "system", content: systemPrompt }, ...messages];

    const callGroq = () =>
      fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: groqMessages,
          temperature: 0.4,
          max_tokens: 180,
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
        return new Response(JSON.stringify({
          reply: "এই মুহূর্তে AI একটু ব্যস্ত আছে। ১০–১৫ সেকেন্ড পরে আবার চেষ্টা করুন, অথবা @RS লিখে Admin-কে মেসেজ করুন।",
          source: "fallback",
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      throw new Error(`Groq API error: ${response.status}`);
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content || "দুঃখিত, উত্তর দিতে পারছি না।";

    return new Response(JSON.stringify({ reply, source: "groq" }), {
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
