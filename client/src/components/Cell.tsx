import { useEffect, useState } from 'react';
import { parseValue } from '../calc';

const formatNumber = (v: number) => (v ? v.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '0');

export default function Cell({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(() => formatNumber(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(formatNumber(value));
  }, [value, focused]);

  return (
    <input
      value={text}
      className={parseValue(text) === 0 ? 'zero' : ''}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseValue(e.target.value));
      }}
      onBlur={() => {
        setFocused(false);
        setText(formatNumber(parseValue(text)));
      }}
    />
  );
}
