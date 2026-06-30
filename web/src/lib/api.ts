// Typed client for the VSHORT worker REST API. Mirrors the legacy public/js/api.js
// but as a small typed module. Auth token comes from the Supabase session, with a
// localhost dev-token fallback so the SPA is usable before real auth is wired.
import { supabase, IS_LOCAL } from './supabase';
import type { Project, Scene, EditJob, Aspect, ExportFormat } from './types';

const BASE = import.meta.env.VITE_API_BASE || '';
const LOCAL_DEV_TOKEN = 'vshort-local-dev-token';

async function token(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || (IS_LOCAL ? LOCAL_DEV_TOKEN : null);
}

async function headers(json = true): Promise<Record<string, string>> {
  const t = await token();
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  async assetUrl(webPath: string | null | undefined): Promise<string> {
    if (!webPath) return '';
    return `${BASE}${webPath}`;
  },

  // ── Projects ──
  async listProjects(): Promise<Project[]> {
    return req('/projects', { headers: await headers(false) });
  },
  async createProject(name: string): Promise<Project> {
    return req('/projects', { method: 'POST', headers: await headers(), body: JSON.stringify({ name }) });
  },

  // ── Scripts ──
  async generateScript(projectId: string, prompt: string): Promise<{ id: string }> {
    return req(`/projects/${projectId}/scripts`, { method: 'POST', headers: await headers(), body: JSON.stringify({ prompt }) });
  },
  async getScript(projectId: string, scriptId: string): Promise<{ id: string; status: string; content: string }> {
    return req(`/projects/${projectId}/scripts/${scriptId}`, { headers: await headers(false) });
  },

  // ── Scenes ──
  async getScenes(projectId: string): Promise<Scene[]> {
    return req(`/projects/${projectId}/scenes`, { headers: await headers(false) });
  },
  async autoGenerateScenes(projectId: string, prompt: string, numScenes: number, aspect: Aspect, referenceImage?: string | null): Promise<Scene[]> {
    return req(`/projects/${projectId}/scenes/auto-generate`, {
      method: 'POST', headers: await headers(),
      body: JSON.stringify({ prompt, numScenes, aspect, referenceImage: referenceImage || undefined }),
    });
  },
  async generateSceneImage(projectId: string, sceneId: string, aspect: Aspect, referenceImage?: string | null): Promise<{ id: string; status: string }> {
    return req(`/projects/${projectId}/scenes/${sceneId}/generate`, {
      method: 'POST', headers: await headers(), body: JSON.stringify({ aspect, referenceImage: referenceImage || undefined }),
    });
  },
  // Upload a reference image (garment/product photo); returns its public URL.
  async uploadReference(projectId: string, file: File): Promise<{ url: string }> {
    const t = await token();
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${BASE}/api/projects/${projectId}/reference`, {
      method: 'POST',
      headers: t ? { Authorization: `Bearer ${t}` } : {},
      body: fd,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
    return data;
  },
  async updateScene(projectId: string, sceneId: string, patch: Partial<Scene>): Promise<Scene> {
    return req(`/projects/${projectId}/scenes/${sceneId}`, { method: 'PUT', headers: await headers(), body: JSON.stringify(patch) });
  },

  // ── Render jobs ──
  async startRender(projectId: string, config: { exportFormat: ExportFormat; resolution?: string; clipSeconds?: number }): Promise<{ id: string; status: string; error?: string; jobId?: string }> {
    return req(`/projects/${projectId}/edit-jobs`, { method: 'POST', headers: await headers(), body: JSON.stringify({ config }) });
  },
  async getJob(projectId: string, jobId: string): Promise<EditJob> {
    return req(`/projects/${projectId}/edit-jobs/${jobId}`, { headers: await headers(false) });
  },
  downloadUrl(projectId: string, jobId: string): string {
    return `${BASE}/api/projects/${projectId}/edit-jobs/${jobId}/download`;
  },
};

export function aspectToFormat(a: Aspect): ExportFormat {
  return a === '16:9' ? 'landscape' : a === '1:1' ? 'square' : 'tiktok';
}
