import { RuleItem, RulesContent } from '../types';

interface Props {
  content: RulesContent;
  onChange: (content: RulesContent) => void;
}

function newRule(): RuleItem {
  return { id: `r${Date.now()}${Math.random().toString(36).slice(2, 6)}`, text: '', hot: false };
}

export default function RulesSection({ content, onChange }: Props) {
  function update(patch: Partial<RulesContent>) {
    onChange({ ...content, ...patch });
  }
  function updateItem(id: string, patch: Partial<RuleItem>) {
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
        <ul className="rules">
          {content.items.map((item) => (
            <li key={item.id} className={item.hot ? 'hot' : ''}>
              {item.text}
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
          </div>
          {content.items.map((item, idx) => (
            <div className="edit-list-item" key={item.id}>
              <textarea rows={2} value={item.text} onChange={(e) => updateItem(item.id, { text: e.target.value })} />
              <div className="row-actions">
                <label className="hot-toggle" title="Destacar como urgente">
                  <input type="checkbox" checked={item.hot} onChange={(e) => updateItem(item.id, { hot: e.target.checked })} />
                  urgente
                </label>
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
          <button className="add-cat" onClick={() => update({ items: [...content.items, newRule()] })}>
            + adicionar regra
          </button>
        </div>
      </div>
    </section>
  );
}
