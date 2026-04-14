# NinoxNet ERP — Mapa de Endpoints

## Navegación (URLs de páginas)

### Compras
- `/compra` — Comprobantes de compra
- `/compra/factura` — Nueva factura de compra
- `/compra/notacredito` — Nueva nota de crédito
- `/compra/notadebito` — Nueva nota de débito
- `/compra/pago` — Nuevo pago
- `/proveedor` — Listado de proveedores
- `/proveedor/saldos` — Saldos de proveedores
- `/app/gastos` — Gastos

### Ventas
- `/venta` — Comprobantes de venta
- `/cliente` — Listado de clientes
- `/cliente/saldos` — Saldos de clientes
- `/preventas` — Preventas
- `/venta/preventas` — Preventas (alt)
- `/presupuestos` — Presupuestos
- `/venta/pv` — Punto de venta
- `/app/configuracion/canales` — Canales de venta

### Artículos
- `/articulos` — Listado de artículos
- `/articulos/Precios` — Listas de precios
- `/Articulos/Categorias` — Categorías
- `/Articulos/Tags` — Etiquetas
- `/Colores` — Colores
- `/Talles` — Talles
- `/Articulos/codigosdebarras` — Códigos de barras
- `/articulocurva/Curva2` — Curva de artículos

### Stock
- `/Stk/Ver` — Ver stock
- `/Stk/movimiento?tipo=ingreso` — Nuevo ingreso
- `/Stk/movimiento?tipo=egreso` — Nuevo egreso
- `/Stk/movimiento?tipo=transferencia` — Nueva transferencia
- `/app/stock-manager/transferencias` — Transferencias
- `/StockHistorial` — Historial de stock
- `/StockHistorial/Articulo` — Historial por artículo

### Caja
- `/Caja/Actual` — Caja actual
- `/Cheque/panel` — Cheques
- `/CuentasBancarias` — Cuentas bancarias
- `/MercadoPago` — MercadoPago

### Reportes
- `/Articulos/Reportes/TopVentas` — Artículos más vendidos
- `/Articulos/Reportes/precios` — Reporte de precios
- `/facturacion/facturaciongeneral` — Facturación general
- `/facturacion/Comparacion` — Comparación de facturación
- `/facturacion/ReporteVentaMensual` — Venta mensual
- `/facturacion/sucursalbalance` — Balance por sucursal
- `/cajas/ReporteCajaDiaria` — Caja diaria
- `/cajas/ReporteFacturacion` — Facturación de caja
- `/cajas/ReporteFacturacionMensual` — Facturación mensual
- `/cajas/ReporteMovimiento` — Movimientos de caja
- `/cajas/ReportePlanilla` — Planilla
- `/cajas/resumen` — Resumen
- `/Stock/Reportes/Balance` — Balance de stock
- `/Stock/Reportes/Reposicion` — Reposición de stock
- `/Stock/Reportes/Valorizado` — Valorizado de stock
- `/ventas/reportes/clientes/ranking` — Ranking clientes
- `/ventas/reportes/comisiones` — Comisiones
- `/ventas/reportes/comisionesarticulo` — Comisiones por artículo
- `/ventas/reportes/descuentos` — Descuentos
- `/ventas/reportes/envios` — Envíos
- `/ventas/reportes/ganancia/articulos` — Ganancia por artículos
- `/ventas/reportes/recargos` — Recargos
- `/ventas/reportes/vendedoresarticulos` — Vendedores por artículos
- `/clientes/reportes/ultimasventas` — Últimas ventas por cliente
- `/preventas/reportes/ranking/articulos` — Ranking preventas
- `/reportes/sucursales/estado` — Estado de sucursales
- `/impuestos/reportes/iva/compras` — IVA compras
- `/impuestos/reportes/iva/ventas` — IVA ventas
- `/exportar-datos` — Exportar datos
- `/powerbi` — PowerBI

### Configuración
- `/app/configuracion` — Configuración
- `/configuracion/cambiosucursal` — Cambiar sucursal (POST {id})
- `/configuracion/recargarsesion` — Recargar sesión
- `/configuracion/usuario2` — Usuario
- `/fabrica2` — Fábrica
- `/account/manage` — Gestión de cuenta

