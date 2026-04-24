/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        void: "#050505",
        panel: "#101013",
        toxic: "#39FF14",
        plasma: "#9b5cff"
      },
      boxShadow: {
        neon: "0 0 24px rgba(57, 255, 20, 0.28), 0 0 48px rgba(155, 92, 255, 0.18)",
        panel: "0 24px 80px rgba(0, 0, 0, 0.45)"
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"]
      }
    },
  },
  plugins: [],
}
