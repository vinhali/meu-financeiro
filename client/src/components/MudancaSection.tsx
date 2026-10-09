import { MudancaContent, MudancaItem } from '../types';

interface Props {
  content: MudancaContent;
  onChange: (content: MudancaContent) => void;
}

function newItem(): MudancaItem {
  return { id: `m${Date.now()}${Math.random().toString(36).slice(2, 6)}`, title: 'Novo item', description: '' };
}

export default function MudancaSection({ content, onChange }: Props) {
  function update(patch: Partial<MudancaContent>) {
    onChange({ ...content, ...patch });
  }
  function updateItem(id: string, patch: Partial<MudancaItem>) {
    update({ items: content.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
  }
  function moveItem(id: string, dir: -1 | 1) {
    const idx = content.items.findIndex((it) => it.id === id);
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= content.items.length) return;
    const items = [...content.items];
    [items[idx], items[newIdx]] = [items[newIdx], items[idx]];
    update({ items });
  }
  function removeItem(id: string) {
    update({ items: content.items.filter((it) => it.id !== id) });
  }

  return (
    <section>
      <div className="eyebrow">{content.eyebrow}</div>
      <h2>{content.title}</h2>
      <div className="panel">
        <p style={{ fontSize: 14 }}>{content.intro}</p>
        <ul className="task-list">
          {content.items.map((item) => (
            <li key={item.id}>
              <span>
                <b>{item.title}</b> — {item.description}
              </span>
            </li>
          ))}
        </ul>

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
            <div className="field span2">
              <label>Introdução</label>
              <textarea rows={2} value={content.intro} onChange={(e) => update({ intro: e.target.value })} />
            </div>
          </div>
          {content.items.map((item, idx) => (
            <div className="edit-list-item" key={item.id}>
              <div className="text-edit">
                <div className="field span2">
                  <label>Título</label>
                  <input value={item.title} onChange={(e) => updateItem(item.id, { title: e.target.value })} />
                </div>
                <div className="field span2">
                  <label>Descrição</label>
                  <textarea rows={3} value={item.description} onChange={(e) => updateItem(item.id, { description: e.target.value })} />
                </div>
              </div>
              <div className="row-actions">
                <button onClick={() => moveItem(item.id, -1)} disabled={idx === 0} title="Mover para cima">
                  ▲
                </button>
                <button onClick={() => moveItem(item.id, 1)} disabled={idx === content.items.length - 1} title="Mover para baixo">
                  ▼
                </button>
                <button onClick={() => removeItem(item.id)} title="Remover">
                  ✕
                </button>
              </div>
            </div>
          ))}
          <button className="add-cat" onClick={() => update({ items: [...content.items, newItem()] })}>
            + adicionar item
          </button>
        </div>
      </div>
    </section>
  );
}
