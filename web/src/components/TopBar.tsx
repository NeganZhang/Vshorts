import { useEffect, useState } from 'react';
import { supabase, IS_LOCAL } from '../lib/supabase';
import AuthModal from './AuthModal';
import type { Nav } from '../App';

export default function TopBar({ nav }: { nav: Nav }) {
  const [email, setEmail] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setEmail(s?.user?.email ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between px-5 sm:px-8 h-14 glass border-b border-line">
      <button onClick={() => nav.go('landing')} className="flex items-center gap-2 font-black tracking-tight text-ink">
        <span className="inline-block w-2.5 h-2.5 rotate-45 bg-vshort rounded-[2px]" />
        VSHORT
      </button>
      <nav className="flex items-center gap-1 text-sm">
        <button onClick={() => nav.go('templates')} className={`px-3 py-1.5 rounded-lg transition ${nav.view === 'templates' ? 'text-ink' : 'text-muted hover:text-ink'}`}>模板</button>
        <button onClick={nav.startBlank} className={`px-3 py-1.5 rounded-lg transition ${nav.view === 'workflow' ? 'text-ink' : 'text-muted hover:text-ink'}`}>工作台</button>
        {email ? (
          <div className="ml-2 flex items-center gap-2">
            <span className="text-xs text-muted hidden sm:inline max-w-[160px] truncate">{email}</span>
            <button className="text-xs text-muted hover:text-ink" onClick={() => supabase.auth.signOut()}>退出</button>
          </div>
        ) : IS_LOCAL ? (
          <span className="ml-2 text-xs text-muted hidden sm:inline">本地预览</span>
        ) : (
          <button className="ml-2 btn-primary py-1.5 px-4 text-sm" onClick={() => setShowAuth(true)}>登录</button>
        )}
      </nav>
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </header>
  );
}
