const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
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

    // Try sending via SMTP/Resend gateway if available
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    // Method 1: Try Supabase Auth admin to send a magic link (piggyback email sending)
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    let emailSent = false;

    // Method: Use Supabase Auth to trigger an email
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      try {
        // Generate a magic link which will trigger Supabase to send an email
        const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type: "magiclink",
            email: email,
            options: {
              data: { otp_code: otp },
            },
          }),
        });
        
        if (res.ok) {
          emailSent = true;
        }
      } catch (e) {
        console.error("Supabase auth email failed:", e);
      }
    }

    return new Response(JSON.stringify({ 
      success: true,
      emailSent,
      message: emailSent ? "OTP email sent" : "OTP generated (check Firebase for code)",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
