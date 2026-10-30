'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { renderContent } from './ChatApp';

type Profile = { username: string; display_name: string | null; avatar_url: string | null };
type Conversation = { id: string; other_id: string; other: Profile };
type Reaction = { emoji: string; count: number; mine: boolean };
type Message = { id: string; content: string; created_at: string; author_id: string; image_url?: string | null; author?: Profile };

type Props = { user: { id: string; email: string }; profile: Profile; onlineIds: string[] };

const QUICK = ['👍', '❤️', '😂', '🔥', '🎉'];

export default function DirectMessages({ user, profile, onlineIds }: Props) {
  const supabase = createClient();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<Record<string, Reaction[]>>({});
  const [draft, setDraft] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const imageInput = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageIds = useRef<string[]>([]);

  const hydrate = useCallback(async (rows: Message[]) => {
    const ids = [...new Set(rows.map((m) => m.author_id))];
    if (!ids.length) return rows;
    const { data } = await supabase.from('profiles').select('id,username,display_name,avatar_url').in('id', ids);
    const map = new Map((data ?? []).map((p: any) => [p.id, p]));
    return rows.map((m) => ({ ...m, author: map.get(m.author_id) }));
  }, [supabase]);

  const loadReactions = useCallback(async (ids: string[]) => {
    if (!ids.length) return setReactions({});
    const { data } = await supabase.from('dm_message_reactions').select('message_id,emoji,user_id').in('message_id', ids);
    const grouped: Record<string, Reaction[]> = {};
    (data ?? []).forEach((r: any) => {
      grouped[r.message_id] ??= [];
      const found = grouped[r.message_id].find((x) => x.emoji === r.emoji);
      if (found) { found.count++; found.mine = found.mine || r.user_id === user.id; }
      else grouped[r.message_id].push({ emoji: r.emoji, count: 1, mine: r.user_id === user.id });
    });
    setReactions(grouped);
  }, [supabase, user.id]);

  const loadConversations = useCallback(async () => {
    const { data } = await supabase.from('dm_conversations').select('*').order('created_at', { ascending: false });
    const rows = data ?? [];
    if (!rows.length) return setConversations([]);
    const otherIds = rows.map((c: any) => (c.user_a === user.id ? c.user_b : c.user_a));
    const { data: profiles } = await supabase.from('profiles').select('id,username,display_name,avatar_url').in('id', otherIds);
    const map = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    setConversations(rows.map((c: any) => {
      const otherId = c.user_a === user.id ? c.user_b : c.user_a;
      return { id: c.id, other_id: otherId, other: map.get(otherId) ?? { username: 'usuario', display_name: 'Usuário', avatar_url: null } };
    }));
  }, [supabase, user.id]);

  const loadMessages = useCallback(async (conversationId: string) => {
    const { data } = await supabase.from('dm_messages').select('*').eq('conversation_id', conversationId).order('created_at', { ascending: true }).limit(200);
    const hydrated = await hydrate((data ?? []) as Message[]);
    setMessages(hydrated);
    messageIds.current = hydrated.map((m) => m.id);
    loadReactions(messageIds.current);
  }, [supabase, hydrate, loadReactions]);

  useEffect(() => { loadConversations(); }, []); // eslint-disable-line
  useEffect(() => {
    if (!active) return;
    loadMessages(active.id);
    const room = supabase
      .channel(`dm:${active.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_messages', filter: `conversation_id=eq.${active.id}` }, async (payload) => {
        const row = payload.new as Message;
        const [hydrated] = await hydrate([row]);
        setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, hydrated]));
        messageIds.current = [...messageIds.current, row.id];
        loadReactions(messageIds.current);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dm_message_reactions' }, () => loadReactions(messageIds.current))
      .subscribe();
    return () => { supabase.removeChannel(room); };
  }, [active?.id]); // eslint-disable-line
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  async function toggleReaction(messageId: string, emoji: string) {
    const current = reactions[messageId]?.find((r) => r.emoji === emoji);
    if (current?.mine) {
      await supabase.from('dm_message_reactions').delete().eq('message_id', messageId).eq('emoji', emoji).eq('user_id', user.id);
    } else {
      await supabase.from('dm_message_reactions').insert({ message_id: messageId, user_id: user.id, emoji });
    }
    loadReactions(messageIds.current);
  }

  async function startConversation(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const clean = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!clean) return;
    const { data: other, error } = await supabase.from('profiles').select('id,username,display_name,avatar_url').eq('username', clean).single();
    if (error || !other) return setError('Usuário não encontrado.');
    if (other.id === user.id) return setError('Você não pode conversar consigo mesmo.');
    const { data: conversationId, error: rpcError } = await supabase.rpc('ensure_dm', { p_other: other.id });
    if (rpcError || !conversationId) return setError(rpcError?.message ?? 'Erro ao abrir conversa.');
    await loadConversations();
    setActive({ id: conversationId, other_id: other.id, other });
    setUsername('');
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content || !active) return;
    setDraft('');
    const { error } = await supabase.from('dm_messages').insert({ conversation_id: active.id, author_id: user.id, content });
    if (error) setError(error.message);
  }

  async function uploadImage(file: File) {
    if (!active) return;
    const ext = file.name.split('.').pop() ?? 'png';
    const path = `${user.id}/${Date.now()}.${ext}`;
    const { error: up } = await supabase.storage.from('chat-images').upload(path, file);
    if (up) return setError(up.message);
    const { data } = supabase.storage.from('chat-images').getPublicUrl(path);
    const { error } = await supabase.from('dm_messages').insert({ conversation_id: active.id, author_id: user.id, content: draft.trim() || 'Imagem', image_url: data.publicUrl });
    if (error) setError(error.message);
    setDraft('');
  }

  return (
    <div className="dm-layout">
      <aside className="dm-list">
        <form onSubmit={startConversation} className="dm-start">
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="@usuario" />
          <button type="submit">Nova DM</button>
        </form>
        <div className="dm-items">
          {conversations.map((c) => (
            <button key={c.id} className={`channel ${active?.id === c.id ? 'active' : ''}`} onClick={() => setActive(c)}>
              <div className="avatar-wrap">
                {c.other.avatar_url ? <img className="avatar-img" src={c.other.avatar_url} alt="avatar" /> : <div className="avatar">{(c.other.display_name || c.other.username).slice(0, 1).toUpperCase()}</div>}
                {onlineIds.includes(c.other_id) && <span className="online-dot" />}
              </div>
              <span>{c.other.display_name || c.other.username}</span>
            </button>
          ))}
        </div>
      </aside>
      <main className="chat">
        {active ? (
          <>
            <header className="chat-header">
              <div className="avatar-wrap">
                {active.other.avatar_url ? <img className="avatar-img" src={active.other.avatar_url} alt="avatar" /> : <div className="avatar">{(active.other.display_name || active.other.username).slice(0, 1).toUpperCase()}</div>}
                {onlineIds.includes(active.other_id) && <span className="online-dot" />}
              </div>
              <strong>{active.other.display_name || active.other.username}</strong>
              <span style={{ color: 'var(--muted)' }}>@{active.other.username}</span>
            </header>
            <div className="messages">
              {messages.map((message) => (
                <div className="message" key={message.id}>
                  <div className="avatar">{(message.author?.display_name || message.author?.username || 'U').slice(0, 1).toUpperCase()}</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="message-head">
                      <span className="message-author">{message.author?.display_name || message.author?.username || 'Usuário'}</span>
                      <span className="message-time">{new Date(message.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <div className="message-content">{renderContent(message.content)}</div>
                    {message.image_url && <img className="chat-image" src={message.image_url} alt="imagem" loading="lazy" />}
                    <div className="quick-reactions">
                      {QUICK.map((emoji) => <button key={emoji} onClick={() => toggleReaction(message.id, emoji)}>{emoji}</button>)}
                    </div>
                    {reactions[message.id]?.length > 0 && (
                      <div className="reaction-row">
                        {reactions[message.id].map((r) => (
                          <button key={r.emoji} className={`reaction ${r.mine ? 'mine' : ''}`} onClick={() => toggleReaction(message.id, r.emoji)}>{r.emoji} {r.count}</button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
            <div className="composer">
              <form onSubmit={sendMessage}>
                <button type="button" className="attach-btn" onClick={() => imageInput.current?.click()}>🖼</button>
                <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Mensagem para ${active.other.username}`} />
                <button type="submit">Enviar</button>
              </form>
              {error && <p className="error">{error}</p>}
            </div>
          </>
        ) : (
          <div className="empty"><div><h2>Mensagens diretas</h2><p>Digite o @usuario para começar.</p></div></div>
        )}
      </main>
      <input ref={imageInput} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0])} />
    </div>
  );
