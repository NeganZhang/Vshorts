/**
 * VSHORT — Shared API Client
 * Included by all pages via <script src="/js/api.js">
 */
const API = {
  base: '/api',

  // ─── Auth state ────────────────────────────────
  token: localStorage.getItem('vshort_token') || null,
  user: null,

  /** Auth headers for all requests */
  _headers(extra = {}) {
    const h = { 'Content-Type': 'application/json', ...extra };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  },

  _authHeaders() {
    const h = {};
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  },

  // ─── Auth methods ──────────────────────────────
  async register(email, password) {
    const res = await fetch(`${this.base}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    this.token = data.token;
    this.user = data.user;
    localStorage.setItem('vshort_token', data.token);
    return data;
  },

  async login(email, password) {
    const res = await fetch(`${this.base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    this.token = data.token;
    this.user = data.user;
    localStorage.setItem('vshort_token', data.token);
    return data;
  },

  logout() {
    this.token = null;
    this.user = null;
    this.projectId = null;
    localStorage.removeItem('vshort_token');
    localStorage.removeItem('vshort_project');
  },

  async getMe() {
    if (!this.token) return null;
    const res = await fetch(`${this.base}/auth/me`, {
      headers: this._authHeaders(),
    });
    if (!res.ok) {
      this.logout();
      return null;
    }
    this.user = await res.json();
    return this.user;
  },

  isLoggedIn() {
    return !!this.token;
  },

  // ─── Project context ───────────────────────────
  projectId: null,

  /** Initialize: check auth, get or create project */
  async init() {
    // Check auth
    if (this.token) {
      const me = await this.getMe();
      if (!me) return null; // token invalid
    }

    if (!this.token) return null; // not logged in

    const params = new URLSearchParams(window.location.search);
    let pid = params.get('project');

    if (pid) {
      this.projectId = pid;
      localStorage.setItem('vshort_project', pid);
      return pid;
    }

    // Try localStorage
    pid = localStorage.getItem('vshort_project');
    if (pid) {
      try {
        const res = await fetch(`${this.base}/projects/${pid}`, {
          headers: this._authHeaders(),
        });
        if (res.ok) {
          this.projectId = pid;
          return pid;
        }
      } catch (e) { /* fall through */ }
    }

    // Create a new default project
    const project = await this.createProject('My Project');
    this.projectId = project.id;
    localStorage.setItem('vshort_project', project.id);
    return project.id;
  },

  // ─── Projects ──────────────────────────────────
  async listProjects() {
    const res = await fetch(`${this.base}/projects`, { headers: this._authHeaders() });
    return res.json();
  },

  async createProject(name) {
    const res = await fetch(`${this.base}/projects`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({ name }),
    });
    return res.json();
  },

  async getProject(id) {
    const res = await fetch(`${this.base}/projects/${id || this.projectId}`, {
      headers: this._authHeaders(),
    });
    return res.json();
  },

  // ─── Scripts ───────────────────────────────────
  async generateScript(prompt) {
    const res = await fetch(`${this.base}/projects/${this.projectId}/scripts`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({ prompt }),
    });
    return res.json();
  },

  async getScript(scriptId) {
    const res = await fetch(`${this.base}/projects/${this.projectId}/scripts/${scriptId}`, {
      headers: this._authHeaders(),
    });
    return res.json();
  },

  // ─── Scenes ────────────────────────────────────
  async getScenes() {
    const res = await fetch(`${this.base}/projects/${this.projectId}/scenes`, {
      headers: this._authHeaders(),
    });
    return res.json();
  },

  async addScene(data) {
    const res = await fetch(`${this.base}/projects/${this.projectId}/scenes`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async updateScene(sceneId, data) {
    const res = await fetch(`${this.base}/projects/${this.projectId}/scenes/${sceneId}`, {
      method: 'PUT',
      headers: this._headers(),
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async deleteScene(sceneId) {
    const res = await fetch(`${this.base}/projects/${this.projectId}/scenes/${sceneId}`, {
      method: 'DELETE',
      headers: this._authHeaders(),
    });
    return res.json();
  },

  async generateSceneImage(sceneId) {
    const res = await fetch(`${this.base}/projects/${this.projectId}/scenes/${sceneId}/generate`, {
      method: 'POST',
      headers: this._authHeaders(),
    });
    return res.json();
  },

  async generateAllScenes() {
    const res = await fetch(`${this.base}/projects/${this.projectId}/scenes/generate-all`, {
      method: 'POST',
      headers: this._authHeaders(),
    });
    return res.json();
  },

  async autoGenerateScenes(prompt, numScenes) {
    const res = await fetch(`${this.base}/projects/${this.projectId}/scenes/auto-generate`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({ prompt, numScenes }),
    });
    return res.json();
  },

  // ─── Clips ─────────────────────────────────────
  async uploadClips(files, onProgress) {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      for (const f of files) formData.append('files', f);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${this.base}/projects/${this.projectId}/clips`);
      if (this.token) xhr.setRequestHeader('Authorization', `Bearer ${this.token}`);

      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100));
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          reject(new Error(xhr.responseText));
        }
      };
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(formData);
    });
  },

  async getClips() {
    const res = await fetch(`${this.base}/projects/${this.projectId}/clips`, {
      headers: this._authHeaders(),
    });
    return res.json();
  },

  async deleteClip(clipId) {
    const res = await fetch(`${this.base}/projects/${this.projectId}/clips/${clipId}`, {
      method: 'DELETE',
      headers: this._authHeaders(),
    });
    return res.json();
  },

  // ─── Edit Jobs ─────────────────────────────────
  async startEditJob(config) {
    const res = await fetch(`${this.base}/projects/${this.projectId}/edit-jobs`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({ config }),
    });
    return res.json();
  },

  async getEditJob(jobId) {
    const res = await fetch(`${this.base}/projects/${this.projectId}/edit-jobs/${jobId}`, {
      headers: this._authHeaders(),
    });
    return res.json();
  },

  getDownloadUrl(jobId) {
    return `${this.base}/projects/${this.projectId}/edit-jobs/${jobId}/download`;
  },

  // ─── Polling helper ────────────────────────────
  async poll(fn, interval = 500, maxAttempts = 120) {
    for (let i = 0; i < maxAttempts; i++) {
      const result = await fn();
      if (result._done) return result;
      await new Promise(r => setTimeout(r, interval));
    }
    throw new Error('Polling timeout');
  },

  // ─── Billing / Stripe ──────────────────────────
  async getSubscription() {
    const res = await fetch(`${this.base}/billing/subscription`, {
      headers: this._authHeaders(),
    });
    return res.json();
  },

  async createCheckout(plan) {
    const res = await fetch(`${this.base}/billing/checkout`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({ plan }),
    });
    return res.json();
  },

  async openBillingPortal() {
    const res = await fetch(`${this.base}/billing/portal`, {
      method: 'POST',
      headers: this._authHeaders(),
    });
    return res.json();
  },

  async getUsage() {
    const res = await fetch(`${this.base}/billing/usage`, {
      headers: this._authHeaders(),
    });
    return res.json();
  },

  // ─── Navigation helpers ────────────────────────
  pageUrl(page) {
    return `${page}?project=${this.projectId}`;
  },
};
