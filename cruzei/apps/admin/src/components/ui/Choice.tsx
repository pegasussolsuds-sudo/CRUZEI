// Escolha única (radiogroup) em dois formatos: segmentado compacto e cartões com descrição.
// Teclado: setas mudam a escolha, Tab entra/sai do grupo (tabindex "roving").
import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface ChoiceOption<T extends string> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

function useRoving<T extends string>(options: readonly ChoiceOption<T>[], value: T, onChange: (v: T) => void) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
    if (!enabled.length) return;
    const pos = enabled.indexOf(idx);
    let next = idx;
    if (e.key === 'Home') next = enabled[0] ?? idx;
    else if (e.key === 'End') next = enabled[enabled.length - 1] ?? idx;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = enabled[(pos + 1) % enabled.length] ?? idx;
    else next = enabled[(pos - 1 + enabled.length) % enabled.length] ?? idx;
    const opt = options[next];
    if (opt) {
      onChange(opt.value);
      refs.current[next]?.focus();
    }
  };
  const tabIndexFor = (i: number) => {
    const selected = options.findIndex((o) => o.value === value);
    return (selected === -1 ? i === 0 : i === selected) ? 0 : -1;
  };
  return { refs, onKeyDown, tabIndexFor };
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly ChoiceOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const { refs, onKeyDown, tabIndexFor } = useRoving(options, value, onChange);
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={tabIndexFor(i)}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function OptionCards<T extends string>({
  options,
  value,
  onChange,
  label,
  labelledBy,
}: {
  options: readonly ChoiceOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label?: string;
  labelledBy?: string;
}) {
  const { refs, onKeyDown, tabIndexFor } = useRoving(options, value, onChange);
  return (
    <div className="option-grid" role="radiogroup" aria-label={label} aria-labelledby={labelledBy}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          className="option"
          aria-checked={o.value === value}
          tabIndex={tabIndexFor(i)}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {o.icon}
          <span>
            <span className="option-title">{o.label}</span>
            {o.description ? <span className="option-desc" style={{ display: 'block' }}>{o.description}</span> : null}
          </span>
        </button>
      ))}
    </div>
  );
}

/** vários ligados/desligados (canais): cada um é um botão de alternar */
export function ToggleCards<K extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { key: K; label: ReactNode; description?: ReactNode; icon?: ReactNode; disabled?: boolean }[];
  value: Record<K, boolean>;
  onChange: (next: Record<K, boolean>) => void;
  label: string;
}) {
  return (
    <div className="option-grid" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          className="option"
          aria-pressed={value[o.key]}
          disabled={o.disabled}
          onClick={() => onChange({ ...value, [o.key]: !value[o.key] })}
        >
          {o.icon}
          <span>
            <span className="option-title">{o.label}</span>
            {o.description ? <span className="option-desc" style={{ display: 'block' }}>{o.description}</span> : null}
          </span>
        </button>
      ))}
    </div>
  );
}
