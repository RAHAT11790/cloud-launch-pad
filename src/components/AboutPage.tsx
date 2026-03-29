import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";

interface AboutPageProps {
  onBack: () => void;
  siteName: string;
}

const AboutPage = ({ onBack, siteName }: AboutPageProps) => {
  const [lang, setLang] = useState<"bn" | "en">("bn");

  const content = {
    bn: {
      title: `${siteName} সম্পর্কে`,
      sections: [
        {
          heading: "আমাদের সম্পর্কে",
          text: `${siteName} হলো একটি প্রিমিয়াম এনিমে স্ট্রিমিং প্ল্যাটফর্ম যেখানে আপনি বাংলা ডাবড এবং সাবটাইটেলসহ বিভিন্ন এনিমে সিরিজ ও মুভি উপভোগ করতে পারবেন। আমাদের লক্ষ্য হলো বাংলাদেশি এনিমে প্রেমীদের জন্য সেরা মানের কন্টেন্ট সরবরাহ করা।`,
        },
        {
          heading: "ফিচারসমূহ",
          text: `• HD ও 4K কোয়ালিটিতে ভিডিও স্ট্রিমিং\n• বাংলা ডাব ও সাবটাইটেল\n• অফলাইনে দেখার জন্য ডাউনলোড\n• প্রিমিয়াম সাবস্ক্রিপশন\n• পুশ নোটিফিকেশন\n• ডার্ক/লাইট থিম\n• ক্যাটাগরি অনুযায়ী ব্রাউজিং\n• Continue Watching ফিচার`,
        },
        {
          heading: "যোগাযোগ",
          text: `কোনো সমস্যা বা পরামর্শ থাকলে আমাদের টেলিগ্রাম চ্যানেলে যোগাযোগ করুন। আমরা সবসময় আপনার ফিডব্যাক গ্রহণ করি এবং আমাদের সেবা উন্নত করতে চেষ্টা করি।`,
        },
      ],
    },
    en: {
      title: `About ${siteName}`,
      sections: [
        {
          heading: "About Us",
          text: `${siteName} is a premium anime streaming platform where you can enjoy various anime series and movies with Bengali dubbing and subtitles. Our goal is to provide the best quality content for Bangladeshi anime lovers.`,
        },
        {
          heading: "Features",
          text: `• HD & 4K quality video streaming\n• Bengali dub & subtitles\n• Download for offline viewing\n• Premium subscription\n• Push notifications\n• Dark/Light theme\n• Category-based browsing\n• Continue Watching feature`,
        },
        {
          heading: "Contact",
          text: `If you have any issues or suggestions, please contact us through our Telegram channel. We always welcome your feedback and strive to improve our services.`,
        },
      ],
    },
  };

  const c = content[lang];

  return (
    <motion.div
      className="fixed inset-0 z-[200] bg-background overflow-y-auto pt-[70px] px-4 pb-24"
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "tween", duration: 0.3 }}
    >
      <div className="flex items-center justify-between mb-5">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-secondary-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
          <span className="font-medium">{c.title}</span>
        </button>
        <div className="flex gap-1 bg-secondary rounded-lg p-0.5">
          <button
            onClick={() => setLang("bn")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${lang === "bn" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            বাংলা
          </button>
          <button
            onClick={() => setLang("en")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${lang === "en" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            English
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {c.sections.map((section, i) => (
          <div key={i} className="glass-card p-4 rounded-xl">
            <h3 className="text-sm font-bold text-foreground mb-2">{section.heading}</h3>
            <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">{section.text}</p>
          </div>
        ))}
        <div className="glass-card p-4 rounded-xl text-center">
          <p className="text-xs text-muted-foreground">Version 2.0</p>
          <p className="text-[10px] text-muted-foreground mt-1">© 2026 {siteName}. All rights reserved.</p>
        </div>
      </div>
    </motion.div>
  );
};

export default AboutPage;
