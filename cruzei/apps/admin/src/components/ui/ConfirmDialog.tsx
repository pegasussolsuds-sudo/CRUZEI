// Confirmação antes de ação que mexe com gente de verdade: motivo opcional/obrigatório e, pra ação
// grande, digitar um texto exato. Mostra o erro da API sem fechar.
import { useEffect, useState, type ReactNode } from 'react';
import { errorMessage } from '@/api/http';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { TextAreaField, TextField } from './Field';

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  tone?: 'danger' | 'primary' | 'premium';
  confirmLabel: string;
  reason?: { label: string; placeholder?: string; required?: boolean; hint?: string; maxLength?: number; minLength?: number };
  /** texto que a pessoa precisa digitar igualzinho pra liberar o botão */
  typed?: { expected: string; label: ReactNode; matches?: (typed: string) => boolean };
  onConfirm: (reason: string) => Promise<unknown> | void;
  children?: ReactNode;
  /** trava o botão por motivo externo (ex.: formulário extra inválido) */
  disabled?: boolean;
}

export function ConfirmDialog({ open, onClose, title, description, icon, tone = 'danger', confirmLabel, reason, typed, onConfirm, children, disabled }: ConfirmDialogProps) {
  const [text, setText] = useState('');
  const [typedText, setTypedText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setText('');
      setTypedText('');
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const minLength = reason?.minLength ?? (reason?.required ? 3 : 0);
  const reasonOk = !reason || text.trim().length >= minLength;
  const typedOk = !typed || (typed.matches ? typed.matches(typedText) : typedText.trim() === typed.expected);
  const canConfirm = reasonOk && typedOk && !disabled;

  const submit = async () => {
    if (!canConfirm || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(text.trim());
      setBusy(false);
      onClose();
    } catch (e) {
      setBusy(false);
      setError(errorMessage(e));
    }
  };

  const variant = tone === 'danger' ? 'danger' : tone === 'premium' ? 'premium' : 'primary';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      icon={icon}
      iconTone={tone === 'primary' ? 'accent' : tone}
      busy={busy}
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Voltar
          </Button>
          <Button type="submit" variant={variant} loading={busy} disabled={!canConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {reason ? (
        <TextAreaField
          label={reason.label}
          placeholder={reason.placeholder}
          hint={reason.hint}
          required={reason.required}
          maxLength={reason.maxLength ?? 255}
          showCounter
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
      ) : null}
      {typed ? (
        <TextField
          label={typed.label}
          value={typedText}
          onChange={(e) => setTypedText(e.target.value)}
          autoComplete="off"
          inputMode="numeric"
          className="num"
          autoFocus={!reason}
        />
      ) : null}
      {error ? (
        <div className="banner banner-danger" role="alert">
          <span>{error}</span>
        </div>
      ) : null}
    </Dialog>
  );
}
