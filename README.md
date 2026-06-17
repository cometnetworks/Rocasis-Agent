# Rocasis Sales Agent

Agente local para prospeccion B2B de Roca Sistemas con objetivo operativo de
conseguir 4 reuniones confirmadas en `https://cal.com/rocasis`.

El agente:

- Prioriza prospectos de Mexico para financiero, retail y manufactura.
- Filtra tomadores de decision: CIO, CTO, directores, gerentes de TI,
  infraestructura, transformacion digital y roles equivalentes.
- Usa el posicionamiento de Roca Sistemas: Magic xpi, integracion de sistemas,
  automatizacion de procesos, ERP/CRM/e-commerce/SAP y conectores empresariales.
- Genera emails personalizados con CTA directo a Cal.com.
- Envia por Resend solo cuando se ejecuta con `--send`.
- Mantiene un tracker local hasta que haya 4 reuniones confirmadas.
- Genera follow-ups vencidos y puede sincronizar bookings desde Cal.com.
- Usa idempotency keys de Resend y delay entre envios para reducir duplicados.
- Puede recibir webhooks de Cal.com para marcar confirmaciones en tiempo real.

## Setup

No guardes la API key en codigo fuente. Exportala en la terminal:

```bash
export RESEND_API_KEY="re_..."
```

Tambien puedes usar un `.env` local en esta carpeta. El agente lo carga
automaticamente y `.gitignore` evita que se versionen secretos:

```text
RESEND_API_KEY=re_...
CAL_API_KEY=cal_live_...
TELEGRAM_BOT_TOKEN=123456:...
TELEGRAM_CHAT_ID=123456789
```

Resend tambien requiere un remitente verificado. Usa un `from` de un dominio
validado en tu cuenta de Resend, por ejemplo:

```bash
python3 agent.py check-resend --from "Miguel Cedillo <ventas@rocasis.mx>"
python3 agent.py prepare
python3 agent.py send \
  --from "Miguel Cedillo <ventas@rocasis.mx>" \
  --reply-to "ventas@rocasis.mx" \
  --limit 20 \
  --delay-seconds 3 \
  --send
```

Sin `--send`, el comando es dry-run y solo genera previews.

Para sincronizar reuniones desde Cal.com, crea/exporta una API key de Cal.com:

```bash
export CAL_API_KEY="cal_live_..."
python3 agent.py sync-cal
```

## Comandos

Auditar estado, bloqueos y siguiente accion:

```bash
python3 agent.py doctor
python3 agent.py doctor --json
python3 agent.py doctor --live --from "Miguel Cedillo <ventas@rocasis.mx>"
```

Preparar shortlist y previews:

```bash
python3 agent.py prepare --limit 20
```

Enviar con Resend:

```bash
python3 agent.py send --from "Miguel Cedillo <miguel@outreach.voxmedia.com.mx>" --reply-to "marketing.voxmedia@gmail.com" --limit 31 --delay-seconds 3 --send
```

Generar follow-ups vencidos:

```bash
python3 agent.py followups
```

Enviar follow-ups vencidos:

```bash
python3 agent.py followups --from "Miguel Cedillo <miguel@outreach.voxmedia.com.mx>" --reply-to "marketing.voxmedia@gmail.com" --delay-seconds 3 --send
```

Sincronizar estado de entrega desde Resend:

```bash
python3 agent.py sync-resend
python3 agent.py sync-resend --quiet
```

Sincronizar reuniones confirmadas desde Cal.com:

```bash
python3 agent.py sync-cal --status upcoming
```

Si Cal.com tiene reservas cuyo email no coincide con el tracker, el comando
crea `outbox/cal_unmatched_bookings.csv` para revisión manual. Después puedes
confirmar una reunión con:

```bash
python3 agent.py confirm --email prospecto@empresa.com --booking-uid BOOKING_UID --meeting-start 2026-06-05T15:00:00Z --notes "Confirmado desde Cal.com"
```

Escuchar webhooks de Cal.com localmente:

```bash
export CAL_WEBHOOK_SECRET="un_secreto_largo"
python3 agent.py webhook-cal --host 127.0.0.1 --port 8787
```

Configura el webhook de Cal.com hacia el endpoint publico que apunte a:

```text
POST /cal-webhook?secret=un_secreto_largo
```

El receptor tambien acepta el secreto por header:

```text
x-rocasis-webhook-secret: un_secreto_largo
```

Enviar notificaciones del agente por Telegram:

