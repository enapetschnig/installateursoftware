/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand:   { 50:"#fef2f2",100:"#fee2e2",200:"#fecaca",300:"#fca5a5",400:"#f87171",500:"#ef4444",600:"#dc2626",700:"#b91c1c",800:"#991b1b",900:"#7f1d1d",950:"#450a0a" },
        accent:  { 400:"#60a5fa",500:"#3b82f6",600:"#2563eb" },
        ok:      { 500:"#22c55e" },
        warn:    { 500:"#f59e0b" },
        ink:     "#030712",
      },
      fontFamily: { sans: ["Inter","SF Pro Display","system-ui","sans-serif"] },
      borderRadius: { xl: "16px", "2xl": "20px", "3xl": "26px" },
      boxShadow: {
        glass: "0 8px 40px -12px rgba(0,0,0,0.25)",
        glow: "0 0 0 1px rgba(255,255,255,0.06), 0 20px 60px -20px rgba(0,0,0,0.5)",
        lift: "0 24px 60px -24px rgba(0,0,0,0.55)",
      },
      keyframes: {
        fadeup: { "0%": { opacity: "0", transform: "translateY(10px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        float:  { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-6px)" } },
        drift:  { "0%,100%": { transform: "translate(0,0)" }, "50%": { transform: "translate(20px,15px)" } },
        pulseglow: { "0%,100%": { opacity: "0.45" }, "50%": { opacity: "0.75" } },
        shimmer:{ "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
      },
      animation: {
        fadeup: "fadeup .5s cubic-bezier(.21,1,.21,1) both",
        float: "float 6s ease-in-out infinite",
        drift: "drift 18s ease-in-out infinite",
        pulseglow: "pulseglow 7s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
