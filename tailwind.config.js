/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ['"DM Serif Display"', "Georgia", "serif"],
        body: ['"DM Sans"', "system-ui", "sans-serif"],
      },
      colors: {
        brand: {
          50: "#eef6ff",
          100: "#d9eaff",
          200: "#bcdaff",
          300: "#8ec2ff",
          400: "#599eff",
          500: "#3478fc",
          600: "#1e5af1",
          700: "#1645de",
          800: "#1838b4",
          900: "#1a338e",
          950: "#152156",
        },
        surface: {
          50: "#f8f9fb",
          100: "#f0f2f5",
          200: "#e4e7ec",
          300: "#cdd3dc",
          400: "#98a2b3",
          500: "#667085",
          600: "#475467",
          700: "#344054",
          800: "#1d2939",
          900: "#101828",
        },
      },
    },
  },
  plugins: [],
};
