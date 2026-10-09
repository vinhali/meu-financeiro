import { HeaderContent } from '../types';

interface Props {
  content: HeaderContent;
  onChange: (content: HeaderContent) => void;
}

export default function Header({ content, onChange }: Props) {
  function update(patch: Partial<HeaderContent>) {
    onChange({ ...content, ...patch });
  }

  return (
    <header>
      <div className="wrap">
        <div className="eyebrow">{content.eyebrow}</div>
        <h1>{content.title}</h1>
        <p className="sub" style={{ marginTop: 8 }}>
          {content.sub}
        </p>
        <div className="note-box">
          <b>{content.noteTitle}</b> {content.note}
        </div>

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
            <label>Subtítulo</label>
            <textarea rows={3} value={content.sub} onChange={(e) => update({ sub: e.target.value })} />
          </div>
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
    </header>
  );
}
