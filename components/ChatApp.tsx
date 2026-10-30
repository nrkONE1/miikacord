'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import DirectMessages from './DirectMessages';
import VoiceRoom from './VoiceRoom';

type Server = { id: string; name: string; icon: string; invite_code: string; owner_id: string };
type Channel = { id: string; name: string; topic: string | null; type: string };
type Profile = { username: string; display_name: string | null; avatar_url: string | null };
type Reaction = { emoji: string; count: number; mine: boolean };
type Message = { id: string; content: string; created_at: string; author_id: string; image_url?: string | null; author?: Profile };
type Notification = { id: string; title: string; body: string | null; read: boolean; created_at: string };

type Props = { user: { id: string; email: string }; profile: Profile };

const STAFF = ['owner', 'admin', 'moderator'];
const QUICK = ['👍', '❤️', '😂', '🔥', '🎉'];

export function renderContent(content: string) {
  return content.split(/(@[a-zA-Z0-9_]{3,32})/g).map((part, i) =>
    /^@[a-zA-Z0-9_]{3,32}$/.test(part)
      ? <span key={i} className="mention">{part}</span>
      : <span key={i}>{part}</span>
  );
}

export default function ChatApp({ user, profile }: Props) {
  const supabase = createClient();
  const router = useRouter();
  const [servers, setServers] = useState<Server[]>([]);
  const [activeServer, setActiveServer] = useState<Server | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [activeVoice, setActiveVoice] = useState<Channel | null>(null);
  const [view, setView] = useState<'server' | 'dm'>('server');
  const [messages, setMessages] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<Record<string, Reaction[]>>({});
  const [draft, setDraft] = useState('');
  const [modal, setModal] = useState<'server' | 'join' | 'channel' | null>(null);
  const [form, setForm] = useState({ name: '', icon: '💜', code: '', type: 'text' });
  const [error, setError] = useState('');
  const [myRole, setMyRole] = useState('member');
  const [onlineIds, setOnlineIds] = useState<string[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [me, setMe] = useState(profile);
  const imageInput = useRef<HTMLInputElement>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageIds = useRef<string[]>([]);

  const initials = (me.display_name || me.username || 'U').slice(0, 1).toUpperCase();
  const isStaff = STAFF.includes(myRole);
  const unread = notifications.filter((n) => !n.read).length;

  const loadServers = useCallback(async () => {
    const { data } = await supabase.from('servers').select('*').order('created_at');
    const list = data ?? [];
    setServers(list);
    if (list.length && !activeServer) setActiveServer(list[0]);
  }, [supabase, activeServer]);

  const loadChannels = useCallback(async (serverId: string) => {
    const { data } = await supabase.from('channels').select('*').eq('server_id', serverId).order('created_at');
    const list = (data ?? []) as Channel[];
    setChannels(list);
    setActiveChannel(list.find((c) => c.type === 'text') ?? null);
  }, [supabase]);

  const loadRole = useCallback(async (serverId: string) => {
    const { data } = await supabase.from('server_members').select('role').eq('server_id', serverId).eq('user_id', user.id).single();
    setMyRole(data?.role ?? 'member');
  }, [supabase, user.id]);

  const loadNotifications = useCallback(async () => {
    const { data } = await supabase.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(30);
    setNotifications((data ?? []) as Notification[]);
  }, [supabase, user.id]);

  const hydrateAuthors = useCallback(async (rows: Message[]) => {
    const ids = [...new Set(rows.map((m) => m.author_id))];
    if (!ids.length) return rows;
    const { data } = await supabase.from('profiles').select('id,username,display_name,avatar_url').in('id', ids);
    const map = new Map((data ?? []).map((p: any) => [p.id, p]));
    return rows.map((m) => ({ ...m, author: map.get(m.author_id) }));
  }, [supabase]);

  const loadReactions = useCallback(async (ids: string[]) => {
    if (!ids.length) return setReactions({});
    const { data } = await supabase.from('message_reactions').select('message_id,emoji,user_id').in('message_id', ids);
    const grouped: Record<string, Reaction[]> = {};
    (data ?? []).forEach((r: any) => {
      grouped[r.message_id] ??= [];
      const found = grouped[r.message_id].find((x) => x.emoji === r.emoji);
      if (found) { found.count++; found.mine = found.mine || r.user_id === user.id; }
      else grouped[r.message_id].push({ emoji: r.emoji, count: 1, mine: r.user_id === user.id });
    });
    setReactions(grouped);
  }, [supabase, user.id]);

  const loadMessages = useCallback(async (channelId: string) => {
    const { data } = await supabase.from('messages').select('*').eq('channel_id', channelId).order('created_at', { ascending: true }).limit(200);
    const hydrated = await hydrateAuthors((data ?? []) as Message[]);
    setMessages(hydrated);
    messageIds.current = hydrated.map((m) => m.id);
    loadReactions(messageIds.current);
  }, [supabase, hydrateAuthors, loadReactions]);

  useEffect(() => { loadServers(); loadNotifications(); }, []); // eslint-disable-line
  useEffect(() => { if (activeServer) loadRole(activeServer.id); }, [activeServer?.id]); // eslint-disable-line
  useEffect(() => { if (activeServer) loadChannels(activeServer.id); }, [activeServer?.id]); // eslint-disable-line

  useEffect(() => {
    const room = supabase.channel('presence:online', { config: { presence: { key: user.id } } });
    room.on('presence', { event: 'sync' }, () => setOnlineIds(Object.keys(room.presenceState())));
    room.subscribe((status) => { if (status === 'SUBSCRIBED') room.track({ online: true }); });
    return () => { supabase.removeChannel(room); };
  }, [supabase, user.id]);

  useEffect(() => {
    const room = supabase
      .channel(`notifications:${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, (payload) => {
        setNotifications((prev) => [payload.new as Notification, ...prev]);
      })
      .subscribe();
    return () => { supabase.removeChannel(room); };
  }, [supabase, user.id]);

  useEffect(() => {
    if (!activeChannel || activeChannel.type !== 'text') return;
    loadMessages(activeChannel.id);
    const room = supabase
      .channel(`messages:${activeChannel.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${activeChannel.id}` }, async (payload) => {
        const row = payload.new as Message;
        const [hydrated] = await hydrateAuthors([row]);
        setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, hydrated]));
        messageIds.current = [...messageIds.current, row.id];
        loadReactions(messageIds.current);
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages', filter: `channel_id=eq.${activeChannel.id}` }, (payload) => {
        const id = (payload.old as any).id;
        setMessages((prev) => prev.filter((m) => m.id !== id));
        messageIds.current = messageIds.current.filter((x) => x !== id);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, () => loadReactions(messageIds.current))
      .subscribe();
    return () => { supabase.removeChannel(room); };
  }, [activeChannel?.id]); // eslint-disable-line

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  function selectChannel(channel: Channel) {
    setView('server');
    if (channel.type === 'voice') setActiveVoice(channel);
    else { setActiveVoice(null); setActiveChannel(channel); }
  }

  async function toggleReaction(messageId: string, emoji: string) {
    const current = reactions[messageId]?.find((r) => r.emoji === emoji);
    if (current?.mine) {
      await supabase.from('message_reactions').delete().eq('message_id', messageId).eq('emoji', emoji).eq('user_id', user.id);
    } else {
      await supabase.from('message_reactions').insert({ message_id: messageId, user_id: user.id, emoji });
    }
    loadReactions(messageIds.current);
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content || !activeChannel) return;
    setDraft('');
    const { error } = await supabase.from('messages').insert({ channel_id: activeChannel.id, author_id: user.id, content });
    if (error) setError(error.message);
  }

  async function uploadImage(file: File) {
    if (!activeChannel) return;
    const ext = file.name.split('.').pop() ?? 'png';
    const path = `${user.id}/${Date.now()}.${ext}`;
    const { error: up } = await supabase.storage.from('chat-images').upload(path, file, { cacheControl: '3600', upsert: false });
    if (up) return setError(up.message);
    const { data } = supabase.storage.from('chat-images').getPublicUrl(path);
    const { error } = await supabase.from('messages').insert({ channel_id: activeChannel.id, author_id: user.id, content: draft.trim() || 'Imagem', image_url: data.publicUrl });
    if (error) setError(error.message);
    setDraft('');
  }

  async function uploadAvatar(file: File) {
    const ext = file.name.split('.').pop() ?? 'png';
    const path = `${user.id}/avatar.${ext}`;
    const { error: up } = await supabase.storage.from('avatars').upload(path, file, { cacheControl: '3600', upsert: true });
    if (up) return setError(up.message);
    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    await supabase.from('profiles').update({ avatar_url: data.publicUrl }).eq('id', user.id);
    setMe((prev) => ({ ...prev, avatar_url: data.publicUrl }));
  }

  async function deleteMessage(id: string) {
    const { error } = await supabase.from('messages').delete().eq('id', id);
    if (error) setError(error.message);
    else setMessages((prev) => prev.filter((m) => m.id !== id));
  }

  async function markRead() {
    await supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  async function createServer() {
    setError('');
    if (!form.name.trim()) return;
    const { data: server, error } = await supabase.from('servers').insert({ name: form.name.trim(), icon: form.icon || '💜', owner_id: user.id }).select().single();
    if (error || !server) return setError(error?.message ?? 'Erro ao criar servidor.');
    await supabase.from('server_members').insert({ server_id: server.id, user_id: user.id, role: 'owner' });
    await supabase.from('channels').insert([
      { server_id: server.id, name: 'geral', topic: 'Conversas gerais', type: 'text' },
      { server_id: server.id, name: 'voz-geral', topic: 'Canal de voz', type: 'voice' }
    ]);
    setModal(null);
    setForm({ name: '', icon: '💜', code: '', type: 'text' });
    setServers((prev) => [...prev, server]);
    setActiveServer(server);
  }

  async function joinServer() {
    setError('');
    if (!form.code.trim()) return;
    const { data, error } = await supabase.rpc('join_server_by_code', { p_code: form.code.trim() });
    if (error) return setError(error.message);
    const { data: server } = await supabase.from('servers').select('*').eq('id', data).single();
    if (server) {
      setModal(null);
      setForm({ name: '', icon: '💜', code: '', type: 'text' });
      setServers((prev) => (prev.some((s) => s.id === server.id) ? prev : [...prev, server]));
      setActiveServer(server);
    }
  }

  async function createChannel() {
    setError('');
    if (!activeServer || !form.name.trim()) return;
    const name = form.name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const { data, error } = await supabase.from('channels').insert({ server_id: activeServer.id, name, topic: form.name.trim(), type: form.type }).select().single();
    if (error || !data) return setError(error?.message ?? 'Erro ao criar canal.');
    setModal(null);
    setForm({ name: '', icon: '💜', code: '', type: 'text' });
    setChannels((prev) => [...prev, data]);
    selectChannel(data);
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="app">
      <aside className="server-rail">
        <button className={`server-pill ${view === 'dm' ? 'active' : ''}`} onClick={() => setView('dm')}>✉️</button>
        <div className="rail-divider" />
        {servers.map((server) => (
          <button key={server.id} className={`server-pill ${view === 'server' && activeServer?.id === server.id ? 'active' : ''}`} onClick={() => { setView('server'); setActiveServer(server); }}>{server.icon}</button>
        ))}
        <button className="server-pill" onClick={() => setModal('server')}>+</button>
        <button className="server-pill" onClick={() => setModal('join')}>🔗</button>
      </aside>

      {view === 'server' ? (
        <aside className="sidebar">
          <div className="sidebar-header">
            <span>{activeServer?.name ?? 'MiikaCord'}</span>
            {activeServer && <button className="icon-btn" onClick={() => setModal('channel')}>+</button>}
          </div>
          <div className="sidebar-body">
            <p className="section-label">Texto</p>
            {channels.filter((c) => c.type === 'text').map((c) => (
              <button key={c.id} className={`channel ${activeChannel?.id === c.id && !activeVoice ? 'active' : ''}`} onClick={() => selectChannel(c)}><span>#</span><span>{c.name}</span></button>
            ))}
            <p className="section-label">Voz</p>
            {channels.filter((c) => c.type === 'voice').map((c) => (
              <button key={c.id} className={`channel ${activeVoice?.id === c.id ? 'active' : ''}`} onClick={() => selectChannel(c)}><span>🔊</span><span>{c.name}</span></button>
            ))}
          </div>
          <div className="sidebar-footer">
            <button className="avatar-wrap" onClick={() => avatarInput.current?.click()}>
              {me.avatar_url ? <img className="avatar-img" src={me.avatar_url} alt="avatar" /> : <div className="avatar">{initials}</div>}
              <span className="online-dot" />
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{me.display_name || me.username}</div>
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>@{me.username} · {myRole}</div>
            </div>
            <button className="icon-btn bell" onClick={() => { setShowNotifications(!showNotifications); if (!showNotifications) markRead(); }}>🔔{unread > 0 && <span className="badge">{unread}</span>}</button>
            <button className="icon-btn" onClick={logout}>⏻</button>
          </div>
          {showNotifications && (
            <div className="notifications">
              <strong>Notificações</strong>
              {notifications.length === 0 && <p className="empty">Nenhuma notificação.</p>}
              {notifications.map((n) => (
                <div key={n.id} className={`notification ${n.read ? '' : 'unread'}`}>
                  <strong>{n.title}</strong><p>{n.body}</p><small>{new Date(n.created_at).toLocaleString('pt-BR')}</small>
                </div>
              ))}
            </div>
          )}
        </aside>
      ) : (
        <aside className="sidebar">
          <div className="sidebar-header"><span>Mensagens diretas</span></div>
          <div className="sidebar-body"><p className="empty">Selecione uma conversa.</p></div>
          <div className="sidebar-footer">
            <button className="avatar-wrap" onClick={() => avatarInput.current?.click()}>
              {me.avatar_url ? <img className="avatar-img" src={me.avatar_url} alt="avatar" /> : <div className="avatar">{initials}</div>}
              <span className="online-dot" />
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{me.display_name || me.username}</div>
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>@{me.username}</div>
            </div>
            <button className="icon-btn" onClick={logout}>⏻</button>
          </div>
        </aside>
      )}

      {view === 'dm' ? (
        <DirectMessages user={user} profile={me} onlineIds={onlineIds} />
      ) : activeVoice ? (
        <VoiceRoom channel={activeVoice} user={user} onLeave={() => setActiveVoice(null)} />
      ) : activeChannel ? (
        <main className="chat">
          <header className="chat-header">
            <strong># {activeChannel.name}</strong>
            {activeChannel.topic && <span style={{ color: 'var(--muted)' }}>— {activeChannel.topic}</span>}
            {isStaff && <span className="role-tag">{myRole}</span>}
          </header>
          <div className="messages">
            {messages.map((message) => (
              <div className="message" key={message.id}>
                <div className="avatar">{(message.author?.display_name || message.author?.username || 'U').slice(0, 1).toUpperCase()}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="message-head">
                    <span className="message-author">{message.author?.display_name || message.author?.username || 'Usuário'}</span>
                    <span className="message-time">{new Date(message.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                    {(message.author_id === user.id || isStaff) && <button className="delete-btn" onClick={() => deleteMessage(message.id)}>🗑</button>}
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
              <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Mensagem em #${activeChannel.name}. Use @usuario`} />
              <button type="submit">Enviar</button>
            </form>
            {error && <p className="error">{error}</p>}
          </div>
        </main>
      ) : (
        <main className="chat"><div className="empty"><div><h2>Bem-vindo ao MiikaCord</h2><p>Crie um servidor, entre com convite ou abra suas DMs.</p></div></div></main>
      )}

      <input ref={imageInput} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0])} />
      <input ref={avatarInput} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && uploadAvatar(e.target.files[0])} />

      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {modal === 'server' && (
              <>
                <h3>Criar servidor</h3>
                <div className="field"><label>Nome</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div className="field"><label>Ícone</label><input value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} maxLength={4} /></div>
                <div className="modal-actions"><button className="btn-ghost btn" onClick={() => setModal(null)}>Cancelar</button><button className="btn" onClick={createServer}>Criar</button></div>
              </>
            )}
            {modal === 'join' && (
              <>
                <h3>Entrar com convite</h3>
                <div className="field"><label>Código</label><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
                <div className="modal-actions"><button className="btn-ghost btn" onClick={() => setModal(null)}>Cancelar</button><button className="btn" onClick={joinServer}>Entrar</button></div>
              </>
            )}
            {modal === 'channel' && (
              <>
                <h3>Criar canal</h3>
                <div className="field"><label>Nome</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div className="field"><label>Tipo</label><select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="select"><option value="text">Texto</option><option value="voice">Voz</option></select></div>
                <div className="modal-actions"><button className="btn-ghost btn" onClick={() => setModal(null)}>Cancelar</button><button className="btn" onClick={createChannel}>Criar</button></div>
              </>
            )}
            {error && <p className="error">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
