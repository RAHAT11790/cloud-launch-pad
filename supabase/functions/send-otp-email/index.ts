const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // GET request = health check / ping
  if (req.method === "GET") {
    return new Response(JSON.stringify({ status: "ok", service: "send-otp-email" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { email, otp, siteName } = await req.json();
    if (!email || !otp) {
      return new Response(JSON.stringify({ error: "email and otp are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const name = siteName || "RS Anime";

    const emailHtml = `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px; background: #ffffff;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h2 style="color: #6366f1; margin: 0; font-size: 24px;">${name}</h2>
        </div>
        <div style="background: #f8f9fa; border-radius: 16px; padding: 32px; text-align: center;">
          <h3 style="color: #1a1a2e; margin: 0 0 8px; font-size: 18px;">🔐 Password Reset Code</h3>
          <p style="color: #666; font-size: 14px; margin: 0 0 24px;">আপনার পাসওয়ার্ড রিসেট করতে নিচের কোডটি ব্যবহার করুন:</p>
          <div style="background: #ffffff; border: 2px dashed #6366f1; border-radius: 12px; padding: 20px; margin: 0 0 24px;">
            <span style="font-size: 36px; font-weight: bold; letter-spacing: 10px; color: #6366f1; font-family: 'Courier New', monospace;">${otp}</span>
          </div>
          <p style="color: #999; font-size: 12px; margin: 0;">⏱️ এই কোডটি ৫ মিনিটের মধ্যে মেয়াদ শেষ হয়ে যাবে।</p>
        </div>
        <p style="color: #bbb; font-size: 11px; text-align: center; margin-top: 24px;">
          আপনি এই রিকোয়েস্ট না করে থাকলে এই ইমেইলটি উপেক্ষা করুন।
        </p>
      </div>
    `;

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send email via Resend API directly
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: `${name} <onboarding@resend.dev>`,
        to: [email],
        subject: `🔐 ${name} - Password Reset Code: ${otp}`,
        html: emailHtml,
      }),
    });

    const resendData = await resendRes.json();

    if (!resendRes.ok) {
      console.error("Resend API error:", resendData);
      return new Response(JSON.stringify({ 
        success: false, 
        emailSent: false, 
        error: resendData?.message || "Email sending failed" 
      }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ 
      success: true,
      emailSent: true,
      message: "OTP email sent via Resend",
      messageId: resendData.id,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: any) {
    console.error("send-otp-email error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
