# Cloudflare Apps Boilerplate

Boilerplate open source para crear aplicaciones SaaS sobre Cloudflare Workers. Reúne landing y SSR con Astro, interfaz interactiva con Preact y API con Hono en un Worker, con una arquitectura modular que puedes adaptar a cada producto.

Está pensado para servir como base de nuevos proyectos, no como un SaaS terminado. Los proveedores son opcionales y cada proyecto debe configurar sus propios dominios, secretos, planes, productos, políticas de acceso y recursos.

## Qué incluye

- **Web y API:** Astro SSR, Preact, Hono, Tailwind CSS, TanStack Query, Zustand, Axios y Zod.
- **Identidad:** Better Auth con sesión persistida en D1, email/password y Google OAuth opcional.
- **Tenancy y permisos:** tenant personal y organizaciones; JWT secundario de tenant vinculado a la sesión y revalidado en cada solicitud protegida.
- **Administración:** gestión del tenant, miembros y billing; Health Check de configuración visible solo para administradores del tenant.
- **Cloudflare:** Worker, D1, R2 y rate limiting con Wrangler para desarrollo local y Previews.
- **Integraciones opcionales:** Stripe, Google Play Billing/RTDN, OpenRouter y Resend.
- **Móvil opcional:** app Flutter con WebView y puente acotado para compras de Google Play.
- **CLI:** generador y configurador interactivo para crear proyectos, registrar módulos y preparar recursos Cloudflare.
- **Cuotas:** base extensible para límites diarios, semanales y mensuales con ventanas UTC y contadores D1.

## Requisitos

- Node.js **22.14 o superior**
- pnpm **10**
- Cuenta de Cloudflare para provisionar recursos o desplegar
- Flutter solo si usarás la app móvil

## Inicio rápido

```bash
pnpm install
pnpm --filter @boilerplate/web db:bootstrap:local
pnpm dev
```

En un proyecto creado con el CLI, `init` prepara `.boilerplate.json` y, si aún no existe, `apps/web/.dev.vars` con secretos aleatorios para desarrollo local. En este repositorio, el manifiesto ya está configurado. Revisa [`.env.example`](.env.example) para variables públicas y [`apps/web/.dev.vars.example`](apps/web/.dev.vars.example) para configuración local del Worker. Nunca copies secretos a `.env` ni los agregues a Git.

La landing se sirve en `http://localhost:4321`; la API incluye `GET /api/health`. Para probar el acceso, abre `/login`. La vista `/admin` requiere iniciar sesión y tener permisos de administración en el tenant activo.

## Crear un proyecto nuevo

Desde este repositorio:

```bash
pnpm cli create ../mi-proyecto
```

El CLI copia una plantilla limpia, excluye secretos y archivos generados, configura el nombre y prepara el proyecto. También puedes usar `init`, `add`, `resources` y `doctor` en un proyecto existente:

```bash
pnpm exec cf-apps init
pnpm exec cf-apps add stripe
pnpm exec cf-apps doctor
pnpm exec cf-apps resources
```

`doctor` revisa la configuración local. `resources` usa Wrangler autenticado para verificar o crear D1 y R2; requiere que confirmes el aprovisionamiento. El CLI no guarda credenciales de proveedores. Consulta la [guía del CLI](packages/cli/README.md) y el [formato de configuración de ejemplo](packages/cli/project-config.example.json).

## Entornos y despliegue

La configuración está preparada para un Worker con `main` como producción y branch Previews, incluido `stage`, usando bindings separados para D1 y R2. Un Preview no es una base de datos compartida con producción ni un Worker persistente separado: usa la configuración Preview del Worker. El entorno local de Wrangler mantiene sus propios datos.

Antes del primer despliegue:

1. Reemplaza los nombres e IDs de ejemplo en [`apps/web/wrangler.jsonc`](apps/web/wrangler.jsonc).
2. Crea recursos D1 y R2 distintos para producción y Preview.
3. Configura secretos diferentes para local, Preview y producción en el lugar correspondiente.
4. Aplica explícitamente las migraciones a cada base de datos.
5. Configura productos, planes, credenciales y webhooks en los proveedores que vayas a usar.

Comandos comunes:

```bash
pnpm --filter @boilerplate/web db:migrate:local
pnpm --filter @boilerplate/web db:migrate:remote
pnpm check
pnpm deploy
```

`db:migrate:remote` actúa sobre el recurso remoto que Wrangler resuelva desde la configuración actual. Confirma el entorno y el nombre de la base antes de ejecutarlo; no lo uses para sustituir la aplicación explícita de migraciones a cada recurso.

## Identidad y límites de seguridad

Better Auth mantiene la sesión principal en una cookie y D1. Al seleccionar un tenant, el cliente pide al backend un JWT secundario de corta duración. Cada endpoint protegido valida ambos, comprueba que el sujeto del JWT coincide con la sesión y vuelve a consultar en D1 la membresía, el estado, el rol y la versión de permisos. Un `tenantId` elegido en el cliente no concede acceso.

Los permisos se aplican en el backend; ocultar controles en la interfaz no sustituye autorización. El rate limiting de Cloudflare protege solicitudes, mientras que las cuotas D1 miden consumo funcional del producto. Webhooks de pago y compras móviles tienen validaciones propias; antes de usarlos en producción, configura y revisa los secretos y recursos de cada proveedor.

El Health Check del admin solo informa sobre presencia y formato básico de configuración. No contacta proveedores, no consulta D1/R2 y no confirma que las migraciones estén aplicadas. Un estado “Configurado” no es una prueba de disponibilidad o de seguridad integral. Revisa [la arquitectura](docs/architecture.md), [el modelo de cuotas](api/modules/quotas/README.md) y [billing](api/modules/billing/README.md) antes de adaptar los módulos.

## Desarrollo y contribuciones

```bash
pnpm test
pnpm check
pnpm --dir packages/cli check
```

Las pruebas unitarias no necesitan credenciales de proveedores. Las verificaciones manuales de Cloudflare, OAuth, Stripe y Google Play sí requieren cuentas y configuración aisladas. Lee [`CONTRIBUTING.md`](CONTRIBUTING.md) antes de abrir un cambio. Las personas que quieran aparecer por nombre en el proyecto pueden seguir [`CONTRIBUTORS.md`](CONTRIBUTORS.md).

## Licencia

Este proyecto se distribuye bajo la licencia [MIT](LICENSE). Las dependencias y servicios de terceros mantienen sus propias licencias y condiciones.
