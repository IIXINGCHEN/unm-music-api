/**
 * UNM-Server 遥测大盘 Tailwind Play CDN 运行时配置（独立于主页配色扩展）。
 * 必须在 /vendor/tailwind.js 之后加载。
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
              850: '#111827',
              925: '#0b0f19',
              950: '#060911',
            },
            brand: {
              50: '#f0f9ff',
              100: '#e0f2fe',
              500: '#0ea5e9',
              600: '#0284c7',
              700: '#0369a1',
            },
          },
          animation: {
            'slide-in-right': 'slideInRight 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
            'wave-bar': 'waveBar 1.2s ease-in-out infinite alternate',
          },
          keyframes: {
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
    };
