# Kingtex — Notas importantes

## ERP NinoxNet — Cosas que NO olvidar

1. **Usar `sucursal: 'all'` en el filtro** para traer stock de TODAS las sucursales y depósitos de una sola vez. Pasar `filtro: JSON.stringify({sucursal: 'all'})` al endpoint `/Stk/jsGetPagedStock`.

2. **EXCLUIR depósito "MATERIA PRIMA"** (ID 5) — es materia prima, no producto terminado. No sumar en análisis de stock.

3. **Para cambiar sucursal (si fuera necesario):** POST a `/Configuracion/jsCambioSucursal` con `{id: 1}` (KingTex) o `{id: 2}` (Fabrica). Pero mejor usar `sucursal: 'all'`.

3. **Exports CSV fallan** con este usuario (error 500, sin permisos de exportación). Usar endpoints JSON siempre que sea posible.

4. **La sesión expira rápido** — re-login necesario entre requests.

5. **Formato de fechas varía por endpoint:**
   - TopVentas: `DD-MM-YYYY` en JSON filtro
   - FacturacionGeneral: `DD/MM/YYYY,DD/MM/YYYY` en param Periodo
   - Exports CSV: `anioDesde, mesDesde` numéricos

## Depósitos

| ID | Nombre | Sucursal | Usar? |
|---|---|---|---|
| 1 | Depósitos local once | KingTex | SÍ |
| 8 | Salón local once | KingTex | SÍ |
| 9 | Depósito 2 | KingTex | SÍ |
| 4 | Stock Fabrica | Fabrica | SÍ |
| 5 | Materia Prima | Fabrica | **NO — es materia prima, no producto terminado** |

## Canales de venta

| appId | Canal |
|---|---|
| 4 | Local |
| 5 | Whatsapp |
| 8 | Fabrica |
| 9 | Tienda Online |
| 11 | Henko |

## Parámetros de reposición

- Lead time fabricación: **20 días**
- Horizonte planificación: **60 días**
- Período ventas para velocidad: **90 días**
