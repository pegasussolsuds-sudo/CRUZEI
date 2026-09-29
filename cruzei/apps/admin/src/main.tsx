import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/jetbrains-mono';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/layout.css';
import './styles/pages.css';
import { isHttpError } from '@/api/http';
import { AuthProvider } from '@/auth/AuthProvider';
import { SocketProvider } from '@/realtime/SocketProvider';
import { SupportLiveProvider } from '@/realtime/SupportLive';
import { TitleProvider } from '@/components/layout/title';
import { ToastProvider } from '@/components/ui/Toast';
import { App } from './App';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      // 4xx não melhora tentando de novo; rede/5xx ganha mais uma chance
      retry: (count, error) => !(isHttpError(error) && error.status >= 400 && error.status < 500) && count < 1,
    },
    mutations: { retry: false },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('#root não existe no index.html');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <SocketProvider>
            <SupportLiveProvider>
              <TitleProvider>
                <App />
              </TitleProvider>
            </SupportLiveProvider>
          </SocketProvider>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
