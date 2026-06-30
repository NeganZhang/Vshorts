import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { Aspect, ReferenceMode } from '../lib/types';

// Publish the current prompt as a reusable template. The prompt is stored
// server-side and never re-exposed (creator protection). Any {{placeholder}}
// in the prompt becomes a field the end-user fills in.
export default function PublishModal({
  initialPrompt, defaults, onClose, onPublished,
}: {
  initialPrompt: string;
  defaults: { aspect: Aspect; sceneCount: number; clipSeconds: number; stylePrompt: string };
  onClose: () => void;
  onPublished: () => void;
}) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [prompt, setPrompt] = useState(initialPrompt);
  const [referenceMode, setReferenceMode] = useState<ReferenceMode>('text');
  const [isPublic, setIsPublic] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Auto-derive the end-user inputs from {{placeholders}} in the prompt.
  const placeholders = useMemo(() => {
    const keys = new Set<string>();
    for (const m of prompt.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) keys.add(m[1]);
    return [...keys];
  }, [prompt]);

  async function publish() {
    setError('');
    if (!title.trim()) { setError('给模板起个名字'); return; }
    if (!prompt.trim()) { setError('prompt 不能为空'); return; }
    setBusy(true);
    try {
      const input_schema = placeholders.map((k) => ({ key: k, label: k, type: 'text', required: true }));
      await api.createTemplate({
        title: title.trim(),
        category: category.trim() || undefined,
        description: description.trim() || undefined,
        reference_mode: referenceMode,
        defaults,
        input_schema,
        prompt_template: prompt.trim(),
        is_public: isPublic,
      });
      onPublished();
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="glass rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-lg">发布为模板</h3>
        <p className="text-xs text-muted mt-1">
          发布后,别人能用这个模板,但看不到里面的 prompt(锁死保护)。在 prompt 里写
          <code className="mx-1 px-1 rounded bg-white/10">{'{{变量}}'}</code>就会变成别人填的输入框。
        </p>

        <div className="space-y-3 mt-4">
          <label className="block"><span className="text-xs text-muted">模板名 *</span>
            <input className="field mt-1" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如:咖啡馆探店" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-xs text-muted">分类</span>
              <input className="field mt-1" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="探店 / 带货…" /></label>
            <label className="block text-xs text-muted">参考图模式
              <select className="field mt-1 py-2" value={referenceMode} onChange={(e) => setReferenceMode(e.target.value as ReferenceMode)}>
                <option value="text">纯文字</option>
                <option value="image">需要参考图</option>
                <option value="both">可选参考图</option>
              </select></label>
          </div>
          <label className="block"><span className="text-xs text-muted">简介</span>
            <input className="field mt-1" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="一句话说明这个模板做什么" /></label>
          <label className="block"><span className="text-xs text-muted">Prompt(锁死,只你可见)*</span>
            <textarea className="field mt-1 min-h-28 font-mono text-xs" value={prompt} onChange={(e) => setPrompt(e.target.value)} /></label>
          {placeholders.length > 0 && (
            <p className="text-[11px] text-vshort">用户需填:{placeholders.join('、')}</p>
          )}
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
            公开到模板库(所有人可用)
          </label>
        </div>

        {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
        <div className="flex gap-3 mt-5">
          <button className="btn-ghost flex-1" onClick={onClose} disabled={busy}>取消</button>
          <button className="btn-primary flex-1" onClick={publish} disabled={busy}>{busy ? '发布中…' : '确定发布'}</button>
        </div>
      </div>
    </div>
  );
}