```bash
export TELEGRAM_BOT_TOKEN="123456:..."
export TELEGRAM_CHAT_ID="123456789"
python3 agent.py notify-test --message "Rocasis agent listo"
python3 agent.py sync-cal --status upcoming --notify
```

Ejecutar el bot interactivo de Telegram:

```bash
python3 agent.py telegram-bot
```

Mientras ese proceso este abierto, Telegram responde:

```text
/status
/sync_cal
/doctor
/help
```

Ver avance:

```bash
python3 agent.py status
```

## Cloudflare 24/7

El agente tambien puede correr en Cloudflare Workers con D1 para no depender
de una terminal local.

Worker desplegado:

```text
https://rocasis-agent.miguelcedillo.workers.dev
```

Endpoints:

```bash
curl https://rocasis-agent.miguelcedillo.workers.dev/status
curl -X POST "https://rocasis-agent.miguelcedillo.workers.dev/admin/run?task=sync-cal" \
  -H "x-rocasis-admin-secret: $ADMIN_SECRET"
curl -X POST "https://rocasis-agent.miguelcedillo.workers.dev/admin/run?task=sync-resend" \
  -H "x-rocasis-admin-secret: $ADMIN_SECRET"
curl -X POST "https://rocasis-agent.miguelcedillo.workers.dev/admin/run?task=followups" \
  -H "x-rocasis-admin-secret: $ADMIN_SECRET"
```

Cron remoto:

- Cada 15 minutos: sincroniza bookings de Cal.com.
- Minuto 7 de cada hora: sincroniza estados de entrega desde Resend.
- 15:20 UTC diario: envia follow-ups vencidos, maximo 10 por corrida.

Estado persistente:

- D1 database: `rocasis-agent-db`.
- Tabla principal: `outreach_tracker`.
- El CSV local sigue existiendo como respaldo operativo, pero el Worker usa D1.

Comandos Cloudflare:

```bash
npm install
npm run cf:migrate:remote
npm run cf:seed
npx wrangler d1 execute rocasis-agent-db --remote --file outbox/tracker-seed.sql
npm run cf:deploy
```

Secretos requeridos en Cloudflare:

```text
RESEND_API_KEY
CAL_API_KEY
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
CAL_WEBHOOK_SECRET
ADMIN_SECRET
```

Webhook de Cal.com en nube:

```text
POST https://rocasis-agent.miguelcedillo.workers.dev/cal-webhook?secret=CAL_WEBHOOK_SECRET
```

Registrar una reunion confirmada manualmente:

```bash
python3 agent.py confirm --email prospecto@empresa.com --notes "Confirmo por correo, agendo en Cal.com"
```

Probar el flujo de confirmacion con un booking simulado:

```bash
python3 agent.py simulate-booking --email prospecto@empresa.com --booking-uid test_booking
python3 agent.py simulate-booking --email prospecto@empresa.com --booking-uid test_booking --commit
```

## Fuentes locales esperadas

El agente busca por defecto:

- `/Users/macmini/Downloads/prospectos_rocasis_nemaris_outreach_05052026_v3_corregido.html`
- `/Users/macmini/Desktop/Prospectos/Rocasis-Nemaris-DB.xlsx`

El HTML contiene datos enriquecidos y drafts. El XLSX queda como respaldo si el
HTML no esta disponible.

## Seguridad comercial

El envio outbound queda limitado por defecto. Para reducir riesgo operativo:

- No envia sin `--send`.
- No envia a contactos ya marcados como enviados o confirmados en el tracker.
- Incluye una frase de salida voluntaria en el email.
- Recomienda personalizacion y revision antes de escalar volumen.
- Valida dominios de Resend con `check-resend` antes de enviar.
- La API key validada para esta campana tiene habilitado
  `outreach.voxmedia.com.mx`; si `rocasis.mx` no esta verificado en Resend,
  usa un remitente de ese dominio.
- Las respuestas futuras deben usar `marketing.voxmedia@gmail.com` como
  `reply-to`.
- Para contactar al agente, Telegram es la mejor opcion: tiene Bot API oficial,
  webhooks y funciona bien en servidores. iMessage depende de macOS/AppleScript,
  no tiene API oficial de bot y es menos estable para automatizacion.
- Usa `Idempotency-Key` por email/cadencia para evitar duplicados en reintentos.
- Rechaza keys que no parezcan de Resend; las keys validas normalmente empiezan
  con `re_`.
- `doctor` muestra si el agente esta listo para enviar o que falta resolver.
- `doctor --live` llama a Resend para validar la credencial y el dominio sin
  enviar correos.
