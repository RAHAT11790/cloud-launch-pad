const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    
    // Support both old format (message + systemPrompt + messages) and new format (messages + animeContext + userContext)
    const messages = body.messages || [];
    const animeContext = body.animeContext || "";
    const userContext = body.userContext || "";
    const systemPrompt = body.systemPrompt || "";
    const userMessage = body.message || "";

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not configured");
    }

    // Build user section from userContext
    const userSection = userContext
      ? `\n## 🔐 বর্তমান লগইন করা ইউজারের ব্যক্তিগত তথ্য:
${userContext}

### ইউজার সহায়তা নিয়ম (অত্যন্ত গুরুত্বপূর্ণ):
- এই তথ্য শুধুমাত্র বর্তমান ইউজারের। এটি অন্য কাউকে দেওয়া যাবে না।
- ইউজার যদি তার পাসওয়ার্ড জানতে চায়, তাকে তার নিজের পাসওয়ার্ড বলে দাও।
- ইউজার যদি পাসওয়ার্ড পরিবর্তন করতে চায়, তাকে Profile পেজে যেতে বলো।
- ইউজার যদি তার প্রিমিয়াম স্ট্যাটাস, বাকি দিন, ডিভাইস লিমিট জানতে চায় — উপরের তথ্য থেকে বলে দাও।
- কখনোই অন্য কোনো ইউজারের তথ্য বলবে না বা অনুমান করবে না।
- ইউজারকে তার নাম ধরে সম্বোধন করো (যদি নাম থাকে)।
`
      : "";

    // Build the full system prompt — use provided systemPrompt if available, otherwise build default
    const finalSystemPrompt = systemPrompt || `তুমি RS Anime-এর AI সাপোর্ট অ্যাসিস্ট্যান্ট। তোমার নাম "RS Bot"। তুমি যেকোনো ভাষায় উত্তর দিতে পারো - ইউজার যে ভাষায় জিজ্ঞেস করবে সেই ভাষায় উত্তর দাও।
${userSection}
## RS Anime সম্পর্কে বিস্তারিত তথ্য:

### সাইট পরিচিতি:
- RS Anime হলো একটি Hindi Dubbed anime streaming ওয়েবসাইট
- Series (ওয়েব সিরিজ) এবং Movies দুই ধরনের কন্টেন্ট আছে
- ক্যাটাগরি: Action/Battle, Adventure/Fantasy, Romance, Sci-Fi, Horror, Comedy, Isekai ইত্যাদি

### 🔴 কন্টেন্ট রাউটিং (অত্যন্ত গুরুত্বপূর্ণ):
একই নামের anime একাধিক আইডিতে থাকতে পারে।

⚠️ রুলস:
- একই নামের একাধিক আইটেম থাকলে সবগুলোর বাটন আলাদা আলাদা দেবে
- primary catalog আইটেম আগে দেখাবে

### সাইট ব্যবহার:
- হোম পেজে Hero Slider-এ ফিচার্ড anime দেখা যায়
- সার্চ বাটনে ক্লিক করে যেকোনো anime খুঁজে পাওয়া যায়
- Continue Watching ফিচার আছে
- New Episode Releases সেকশনে সর্বশেষ রিলিজ হওয়া এপিসোড দেখা যায়

### Video Quality:
- 480p, 720p, 1080p এবং 4K quality পাওয়া যায়

### Premium সিস্টেম:
- ফ্রি ইউজাররা ad-supported লিংকে ক্লিক করে ভিডিও দেখতে পারেন
- Premium ইউজাররা সরাসরি বিজ্ঞাপন ছাড়া দেখতে পারেন
- bKash এর মাধ্যমে পেমেন্ট করা যায়

### যোগাযোগ:
- এই চ্যাটে @RS লিখে মেসেজ করলে সরাসরি Admin-এর কাছে পৌঁছায়
- Telegram: https://t.me/rs_woner

## 🔘 বাটন ফরম্যাট:
- anime-এর জন্য: [BTN:anime_title:ANIME_ID:anime_exact_id]
- External লিংকের জন্য: [BTN:button_label:LINK:url]

### যোগাযোগ বাটন:
[BTN:📢 Official Channel:LINK:https://t.me/CARTOONFUNNY03]
[BTN:💬 Anime Group:LINK:https://t.me/HINDIANIME03]
[BTN:🛡️ Admin (RS):LINK:https://t.me/RS_WONER]

⚠️ গুরুত্বপূর্ণ নিয়ম:
- কোনো anime recommend করলে অবশ্যই [BTN:...] ফরম্যাটে বাটন দেবে
- একই নামের anime একাধিক থাকলে সবগুলোর বাটন দেবে
- বন্ধুত্বপূর্ণ এবং সংক্ষিপ্ত উত্তর দাও
- ইমোজি ব্যবহার করো

${animeContext ? `\n## বর্তমানে সাইটে যে anime গুলো আছে (ID সহ):\n${animeContext}` : ""}`;

    // Build Gemini-compatible messages
    const geminiContents: { role: string; parts: { text: string }[] }[] = [];

    // Add system instruction as first user turn context
    for (const msg of messages) {
      const role = msg.role === "assistant" ? "model" : "user";
      geminiContents.push({ role, parts: [{ text: msg.content }] });
    }

    // If old format with single `message`, add it
    if (userMessage && !messages.some((m: any) => m.content === userMessage)) {
      geminiContents.push({ role: "user", parts: [{ text: userMessage }] });
    }

    // Call Gemini API
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: finalSystemPrompt }],
        },
        contents: geminiContents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024,
          topP: 0.9,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API error:", response.status, errText);
      
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Too many requests, please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || "দুঃখিত, এই মুহূর্তে উত্তর দিতে পারছি না।";

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