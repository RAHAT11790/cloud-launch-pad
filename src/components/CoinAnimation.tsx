import { useEffect, useState } from "react";
import { Coins } from "lucide-react";

interface Props {
  trigger: number; // increment to fire animation
  amount?: number;
}

// Floating "+1 coin" animation from top center.
export default function CoinAnimation({ trigger, amount = 1 }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!trigger) return;
    setVisible(true);
    const t = window.setTimeout(() => setVisible(false), 1600);
    return () => window.clearTimeout(t);
  }, [trigger]);

  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[200] flex items-start justify-center pt-20">
      <div className="flex items-center gap-2 rounded-full border border-amber-400/40 bg-gradient-to-r from-amber-500/90 to-yellow-400/90 px-5 py-2.5 text-black shadow-[0_10px_40px_-10px_rgba(251,191,36,0.6)] animate-coin-pop">
        <Coins className="w-5 h-5" />
        <span className="text-base font-bold">+{amount} Coin</span>
      </div>
      <style>{`
        @keyframes coin-pop {
          0% { opacity: 0; transform: translateY(-40px) scale(0.6); }
          20% { opacity: 1; transform: translateY(0) scale(1.15); }
          40% { transform: translateY(-6px) scale(1); }
          80% { opacity: 1; transform: translateY(0) scale(1); }
          100% { opacity: 0; transform: translateY(80px) scale(0.9); }
        }
        .animate-coin-pop { animation: coin-pop 1.6s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
      `}</style>
    </div>
  );
}
