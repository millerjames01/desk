import { useEffect, useRef, useState } from 'react';
import { download, exportAll, importAll, type Backup } from '../backup';
import { saveSettings, DEFAULT_PROXIES } from '../settings';
import { useNotice, type Data } from '../lib';
import { installSample } from '../read/sample';
import { bookUrl } from './Read';
import type { BookConfig, HouseStyle, Settings } from '../types';

const HOUSES: { id: HouseStyle; name: string; blurb: string }[] = [
  { id: 'a-review', name: 'A · Review', blurb: 'Literary quarterly. EB Garamond, justified, drop caps, ochre card.' },
  { id: 'b-grid', name: 'B · Grid', blurb: 'Modern Swiss. Source Serif and Plex Sans, a big issue number, ragged right, dusty blue card.' },
  { id: 'c-pamphlet', name: 'C · Pamphlet', blurb: 'Classical and centred. Literata, spaced capitals, roman numerals, a fleuron.' },
];

export default function SettingsPage({ data }: { data: Data }) {
  const [s, setS] = useState<Settings>(data.settings);
  const [proxies, setProxies] = useState(data.settings.proxies.join('\n'));
  const [storage, setStorage] = useState('');
  const [notice, show] = useNotice();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setStorage(`${((e.usage ?? 0) / 1e6).toFixed(1)} MB used of about ${((e.quota ?? 0) / 1e9).toFixed(1)} GB`));
  }, [data]);

  const book = (patch: Partial<BookConfig>) => setS({ ...s, book: { ...s.book, ...patch } });
  const save = async (next = s) => {
    await saveSettings({ ...next, proxies: proxies.split('\n').map((p) => p.trim()).filter((p) => p.includes('{url}')) });
    show('Saved.');
  };
  const persist = async () => {
    const ok = await navigator.storage?.persist?.();
    show(ok ? 'This browser will keep Desk’s data unless you clear it yourself.' : 'The browser declined. Installing Desk to the home screen usually helps; keep backups either way.', ok ? 'good' : 'bad');
  };
  const backup = async () => {
    const b = await exportAll();
    download(`desk-backup-${b.exportedAt.slice(0, 10)}.json`, JSON.stringify(b, null, 1));
  };
  const restore = async (f: File | undefined) => {
    if (!f) return;
    try {
      const counts = await importAll(JSON.parse(await f.text()) as Backup);
      const n = Object.values(counts).reduce((a, b) => a + b, 0);
      show(`Merged ${n} new or newer records. Photos and article images don’t travel in backups.`);
    } catch (e) {
      show((e as Error).message, 'bad');
    }
    if (fileRef.current) fileRef.current.value = '';
  };
  const previewHouse = async (id: HouseStyle) => {
    const next = { ...s, book: { ...s.book, house_style: id } };
    setS(next);
    await save(next);
    window.open(bookUrl(await installSample(), 'reading'), '_blank');
  };

  return (
    <>
      <div className="head">
        <h1>Settings</h1>
        <p className="lede">Everything lives in this browser. Back it up now and then.</p>
        <div className="toast">{notice}</div>
      </div>

      <div className="card stack">
        <h3>The booklet</h3>
        <div className="houses">
          {HOUSES.map((h) => (
            <div key={h.id} className={`house${s.book.house_style === h.id ? ' on' : ''}`}>
              <label className="check"><input type="radio" name="house" checked={s.book.house_style === h.id} onChange={() => book({ house_style: h.id })} /> <strong>{h.name}</strong></label>
              <p className="muted small">{h.blurb}</p>
              <button className="link small" onClick={() => previewHouse(h.id)}>Preview with the sample</button>
            </div>
          ))}
        </div>
        <div className="grid2">
          <label>Title<input value={s.book.title} onChange={(e) => book({ title: e.target.value })} /></label>
          <label>Tagline<input value={s.book.tagline} onChange={(e) => book({ tagline: e.target.value })} /></label>
          <label>Images per article, at most<input type="number" min={0} max={10} value={s.book.max_images_per_article} onChange={(e) => book({ max_images_per_article: Number(e.target.value) })} /></label>
          <label>Fill a booklet to about, pages<input type="number" min={16} max={96} step={4} value={s.book.target_pages} onChange={(e) => book({ target_pages: Number(e.target.value) })} /></label>
          <label>Creep, mm per sheet<input type="number" step={0.05} value={s.book.creep_mm_per_sheet} onChange={(e) => book({ creep_mm_per_sheet: Number(e.target.value) })} /></label>
          <label>
            Pad to a multiple of 4 with
            <select value={s.book.pad_with} onChange={(e) => book({ pad_with: e.target.value as BookConfig['pad_with'] })}>
              <option value="blank">blank pages</option>
              <option value="notes">ruled notes pages</option>
            </select>
          </label>
          <label>Printer<input value={s.book.printer} placeholder="Brother model" onChange={(e) => book({ printer: e.target.value })} /></label>
          <label>Place line (house C cover)<input value={s.book.place} placeholder="e.g. Catalunya" onChange={(e) => book({ place: e.target.value })} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={s.book.recto_starts} onChange={(e) => book({ recto_starts: e.target.checked })} /> Start every article on a right-hand page (uses more paper)</label>
        <p className="muted small">Creep moves the pages of inner sheets toward the spine so the text lines up once folded. 0.2 mm suits 90 g paper.</p>
        <div><button className="primary" onClick={() => save()}>Save</button></div>
      </div>

      <div className="card stack">
        <h3>Fetching</h3>
        <label>
          CORS proxies, tried in order (<code>{'{url}'}</code> is the article address)
          <textarea className="mono" rows={4} value={proxies} onChange={(e) => setProxies(e.target.value)} />
        </label>
        <p className="muted small">
          Public proxies are free, flaky and see what you fetch. A personal Cloudflare Worker is steadier (see the README). The bookmarklet needs none.{' '}
          <button className="link" onClick={() => setProxies(DEFAULT_PROXIES.join('\n'))}>Reset to defaults</button>
        </p>
        <div><button className="primary" onClick={() => save()}>Save</button></div>
      </div>

      <div className="card stack">
        <h3>Claude (optional)</h3>
        <label>
          Anthropic API key
          <input type="password" autoComplete="off" value={s.anthropicKey} placeholder="sk-ant-…" onChange={(e) => setS({ ...s, anthropicKey: e.target.value.trim() })} />
        </label>
        <div className="grid2">
          <label>Model<input value={s.claudeModel} onChange={(e) => setS({ ...s, claudeModel: e.target.value.trim() })} /></label>
          <label>
            Read handwriting with
            <select value={s.ocrEngine} onChange={(e) => setS({ ...s, ocrEngine: e.target.value as Settings['ocrEngine'] })}>
              <option value="tesseract">Tesseract, on this device</option>
              <option value="claude">Claude, when a key is set</option>
            </select>
          </label>
        </div>
        <label className="check"><input type="checkbox" checked={s.autoClaudeExtract} onChange={(e) => setS({ ...s, autoClaudeExtract: e.target.checked })} /> Ask Claude to extract flagged articles automatically</label>
        <p className="muted small">
          The key stays in this browser and is sent only to Anthropic. It is never in backups. Claude only ever transcribes or extracts: an extraction is
          kept only if every paragraph is found word for word in the page.
        </p>
        <div><button className="primary" onClick={() => save()}>Save</button></div>
      </div>

      <div className="card stack">
        <h3>Your data</h3>
        <p className="muted">{storage}</p>
        <div className="actions">
          <button onClick={backup}>Download a backup</button>
          <button onClick={() => fileRef.current?.click()}>Merge a backup…</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => restore(e.target.files?.[0])} />
          <button onClick={persist}>Ask the browser to keep my data</button>
        </div>
        <p className="muted small">
          Backups hold every piece, version, transcription, submission, journal and article text. They leave out photos, article images and the API key.
          Merging keeps whichever copy of each record is newer, so you can move a file between phone and computer in either direction.
        </p>
      </div>
    </>
  );
}
