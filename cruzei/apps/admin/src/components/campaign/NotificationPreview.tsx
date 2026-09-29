// Como o aviso aparece no celular (push) e na central de avisos do app
import { Bell } from 'lucide-react';
import type { NotificationTarget } from '@cruzei/shared-types';
import { describeTarget } from '@/lib/audience';

export function NotificationPreview({ title, body, target }: { title: string; body: string; target: NotificationTarget | null }) {
  return (
    <div className="phone" aria-label="Prévia da notificação">
      <div className="phone-notch" aria-hidden="true" />
      <div className="phone-time num" aria-hidden="true">
        21:30
      </div>
      <div className="push-card">
        <div className="push-app">
          <span className="push-icon" aria-hidden="true">
            m
          </span>
          <span>Metch</span>
          <span className="faint">· agora</span>
        </div>
        <div className="push-title">{title.trim() || 'Título do aviso'}</div>
        <div className="push-body">{body.trim() || 'O texto aparece aqui. Curto e direto funciona melhor.'}</div>
      </div>
      <div className="push-target">
        <Bell size={12} aria-hidden="true" /> Ao tocar: {describeTarget(target).toLowerCase()}
      </div>
    </div>
  );
}
