import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import ChatApp from '@/components/ChatApp';

export default async function ChatPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login');
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).single();
  if (!profile) redirect('/login');
  return <ChatApp user={{ id: data.user.id, email: data.user.email ?? '' }} profile={profile} />;
}
