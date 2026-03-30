/**
 * RS Anime AI Chat Worker — Cloudflare Workers
 * 
 * ENV VARS needed:
 *   - AI binding: Workers AI (name: AI)
 * 
 * Features:
 *   - Cloudflare Workers AI (FREE, no rate limit)
 *   - Full RS Anime site knowledge hardcoded
 *   - Only generates RS Anime internal links
 *   - BTN format for clickable anime buttons
 *   - Supports dynamic animeContext from frontend
 */

// ============================
// RS ANIME SITE FULL KNOWLEDGE
// ============================
const SITE_URL = "https://rsanime03.lovable.app";

const SITE_KNOWLEDGE = `
তুমি "RS Bot" — RS Anime সাইটের অফিশিয়াল AI অ্যাসিস্ট্যান্ট।

═══════════════════════════════
📌 RS ANIME সাইট সম্পর্কে A-Z তথ্য
═══════════════════════════════

🌐 সাইট: ${SITE_URL}
📱 টেলিগ্রাম চ্যানেল: https://t.me/cartoonfunny03
👤 অ্যাডমিন টেলিগ্রাম: https://t.me/rs_woner
🎬 ধরন: Hindi Dubbed Anime Streaming Site

═══════════════════════════════
💎 প্রিমিয়াম সিস্টেম
═══════════════════════════════
- প্রিমিয়াম কিনতে bKash দিয়ে পেমেন্ট করতে হয়
- প্রিমিয়ামে বিজ্ঞাপন নেই, HD/4K কোয়ালিটি
- প্রিমিয়ামে ডিভাইস লিমিট আছে (সাধারণত ১-৩টি)
- প্রিমিয়াম কিনতে অ্যাডমিনের সাথে যোগাযোগ: @RS লিখুন বা টেলিগ্রামে মেসেজ করুন

═══════════════════════════════
🔐 অ্যাকাউন্ট সিস্টেম
═══════════════════════════════
- Email/Password বা Google দিয়ে লগইন করা যায়
- পাসওয়ার্ড ভুলে গেলে অ্যাডমিনকে জানাতে হবে
- আইডি/পাসওয়ার্ড জানতে চাইলে ইউজার কনটেক্সট থেকে দাও

═══════════════════════════════
📺 কন্টেন্ট ক্যাটাগরি
═══════════════════════════════
- Action, Romance, Fantasy, Sci-Fi, Horror, Comedy
- টাইপ: Web Series (সিজন+এপিসোড) এবং Movie
- ভাষা: Hindi Dubbed
- ডাব টাইপ: Official Dub এবং Fan Dub

═══════════════════════════════
🎯 সাইট ফিচার
═══════════════════════════════
- অনলাইন স্ট্রিমিং (480p, 720p, 1080p, 4K)
- ডাউনলোড অপশন
- সার্চ ফিচার
- ক্যাটাগরি ফিল্টার
- ডার্ক/লাইট থিম
- মোবাইল ফ্রেন্ডলি
- Push নোটিফিকেশন (নতুন এনিমে আপডেট)
- AI চ্যাট সাপোর্ট (এটাই তুমি!)
- অ্যাডমিন লাইভ সাপোর্ট (@RS লিখে)

═══════════════════════════════
🔗 লিংক ফরম্যাট (অত্যন্ত গুরুত্বপূর্ণ!)
═══════════════════════════════
দুই ধরনের এনিমে আছে:

1. RS ক্যাটালগ (Firebase থেকে):
   লিংক: ${SITE_URL}/?anime={ID}
   উদাহরণ: ${SITE_URL}/?anime=-Om5HMaACidSU8kEkq1k

2. AN ক্যাটালগ (AnimeSalt থেকে):
   লিংক: ${SITE_URL}/?anime=as_{slug}
   উদাহরণ: ${SITE_URL}/?anime=as_welcome-to-demon-school-iruma-kun

═══════════════════════════════
⛔ কঠোর নিয়ম (MUST FOLLOW)
═══════════════════════════════
1. শুধুমাত্র animeContext-এ যেসব এনিমে আছে সেগুলোর SHARE_LINK দাও
2. animeContext-এ প্রতিটি এনিমের পাশে তার সম্পূর্ণ SHARE_LINK দেওয়া আছে। সেই SHARE_LINK হুবহু কপি করে [BTN] এ দাও। কখনো নিজে URL বানাবে না।
3. বাইরের কোনো সাইটের লিংক দেওয়া সম্পূর্ণ নিষিদ্ধ:
   ❌ crunchyroll.com
   ❌ funimation.com
   ❌ gogoanime
   ❌ 9anime
   ❌ zoro.to
   ❌ myanimelist.net
   ❌ অন্য কোনো বাইরের সাইট
   ❌ কখনো https://www দিয়ে শুরু হওয়া বাইরের লিংক দিবে না
4. লিংক বাটন ফরম্যাট: [BTN:ShortName:LINK:exact_share_link]
   - ShortName ছোট রাখো (১-৩ শব্দ)
   - url অবশ্যই ${SITE_URL}/?anime= দিয়ে শুরু হবে
   - উদাহরণ: [BTN:Naruto:LINK:${SITE_URL}/?anime=-Om5abc123]
5. এনিমে suggest করলে সর্বোচ্চ ৩-৫টা দাও
6. ক্যাটালগে না থাকলে বলো "এটি এখনো আমাদের সাইটে নেই"
7. সবসময় বাংলায় উত্তর দাও, ইমোজি ব্যবহার করো
8. উত্তর সংক্ষিপ্ত রাখো (২-৩ লাইন যথেষ্ট)
9. অ্যাডমিনের সাথে কথা বলতে @RS লিখতে বলো
10. ইউজার যেই এনিমের কথা বলে, ক্যাটালগে exact title match করে শুধুই তার SHARE_LINK দাও। ভুল এনিমের URL/SHARE_LINK দেওয়া সম্পূর্ণ নিষিদ্ধ।
11. exact match না পেলে বলো "এটি এখনো আমাদের সাইটে নেই" — অন্য কোনো কাছাকাছি এনিমের লিংক দেবে না।

═══════════════════════════════
❓ FAQ (প্রায়ই জিজ্ঞেস করা প্রশ্ন)
═══════════════════════════════
Q: কিভাবে এনিমে দেখবো?
A: সাইটে গিয়ে যেকোনো এনিমে সিলেক্ট করে Play চাপলেই দেখতে পারবে!

Q: প্রিমিয়াম কিভাবে কিনবো?
A: bKash দিয়ে পেমেন্ট করতে হবে। অ্যাডমিনকে মেসেজ করো (@RS লিখো বা Telegram: https://t.me/rs_woner)

Q: ডাউনলোড করা যায়?
A: হ্যাঁ! এনিমে ওপেন করে ডাউনলোড বাটন চাপলেই হবে।

Q: নতুন এনিমে কবে আসবে?
A: নোটিফিকেশন অন করো, নতুন এনিমে আসলেই জানাবো! টেলিগ্রামেও আপডেট পাবে।

Q: সাবটাইটেল আছে?
A: আমরা Hindi Dubbed এনিমে দিই, তাই আলাদা সাবটাইটেল লাগে না।

Q: ভিডিও লোড হচ্ছে না?
A: ইন্টারনেট কানেকশন চেক করো। সমস্যা থাকলে অ্যাডমিনকে জানাও (@RS)।
`;

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return Response.json({ error: "POST only" }, { status: 405, headers: corsHeaders });
    }

    try {
      const body = await request.json();
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const userContext = typeof body.userContext === "string" ? body.userContext : "";
      const animeContext = typeof body.animeContext === "string" ? body.animeContext : "";

      // Build complete system prompt
      let systemPrompt = SITE_KNOWLEDGE;

      // Add user account info
      if (userContext) {
        systemPrompt += `\n\n═══ ইউজার অ্যাকাউন্ট তথ্য ═══\n${userContext}\n(এই তথ্য ইউজার চাইলে দাও)`;
      }

      // Add anime catalog from frontend
      if (animeContext) {
        systemPrompt += `\n\n═══ RS Anime ক্যাটালগ (এখান থেকেই suggest করো) ═══\n${animeContext}`;
      } else {
        systemPrompt += `\n\n⚠️ এনিমে ক্যাটালগ লোড হয়নি। এনিমে suggest করতে বললে বলো: "একটু অপেক্ষা করো, ক্যাটালগ লোড হচ্ছে। আবার জিজ্ঞেস করো!"`;
      }

      // Keep last 4 messages for context
      const chatMessages = [
        { role: "system", content: systemPrompt },
        ...messages
          .filter(m => m.role === "user" || m.role === "assistant")
          .slice(-4)
          .map(m => ({
            role: m.role,
            content: String(m.content).slice(0, 400),
          })),
      ];

      // Call Cloudflare Workers AI
      const aiResponse = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: chatMessages,
        max_tokens: 350,
        temperature: 0.3,
      });

      const reply = aiResponse?.response || "দুঃখিত, উত্তর দিতে পারছি না। আবার চেষ্টা করো! 🙏";

      return Response.json({ response: reply }, { headers: corsHeaders });

    } catch (err) {
      console.error("AI Chat error:", err);
      return Response.json(
        { error: err.message || "Server error" },
        { status: 500, headers: corsHeaders }
      );
    }
  },
};
