/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{ts,js,html}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: 'var(--colors-canvas)',
        ink: 'var(--colors-ink)',
        'soft-cloud': 'var(--colors-soft-cloud)',
        hairline: 'var(--colors-hairline)',
        'hairline-soft': 'var(--colors-hairline-soft)',
        sale: 'var(--colors-sale)',
        'sale-deep': 'var(--colors-sale-deep)',
        success: 'var(--colors-success)',
        'success-bright': 'var(--colors-success-bright)',
        info: 'var(--colors-info)',
        'info-deep': 'var(--colors-info-deep)',
        'on-primary': 'var(--colors-on-primary)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Bebas Neue', 'Anton', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out forwards',
        'slide-up': 'slideUp 0.3s ease-out forwards',
        'slide-down': 'slideDown 0.2s ease-out forwards',
        'scale-in': 'scaleIn 0.2s ease-out forwards',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
        'spin-slow': 'spin 3s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
      },
    },
  },
  plugins: [],
};
