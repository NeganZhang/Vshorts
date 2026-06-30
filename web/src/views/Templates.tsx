import type { Nav } from '../App';

export default function Templates({ nav }: { nav: Nav }) {
  return (
    <section className="px-5 sm:px-8 py-12 max-w-5xl mx-auto">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight">选择模板</h2>
          <p className="text-muted text-sm mt-1">用模板一键开跑,或进工作台自己调好 prompt 后发布成模板。</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        {nav.templates.map((t) => (
          <div key={t.id || t.slug} className="glass rounded-2xl overflow-hidden flex flex-col">
            <div className="h-32 relative" style={{ background: `linear-gradient(135deg, ${t.accent}33, transparent)` }}>
              <span className="absolute top-3 left-3 inline-block w-2.5 h-2.5 rounded-full" style={{ background: t.accent }} />
              <span className="absolute top-3 right-3 text-[10px] tracking-wide uppercase px-1.5 py-0.5 rounded bg-black/40 text-muted">{t.isOfficial ? '官方' : '社区'}</span>
              <span className="absolute bottom-3 left-4 text-xs tracking-widest uppercase text-muted">{t.referenceMode === 'text' ? '文字生成' : '可传参考图'}</span>
            </div>
            <div className="p-5 flex-1 flex flex-col">
              <div className="font-semibold">{t.title}</div>
              <div className="text-xs text-muted mt-1">{t.category}</div>
              <p className="text-sm text-muted mt-3 leading-relaxed flex-1">{t.description}</p>
              <div className="text-xs text-muted mt-4">
                需要你提供:{t.inputs.filter((i) => i.required).map((i) => i.label).join('、') || '一句主题'}
              </div>
              <button className="btn-primary mt-4 w-full" onClick={() => nav.startTemplate(t.slug)}>使用此模板 →</button>
            </div>
          </div>
        ))}

        {/* Author a new template in the workspace, then publish it */}
        <button onClick={nav.startBlank}
          className="rounded-2xl border border-dashed border-line p-5 flex flex-col items-center justify-center text-center text-muted hover:text-fg hover:border-white/30 transition">
          <div className="text-2xl mb-2">＋</div>
          <div className="text-sm">做一个自己的模板</div>
          <div className="text-xs mt-1 opacity-70">进工作台调好 prompt → 发布</div>
        </button>
      </div>
    </section>
  );
}
