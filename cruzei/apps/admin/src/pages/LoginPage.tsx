// Entrar: telefone → código (mesmo login do app). Em dev a API devolve o código e a gente mostra.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { authApi } from '@/api/admin';
import { errorMessage, isHttpError } from '@/api/http';
import { useAuth } from '@/auth/AuthProvider';
import { formatPhoneInput, isValidPhoneBR } from '@/lib/format';
import { usePageTitle } from '@/components/layout/title';
import { Button } from '@/components/ui/Button';

const RESEND_SECONDS = 30;

export function LoginPage() {
  usePageTitle('Entrar');
  const { login, notice, clearNotice } = useAuth();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
    else phoneRef.current?.focus();
  }, [step]);

  const phoneOk = isValidPhoneBR(phone);

  const sendCode = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!phoneOk || busy) return;
    setBusy(true);
    setError(null);
    clearNotice();
    try {
      const res = await authApi.requestCode(phone);
      setDevCode(res.devCode ?? null);
      setCode('');
      setStep('code');
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      setError(errorMessage(err));
      if (isHttpError(err, 429)) {
        const secs = Number(/(\d+)\s*s/.exec(errorMessage(err))?.[1] ?? RESEND_SECONDS);
        setCooldown(Number.isFinite(secs) ? secs : RESEND_SECONDS);
      }
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e?: FormEvent) => {
    e?.preventDefault();
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(phone, code);
    } catch (err) {
      setBusy(false);
      setError(errorMessage(err));
      // conta sem acesso (ou sem cadastro): o código já foi gasto, volta pro telefone
      if (isHttpError(err, 403) || isHttpError(err, 404)) {
        setCode('');
        setDevCode(null);
        setCooldown(0);
        setStep('phone');
      }
    }
  };

  // 6 dígitos digitados: entra direto
  useEffect(() => {
    if (step === 'code' && code.length === 6 && !busy && !error) void submitCode();
  }, [code]); // só quando o código muda (não a cada render)

  return (
    <div className="login">
      <aside className="login-brand" aria-hidden="true">
        <div className="login-glow" />
        <div className="brand" style={{ padding: 0 }}>
          <span className="brand-mark">m</span>
          <span className="brand-name">
            metch<span className="dot">.</span>
          </span>
          <span className="brand-tag">admin</span>
        </div>
        <div className="login-hero">
          <h1>
            O Metch por trás
            <br />
            <span className="text-lime">do mapa.</span>
          </h1>
          <p>Moderação, lugares, eventos, avisos e suporte ao vivo. Tudo num lugar só, pra equipe cuidar da galera.</p>
        </div>
        <ul className="login-points">
          <li>
            <ShieldCheck size={16} /> Só entra quem é da equipe
          </li>
          <li>
            <Lock size={16} /> Toda ação fica registrada na auditoria
          </li>
        </ul>
      </aside>

      <main className="login-main">
        <div className="login-card">
          {step === 'phone' ? (
            <form onSubmit={sendCode} className="stack" noValidate>
              <div>
                <div className="eyebrow">Painel da equipe</div>
                <h2 className="login-title">Entrar</h2>
                <p className="muted">Use o mesmo número da sua conta no app. A gente manda um código.</p>
              </div>
              {notice ? (
                <div className="banner banner-warning" role="alert">
                  <Lock size={16} />
                  <span>{notice}</span>
                </div>
              ) : null}
              <div className="field">
                <label className="field-label" htmlFor="login-phone">
                  Telefone
                </label>
                <input
                  ref={phoneRef}
                  id="login-phone"
                  className="input input-lg num"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  placeholder="(34) 99999-9999"
                  value={phone}
                  onChange={(e) => {
                    setError(null);
                    setPhone(formatPhoneInput(e.target.value));
                  }}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'login-error' : undefined}
                />
              </div>
              {error ? (
                <div className="field-error" id="login-error" role="alert">
                  {error}
                </div>
              ) : null}
              <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={!phoneOk || cooldown > 0} icon={busy ? undefined : <ArrowRight size={18} />}>
                {cooldown > 0 ? `Espera ${cooldown}s` : 'Receber código'}
              </Button>
            </form>
          ) : (
            <form onSubmit={submitCode} className="stack" noValidate>
              <div>
                <button
                  type="button"
                  className="back-link"
                  style={{ border: 0, background: 'none', padding: 0 }}
                  onClick={() => {
                    setStep('phone');
                    setError(null);
                  }}
                >
                  <ArrowLeft size={14} /> Trocar número
                </button>
                <h2 className="login-title">Digite o código</h2>
                <p className="muted">
                  Mandamos 6 dígitos pra <span className="num strong">{phone}</span>.
                </p>
              </div>
              {devCode ? (
                <div className="banner banner-gold">
                  <KeyRound size={16} />
                  <div className="grow">
                    <div className="small strong">Ambiente de teste</div>
                    <div className="small">
                      Código: <span className="num strong">{devCode}</span>
                    </div>
                  </div>
                  <Button size="sm" onClick={() => setCode(devCode)}>
                    Usar
                  </Button>
                </div>
              ) : null}
              <div className="field">
                <label className="field-label" htmlFor="login-code">
                  Código
                </label>
                <input
                  ref={codeRef}
                  id="login-code"
                  className="input input-lg input-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="••••••"
                  value={code}
                  onChange={(e) => {
                    setError(null);
                    setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                  }}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'login-error' : undefined}
                />
              </div>
              {error ? (
                <div className="field-error" id="login-error" role="alert">
                  {error}
                </div>
              ) : null}
              <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={code.length !== 6}>
                Entrar no painel
              </Button>
              <Button variant="ghost" size="sm" disabled={cooldown > 0 || busy} onClick={() => void sendCode()}>
                {cooldown > 0 ? `Reenviar em ${cooldown}s` : 'Reenviar código'}
              </Button>
            </form>
          )}
        </div>
        <p className="xsmall faint" style={{ textAlign: 'center' }}>
          Acesso restrito à equipe do Metch.
        </p>
      </main>
    </div>
  );
}