---

## Endpoints API (JSON)

### Ventas
- `Venta/jsGetPagedVentas` — DataTable, comprobantes de venta
  - Filtro JSON: {desde, hasta, sucursal, vendedor (ID), appId (canal)}
  - Row: [facturaId, fecha, hora, tipo(F/R/NC), comprobante, cliente, monto, ?, estado, canal, ?, ?, ?, ?]
  - Estados: FACTURADO, ANULADO, PENDIENTE, etc.
- `/cliente/jsGetlsClientes?term=X` — Select2, búsqueda de clientes
- `/cliente/jsGetById/ID` — Datos de un cliente por ID
- `/empleado/jsGetAllSelect2` — Lista TODOS los vendedores [{id, text}]
  - Vendedores Kingtex: Daniel (11977), Daniel 2 (11978), LAUTARO (3233), LAUTARO 2 (9265), SUSANA (12529)
- `/empleado/jsGetById/ID` — Datos de un empleado/vendedor por ID
- `/empleado/GetFiltroInit?value=ID` — Datos de vendedor para filtro
- `/facturacion/GetMetodosPagoVenta` — Métodos de pago
- `/facturacion/GetFacturacionGeneral` — Facturación general (params: sucursalid, Periodo DD/MM/YYYY,DD/MM/YYYY, appId)
- `/saldos/SaldoVencidoClientes` — Saldos pendientes de clientes
- `/apps/canales` — Lista de canales de venta [{appId, nombre}]
  - Canales: Local (4), Whatsapp (5), fabrica (8), Tienda Online (9), Henko (11)

### Preventas
- Endpoints de preventa cargan via Vue app
- Estados: NUEVO(0), PENDIENTE(1), FACTURADO(2), ANULADO(3), ENTREGADO(4), ELIMINADO(5), PEDIDO(6), BORRADOR(7), FINALIZADO(8), PREVENTA(9), RECHAZADO(10), CONFIRMADO(11)
- Estados pago: PROCESANDO(100), PAGADO(101), PAGO_CONFIRMADO(102), PAGO_RECHAZADO(103)

### Artículos/Stock
- `/Articulos/Reportes/jsGetPagedReporteTopVenta` — Top ventas (DataTable)
  - Filtro JSON: {desde DD-MM-YYYY, hasta, sucursal, appId, vendedor (ID)}
  - NOTA: sin columns[] devuelve líneas individuales, agrupar por código en Node.js
- `/Stk/jsGetPagedStock` — Stock por talle/color (DataTable, filtro JSON: sucursal 'all'). search[value] min 2 chars.
- `/Stock/Reportes/jsGetPagedBalanceOptimizado` — Balance de stock

### Compras
- `Compra/jsGetPagedCompras` — DataTable, comprobantes de compra
- `/proveedor/jsGetlsProveedores` — Select2, búsqueda de proveedores
- `/proveedor/jsGetlsProveedor/ID` — Datos de proveedor por ID

### Caja
- `/cajas/jsResumenAbrir` — Abrir caja
- `/cajas/jsResumenCierre` — Cierre de caja
- `/tarjetas/jsGetAll` — Tarjetas de pago

### Búsqueda global
- `/nx/ajGlobalQueryLs?q=QUERY` — Búsqueda global (clientes, artículos, etc.)

### Configuración
- `/Configuracion/jsCambioSucursal` — POST {id: 1|2} cambiar sucursal

---

## Notas importantes

1. **DataTables sin columns[]**: El endpoint TopVenta sin params `columns[]` devuelve líneas individuales (1 ud c/u). Hay que agrupar por código en el cliente.
2. **Sucursal 'all'**: Para stock, usar `filtro: {"sucursal": "all"}` para traer todas las sucursales.
3. **MATERIA PRIMA**: Excluir depósito "MATERIA PRIMA" de cálculos de stock.
4. **Rate limit**: 15 requests en 5 segundos → 409.
5. **Sesión**: Cookie-based, expira rápido. Re-login necesario.
6. **Exports CSV**: Fallan con usuario davidrobles (500). Usar endpoints JSON.

*Generado: 2026-04-12*
