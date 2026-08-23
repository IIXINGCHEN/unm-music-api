/**
 * UNM-Server Tailwind Play CDN 运行时配置。
 * 必须在 /vendor/tailwind.js 之后、页面其余脚本之前加载。
 */
tailwind.config = {
  darkMode: 'class',
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
      },
    },
  },
};
