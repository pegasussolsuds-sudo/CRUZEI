// Diálogo com <dialog> nativo: showModal() dá foco preso, Esc e fundo inerte de graça.
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  iconTone?: 'danger' | 'premium' | 'accent' | 'neutral';
  size?: 'sm' | 'md' | 'lg';
  /** enquanto salva: Esc e clique fora não fecham */
  busy?: boolean;
  footer?: ReactNode;
  children?: ReactNode;
  /** vira <form>: Enter envia */
  onSubmit?: () => void;
}

export function Dialog({ open, onClose, title, description, icon, iconTone = 'neutral', size = 'sm', busy, footer, children, onSubmit }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      // showModal põe o foco no primeiro botão (o X); melhor começar no primeiro campo do formulário
      // (o autoFocus do React roda antes do showModal e se perde; os campos marcam data-autofocus)
      const first =
        el.querySelector<HTMLElement>('[data-autofocus="true"]') ??
        el.querySelector<HTMLElement>(
          '.dialog-body input:not([type="hidden"]):not(:disabled), .dialog-body textarea:not(:disabled), .dialog-body select:not(:disabled), .dialog-body [role="radio"][tabindex="0"]',
        );
      first?.focus();
    }
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      if (!busy) onClose();
    };
    el.addEventListener('cancel', onCancel);
    return () => el.removeEventListener('cancel', onCancel);
  }, [busy, onClose]);

  const body = (
    <>
      <header className="dialog-head">
        {icon ? <div className={`dialog-icon${iconTone !== 'neutral' ? ` dialog-icon-${iconTone}` : ''}`}>{icon}</div> : null}
        <div className="grow">
          <h2 id={titleId}>{title}</h2>
          {description ? <p id={descId}>{description}</p> : null}
        </div>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onClose} disabled={busy} aria-label="Fechar">
          <X size={18} />
        </button>
      </header>
      {children ? <div className="dialog-body">{children}</div> : null}
      {footer ? <footer className="dialog-foot">{footer}</footer> : null}
    </>
  );

  return (
    <dialog
      ref={ref}
      className={`dialog${size !== 'sm' ? ` dialog-${size}` : ''}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClick={(e) => {
        // clique no fundo (fora da caixa) fecha
        if (e.target === ref.current && !busy) onClose();
      }}
    >
      {open ? (
        onSubmit ? (
          <form
            style={{ display: 'contents' }}
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy) onSubmit();
            }}
          >
            {body}
          </form>
        ) : (
          body
        )
      ) : null}
    </dialog>
  );
}
