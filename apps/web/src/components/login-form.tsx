import { useState } from 'preact/hooks';
import { authClient } from '../lib/auth-client';

export function LoginForm() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: Event) {
    event.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const result = mode === 'signin'
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ name, email, password, callbackURL: '/app' });
      if (result.error) throw new Error(result.error.message || 'No se pudo iniciar sesión.');
      if (mode === 'signup' && result.data?.token === null) {
        setNotice('Te enviamos un correo para verificar la cuenta. Cuando confirmes tu dirección podrás iniciar sesión.');
        return;
      }
      window.location.assign('/app');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo completar la operación.');
    } finally {
      setBusy(false);
    }
  }

  async function signInWithGoogle() {
    setError('');
    setBusy(true);
    try {
      const result = await authClient.signIn.social({ provider: 'google', callbackURL: '/app' });
      if (result.error) throw new Error(result.error.message || 'No se pudo conectar con Google.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Google OAuth no está configurado.');
      setBusy(false);
    }
  }

  return (
    <div class="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-xl shadow-slate-900/5 sm:p-9">
      <div class="mb-7">
        <div class="mb-5 grid size-12 place-items-center rounded-2xl bg-brand-50 text-brand-700">
          <span class="text-xl font-bold">C</span>
        </div>
        <h2 class="text-2xl font-bold tracking-tight">{mode === 'signin' ? 'Bienvenido de nuevo' : 'Crea tu cuenta'}</h2>
        <p class="mt-2 text-sm text-slate-500">Sesión segura con acceso por tenant.</p>
      </div>
      <form class="space-y-4" onSubmit={submit}>
        {mode === 'signup' && (
          <label class="block text-sm font-medium text-slate-700">
            Nombre
            <input required minLength={2} autoComplete="name" value={name} onInput={(event) => setName(event.currentTarget.value)} class="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-3 outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100" />
          </label>
        )}
        <label class="block text-sm font-medium text-slate-700">
          Correo
          <input required type="email" autoComplete="email" value={email} onInput={(event) => setEmail(event.currentTarget.value)} class="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-3 outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100" />
        </label>
        <label class="block text-sm font-medium text-slate-700">
          Contraseña
          <input required minLength={12} type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={password} onInput={(event) => setPassword(event.currentTarget.value)} class="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-3 outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100" />
          {mode === 'signup' && <span class="mt-1 block text-xs font-normal text-slate-500">Usa al menos 12 caracteres.</span>}
        </label>
        {error && <p role="alert" class="rounded-xl bg-rose-50 px-3.5 py-3 text-sm text-rose-700">{error}</p>}
        {notice && <p role="status" class="rounded-xl bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800">{notice}</p>}
        <button disabled={busy} class="w-full rounded-xl bg-brand-600 px-4 py-3 font-semibold text-white transition hover:bg-brand-700 disabled:cursor-wait disabled:opacity-60">
          {busy ? 'Un momento…' : mode === 'signin' ? 'Iniciar sesión' : 'Crear cuenta'}
        </button>
      </form>
      <div class="my-5 flex items-center gap-3 text-xs uppercase tracking-wide text-slate-400"><span class="h-px flex-1 bg-slate-200"></span>o continúa con<span class="h-px flex-1 bg-slate-200"></span></div>
      <button type="button" disabled={busy} onClick={signInWithGoogle} class="w-full rounded-xl border border-slate-300 px-4 py-3 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60">Google</button>
      <p class="mt-6 text-center text-sm text-slate-600">
        {mode === 'signin' ? '¿Aún no tienes cuenta?' : '¿Ya tienes cuenta?'}{' '}
        <button type="button" class="font-semibold text-brand-700 hover:underline" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); }}>
          {mode === 'signin' ? 'Regístrate' : 'Inicia sesión'}
        </button>
      </p>
    </div>
  );
}
