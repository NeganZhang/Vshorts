import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { api } from '../lib/api';

interface ProjectCtx {
  projectId: string | null;
  setProjectId: (id: string | null) => void;
  /** Ensure a project exists for the current session; creates one if needed. */
  ensureProject: (name?: string) => Promise<string>;
}

const Ctx = createContext<ProjectCtx | null>(null);
const LS_KEY = 'vshort_project';

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projectId, setProjectIdState] = useState<string | null>(() => localStorage.getItem(LS_KEY));

  const setProjectId = useCallback((id: string | null) => {
    setProjectIdState(id);
    if (id) localStorage.setItem(LS_KEY, id);
    else localStorage.removeItem(LS_KEY);
  }, []);

  const ensureProject = useCallback(async (name = 'My VShort') => {
    if (projectId) return projectId;
    const proj = await api.createProject(name);
    setProjectId(proj.id);
    return proj.id;
  }, [projectId, setProjectId]);

  return <Ctx.Provider value={{ projectId, setProjectId, ensureProject }}>{children}</Ctx.Provider>;
}

export function useProject(): ProjectCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useProject must be used within ProjectProvider');
  return v;
}
