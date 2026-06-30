import { useRef, useState } from 'react';
import { supabase, IS_LOCAL } from '../lib/supabase';
import { useProject } from '../state/project';
import type { Nav } from '../App';

interface Msg { role: 'user' | 'agent'; text: string }

// Bottom-right agent dock — a prompt copilot that can build storyboards, run
// templates, and assemble/publish new templates. Shares the active project with
// the workspace via ProjectProvider, so what it makes shows up there.
export default function AgentDock({ nav }: { nav: Nav }) {
  const { projectId, setProjectId } = useProject();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: 'agent', text: '嗨,我是你的短视频助手 + prompt 副驾。可以让我「做一条卖咖啡杯的种草视频」、用某个模板开跑,或者帮你把一段好用的 prompt 整合发布成模板。' },
  ]);
  const listRef = useRef<HTMLDivElement>(null);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    const history = msgs.map((m) => ({ role: m.role === 'agent' ? 'assistant' : 'user', text: m.text }));
    setMsgs((m) => [...m, { role: 'user', text }]);
    setBusy(true);
    try {
      // Real Supabase session token (falls back to the dev token only on localhost).
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token || (IS_LOCAL ? 'vshort-local-dev-token' : null);
      if (!token) {
        setMsgs((m) => [...m, { role: 'agent', text: '请先点右上角「登录」再和我对话哦~ 登录后我就能帮你写脚本、出分镜、跑视频。' }]);
        setBusy(false);
        return;
      }
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: text, projectId, history }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (data.projectId) setProjectId(data.projectId);   // shared with the workspace
      setMsgs((m) => [...m, { role: 'agent', text: data.reply || '(no reply)' }]);
      nav.refreshTemplates();   // a publish may have added a template
    } catch {
      setMsgs((m) => [...m, {
        role: 'agent',
        text: '助手大脑还在接线中(Phase 2:接入 Claude 后即可自动写脚本、出分镜、跑视频)。现在可以先到「工作台」手动生成。',
      }]);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: 1e9, behavior: 'smooth' }));
    }
  };

  return (
    <>
      {open && (
        <div className="fixed bottom-24 right-5 z-40 w-[min(380px,calc(100vw-2rem))] h-[min(520px,70vh)] glass rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-fade-up">
          <div className="flex items-center justify-between px-4 h-12 border-b border-line">
            <span className="text-sm font-semibold">VShort 助手</span>
            <button onClick={() => setOpen(false)} className="text-muted hover:text-ink text-lg leading-none">×</button>
          </div>
          <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {msgs.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
                <span className={`inline-block max-w-[85%] text-sm rounded-2xl px-3 py-2 ${m.role === 'user' ? 'bg-vshort/90 text-white' : 'bg-white/[0.06] text-ink/90'}`}>
                  {m.text}
                </span>
              </div>
            ))}
            {busy && <div className="text-xs text-muted">思考中…</div>}
          </div>
          {projectId && (
            <button onClick={() => { nav.go('workflow'); setOpen(false); }}
              className="mx-3 mb-1 text-xs text-vshort hover:underline text-left">在工作台查看 / 调整分镜 →</button>
          )}
          <div className="p-3 border-t border-line flex gap-2">
            <input
              className="field py-2"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder="描述你的视频想法…"
            />
            <button className="btn-primary px-3" onClick={send} disabled={busy}>发送</button>
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full bg-vshort text-white text-xl shadow-xl animate-pulse-ring grid place-items-center"
        title="AI 助手"
      >
        {open ? '×' : '✨'}
      </button>
    </>
  );
}
