# Arquitectura del boilerplate

## Una aplicación modular en un Worker

Astro sirve landing, app y SSR. Preact se usa para islas interactivas. Un endpoint catch-all de Astro delega `/api/*` a Hono en el mismo Worker y pasa el entorno Cloudflare explícitamente. Los módulos de negocio viven separados por capacidad; no se crean servicios externos por defecto.

```text
apps/web/src/
  pages/                  # landing, SSR y rutas Astro
  components/             # islas Preact reutilizables
  lib/                    # auth client, HTTP, stores
  styles/                 # tokens globales de Tailwind
api/
  router.ts               # Hono bajo /api
  middleware/             # rate limit
  modules/
    auth/ tenants/ quotas/ # sesión, tenant y uso
    billing/ ai/ email/   # Stripe, Google Play, OpenRouter, Resend
    admin/                # consola tenant-local
packages/
  contracts/               # contratos Zod
  cli/                     # CLI init/add/doctor
apps/mobile/               # wrapper Flutter opcional
```

El módulo `api/modules/quotas` lleva consumo de producto por tenant y capability, con ventanas UTC diarias, semanales o mensuales y contadores D1 atómicos. El módulo billing sincroniza políticas de cuota a partir del plan activo y conserva políticas manuales/add-ons. El rate limit de Cloudflare protege requests; las cuotas miden uso funcional.

Cada módulo separa rutas/handlers, esquemas, servicios, repositorios y políticas. Las rutas convierten HTTP en llamadas de aplicación; los servicios aplican reglas y orquestan; los repositorios encapsulan D1. La UI no contiene reglas de autorización. El CLI deja registrados como planeados los módulos opcionales aún sin scaffold.

## Tenant activo

Better Auth mantiene la sesión primaria. Al seleccionar tenant, el cliente solicita un JWT secundario corto al backend y lo envía en cada request autenticado. El backend valida firma, issuer, audience, expiración y subject, vincula el subject con la sesión, y vuelve a consultar membresía y versión de permisos. Nunca acepta un `tenantId` arbitrario como autorización. Un tenant personal se crea idempotentemente durante el onboarding.

Use `jose` sobre Web Crypto para JWT. Mantenga en D1 el estado actual de membresía y permisos para poder revocar acceso sin esperar a que expire el token. El token no reemplaza la sesión.

## Permisos

Permisos son capacidades estables (`members.invite`, `billing.manage`, `records.read`); roles solo agrupan capacidades. Las políticas viven en backend y se invocan desde handlers/servicios. Los componentes pueden ocultar acciones, pero eso nunca concede acceso.

## Entornos Cloudflare

Un único Worker: configuración superior para producción y bloque `previews` para Worker Previews. El binding de cada entorno conserva el mismo nombre, pero referencia D1 y R2 independientes. `main` contiene la configuración base que heredan los previews de branches. Las migraciones se aplican explícitamente a cada DB.

Wrangler local usa almacenamiento local. Nunca se usan secretos de producción en `.dev.vars`; ese archivo se ignora en Git. Para secretos de producción use Wrangler; para secretos de Previews use la configuración de Preview correspondiente.

## Billing y entitlements

Stripe Checkout/webhooks y Google Play verify/RTDN publican entitlements normalizados ligados al tenant. El backend valida la firma de Stripe y verifica tokens Play con Android Publisher antes de conceder acceso; el bridge móvil completa una compra solo después de la respuesta verificada. Cada proveedor queda detrás de su adaptador, y la resolución del plan aplica sus cuotas D1.

## Módulos opcionales

OpenRouter, Resend, Stripe, Google Play y Flutter se habilitan/configuran por CLI. Cada proveedor está detrás de un adaptador; el build funciona sin credenciales. Admin solo opera sobre el tenant activo y exige `admin.manage`; no hay rol de superadmin multi-tenant.
