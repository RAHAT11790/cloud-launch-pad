const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// --- Origin/Referer allowlist (basic abuse prevention; OTP flow is pre-login
//     so we can't require a user JWT). Template fields are server-controlled
//     to prevent content injection by attackers.
const ALLOWED_HOST_RX = [
  /\.lovable\.app$/i,
  /\.lovableproject\.com$/i,
  /^lovable\.app$/i,
  /^lovableproject\.com$/i,
  /^rsanime03\.lovable\.app$/i,
  /^localhost(?::\d+)?$/i,
  /^127\.0\.0\.1(?::\d+)?$/i,
];
function hostAllowed(urlStr: string | null): boolean {
  if (!urlStr) return false;
  try { return ALLOWED_HOST_RX.some((rx) => rx.test(new URL(urlStr).host)); } catch { return false; }
}

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_RX = /^\d{6}$/;

// Server-controlled branding (do NOT accept caller-supplied template fields).
const NAME = "RS ANIME";
const LOGO = "https://i.ibb.co.com/gLc93Bc3/android-chrome-512x512.png";
const SITE = "https://rsanime03.lovable.app";
const TELEGRAM = "https://t.me/rs_woner";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return new Response(JSON.stringify({ status: "ok", service: "send-otp-email" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const reqBody = await req.json();
    if (reqBody?.test === true) {
      return new Response(JSON.stringify({ ok: true, ping: "send-otp-email" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Origin/Referer gate
    const origin = req.headers.get("origin");
    const referer = req.headers.get("referer");
    if (!hostAllowed(origin) && !hostAllowed(referer)) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { email, otp } = reqBody;
    if (!email || !EMAIL_RX.test(String(email))) {
      return new Response(JSON.stringify({ error: "valid email required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!otp || !OTP_RX.test(String(otp))) {
      return new Response(JSON.stringify({ error: "otp must be 6 digits" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const name = NAME;
    const logo = LOGO;
    const site = SITE;
    const telegram = TELEGRAM;

    const otpDigits = otp.toString().split("").map((d: string) =>
      `<td style="width:48px;height:56px;background:#1a1a2e;border-radius:10px;text-align:center;vertical-align:middle;font-size:28px;font-weight:700;color:#818cf8;font-family:'Courier New',monospace;border:1px solid #2d2d4e;">${d}</td>`
    ).join('<td style="width:8px;"></td>');

    const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0f0f1a;font-family:'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="max-width:500px;margin:0 auto;padding:24px 16px;">
    <div style="text-align:center;padding:28px 20px 20px;">
      <img src="${logo}" alt="${name}" width="64" height="64" style="border-radius:14px;margin-bottom:12px;" />
      <h1 style="color:#818cf8;font-size:22px;font-weight:700;margin:0;letter-spacing:1px;">${name}</h1>
    </div>
    <div style="background:linear-gradient(145deg,#1a1a2e,#16162a);border-radius:20px;padding:36px 28px;border:1px solid #2d2d4e;box-shadow:0 8px 32px rgba(99,102,241,0.1);">
      <div style="text-align:center;margin-bottom:8px;">
        <div style="display:inline-block;background:#818cf8;border-radius:50%;width:48px;height:48px;line-height:48px;font-size:24px;margin-bottom:12px;">🔐</div>
        <h2 style="color:#e2e8f0;font-size:20px;font-weight:600;margin:0 0 6px;">Password Reset Code</h2>
        <p style="color:#94a3b8;font-size:14px;margin:0;">Use the code below to reset your password:</p>
      </div>
      <div style="margin:28px 0;text-align:center;">
        <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>${otpDigits}</tr></table>
      </div>
      <div style="text-align:center;background:#0f0f1a;border-radius:10px;padding:12px;margin-top:8px;">
        <p style="color:#64748b;font-size:12px;margin:0;">⏱ This code expires in <strong style="color:#818cf8;">5 minutes</strong></p>
      </div>
    </div>
    <p style="color:#475569;font-size:12px;text-align:center;margin:20px 0 28px;line-height:1.5;">
      If you didn't request this, you can safely ignore this email.<br/>
      Never share this code with anyone.
    </p>
    <div style="border-top:1px solid #1e1e35;margin:0 20px;"></div>
    <div style="text-align:center;padding:20px 0 8px;">
      <p style="color:#4a4a6a;font-size:11px;margin:0 0 8px;">Powered by <strong style="color:#818cf8;">${name}</strong></p>
      <div style="margin:8px 0;">
        <a href="${telegram}" style="color:#818cf8;font-size:12px;text-decoration:none;margin:0 10px;">📱 Telegram</a>
        <span style="color:#2d2d4e;">|</span>
        <a href="${site}" style="color:#818cf8;font-size:12px;text-decoration:none;margin:0 10px;">🌐 Website</a>
      </div>
      <p style="color:#3a3a5a;font-size:10px;margin:8px 0 0;">© ${new Date().getFullYear()} ${name}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: `${name} <onboarding@resend.dev>`,
        to: [email],
        subject: `${name} - Password Reset Code`,
        html: emailHtml,
      }),
    });

    const resendData = await resendRes.json();

    if (!resendRes.ok) {
      console.error("Resend API error:", resendData);
      return new Response(JSON.stringify({
        success: false, emailSent: false,
        error: resendData?.message || "Email sending failed"
      }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      success: true, emailSent: true,
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
