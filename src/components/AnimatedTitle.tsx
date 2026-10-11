// Section title whose emoji moves in a way that matches the category.
const FX: [RegExp, string][] = [
  [/new|release|latest|hot|🔥/i, "cat-fx-flame"], [/action|fight|⚔/i, "cat-fx-slash"], [/movie|film|🎬/i, "cat-fx-pop"],
  [/romance|love|💖|❤/i, "cat-fx-beat"], [/comedy|😂/i, "cat-fx-wiggle"], [/horror|👻/i, "cat-fx-float"],
  [/fantasy|magic|isekai|✨/i, "cat-fx-spin"], [/top|popular|trend|🏆|⭐/i, "cat-fx-bounce"],
];
const LEAD = /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)\s*/u;

const AnimatedTitle = ({ title }: { title: string }) => {
  const m = title.match(LEAD);
  if (!m) return <>{title}</>;
  const fx = FX.find(([re]) => re.test(title))?.[1] || "cat-fx-pop";
  return (<><span aria-hidden className={`cat-fx ${fx} mr-1.5 inline-block`}>{m[1]}</span>{title.slice(m[0].length)}</>);
};
export default AnimatedTitle;
