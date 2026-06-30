import { useEffect, useState } from 'react';
import TopBar from './components/TopBar';
import AgentDock from './components/AgentDock';
import Landing from './views/Landing';
import Templates from './views/Templates';
import Workflow from './views/Workflow';
import { templateBySlug, TEMPLATES } from './lib/templates';
import { api } from './lib/api';
import { useProject } from './state/project';
import type { Template } from './lib/types';

export type View = 'landing' | 'templates' | 'workflow';

export interface Nav {
  view: View;
  go: (v: View) => void;
  activeTemplate: Template | null;
  templates: Template[];
  refreshTemplates: () => void;
  startTemplate: (slug: string) => void;
  startBlank: () => void;
}

export default function App() {
  const [view, setView] = useState<View>('landing');
  const [activeTemplate, setActiveTemplate] = useState<Template | null>(null);
  // Seed with the hardcoded ones so the gallery renders instantly / offline;
  // replaced by the live DB list (official + public + own) once it loads.
  const [templates, setTemplates] = useState<Template[]>(TEMPLATES);
  const [wfKey, setWfKey] = useState(0);   // bump to remount (reset) the workspace
  const { setProjectId } = useProject();

  const refreshTemplates = () => { api.listTemplates().then((t) => { if (t.length) setTemplates(t); }).catch(() => { /* keep fallback */ }); };
  useEffect(refreshTemplates, []);

  const nav: Nav = {
    view,
    go: setView,
    activeTemplate,
    templates,
    refreshTemplates,
    // Starting fresh (template or blank) must NOT inherit a previous/agent
    // project — clear it so the workspace creates a clean one.
    startTemplate: (slug) => { setProjectId(null); setWfKey((k) => k + 1); setActiveTemplate(templates.find((t) => t.slug === slug) ?? templateBySlug(slug) ?? null); setView('workflow'); },
    startBlank: () => { setProjectId(null); setWfKey((k) => k + 1); setActiveTemplate(null); setView('workflow'); },
  };

  return (
    <div className="min-h-full flex flex-col">
      <TopBar nav={nav} />
      <main className="flex-1 min-h-0">
        {view === 'landing' && <Landing nav={nav} />}
        {view === 'templates' && <Templates nav={nav} />}
        {view === 'workflow' && <Workflow key={wfKey} nav={nav} />}
      </main>
      <AgentDock nav={nav} />
    </div>
  );
}
