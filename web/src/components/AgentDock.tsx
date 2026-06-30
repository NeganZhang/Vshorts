import { useRef, useState } from 'react';

interface Msg { role: 'user' | 'agent'; text: string }

// Bottom-right agent dock. UI is live now; it posts to /api/agent which lands in
// Phase 2 (Claude tool-use). Until that endpoint exists it degrades to a clear
// message instead of erroring, so the dock is usable while the backend catches up.
export default function AgentDock() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const [projectId, setProjectId] = useState<string | null>(() => localStorage.getItem('vshort_project'));
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: 'agent', text: '嗨,我是你的短视频助手。告诉我你想做什么,比如「帮我做一条卖咖啡杯的种草视频」,我来写脚本、分镜并生成。' },
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
      const token = localStorage.getItem('sb-access-token');
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token || 'vshort-local-dev-token'}`,
        },
        body: JSON.stringify({ message: text, projectId, history }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (data.projectId) { setProjectId(data.projectId); localStorage.setItem('vshort_project', data.projectId); }
      setMsgs((m) => [...m, { role: 'agent', text: data.reply || '(no reply)' }]);
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
