'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'signup') {
        const clean = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
        if (clean.length < 3) throw new Error('Usuário precisa ter pelo menos 3 caracteres.');
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.user) throw new Error('Confirme o e-mail antes de entrar.');
        const { error: profileError } = await supabase.from('profiles').insert({
          id: data.user.id, username: clean, display_name: clean
        });
        if (profileError) throw profileError;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.replace('/chat');
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? 'Erro inesperado.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="logo">
          <div className="logo-mark">💜</div>
          <div>
            <h1>MiikaCord</h1>
            <p>Sua comunidade, do jeito mais bonito.</p>
          </div>
        </div>
        <form onSubmit={submit}>
          {mode === 'signup' && (
            <div className="field">
              <label>Nome de usuário</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ex: miika" required />
            </div>
          )}
          <div className="field">
            <label>E-mail</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label>Senha</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
          </div>
          {error && <p className="error">{error}</p>}
          <button className="btn" disabled={loading}>{loading ? 'Carregando...' : mode === 'signin' ? 'Entrar' : 'Criar conta'}</button>
        </form>
        <p style={{ textAlign: 'center', marginTop: 18, color: 'var(--muted)', fontSize: 14 }}>
          {mode === 'signin' ? 'Não tem conta?' : 'Já tem conta?'}{' '}
          <button type="button" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')} style={{ background: 'none', color: 'var(--brand)', fontWeight: 600 }}>
            {mode === 'signin' ? 'Criar conta' : 'Entrar'}
          </button>
        </p>
      </div>
    </main>
  );
}
