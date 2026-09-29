// Sessão do painel: access token só em memória (some ao fechar/recarregar a aba), refresh token no
// sessionStorage da aba (recarregar não desloga, fechar a aba sim). Nada em localStorage.

const REFRESH_KEY = 'metch-admin:refresh';

type EndListener = (reason: string | null) => void;
type TokenListener = (token: string | null) => void;

let accessToken: string | null = null;
const endListeners = new Set<EndListener>();
const tokenListeners = new Set<TokenListener>();

function readRefresh(): string | null {
  try {
    return window.sessionStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

function writeRefresh(value: string | null): void {
  try {
    if (value) window.sessionStorage.setItem(REFRESH_KEY, value);
    else window.sessionStorage.removeItem(REFRESH_KEY);
  } catch {
    // aba anônima/armazenamento bloqueado: segue só com o token em memória
  }
}

export const session = {
  getAccessToken(): string | null {
    return accessToken;
  },
  getRefreshToken(): string | null {
    return readRefresh();
  },
  setTokens(token: string, refreshToken: string): void {
    accessToken = token;
    writeRefresh(refreshToken);
    tokenListeners.forEach((l) => l(token));
  },
  clear(): void {
    accessToken = null;
    writeRefresh(null);
    tokenListeners.forEach((l) => l(null));
  },
  /** encerra a sessão (refresh recusado, conta bloqueada…) e avisa quem estiver ouvindo */
  end(reason: string | null): void {
    session.clear();
    endListeners.forEach((l) => l(reason));
  },
  onEnd(l: EndListener): () => void {
    endListeners.add(l);
    return () => endListeners.delete(l);
  },
  onToken(l: TokenListener): () => void {
    tokenListeners.add(l);
    return () => tokenListeners.delete(l);
  },
};
