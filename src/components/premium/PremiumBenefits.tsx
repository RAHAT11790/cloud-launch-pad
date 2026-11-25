export function PremiumBenefits({ benefits, fallback }: { benefits: string[]; fallback: string[] }) {
  const lines = benefits.length ? benefits : fallback;
  return (
    <div data-premium-benefits>
      {lines.map((line, i) => (
        <div key={`${i}-${line}`} className="pg3d-step">
          <b>{i + 1}</b><span className="text-sm leading-relaxed min-w-0 break-words pt-0.5">{line}</span>
        </div>
      ))}
    </div>
  );
}