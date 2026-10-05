// Miniatura da foto na ficha. A retida por denúncia vem como rota autenticada da API: busca com o Bearer (fetch →
// blob), mostra a URL blob: local e revoga ao sair da tela; o clique abre o blob numa aba (nunca o caminho cru, que
// sem o token dá 401). As outras são URL pública, como sempre.
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { requestBlob } from '@/api/http';
import { loadProtectedPhoto, needsAuthFetch, type ProtectedPhotoDeps, type ProtectedPhotoState } from '@/lib/protected-photo';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/States';

const browserDeps: ProtectedPhotoDeps = {
  fetchBlob: (path, signal) => requestBlob(path, { signal }),
  createObjectURL: (b) => URL.createObjectURL(b),
  revokeObjectURL: (u) => URL.revokeObjectURL(u),
};

/** foto de rota autenticada como URL blob: (null = sem caminho); `retry` busca de novo */
export function useProtectedPhoto(path: string | null): { state: ProtectedPhotoState | null; retry: () => void } {
  const [state, setState] = useState<ProtectedPhotoState | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!path) {
      setState(null);
      return undefined;
    }
    return loadProtectedPhoto(path, browserDeps, setState);
  }, [path, attempt]);
  return { state, retry: () => setAttempt((n) => n + 1) };
}

interface Props {
  photo: { url: string; retained?: boolean; isMain: boolean };
  alt: string;
}

export function PhotoThumb({ photo, alt }: Props) {
  if (needsAuthFetch(photo)) return <RetainedPhotoThumb path={photo.url} alt={alt} />;
  return (
    <a className="thumb photo-thumb" href={photo.url} target="_blank" rel="noreferrer noopener" aria-label="Abrir foto em tamanho real">
      <img src={photo.url} alt={alt} loading="lazy" />
      {photo.isMain ? <span className="photo-main">Principal</span> : null}
    </a>
  );
}

function RetainedPhotoThumb({ path, alt }: { path: string; alt: string }) {
  const { state, retry } = useProtectedPhoto(path);
  const seal = <span className="photo-main photo-retained">Retida por denúncia</span>;
  if (state?.status === 'ready') {
    return (
      // blob: da própria aba; noopener sem noreferrer (o blob não sai do painel)
      <a className="thumb photo-thumb" href={state.url} target="_blank" rel="noopener" aria-label="Abrir foto retida em tamanho real">
        <img src={state.url} alt={alt} />
        {seal}
      </a>
    );
  }
  return (
    <div
      className="thumb photo-thumb photo-thumb-state"
      role={state?.status === 'error' ? 'alert' : 'status'}
      aria-label={state?.status === 'error' ? undefined : 'Carregando foto retida'}
    >
      {state?.status === 'error' ? (
        <>
          <span className="xsmall muted">{state.message}</span>
          <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={retry}>
            Tentar de novo
          </Button>
        </>
      ) : (
        <Skeleton height="100%" radius={0} />
      )}
      {seal}
    </div>
  );
}
