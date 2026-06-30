import { useState } from 'react';
import TopBar from './components/TopBar';
import AgentDock from './components/AgentDock';
import Landing from './views/Landing';
import Templates from './views/Templates';
import Workflow from './views/Workflow';
import { templateBySlug } from './lib/templates';
import type { Template } from './lib/types';

export type View = 'landing' | 'templates' | 'workflow';

export interface Nav {
  view: View;
  go: (v: View) => void;
  activeTemplate: Template | null;
  startTemplate: (slug: string) => void;
  startBlank: () => void;
}

export default function App() {
  const [view, setView] = useState<View>('landing');
  const [activeTemplate, setActiveTemplate] = useState<Template | null>(null);

  const nav: Nav = {
    view,
    go: setView,
    activeTemplate,
    startTemplate: (slug) => { setActiveTemplate(templateBySlug(slug) ?? null); setView('workflow'); },
    startBlank: () => { setActiveTemplate(null); setView('workflow'); },
  };

  return (
    <div className="min-h-full flex flex-col">
      <TopBar nav={nav} />
      <main className="flex-1 min-h-0">
        {view === 'landing' && <Landing nav={nav} />}
        {view === 'templates' && <Templates nav={nav} />}
        {view === 'workflow' && <Workflow nav={nav} />}
      </main>
      <AgentDock />
    </div>
  );
}
