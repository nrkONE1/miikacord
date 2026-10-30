'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Peer = { id: string; stream: MediaStream; screen?: MediaStream | null };
type Props = { channel: { id: string; name: string }; user: { id: string }; onLeave: () => void };

export default function VoiceRoom({ channel, user, onLeave }: Props) {
  const supabase = createClient();
  const [peers, setPeers] = useState<Peer[]>([]);
  const [muted, setMuted] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState('');
  const pcs = useRef(new Map<string, RTCPeerConnection>());
  const polite = useRef(new Map<string, boolean>());
  const makingOffer = useRef(new Map<string, boolean>());
  const localStream = useRef<MediaStream | null>(null);
  const screenStream = useRef<MediaStream | null>(null);
  const room = useRef<any>(null);
  const localVideo = useRef<HTMLVideoElement>(null);

  function sendSignal(to: string, payload: any) {
    room.current?.send({ type: 'broadcast', event: 'signal', payload: { from: user.id, to, ...payload } });
  }

  function updatePeer(peerId: string, patch: Partial<Peer>) {
    setPeers((prev) => {
      const exists = prev.some((p) => p.id === peerId);
      if (!exists) return [...prev, { id: peerId, stream: new MediaStream(), ...patch }];
      return prev.map((p) => (p.id === peerId ? { ...p, ...patch } : p));
    });
  }

  function createPeer(peerId: string) {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] }] });
    polite.current.set(peerId, user.id > peerId);
    makingOffer.current.set(peerId, false);
    localStream.current?.getTracks().forEach((track) => pc.addTrack(track, localStream.current!));
    pc.onicecandidate = (e) => { if (e.candidate) sendSignal(peerId, { type: 'ice', candidate: e.candidate }); };
    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (e.track.kind === 'video') updatePeer(peerId, { screen: stream });
      else updatePeer(peerId, { stream });
    };
    pc.onnegotiationneeded = async () => {
      try {
        makingOffer.current.set(peerId, true);
        await pc.setLocalDescription();
        if (pc.localDescription) sendSignal(peerId, { type: 'description', description: pc.localDescription });
      } finally { makingOffer.current.set(peerId, false); }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        pc.close(); pcs.current.delete(peerId);
        setPeers((prev) => prev.filter((p) => p.id !== peerId));
      }
    };
    pcs.current.set(peerId, pc);
    return pc;
  }

  async function handleDescription(peerId: string, description: RTCSessionDescriptionInit) {
    const pc = pcs.current.get(peerId) ?? createPeer(peerId);
    const ready = !makingOffer.current.get(peerId) && (pc.signalingState === 'stable' || pc.signalingState === 'have-local-offer');
    const collision = description.type === 'offer' && !ready;
    if (collision && !polite.current.get(peerId)) return;
    if (collision) await pc.setLocalDescription({ type: 'rollback' } as RTCSessionDescriptionInit);
    await pc.setRemoteDescription(description);
    if (description.type === 'offer') {
      await pc.setLocalDescription();
      if (pc.localDescription) sendSignal(peerId, { type: 'description', description: pc.localDescription });
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        localStream.current = stream;
        const ch = supabase.channel(`voice:${channel.id}`, { config: { presence: { key: user.id } } });
        room.current = ch;
        ch.on('presence', { event: 'sync' }, () => {
          const ids = Object.keys(ch.presenceState()).filter((id) => id !== user.id);
          ids.forEach((id) => { if (!pcs.current.has(id) && user.id < id) createPeer(id); });
          pcs.current.forEach((pc, id) => {
            if (!ids.includes(id)) { pc.close(); pcs.current.delete(id); setPeers((prev) => prev.filter((p) => p.id !== id)); }
          });
        });
        ch.on('broadcast', { event: 'signal' }, async ({ payload }: any) => {
          const { type, from, to } = payload;
          if (to !== user.id) return;
          if (type === 'description') await handleDescription(from, payload.description);
          else if (type === 'ice') {
            const pc = pcs.current.get(from);
            if (pc && payload.candidate) { try { await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)); } catch {} }
          }
        });
        ch.subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await ch.track({ online: true });
            await supabase.from('voice_states').upsert({ channel_id: channel.id, user_id: user.id, muted: false });
          }
        });
      } catch (err: any) { setError(err.message ?? 'Microfone não autorizado.'); }
    }
    start();
    return () => {
      cancelled = true;
      supabase.from('voice_states').delete().eq('channel_id', channel.id).eq('user_id', user.id);
      screenStream.current?.getTracks().forEach((t) => t.stop());
      pcs.current.forEach((pc) => pc.close()); pcs.current.clear();
      localStream.current?.getTracks().forEach((t) => t.stop());
      if (room.current) supabase.removeChannel(room.current);
    };
  }, [channel.id]); // eslint-disable-line

  useEffect(() => { if (localVideo.current) localVideo.current.srcObject = screenStream.current; }, [sharing]);

  async function toggleShare() {
    if (sharing) {
      screenStream.current?.getTracks().forEach((t) => t.stop());
      pcs.current.forEach((pc) => pc.getSenders().filter((s) => s.track?.kind === 'video').forEach((s) => pc.removeTrack(s)));
      screenStream.current = null; setSharing(false); return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      screenStream.current = stream; setSharing(true);
      pcs.current.forEach((pc) => stream.getVideoTracks().forEach((track) => pc.addTrack(track, stream)));
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        pcs.current.forEach((pc) => pc.getSenders().filter((s) => s.track?.kind === 'video').forEach((s) => pc.removeTrack(s)));
        screenStream.current = null; setSharing(false);
      });
    } catch (err: any) {
      if (err.name !== 'NotAllowedError') setError(err.message ?? 'Não foi possível compartilhar.');
    }
  }

  function toggleMute() {
    const next = !muted; setMuted(next);
    localStream.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
    supabase.from('voice_states').update({ muted: next }).eq('channel_id', channel.id).eq('user_id', user.id);
  }

  return (
    <main className="chat">
      <header className="chat-header">
        <strong>🔊 {channel.name}</strong>
        <span style={{ color: 'var(--muted)' }}>{sharing ? 'Compartilhando tela' : 'Canal de voz'}</span>
      </header>
      <div className="voice-stage">
        {sharing && <div className="screen-tile"><video ref={localVideo} autoPlay playsInline muted /><span>Sua tela</span></div>}
        <div className="voice-tile you"><div className="avatar large">Você</div><span>{muted ? 'Microfone desativado' : 'Microfone ativo'}</span></div>
        {peers.map((peer) => (
          <div className="voice-tile" key={peer.id}>
            {peer.screen && <RemoteScreen stream={peer.screen} />}
            <div className="avatar large">🎧</div>
            <span>{peer.screen ? 'Compartilhando tela' : 'Participante conectado'}</span>
            <RemoteAudio stream={peer.stream} />
          </div>
        ))}
      </div>
      {error && <p className="error" style={{ textAlign: 'center' }}>{error}</p>}
      <div className="voice-controls">
        <button className={muted ? 'voice-btn danger' : 'voice-btn'} onClick={toggleMute}>{muted ? 'Ativar microfone' : 'Silenciar'}</button>
        <button className={sharing ? 'voice-btn active-share' : 'voice-btn'} onClick={toggleShare}>{sharing ? 'Parar compartilhamento' : 'Compartilhar tela'}</button>
        <button className="voice-btn danger" onClick={onLeave}>Sair</button>
      </div>
    </main>
  );
}

function RemoteAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => { if (ref.current) { ref.current.srcObject = stream; ref.current.play().catch(() => {}); } }, [stream]);
  return <audio ref={ref} autoPlay playsInline />;
}

function RemoteScreen({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) { ref.current.srcObject = stream; ref.current.play().catch(() => {}); } }, [stream]);
  return <video ref={ref} autoPlay playsInline className="screen-video" />;
}
