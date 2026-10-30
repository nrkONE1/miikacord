import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import ChatApp from '@/components/ChatApp';

export default async function ChatPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login');

  let { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .single();

  if (!profile) {
    const base = (data.user.email?.split('@')[0] ?? 'user')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 20) || 'user';

    const created = await supabase
      .from('profiles')
      .upsert({
        id: data.user.id,
        username: `${base}_${data.user.id.slice(0, 4)}`,
        display_name: data.user.user_metadata?.full_name ?? base,
        avatar_url: data.user.user_metadata?.avatar_url ?? null
      })
      .select()
      .single();

    profile = created.data;
  }

  if (!profile) redirect('/login');

  return <ChatApp user={{ id: data.user.id, email: data.user.email ?? '' }} profile={profile} />;
}
