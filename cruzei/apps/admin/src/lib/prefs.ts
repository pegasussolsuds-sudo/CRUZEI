// Preferências só deste navegador (tema, som, barra recolhida). Nunca dado de sessão.
const PREFIX = 'metch-admin:';

export function readPref(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(PREFIX + key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    // armazenamento bloqueado: vale só até recarregar
  }
}
