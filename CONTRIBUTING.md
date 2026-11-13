# Contribuir

Gracias por ayudar a mejorar Cloudflare Apps Boilerplate. Los cambios pequeños, documentados y fáciles de revisar son los más sencillos de integrar.

## Antes de empezar

- Revisa [README.md](README.md), [docs/architecture.md](docs/architecture.md) y la guía del módulo que vas a modificar.
- Para cambios grandes, abre primero una discusión o issue con el problema y el enfoque propuesto.
- No incluyas secretos, tokens, credenciales de servicio, archivos `.dev.vars` ni datos de producción.

## Flujo de trabajo

1. Crea una rama desde `main`.
2. Instala dependencias con `pnpm install`.
3. Implementa el cambio siguiendo la estructura modular existente y valida entradas con los contratos compartidos cuando corresponda.
4. Añade o actualiza pruebas para comportamiento nuevo o corregido.
5. Ejecuta las verificaciones aplicables:

   ```bash
   pnpm test
   pnpm check
   pnpm --dir packages/cli check
   ```

6. Abre un pull request con el motivo del cambio, resumen de implementación, verificaciones ejecutadas y cualquier limitación o configuración manual requerida.

No ejecutes migraciones remotas, crees recursos facturables ni despliegues a cuentas compartidas como parte de una contribución sin autorización explícita del titular de esas cuentas.

## Cambios en API e identidad

- Los handlers y servicios multi-tenant deben consumir el contexto autorizado que construye el middleware; no autorices una operación usando un `tenantId` sin verificar enviado por el cliente.
- Mantén los endpoints admin bajo autenticación, tenant activo y permisos del backend.
- No registres secretos, cookies, JWT, tokens de compra ni payloads sensibles.
- Los ejemplos de configuración deben explicar qué necesita cada variable sin incluir valores reales.
- Cambios de esquema requieren una migración nueva y documentar cómo aplicarla en local, Preview y producción.

## Estilo y alcance

- Mantén cada módulo cohesivo y evita duplicar componentes, validaciones o lógica compartida.
- Actualiza documentación cuando cambien comandos, variables, endpoints o decisiones de arquitectura.
- No amplíes el alcance de un cambio sin explicar por qué en el pull request.

## Reconocimiento

La autoría de commits y pull requests se conserva en el historial del repositorio. Si quieres aparecer con un nombre o enlace en la lista pública, sigue las instrucciones de [CONTRIBUTORS.md](CONTRIBUTORS.md).
