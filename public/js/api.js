/**
 * VSHORT — Shared API Client
 * Requires: <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 * Included by all pages via <script src="/js/api.js">
 */

// ─── Supabase client (uses global from CDN) ────
const _supabase = window.supabase.createClient(
  'https://seolaotjqmyrtujehbfo.supabase.co',
  'sb_publishable_XP4UxVBA0H9jNxcdtO9LUQ_ra8dln8n'
);

const API = {
  base: '/api',

  // ─── Auth state (synced from Supabase session) ─
  user: null,
  _session: null,

  /** Get current access token from Supabase session (for Express API calls) */
  async _getToken() {
    const { data } = await _supabase.auth.getSession();
    this._session = data.session;
    return data.session?.access_token || null;
  },

  /** Auth headers for Express API calls */
  async _headers(extra = {}) {
    const token = await this._getToken();
    const h = { 'Content-Type': 'application/json', ...extra };
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  },

  async _authHeaders() {
    const token = await this._getToken();
    const h = {};
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  },

  // ─── Auth methods (server-side via Supabase Admin) ──
  /**
   * Register a new account.
   * @param {string} email
   * @param {string} password
   * @param {object} [extras] { nickname, birthday, sex, disclaimerAccepted }
   */
  async register(email, password, extras = {}) {
    const body = {
      email,
      password,
      nickname:            extras.nickname || null,
      birthday:            extras.birthday || null,
      sex:                 extras.sex || null,
      disclaimerAccepted:  !!extras.disclaimerAccepted,
    };

    const res = await fetch(`${this.base}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');

    // Set Supabase session with returned tokens
    if (data.access_token) {
      await _supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
      this._session = { access_token: data.access_token };
    }
    this.user = data.user;
    return { user: this.user };
  },

  async login(email, password) {
    const res = await fetch(`${this.base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');

    // Set Supabase session with returned tokens
    if (data.access_token) {
      await _supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
      this._session = { access_token: data.access_token };
    }
    this.user = data.user;
    return { user: this.user };
  },

  async logout() {
    await _supabase.auth.signOut();
    this.user = null;
    this._session = null;
    this.projectId = null;
    localStorage.removeItem('vshort_project');
  },

  async getMe() {
    const { data, error } = await _supabase.auth.getUser();
    if (error || !data.user) {
      this.user = null;
      this._session = null;
      return null;
    }
    this.user = { id: data.user.id, email: data.user.email };
    return this.user;
  },

  /** Fetch the full profile (nickname / birthday / sex) from our API. */
  async getProfile() {
    const res = await fetch(`${this.base}/auth/me`, {
      headers: await this._authHeaders(),
    });
    if (!res.ok) throw new Error('Failed to load profile');
    const data = await res.json();
    // Mirror profile fields onto the cached user for convenience
    if (this.user) {
      this.user.nickname = data.nickname;
      this.user.birthday = data.birthday;
      this.user.sex      = data.sex;
    }
    return data;
  },

  /** Update profile fields. Pass only the keys you want to change. */
  async updateProfile(fields) {
    const res = await fetch(`${this.base}/auth/profile`, {
      method: 'PATCH',
      headers: await this._headers(),
      body: JSON.stringify(fields),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update profile');
    if (this.user) {
      if ('nickname' in data) this.user.nickname = data.nickname;
      if ('birthday' in data) this.user.birthday = data.birthday;
      if ('sex'      in data) this.user.sex      = data.sex;
    }
    return data;
  },

  isLoggedIn() {
    return !!this.user;
  },

  // ─── Project context ───────────────────────────
  projectId: null,

  /** Initialize: check Supabase session, get or create project */
  async init() {
    // Restore session from Supabase (auto-persisted)
    const { data: { session } } = await _supabase.auth.getSession();
    this._session = session;

    if (session?.user) {
      this.user = { id: session.user.id, email: session.user.email };
    } else {
      this.user = null;
      return null;
    }

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
          headers: await this._authHeaders(),
        });
        if (res.ok) {
          this.projectId = pid;
          return pid;
        }
      } catch (e) { /* fall through */ }
    }

    // Create a new default project
    const project = await this.createProject('My Project');
    if (project && project.id) {
      this.projectId = project.id;
      localStorage.setItem('vshort_project', project.id);
      return project.id;
    }
    return null;
  },

  // ─── Projects ──────────────────────────────────
  async listProjects() {
    const res = await fetch(`${this.base}/projects`, { headers: await this._authHeaders() });
    return res.json();
  },

  async createProject(name) {
    const res = await fetch(`${this.base}/projects`, {
      method: 'POST',
      headers: await this._headers(),
      body: JSON.stringify({ name }),
    });
    return res.json();
  },

  async getProject(id) {
    const res = await fetch(`${this.base}/projects/${id || this.projectId}`, {
      headers: await this._authHeaders(),
    });
    return res.json();
  },

  // ─── Scripts ───────────────────────────────────
  async generateScript(prompt) {
    const res = await fetch(`${this.base}/projects/${this.projectId}/scripts`, {
      method: 'POST',
      headers: await this._headers(),
      body: JSON.stringify({ prompt }),
    });
    return res.json();
  },

  async getScript(scriptId) {
    const res = await fetch(`${this.base}/projects/${this.projectId}/scripts/${scriptId}`, {
      headers: await this._authHeaders(),
    });
    return res.json();
  },

  // ─── Scenes ────────────────────────────────────
  async getScenes() {
    const res = await fetch(`${this.base}/projects/${this.projectId}/scenes`, {
      headers: await this._authHeaders(),
    });
    return res.json();
  },

  async addScene(data) {
    const res = await fetch(`${this.base}/projects/${this.projectId}/scenes`, {
      method: 'POST',
      headers: await this._headers(),
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async updateScene(sceneId, data) {
    const res = await fetch(`${this.base}/projects/${this.projectId}/scenes/${sceneId}`, {
      method: 'PUT',
      headers: await this._headers(),
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async deleteScene(sceneId) {
    const res = await fetch(`${this.base}/projects/${this.projectId}/scenes/${sceneId}`, {
      method: 'DELETE',
      headers: await this._authHeaders(),
    });
    return res.json();
  },

  async generateSceneImage(sceneId) {
    const res = await fetch(`${this.base}/projects/${this.projectId}/scenes/${sceneId}/generate`, {
      method: 'POST',
      headers: await this._authHeaders(),
    });
    return res.json();
  },

  async generateAllScenes() {
    const res = await fetch(`${this.base}/projects/${this.projectId}/scenes/generate-all`, {
      method: 'POST',
      headers: await this._authHeaders(),
    });
    return res.json();
  },

  async autoGenerateScenes(prompt, numScenes) {
    const res = await fetch(`${this.base}/projects/${this.projectId}/scenes/auto-generate`, {
      method: 'POST',
      headers: await this._headers(),
      body: JSON.stringify({ prompt, numScenes }),
    });
    return res.json();
  },

  // ─── Clips ─────────────────────────────────────
  async uploadClips(files, onProgress) {
    const token = await this._getToken();
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      for (const f of files) formData.append('files', f);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${this.base}/projects/${this.projectId}/clips`);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

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
      headers: await this._authHeaders(),
    });
    return res.json();
  },

  async deleteClip(clipId) {
    const res = await fetch(`${this.base}/projects/${this.projectId}/clips/${clipId}`, {
      method: 'DELETE',
      headers: await this._authHeaders(),
    });
    return res.json();
  },

  // ─── Edit Jobs ─────────────────────────────────
  async startEditJob(config) {
    const res = await fetch(`${this.base}/projects/${this.projectId}/edit-jobs`, {
      method: 'POST',
      headers: await this._headers(),
      body: JSON.stringify({ config }),
    });
    return res.json();
  },

  async getEditJob(jobId) {
    const res = await fetch(`${this.base}/projects/${this.projectId}/edit-jobs/${jobId}`, {
      headers: await this._authHeaders(),
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
      headers: await this._authHeaders(),
    });
    return res.json();
  },

  async createCheckout(plan) {
    const res = await fetch(`${this.base}/billing/checkout`, {
      method: 'POST',
      headers: await this._headers(),
      body: JSON.stringify({ plan }),
    });
    return res.json();
  },

  async openBillingPortal() {
    const res = await fetch(`${this.base}/billing/portal`, {
      method: 'POST',
      headers: await this._authHeaders(),
    });
    return res.json();
  },

  async getUsage() {
    const res = await fetch(`${this.base}/billing/usage`, {
      headers: await this._authHeaders(),
    });
    return res.json();
  },

  // ─── Navigation helpers ────────────────────────
  pageUrl(page) {
    return `${page}?project=${this.projectId}`;
  },
};
