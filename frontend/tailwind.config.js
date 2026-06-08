/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./public/index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],

  theme: {
    extend: {
      keyframes: {

        /* --- ORIGINAL ANIMATIONS --- */
        bounceSlow: {
          "0%, 100%": { transform: "translateY(-6px)" },
          "50%": { transform: "translateY(0px)" }
        },

        pulseSlow: {
          "0%, 100%": { opacity: 0.4 },
          "50%": { opacity: 1 }
        },

        wiggle: {
          "0%, 100%": { transform: "rotate(-3deg)" },
          "50%": { transform: "rotate(3deg)" }
        },

        fadeIn: {
          "0%": { opacity: 0, transform: "translateY(6px)" },
          "100%": { opacity: 1, transform: "translateY(0)" }
        },

        rotateRing: {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" }
        },

        popLoop: {
          "0%": { transform: "scale(1)", opacity: 0.9 },
          "50%": { transform: "scale(1.08)", opacity: 1 },
          "100%": { transform: "scale(1)", opacity: 0.9 }
        },

        /* --- NEW SLIDE-IN ANIMATION --- */
        slideInRight: {
          "0%": { transform: "translateX(40px)", opacity: 0 },
          "100%": { transform: "translateX(0)", opacity: 1 }
        }
      },

      animation: {
        "bounce-slow": "bounceSlow 2.8s infinite ease-in-out",
        "pulse-slow": "pulseSlow 3.5s infinite ease-in-out",
        "wiggle": "wiggle 1.8s infinite ease-in-out",
        "fade-in": "fadeIn 0.5s ease-out",
        "rotate-ring": "rotateRing 4s linear infinite",
        "pop-loop": "popLoop 1.4s ease-in-out infinite",

        /* NEW */
        "slide-in-right": "slideInRight 0.55s ease-out",
      },
    },
  },

  plugins: [],
};
