// Título da aba: "(3) Suporte · metch admin" — o número é quem espera no suporte;
// com mensagem nova chegando e a aba escondida, ganha um "•" na frente.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useSupportLive } from '@/realtime/SupportLive';

const APP_NAME = 'metch admin';

const TitleContext = createContext<(t: string) => void>(() => undefined);

export function TitleProvider({ children }: { children: ReactNode }) {
  const [page, setPage] = useState('');
  const { waiting, unseen, urgentCount } = useSupportLive();

  useEffect(() => {
    const base = page ? `${page} · ${APP_NAME}` : APP_NAME;
    const count = waiting > 0 ? `(${waiting}) ` : '';
    const dot = unseen > 0 ? '• ' : '';
    // emergência sem resolver: 🆘 na frente de tudo
    const sos = urgentCount > 0 ? '🆘 ' : '';
    document.title = `${sos}${dot}${count}${base}`;
  }, [page, waiting, unseen, urgentCount]);

  return <TitleContext.Provider value={setPage}>{children}</TitleContext.Provider>;
}

export function usePageTitle(title: string): void {
  const set = useContext(TitleContext);
  useEffect(() => {
    set(title);
  }, [set, title]);
}
