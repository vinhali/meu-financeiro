import { AllocationContent, AllocationSlice } from '../types';

interface Props {
  content: AllocationContent;
  onChange: (content: AllocationContent) => void;
}

function newSlice(): AllocationSlice {
  return { id: `a${Date.now()}${Math.random().toString(36).slice(2, 6)}`, label: 'Nova fatia', value: 'R$ 0', description: '', locked: false };
}

export default function AllocationSection({ content, onChange }: Props) {
  function update(patch: Partial<AllocationContent>) {
    onChange({ ...content, ...patch });
  }
  function updateSlice(id: string, patch: Partial<AllocationSlice>) {
    update({ slices: content.slices.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  }
  function moveSlice(id: string, dir: -1 | 1) {
    const idx = content.slices.findIndex((s) => s.id === id);
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= content.slices.length) return;
    const slices = [...content.slices];
    [slices[idx], slices[newIdx]] = [slices[newIdx], slices[idx]];
    update({ slices });
  }
  function removeSlice(id: string) {
    update({ slices: content.slices.filter((s) => s.id !== id) });
  }

  return (
    <section>
      <div className="eyebrow">{content.eyebrow}</div>
      <h2>{content.title}</h2>
      <div className="alloc">
        {content.slices.map((slice) => (
          <div className={`slice ${slice.locked ? 'lock' : ''}`} key={slice.id}>
            <div className="a-lbl">{slice.label}</div>
            <div className="a-val">{slice.value}</div>
            <p>{slice.description}</p>
          </div>
        ))}
      </div>
      <div className="ok-box">
        <b>{content.noteTitle}</b> {content.note}
      </div>

      <div className="edit-list">
        <div className="text-edit">
          <div className="field span2">
            <label>Eyebrow</label>
            <input value={content.eyebrow} onChange={(e) => update({ eyebrow: e.target.value })} />
          </div>
          <div className="field span2">
            <label>Título</label>
            <input value={content.title} onChange={(e) => update({ title: e.target.value })} />
          </div>
        </div>
        {content.slices.map((slice, idx) => (
          <div className="edit-list-item" key={slice.id}>
            <div className="text-edit">
              <div className="field">
                <label>Rótulo</label>
                <input value={slice.label} onChange={(e) => updateSlice(slice.id, { label: e.target.value })} />
              </div>
              <div className="field">
                <label>Valor</label>
                <input value={slice.value} onChange={(e) => updateSlice(slice.id, { value: e.target.value })} />
              </div>
              <div className="field span2">
                <label>Descrição</label>
                <textarea rows={2} value={slice.description} onChange={(e) => updateSlice(slice.id, { description: e.target.value })} />
              </div>
            </div>
            <div className="row-actions">
              <label className="hot-toggle" title="Mostrar com destaque de fatia travada (🔒)">
                <input type="checkbox" checked={slice.locked} onChange={(e) => updateSlice(slice.id, { locked: e.target.checked })} />
                trava
              </label>
              <button onClick={() => moveSlice(slice.id, -1)} disabled={idx === 0} title="Mover para cima">
                ▲
              </button>
              <button onClick={() => moveSlice(slice.id, 1)} disabled={idx === content.slices.length - 1} title="Mover para baixo">
                ▼
              </button>
              <button onClick={() => removeSlice(slice.id)} title="Remover">
                ✕
              </button>
            </div>
          </div>
        ))}
        <button className="add-cat" onClick={() => update({ slices: [...content.slices, newSlice()] })}>
          + adicionar fatia
        </button>
        <div className="text-edit">
          <div className="field">
            <label>Título da nota</label>
            <input value={content.noteTitle} onChange={(e) => update({ noteTitle: e.target.value })} />
          </div>
          <div className="field span2">
            <label>Nota</label>
            <textarea rows={3} value={content.note} onChange={(e) => update({ note: e.target.value })} />
          </div>
        </div>
      </div>
    </section>
  );
}
