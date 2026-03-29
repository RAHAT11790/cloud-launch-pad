/**
 * RS Anime AI Chat Worker — Cloudflare Workers
 * 
 * ENV VARS needed:
 *   - AI binding: Workers AI (name: AI)
 * 
 * Features:
 *   - Uses Cloudflare Workers AI (free, no rate limit like Groq)
 *   - Receives anime catalog from frontend, generates RS Anime site links only
 *   - Supports userContext for account info (password, premium, etc.)
 *   - BTN format for clickable anime links
 */

export default {
  async fetch(request, env) {
    // CORS
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

      // Get last user message
      const lastUserMsg = [...messages].reverse().find(m => m.role === "user")?.content || "";

      // Build system prompt
      let systemPrompt = `তুমি RS Anime-এর "RS Bot"। সংক্ষিপ্ত, বাংলায় উত্তর দাও। ইমোজি ব্যবহার করো।
- RS Anime একটি Hindi Dubbed anime streaming site।
- Premium bKash দিয়ে কেনা যায়।
- Admin-এর সাথে কথা বলতে @RS লিখতে বলো।
- Telegram: https://t.me/RS_WONER

গুরুত্বপূর্ণ নিয়ম:
1. anime/movie suggest করলে শুধু নিচের ক্যাটালগ থেকে দাও
2. বাইরের কোনো link দিবে না (crunchyroll, funimation, gogoanime ইত্যাদি নিষিদ্ধ)
3. link দিতে হলে এই ফরম্যাটে দাও: [BTN:AnimeShortName:LINK:url]
4. anime suggest করলে ৩-৫টা বেশি দিও না`;

      // Add user account context if provided
      if (userContext) {
        systemPrompt += `\n\nইউজার অ্যাকাউন্ট তথ্য:\n${userContext}`;
      }

      // Add anime catalog context if provided
      if (animeContext) {
        systemPrompt += `\n\nRS Anime ক্যাটালগ:\n${animeContext}`;
      }

      // Prepare chat messages (keep only last 2 + system)
      const chatMessages = [
        { role: "system", content: systemPrompt },
        ...messages
          .filter(m => m.role === "user" || m.role === "assistant")
          .slice(-2)
          .map(m => ({
            role: m.role,
            content: String(m.content).slice(0, 300),
          })),
      ];

      // Call Cloudflare Workers AI
      const aiResponse = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: chatMessages,
        max_tokens: 250,
        temperature: 0.4,
      });

      const reply = aiResponse?.response || "দুঃখিত, উত্তর দিতে পারছি না।";

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
