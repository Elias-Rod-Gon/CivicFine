// Espera a que todo el documento HTML esté cargado antes de ejecutar el código
document.addEventListener('DOMContentLoaded', () => {

  // ==========================================================================
  // 1. CONFIGURACIÓN Y VARIABLES DE ESTADO
  // ==========================================================================

  // Reemplaza esta URL por la ruta real de tu backend desplegado en Railway
const API_URL = 'https://tu-proyecto.up.railway.app/api/reportes';

  // Información de sesión del operador (puedes conectarla luego a tu login/auth)
let operadorActual = {
    nombre: "E. Méndez",
    rol: "Operador Activo",
    sector: "Comité de Monitoreo Urbano > Sector Zapopan Centro"
};

  // Arreglo global donde se guardarán los reportes traídos desde PostgreSQL
let listaReportes = [];


  // ==========================================================================
  // 2. REFERENCIAS A ELEMENTOS DEL DOM (HTML)
  // ==========================================================================
const btnToggle = document.getElementById('btn-toggle-menu');
const sidebar = document.getElementById('sidebar');
const btnActualizar = document.getElementById('btn-actualizar');
const tableBody = document.getElementById('table-body');

  // Controles de búsqueda y filtrado
const inputSearch = document.getElementById('input-search');
const filterStatus = document.getElementById('filter-status');
const filterType = document.getElementById('filter-type');
const filterZone = document.getElementById('filter-zone');
const filterDate = document.getElementById('filter-date');
const btnClear = document.getElementById('btn-clear');


  // ==========================================================================
  // 3. CONEXIÓN AL SERVIDOR (RAILWAY + POSTGRESQL)
  // ==========================================================================

async function obtenerReportesDesdeServidor() {
    // Cambia el texto del botón para dar retroalimentación visual mientras carga
    if (btnActualizar) {
    btnActualizar.textContent = 'Cargando...';
    btnActualizar.disabled = true;
    }

    try {
    const respuesta = await fetch(API_URL);

      // Si el servidor responde con error (ej. 404 o 500), lanza una excepción
    if (!respuesta.ok) {
        throw new Error(`Error del servidor: ${respuesta.status}`);
    }

      // Convierte la respuesta JSON de PostgreSQL en un arreglo de objetos JS
    listaReportes = await respuesta.json();

      // Actualiza las tarjetas métricas y la tabla con los datos recibidos
    actualizarKPIs(listaReportes);
    aplicarFiltros();

    } catch (error) {
    console.error('No se pudieron obtener los reportes:', error);
      // Si aún no conectas el servidor, mantiene la tabla en estado vacío sin romper la app
    actualizarKPIs(listaReportes);
    renderizarTabla(listaReportes);
    } finally {
      // Restaura el botón sin importar si la petición tuvo éxito o falló
    if (btnActualizar) {
        btnActualizar.textContent = 'Actualizar';
        btnActualizar.disabled = false;
    }
    }
}


  // ==========================================================================
  // 4. FUNCIONES DE RENDERIZADO Y CÁLCULOS DINÁMICOS
  // ==========================================================================

  // Muestra los datos del operador en la barra superior
function cargarPerfil() {
    document.getElementById('operador-nombre').textContent = operadorActual.nombre;
    document.getElementById('operador-rol').textContent = operadorActual.rol;
    document.getElementById('sector-actual').textContent = operadorActual.sector;
}

  // Calcula los totales de las 4 tarjetas KPI automáticamente
function actualizarKPIs(datos) {
    const totalHoy = datos.length;
    const pendientes = datos.filter(r => r.estado === 'revision').length;
    const multados = datos.filter(r => r.estado === 'multado');
    const descartados = datos.filter(r => r.estado === 'descartado').length;

    // Suma las UMAs de los reportes multados (si no tiene valor, suma 0)
    const totalUmas = multados.reduce((suma, r) => suma + (Number(r.umas) || 0), 0);

    document.getElementById('kpi-hoy').textContent = totalHoy;
    document.getElementById('kpi-pendientes').textContent = pendientes;
    document.getElementById('kpi-multados').textContent = multados.length;
    document.getElementById('kpi-umas').textContent = `${totalUmas} UMA acumuladas`;
    document.getElementById('kpi-descartados').textContent = descartados;
}

  // Construye las filas de la tabla en el HTML
function renderizarTabla(datos) {
    tableBody.innerHTML = ''; // Limpia contenido anterior

    // Mensaje por defecto cuando el arreglo está vacío o no hay coincidencias
    if (datos.length === 0) {
    tableBody.innerHTML = `
        <tr>
        <td colspan="4" class="empty-message">No hay reportes registrados o que coincidan con la búsqueda.
        </td>
        </tr>
    `;
    return;
    }

    // Genera una fila <tr> por cada objeto del arreglo
    datos.forEach(reporte => {
        const fila = document.createElement('tr');
        fila.innerHTML = `
        <td>${reporte.folio}</td>
        <td><span class="badge-plate">${reporte.placa}</span></td>
        <td>${reporte.tipo}</td>
        <td>${reporte.fecha}</td>
    `;
    tableBody.appendChild(fila);
    });
}

  // Filtra el arreglo principal según los 5 controles de búsqueda
function aplicarFiltros() {
    const texto = inputSearch.value.toLowerCase().trim();
    const estado = filterStatus.value;
    const tipo = filterType.value;
    const sector = filterZone.value;
    const fecha = filterDate.value;

    const filtrados = listaReportes.filter(reporte => {
    const coincideTexto = (reporte.folio || '').toLowerCase().includes(texto) ||
                            (reporte.placa || '').toLowerCase().includes(texto);
    const coincideEstado = estado === 'todos' || reporte.estado === estado;
    const coincideTipo = tipo === 'todos' || reporte.tipo === tipo;
    const coincideSector = sector === 'todos' || reporte.sector === sector;
    const coincideFecha = !fecha || (reporte.fecha || '').startsWith(fecha);

    return coincideTexto && coincideEstado && coincideTipo && coincideSector && coincideFecha;
    });

    renderizarTabla(filtrados);
}


  // ==========================================================================
  // 5. EVENTOS DE INTERACCIÓN DEL USUARIO
  // ==========================================================================

  // Desplegar/ocultar menú lateral en teléfonos móviles
if (btnToggle && sidebar) {
    btnToggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    });
}

  // Volver a consultar PostgreSQL al presionar el botón "Actualizar"
if (btnActualizar) {
    btnActualizar.addEventListener('click', obtenerReportesDesdeServidor);
}

  // Ejecutar filtros en tiempo real al escribir o cambiar selectores
[inputSearch, filterStatus, filterType, filterZone, filterDate].forEach(elemento => {
    if (elemento) {
    elemento.addEventListener('input', aplicarFiltros);
    elemento.addEventListener('change', aplicarFiltros);
    }
});

  // Limpiar todos los filtros y mostrar la lista completa
if (btnClear) {
    btnClear.addEventListener('click', () => {
    inputSearch.value = '';
    filterStatus.value = 'todos';
    filterType.value = 'todos';
    filterZone.value = 'todos';
    filterDate.value = '';
    aplicarFiltros();
    });
}


  // ==========================================================================
  // 6. INICIALIZACIÓN AL ABRIR LA PÁGINA
  // ==========================================================================
cargarPerfil();
obtenerReportesDesdeServidor();
});