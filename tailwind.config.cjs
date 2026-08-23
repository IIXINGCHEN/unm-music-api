/** @type {import('tailwindcss').Config} */
// UNM-Server 构建期 Tailwind 配置：扫描 public 下全部 HTML/JS 字面量类名，
// 由 prebuild 预编译为 public/assets/css/tailwind.css，浏览器不再依赖运行时 JIT。
module.exports = {
  darkMode: 'class',
  content: ["./public/**/*.html", "./public/**/*.js", "!./public/vendor/**"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        slate: {
          850: '#101626',
          900: '#0b0f19',
          925: '#070b14',
          950: '#040711',
        },
        brand: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
        accent: {
          gold: '#f59e0b',
          amber: '#d97706',
          rose: '#f43f5e',
          purple: '#a855f7',
          cyan: '#06b6d4',
        },
      },
      animation: {
        'wave-1': 'wave 1.1s ease-in-out infinite alternate',
        'wave-2': 'wave 1.4s ease-in-out infinite alternate 0.2s',
        'wave-3': 'wave 0.9s ease-in-out infinite alternate 0.4s',
        'wave-4': 'wave 1.3s ease-in-out infinite alternate 0.1s',
        'wave-5': 'wave 1.0s ease-in-out infinite alternate 0.3s',
        'pulse-glow': 'pulseGlow 4s ease-in-out infinite',
        'spin-slow': 'spin 18s linear infinite',
        'slide-in-right': 'slideInRight 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        'wave-bar': 'waveBar 1.2s ease-in-out infinite alternate',
      },
      keyframes: {
        wave: {
          '0%': { height: '4px' },
          '100%': { height: '24px' },
        },
        pulseGlow: {
          '0%, 100%': { opacity: '0.3' },
          '50%': { opacity: '0.7' },
        },
        slideInRight: {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        waveBar: {
          '0%': { height: '6px' },
          '100%': { height: '32px' },
        },
      },
    },
  },
  plugins: [],
};
