export interface Project { id: string; name: string; created_at?: string; updated_at?: string }

export interface Scene {
  id: string;
  project_id: string;
  sort_order: number;
  prompt: string;
  shot_type: string;
  camera_move: string;
  duration: string;
  image_path: string | null;
  status: 'pending' | 'generating' | 'done' | 'error';
  clip_path?: string | null;
  clip_status?: 'none' | 'generating' | 'done' | 'error';
}

export interface EditJob {
  id: string;
  project_id: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  progress: number;
  stage?: string;
  stage_msg?: string;
  output_path?: string | null;
  error_msg?: string | null;
}

export type Aspect = '9:16' | '16:9' | '1:1';
export type ExportFormat = 'tiktok' | 'youtube' | 'landscape' | 'square';
export type ReferenceMode = 'text' | 'image' | 'both';

export interface Template {
  slug: string;
  title: string;
  category: string;
  accent: string;          // hex accent for the card
  description: string;
  referenceMode: ReferenceMode;
  defaults: { aspect: Aspect; sceneCount: number; clipSeconds: number; stylePrompt: string };
  inputs: { key: string; label: string; type: 'text' | 'textarea' | 'image'; placeholder?: string; required?: boolean }[];
}
