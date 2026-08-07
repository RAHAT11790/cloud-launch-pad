import { createRoot } from "react-dom/client";
import "./index.css";

const App = () => (
  <div className="min-h-screen bg-slate-900 flex items-center justify-center p-8 text-center">
    <div className="max-w-2xl bg-slate-800 rounded-3xl p-12 shadow-2xl border border-slate-700">
      <h1 className="text-6xl font-black text-white mb-6 tracking-tighter">Hi</h1>
      <p className="text-xl text-slate-400 font-medium">Your project is ready. Start building by editing your components.</p>
    </div>
  </div>
);

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
