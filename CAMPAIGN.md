# Campana Rocasis: 4 reuniones en Cal.com

## Objetivo

Conseguir 4 reuniones online confirmadas en `https://cal.com/rocasis` con
tomadores de decision de TI en Mexico.

## ICP

Sectores:

- Financiero: banca, fintech, seguros, credito, medios de pago.
- Retail: cadenas con tiendas, e-commerce, POS, inventario, facturacion,
  promociones, proveedores y logistica.
- Manufactura: automotriz, plantas, produccion, pharma, dispositivos medicos,
  alimentos, operacion regulada.

Roles:

- CIO, CTO, CISO.
- Director o gerente de TI.
- Director o gerente de infraestructura.
- Director o gerente de transformacion digital.
- Head of IT / IT Director / IT Manager.

## Oferta

Assessment de 30 minutos para detectar fricciones de integracion entre sistemas
criticos y priorizar oportunidades de automatizacion con Magic xpi.

Mensajes principales:

- Integracion de ERP, CRM, e-commerce, inventario, facturacion, WMS/TMS y SAP.
- Reduccion de procesos manuales, datos duplicados y errores humanos.
- Conectores empresariales y enfoque low-code para acelerar integraciones.
- Continuidad operativa, monitoreo centralizado y eficiencia organizacional.

## Primera y segunda ola

El dry-run actual genera 31 prospectos Rocasis calificados desde la fuente local
enriquecida y la base XLSX. Para llegar a 4 reuniones confirmadas, la campana
deberia iniciar con 20 a 31 contactos y mantener follow-ups hasta dia 10. Si la
tasa de respuesta inicial queda debajo de 20%, conviene ampliar con otra fuente
verificada antes de aumentar volumen.

## Cadencia recomendada

1. Dia 0: email personalizado con link directo a Cal.com.
2. Dia 2: conexion o mensaje corto por LinkedIn si no hay respuesta.
3. Dia 5: follow-up con pregunta de enrutamiento: "si no lo ves contigo,
   quien lleva integraciones/automatizacion?".
4. Dia 10: cierre educado con salida voluntaria.

## Condiciones antes de enviar

- Confirmar remitente verificado en Resend.
- Ejecutar `python3 agent.py check-resend --from "Miguel Cedillo <ventas@rocasis.mx>"`.
- Confirmar `reply-to` atendido por ventas.
- Revisar previews en `outbox/email_previews.txt`.
- Exportar `RESEND_API_KEY` en el entorno, nunca en codigo fuente.
- Ejecutar `python3 agent.py send ... --delay-seconds 3 --send` solamente
  despues de revisar.

## Confirmacion de reuniones

El agente puede sincronizar bookings de Cal.com si existe `CAL_API_KEY`:

```bash
export CAL_API_KEY="cal_live_..."
python3 agent.py sync-cal --status upcoming
```

Tambien puede recibir webhooks de booking en tiempo real:

```bash
export CAL_WEBHOOK_SECRET="un_secreto_largo"
python3 agent.py webhook-cal --host 127.0.0.1 --port 8787
```

Si no existe esa integracion, cada cita confirmada se marca con:

```bash
python3 agent.py confirm --email prospecto@empresa.com --notes "Agendo en Cal.com"
```

El objetivo queda cumplido cuando `python3 agent.py status` muestre 4 reuniones
confirmadas.
