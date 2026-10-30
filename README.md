# MiikaCord

Chat premium estilo Discord com servidores, canais de texto e voz, DMs, compartilhamento de tela, imagens, cargos, presença online, notificações, reações e login com Google.

## Rodar

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

## Login com Google

1. No Google Cloud Console, crie um **OAuth client ID** do tipo **Web application**.
2. Em **Authorized redirect URIs**, adicione:

```text
https://lswkrqsfpcwvhupasmlr.supabase.co/auth/v1/callback
```

3. No Supabase, vá em **Authentication → Providers → Google**.
4. Ative o Google e cole o **Client ID** e o **Client Secret** do Google Cloud.
5. Em **Authentication → URL Configuration**, adicione:

```text
http://localhost:3000/auth/callback
```

6. Salve e teste o botão **Entrar com Google** no MiikaCord.

## Recursos

- Login por e-mail e Google
- Servidores com convites
- Canais de texto e voz
- Compartilhamento de tela
- DMs por @usuario
- Upload de avatar e imagens
- Cargos e moderação
- Presença online
- Menções e notificações
- Reações com emoji
