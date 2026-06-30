import { useEffect, useMemo, useRef, useState } from 'react';
import type { Nav } from '../App';
import { api, aspectToFormat } from '../lib/api';
import { buildPrompt } from '../lib/templates';
import { useProject } from '../state/project';
import PublishModal from '../components/PublishModal';
import type { Aspect, EditJob, Scene } from '../lib/types';

const STAGE_LABEL: Record<string, string> = {
  load: '加载分镜', i2v: '生成 AI 片段', normalize: '统一画面', concat: '拼接', finalize: '收尾', done: '完成', error: '出错',
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Workflow({ nav }: { nav: Nav }) {
  const tpl = nav.activeTemplate;
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [idea, setIdea] = useState('');
  const [aspect, setAspect] = useState<Aspect>(tpl?.defaults.aspect ?? '9:16');
  const [sceneCount, setSceneCount] = useState(tpl?.defaults.sceneCount ?? 5);
  const [clipSeconds, setClipSeconds] = useState(tpl?.defaults.clipSeconds ?? 5);
  const [resolution, setResolution] = useState<'720p' | '1080p'>('720p');

  const [scenes, setScenes] = useState<Scene[]>([]);
  const [genBusy, setGenBusy] = useState(false);
  const [job, setJob] = useState<EditJob | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [error, setError] = useState('');
  const [refFile, setRefFile] = useState<File | null>(null);   // uploaded garment/product photo
  const [refUrl, setRefUrl] = useState<string | null>(null);   // its public URL (image-to-image)
  const [showPublish, setShowPublish] = useState(false);
  const { projectId: ctxPid, setProjectId } = useProject();
  const pidRef = useRef<string | null>(null);

  // If the agent (or a previous session) set a project, load its scenes here so
  // the workspace reflects what the assistant just made.
  useEffect(() => {
    if (ctxPid && pidRef.current !== ctxPid) {
      pidRef.current = ctxPid;
      api.getScenes(ctxPid).then(setScenes).catch(() => { /* ignore */ });
    }
  }, [ctxPid]);

  const canGenerate = useMemo(() => {
    if (tpl) return tpl.inputs.filter((i) => i.required).every((i) => (inputs[i.key] || '').trim());
    return idea.trim().length > 0;
  }, [tpl, inputs, idea]);

  async function pollScenes(projectId: string) {
    for (let i = 0; i < 80; i++) {
      const list = await api.getScenes(projectId);
      setScenes(list);
      if (list.length && list.every((s) => s.status === 'done' || s.status === 'error')) return list;
      await sleep(2500);
    }
    return api.getScenes(projectId);
  }

  async function onGenerate() {
    setError(''); setVideoUrl(''); setJob(null); setGenBusy(true);
    try {
      // Upload the reference photo first (project-independent) so scenes can be
      // generated image-to-image.
      let ref = refUrl;
      if (refFile && !ref) { ref = (await api.uploadReference(refFile)).url; setRefUrl(ref); }

      if (tpl?.id) {
        // DB-backed template → run server-side; the prompt stays hidden.
        const r = await api.runTemplate(tpl.id, { inputs, referenceImage: ref, numScenes: sceneCount, aspect });
        pidRef.current = r.projectId;
        setProjectId(r.projectId);
        setScenes(r.scenes);
        await pollScenes(r.projectId);
      } else {
        // Blank workspace (or hardcoded fallback template) → build prompt client-side.
        const prompt = tpl ? buildPrompt(tpl, inputs) : idea.trim();
        const projectId = await ensurePid();
        await api.autoGenerateScenes(projectId, prompt, sceneCount, aspect, ref);
        await pollScenes(projectId);
      }
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setGenBusy(false);
    }
  }

  async function ensurePid() {
    if (pidRef.current) return pidRef.current;
    const proj = await api.createProject(tpl ? tpl.title : 'My VShort');
    pidRef.current = proj.id;
    setProjectId(proj.id);   // share with the agent dock
    return proj.id;
  }

  async function regenerate(sceneId: string) {
    const pid = pidRef.current; if (!pid) return;
    setScenes((s) => s.map((x) => (x.id === sceneId ? { ...x, status: 'generating' } : x)));
    await api.generateSceneImage(pid, sceneId, aspect, refUrl);
    await pollScenes(pid);
  }

  async function onRender() {
    const pid = pidRef.current; if (!pid) return;
    setError(''); setVideoUrl('');
    try {
      const started = await api.startRender(pid, { exportFormat: aspectToFormat(aspect), resolution, clipSeconds });
      const jobId = started.id || started.jobId;
      if (!jobId) throw new Error(started.error || '无法开始渲染');
      for (let i = 0; i < 600; i++) {
        const j = await api.getJob(pid, jobId);
        setJob(j);
        // Use the public Storage URL directly — <video>/<a> can't send the auth
        // header the /download endpoint requires (that returned 401 JSON).
        if (j.status === 'done') { setVideoUrl(j.output_path || api.downloadUrl(pid, jobId)); return; }
        if (j.status === 'error') throw new Error(j.error_msg || '渲染失败');
        await sleep(1500);
      }
      throw new Error('渲染超时');
    } catch (e: any) {
      setError(e.message || String(e));
    }
  }

  const readyScenes = scenes.filter((s) => s.image_path && s.status === 'done');

  return (
    <section className="px-5 sm:px-8 py-8 max-w-6xl mx-auto grid lg:grid-cols-[360px_1fr] gap-6">
      {/* ── Left: brief + controls ── */}
      <div className="glass rounded-2xl p-5 h-fit lg:sticky lg:top-20">
        <div className="flex items-center gap-2 mb-4">
          {tpl && <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: tpl.accent }} />}
          <h2 className="font-semibold">{tpl ? tpl.title : '空白工作台'}</h2>
        </div>

        {tpl ? (
          <div className="space-y-3">
            {tpl.inputs.map((f) => (
              <label key={f.key} className="block">
                <span className="text-xs text-muted">{f.label}{f.required && ' *'}</span>
                {f.type === 'image' ? (
                  <input type="file" accept="image/*" className="field mt-1 text-sm file:hidden"
                    onChange={(e) => { const file = e.target.files?.[0] || null; setRefFile(file); setRefUrl(null); setInputs((v) => ({ ...v, [f.key]: file?.name || '' })); }} />
                ) : f.type === 'textarea' ? (
                  <textarea className="field mt-1 min-h-20" placeholder={f.placeholder}
                    value={inputs[f.key] || ''} onChange={(e) => setInputs((v) => ({ ...v, [f.key]: e.target.value }))} />
                ) : (
                  <input className="field mt-1" placeholder={f.placeholder}
                    value={inputs[f.key] || ''} onChange={(e) => setInputs((v) => ({ ...v, [f.key]: e.target.value }))} />
                )}
              </label>
            ))}
            {tpl.referenceMode !== 'text' && (
              <p className="text-[11px] text-muted/80">参考图会用「图生图」让产品/服装在每个分镜里保持一致。</p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <textarea className="field min-h-28" placeholder="一句话描述你的视频想法…"
              value={idea} onChange={(e) => setIdea(e.target.value)} />
            <label className="block">
              <span className="text-xs text-muted">参考图(可选)— 上传后用「图生图」保真</span>
              <input type="file" accept="image/*" className="field mt-1 text-sm file:hidden"
                onChange={(e) => { const file = e.target.files?.[0] || null; setRefFile(file); setRefUrl(null); }} />
              {refFile && <span className="text-[11px] text-vshort">已选:{refFile.name}</span>}
            </label>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mt-4">
          <label className="text-xs text-muted">
            画幅
            <select className="field mt-1 py-2" value={aspect} onChange={(e) => setAspect(e.target.value as Aspect)}>
              <option value="9:16">9:16 竖屏</option>
              <option value="16:9">16:9 横屏</option>
              <option value="1:1">1:1 方形</option>
            </select>
          </label>
          <label className="text-xs text-muted">
            分镜数
            <select className="field mt-1 py-2" value={sceneCount} onChange={(e) => setSceneCount(Number(e.target.value))}>
              {[3, 4, 5, 6, 8].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted">
            每段时长
            <select className="field mt-1 py-2" value={clipSeconds} onChange={(e) => setClipSeconds(Number(e.target.value))}>
              {[4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n}s</option>)}
            </select>
          </label>
          <label className="text-xs text-muted">
            分辨率
            <select className="field mt-1 py-2" value={resolution} onChange={(e) => setResolution(e.target.value as '720p' | '1080p')}>
              <option value="720p">720p(快)</option>
              <option value="1080p">1080p(更清晰)</option>
            </select>
          </label>
        </div>

        <button className="btn-primary w-full mt-4" disabled={!canGenerate || genBusy} onClick={onGenerate}>
          {genBusy ? '生成分镜中…' : '生成分镜 →'}
        </button>
        {!tpl && idea.trim() && (
          <button className="btn-ghost w-full mt-2 text-sm" onClick={() => setShowPublish(true)}>发布为模板</button>
        )}
        {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
      </div>

      {/* ── Right: storyboard + render ── */}
      <div className="min-w-0">
        {scenes.length === 0 ? (
          <div className="glass rounded-2xl h-full min-h-[320px] grid place-items-center text-muted text-sm text-center p-8">
            填好左边的简介,点「生成分镜」。AI 会先出一组分镜画面,确认后再生成视频。
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {scenes.map((s, i) => (
                <div key={s.id} className="glass rounded-xl overflow-hidden">
                  <div className="aspect-[9/16] bg-surface relative">
                    {s.image_path
                      ? <img src={/^https?:\/\//.test(s.image_path) ? s.image_path : `${import.meta.env.VITE_API_BASE || ''}${s.image_path}`} className="w-full h-full object-cover" alt={`scene ${i + 1}`} />
                      : <div className="w-full h-full grid place-items-center text-xs text-muted">{s.status === 'generating' ? '生成中…' : s.status === 'error' ? '失败' : '等待'}</div>}
                    <span className="absolute top-2 left-2 text-[11px] font-bold bg-black/60 border border-white/20 rounded px-1.5">{i + 1}</span>
                  </div>
                  <div className="p-2.5">
                    <p className="text-xs text-muted line-clamp-2 leading-snug">{s.prompt}</p>
                    <button className="text-[11px] text-vshort mt-2 hover:underline" onClick={() => regenerate(s.id)}>重新生成</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="glass rounded-2xl p-5 mt-5">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="text-sm text-muted">
                  {readyScenes.length}/{scenes.length} 个分镜就绪 · 画幅 {aspect}
                </div>
                <button className="btn-primary" disabled={readyScenes.length === 0 || (job?.status === 'processing')} onClick={onRender}>
                  {job?.status === 'processing' ? '渲染中…' : '生成视频 →'}
                </button>
              </div>

              {job && job.status === 'processing' && (
                <div className="mt-4">
                  <div className="flex justify-between text-xs text-muted mb-1">
                    <span>{STAGE_LABEL[job.stage || ''] || job.stage || '处理中'}{job.stage_msg ? ` · ${job.stage_msg}` : ''}</span>
                    <span>{job.progress}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full bg-vshort transition-all" style={{ width: `${job.progress}%` }} />
                  </div>
                </div>
              )}

              {videoUrl && (
                <div className="mt-4">
                  <video src={videoUrl} controls className="w-full max-w-xs mx-auto rounded-xl bg-black" />
                  <a href={videoUrl} download target="_blank" rel="noopener" className="btn-ghost w-full mt-3">下载 MP4</a>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {showPublish && (
        <PublishModal
          initialPrompt={idea}
          defaults={{ aspect, sceneCount, clipSeconds, stylePrompt: '' }}
          onClose={() => setShowPublish(false)}
          onPublished={() => { setShowPublish(false); nav.refreshTemplates(); }}
        />
      )}
    </section>
  );
}
