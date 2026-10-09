import { FormEvent, useState } from 'react';
import { api, ApiError } from '../api';

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  // Segundo passo: o servidor mandou um código e espera por ele.
  const [step, setStep] = useState<{ challenge: string; via: 'telegram' | 'email' } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (step) {
        await api.verifyLogin(step.challenge, code);
        onSuccess();
        return;
      }
      const result = await api.login(username, password);
      if (result.ok) onSuccess();
      else {
        setStep({ challenge: result.challenge, via: result.via });
        setCode('');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao entrar');
    } finally {
      setLoading(false);
    }
  }

  function back() {
    setStep(null);
    setCode('');
    setPassword('');
    setError('');
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="eyebrow">meu financeiro</div>
        <h1>Seu próximo passo<br/>começa aqui<span className="mint-dot">.</span></h1>
        <p className="sub">
          {step
            ? `Mandei um código de 6 dígitos ${step.via === 'telegram' ? 'no seu Telegram' : 'para o seu e-mail'}. Ele vale por 5 minutos.`
            : 'Entre para acompanhar seu planejamento financeiro.'}
        </p>
        <form onSubmit={handleSubmit}>
          {error && <div className="login-error">{error}</div>}
          {step ? (
            <div className="login-field">
              <label htmlFor="code">Código de acesso</label>
              <input
                id="code"
                name="code"
                className="login-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
                autoFocus
              />
            </div>
          ) : (
            <>
              <div className="login-field">
                <label htmlFor="username">Usuário</label>
                <input
                  id="username"
                  name="username"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="login-field">
                <label htmlFor="password">Senha</label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </>
          )}
          <button type="submit" disabled={loading || (!!step && code.length !== 6)}>
            {loading ? 'Entrando…' : step ? 'Confirmar' : 'Entrar'}
          </button>
          {step && (
            <button type="button" className="login-back" onClick={back} disabled={loading}>
              Voltar e pedir outro código
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
