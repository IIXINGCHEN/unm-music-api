/** @type {import('tailwindcss').Config} */
// UNM-Server 构建期 Tailwind 配置：全面扫描 public 下全部 HTML/JS 文件
module.exports = {
  darkMode: 'class',
  content: [
    "./public/**/*.html",
    "./public/**/*.js",
    "!./public/vendor/**"
  ],
  safelist: [
    // 动态 Toast 与状态类
    'bg-sky-500/10', 'bg-sky-500/15', 'bg-sky-500/20', 'bg-sky-500/30',
    'border-sky-500/20', 'border-sky-500/30', 'border-sky-500/40', 'border-sky-500/50',
    'text-sky-300', 'text-sky-400', 'text-sky-500', 'text-sky-600',
    'bg-emerald-500/10', 'bg-emerald-500/15', 'bg-emerald-500/20',
    'border-emerald-500/20', 'border-emerald-500/30', 'border-emerald-500/40',
    'text-emerald-300', 'text-emerald-400', 'text-emerald-500', 'text-emerald-600',
    'bg-rose-500/10', 'bg-rose-500/15', 'bg-rose-500/20',
    'border-rose-500/20', 'border-rose-500/30', 'border-rose-500/40',
    'text-rose-300', 'text-rose-400', 'text-rose-500', 'text-rose-600',
    'bg-amber-500/10', 'bg-amber-500/15', 'bg-amber-500/20',
    'border-amber-500/20', 'border-amber-500/30', 'border-amber-500/40',
    'text-amber-300', 'text-amber-400', 'text-amber-500', 'text-amber-600',
    'bg-purple-500/10', 'bg-purple-500/15', 'bg-purple-500/20',
    'border-purple-500/20', 'border-purple-500/30',
    'text-purple-300', 'text-purple-400', 'text-purple-500', 'text-purple-600',
    'bg-teal-500/10', 'bg-teal-500/15', 'bg-teal-500/20',
    'border-teal-500/20', 'border-teal-500/30',
    'text-teal-300', 'text-teal-400', 'text-teal-500',
    'bg-indigo-500/10', 'bg-indigo-500/20', 'text-indigo-400',
    'bg-pink-500/10', 'bg-pink-500/15', 'bg-pink-500/20',
    'border-pink-500/20', 'border-pink-500/30',
    'text-pink-300', 'text-pink-400', 'text-pink-500',
    'translate-y-2', 'translate-x-12', 'translate-x-0', 'opacity-0', 'opacity-100',
    'hidden', 'flex', 'block', 'rotate-180'
  ],
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
      },
    },
  },
  plugins: [],
};
