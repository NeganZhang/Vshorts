import type { Nav } from '../App';
import { TEMPLATES } from '../lib/templates';

export default function Landing({ nav }: { nav: Nav }) {
  return (
    <section className="px-5 sm:px-8 py-16 sm:py-24 max-w-5xl mx-auto text-center">
      <p className="text-sm tracking-widest text-vshort font-semibold mb-4 animate-fade-up">一站式 AI 短视频工坊</p>
      <h1 className="text-4xl sm:text-6xl font-black tracking-tight leading-[1.05] text-balance animate-fade-up">
        几分钟做出一条<br className="hidden sm:block" />会爆的短视频
      </h1>
      <p className="mt-5 text-base sm:text-lg text-muted max-w-xl mx-auto animate-fade-up">
        选一个模板,或直接告诉助手你的想法。AI 帮你写脚本、出分镜、生成画面并跑出成片。不需要专业知识,也能专业地用。
      </p>
      <div className="mt-9 flex items-center justify-center gap-3 animate-fade-up">
        <button className="btn-primary text-base px-6 py-3" onClick={() => nav.go('templates')}>开始制作 →</button>
        <button className="btn-ghost text-base px-6 py-3" onClick={nav.startBlank}>空白工作台</button>
      </div>

      <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
        {TEMPLATES.map((t) => (
          <button
            key={t.slug}
            onClick={() => nav.startTemplate(t.slug)}
            className="glass rounded-2xl p-5 hover:border-white/20 transition group"
          >
            <span className="inline-block w-2 h-2 rounded-full mb-3" style={{ background: t.accent }} />
            <div className="font-semibold">{t.title}</div>
            <div className="text-xs text-muted mt-1">{t.category}</div>
            <div className="text-sm text-muted mt-3 leading-relaxed">{t.description}</div>
          </button>
        ))}
      </div>
    </section>
  );
}
