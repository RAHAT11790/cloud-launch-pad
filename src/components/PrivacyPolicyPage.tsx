import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";

interface PrivacyPolicyPageProps {
  onBack: () => void;
  siteName: string;
}

const PrivacyPolicyPage = ({ onBack, siteName }: PrivacyPolicyPageProps) => {
  const [lang, setLang] = useState<"bn" | "en">("bn");

  const content = {
    bn: {
      title: "গোপনীয়তা নীতি",
      sections: [
        {
          heading: "তথ্য সংগ্রহ",
          text: `${siteName} আপনার ব্রাউজিং অভিজ্ঞতা উন্নত করতে কিছু তথ্য সংগ্রহ করে। এর মধ্যে রয়েছে:\n• ডিভাইসের তথ্য (ব্রাউজার টাইপ, অপারেটিং সিস্টেম)\n• ব্যবহারের পরিসংখ্যান (দেখা ভিডিও, সময়কাল)\n• অ্যাকাউন্ট তথ্য (ইমেইল, ডিসপ্লে নাম)\n• প্রোফাইল ছবি (আপনার ডিভাইসে সংরক্ষিত)`,
        },
        {
          heading: "তথ্য ব্যবহার",
          text: `আমরা আপনার তথ্য নিম্নলিখিত উদ্দেশ্যে ব্যবহার করি:\n• আপনার অ্যাকাউন্ট পরিচালনা\n• ব্যক্তিগতকৃত কন্টেন্ট সুপারিশ\n• পুশ নোটিফিকেশন পাঠানো\n• সেবার মান উন্নতি\n• প্রিমিয়াম সাবস্ক্রিপশন ম্যানেজমেন্ট`,
        },
        {
          heading: "তথ্য নিরাপত্তা",
          text: `আপনার তথ্যের নিরাপত্তা আমাদের কাছে গুরুত্বপূর্ণ। আমরা Firebase এবং এনক্রিপশন প্রযুক্তি ব্যবহার করে আপনার তথ্য সুরক্ষিত রাখি। আমরা কখনোই আপনার ব্যক্তিগত তথ্য তৃতীয় পক্ষের কাছে বিক্রি করি না।`,
        },
        {
          heading: "কুকি ও স্থানীয় স্টোরেজ",
          text: `আমরা আপনার পছন্দ (থিম, ভাষা, ভিডিও কোয়ালিটি) এবং সেশন তথ্য সংরক্ষণে লোকাল স্টোরেজ ব্যবহার করি। এই তথ্য শুধুমাত্র আপনার ডিভাইসে থাকে।`,
        },
        {
          heading: "যোগাযোগ",
          text: `গোপনীয়তা নীতি সম্পর্কে কোনো প্রশ্ন থাকলে আমাদের টেলিগ্রাম চ্যানেলে যোগাযোগ করুন।`,
        },
      ],
    },
    en: {
      title: "Privacy Policy",
      sections: [
        {
          heading: "Information Collection",
          text: `${siteName} collects certain information to improve your browsing experience, including:\n• Device information (browser type, operating system)\n• Usage statistics (videos watched, duration)\n• Account information (email, display name)\n• Profile photo (stored on your device)`,
        },
        {
          heading: "Use of Information",
          text: `We use your information for the following purposes:\n• Managing your account\n• Personalized content recommendations\n• Sending push notifications\n• Improving service quality\n• Premium subscription management`,
        },
        {
          heading: "Data Security",
          text: `Your data security is important to us. We use Firebase and encryption technologies to keep your information secure. We never sell your personal information to third parties.`,
        },
        {
          heading: "Cookies & Local Storage",
          text: `We use local storage to save your preferences (theme, language, video quality) and session data. This information only exists on your device.`,
        },
        {
          heading: "Contact",
          text: `If you have any questions about the privacy policy, please contact us through our Telegram channel.`,
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
        <div className="text-center py-3">
          <p className="text-[10px] text-muted-foreground">Last updated: March 2026</p>
        </div>
      </div>
    </motion.div>
  );
};

export default PrivacyPolicyPage;
