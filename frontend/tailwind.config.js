/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#8b1a1a",
          dark: "#5e1010",
          light: "#c0392b",
        },
      },
    },
  },
  plugins: [],
};
