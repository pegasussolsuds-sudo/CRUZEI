// Campos com rótulo, dica, erro e contador ligados por id (leitor de tela lê tudo junto)
import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';

interface FieldShellProps {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  counter?: { value: number; max: number };
  className?: string;
  children: ReactNode;
}

export function FieldShell({ id, label, hint, error, required, counter, className, children }: FieldShellProps) {
  return (
    <div className={['field', className ?? ''].filter(Boolean).join(' ')}>
      <label className="field-label" htmlFor={id}>
        {label}
        {required ? (
          <span className="req" aria-hidden="true">
            *
          </span>
        ) : null}
        {counter ? (
          <span className={`field-counter${counter.value > counter.max ? ' over' : ''}`} aria-hidden="true">
            {counter.value}/{counter.max}
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <span className="field-error" id={`${id}-error`} role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="field-hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function describedBy(id: string, error?: string | null, hint?: ReactNode): string | undefined {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}

type Common = { label: ReactNode; hint?: ReactNode; error?: string | null; fieldClassName?: string; showCounter?: boolean };

export function TextField({ label, hint, error, fieldClassName, showCounter, id: idProp, className, required, maxLength, value, autoFocus, ...rest }: Common & ComponentPropsWithRef<'input'>) {
  const auto = useId();
  const id = idProp ?? auto;
  const len = typeof value === 'string' ? value.length : 0;
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={fieldClassName}
      counter={showCounter && maxLength ? { value: len, max: maxLength } : undefined}
    >
      <input
        id={id}
        className={['input', className ?? ''].filter(Boolean).join(' ')}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        required={required}
        maxLength={maxLength}
        value={value}
        autoFocus={autoFocus}
        data-autofocus={autoFocus ? 'true' : undefined}
        {...rest}
      />
    </FieldShell>
  );
}

export function TextAreaField({ label, hint, error, fieldClassName, showCounter, id: idProp, className, required, maxLength, value, autoFocus, ...rest }: Common & ComponentPropsWithRef<'textarea'>) {
  const auto = useId();
  const id = idProp ?? auto;
  const len = typeof value === 'string' ? value.length : 0;
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={fieldClassName}
      counter={showCounter && maxLength ? { value: len, max: maxLength } : undefined}
    >
      <textarea
        id={id}
        className={['textarea', className ?? ''].filter(Boolean).join(' ')}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        required={required}
        maxLength={maxLength}
        value={value}
        autoFocus={autoFocus}
        data-autofocus={autoFocus ? 'true' : undefined}
        {...rest}
      />
    </FieldShell>
  );
}

export function SelectField({
  label,
  hint,
  error,
  fieldClassName,
  id: idProp,
  className,
  required,
  children,
  ...rest
}: Omit<Common, 'showCounter'> & ComponentPropsWithRef<'select'>) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={required} className={fieldClassName}>
      <select
        id={id}
        className={['select', className ?? ''].filter(Boolean).join(' ')}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        required={required}
        {...rest}
      >
        {children}
      </select>
    </FieldShell>
  );
}

export function Checkbox({ label, checked, onChange, disabled, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className="col" style={{ gap: 2 }}>
      <label className="check" htmlFor={id}>
        <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-describedby={hint ? `${id}-hint` : undefined} />
        <span>{label}</span>
      </label>
      {hint ? (
        <span className="field-hint" id={`${id}-hint`} style={{ paddingLeft: 24 }}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
