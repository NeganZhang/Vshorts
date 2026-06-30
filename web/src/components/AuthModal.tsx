import { useState } from 'react';
import { supabase } from '../lib/supabase';

// Minimal email/password auth via Supabase. The session token is then attached
// to API calls automatically (see lib/api.ts).
export default function AuthModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const submit = async () => {
    setErr(''); setMsg(''); setBusy(true);
    try {
      if (mode === 'up') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMsg('注册成功。若开启了邮箱验证,请查收邮件后再登录。');
        setMode('in');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onClose();
      }
    } catch (e: any) {
      setErr(e.message || '出错了');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="glass rounded-2xl p-6 w-[min(380px,calc(100vw-2rem))]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-lg">{mode === 'in' ? '登录' : '注册'} VSHORT</h2>
          <button onClick={onClose} className="text-muted hover:text-ink text-xl leading-none">×</button>
        </div>
        <div className="space-y-3">
          <input className="field" type="email" placeholder="邮箱" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="field" type="password" placeholder="密码" value={password}
            onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
          {err && <p className="text-sm text-red-400">{err}</p>}
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}
          <button className="btn-primary w-full" disabled={busy || !email || !password} onClick={submit}>
            {busy ? '请稍候…' : mode === 'in' ? '登录' : '注册'}
          </button>
          <button className="text-sm text-muted hover:text-ink w-full" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setErr(''); setMsg(''); }}>
            {mode === 'in' ? '没有账号?去注册' : '已有账号?去登录'}
          </button>
        </div>
      </div>
    </div>
  );
}
