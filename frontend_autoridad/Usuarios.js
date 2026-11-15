document.addEventListener('DOMContentLoaded', () => {

  // ==========================================================================
  // 1. VARIABLES DE ESTADO (Inician vacías hasta conectar con Railway/PostgreSQL)
  // ==========================================================================
const API_USUARIOS_URL = 'https://tu-proyecto.up.railway.app/api/usuarios-activos';

let sesionActual = {
    nombre: "R. Méndez",
    rol: "Operador Activo",
    area: "Dir. de Movilidad, Zapopan"
};

let listaOficiales = [];
let zonasDemanda = [];
let metricasTurno = {
    tiempoPromedio: 0.0,
    aprobadasHoy: 0,
    descartadasHoy: 0,
    capacidadPorcentaje: 0
};

  // ==========================================================================
  // 2. REFERENCIAS AL DOM
  // ==========================================================================
const btnToggle = document.getElementById('btn-toggle-menu');
const sidebar = document.getElementById('sidebar');
const tableBody = document.getElementById('table-body');
const listaZonasEl = document.getElementById('lista-zonas');

const inputSearch = document.getElementById('input-search');
const filterRol = document.getElementById('filter-rol');
const filterEstado = document.getElementById('filter-estado');
const btnRefresh = document.getElementById('btn-refresh');

  // ==========================================================================
  // 3. CONEXIÓN AL SERVIDOR (RAILWAY + POSTGRESQL + AWS S3)
  // ==========================================================================
async function cargarDatosDesdeServidor() {
    if (btnRefresh) {
        btnRefresh.textContent = 'Cargando...';
        btnRefresh.disabled = true;
    }

    try {
        const res = await fetch(API_USUARIOS_URL);
        if (!res.ok) throw new Error('Servidor aún no conectado');

        const data = await res.json();
        listaOficiales = data.oficiales || [];
        zonasDemanda = data.zonas || [];
        metricasTurno = data.metricas || metricasTurno;

    } catch (error) {
        console.warn('Esperando conexión a Railway/PostgreSQL:', error.message);
    } finally {
        actualizarKPIs();
        aplicarFiltros();
        renderizarZonas();

        if (btnRefresh) {
        btnRefresh.textContent = '↻ Actualizar';
        btnRefresh.disabled = false;
        }
        }
}

  // ==========================================================================
  // 4. FUNCIONES DE RENDERIZADO DINÁMICO
  // ==========================================================================
function cargarSesion() {
    document.getElementById('operador-nombre').textContent = sesionActual.nombre;
    document.getElementById('operador-rol').textContent = sesionActual.rol;
    document.getElementById('sidebar-user-name').textContent = sesionActual.nombre;
    document.getElementById('sidebar-user-area').textContent = sesionActual.area;
}

function actualizarKPIs() {
    const enLinea = listaOficiales.filter(o => o.estado === 'En línea').length;
    const enPatrullaje = listaOficiales.filter(o => o.estado === 'En patrullaje').length;
    const totalDictamenes = (metricasTurno.aprobadasHoy || 0) + (metricasTurno.descartadasHoy || 0);

    document.getElementById('kpi-activos').textContent = enLinea;
    document.getElementById('kpi-patrullaje').textContent = enPatrullaje;
    document.getElementById('kpi-tiempo').innerHTML = `${metricasTurno.tiempoPromedio.toFixed(1)} <small>min / reporte</small>`;
    document.getElementById('kpi-dictamenes').textContent = totalDictamenes;
    document.getElementById('kpi-desglose').textContent = `Aprobadas: ${metricasTurno.aprobadasHoy} | Descartadas: ${metricasTurno.descartadasHoy}`;
    document.getElementById('capacidad-turno').textContent = `${metricasTurno.capacidadPorcentaje}% Operativo`;
}

function obtenerClaseEstado(estado) {
    if (estado === 'En línea') return 'online';
    if (estado === 'En patrullaje') return 'patrol';
    return 'away';
}

function renderizarTabla(datos) {
    tableBody.innerHTML = '';
    document.getElementById('contador-registros').textContent = `Mostrando ${datos.length} de ${listaOficiales.length} funcionarios en turno`;

    if (datos.length === 0) {
        tableBody.innerHTML = `
        <tr>
        <td colspan="6" class="empty-message">
            No hay oficiales conectados o registrados en este momento.
        </td>
        </tr>
    `;
    return;
    }

    datos.forEach(oficial => {
        const avatarUrl = oficial.fotoS3 || `https://ui-avatars.com/api/?name=${encodeURIComponent(oficial.nombre)}&background=cbd5e1&color=0f172a`;
        const claseBadge = obtenerClaseEstado(oficial.estado);

        const fila = document.createElement('tr');
        fila.innerHTML = `
        <td>
        <div class="user-cell">
            <img src="${avatarUrl}" alt="${oficial.nombre}">
            <div>
                <strong>${oficial.nombre}</strong>
                <small>${oficial.correo}</small>
                <small>ID: ${oficial.id}</small>
            </div>
        </div>
        </td>
        <td><strong>${oficial.area}</strong><br><small>${oficial.sector}</small></td>
        <td><span class="badge role">${oficial.rol}</span></td>
        <td>${oficial.ultimaActividad}</td>
        <td><span class="badge ${claseBadge}">● ${oficial.estado}</span></td>
        <td>
        <div class="action-btns">
            <button onclick="verActividad('${oficial.id}')">Ver actividad</button>
            <button class="dark" onclick="asignarZona('${oficial.id}')">Asignar zona</button>
        </div>
        </td>
    `;
    tableBody.appendChild(fila);
    });
}

function renderizarZonas() {
    listaZonasEl.innerHTML = '';
    if (zonasDemanda.length === 0) {
        listaZonasEl.innerHTML = `<li><span>Sin reportes activos en los últimos 45 min</span><strong>0 reportes</strong></li>`;
        return;
    }

    zonasDemanda.forEach(z => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${z.nombre}</span><strong>${z.cantidad} reportes</strong>`;
        listaZonasEl.appendChild(li);
    });
}

function aplicarFiltros() {
    const texto = inputSearch.value.toLowerCase().trim();
    const rol = filterRol.value;
    const estado = filterEstado.value;

    const filtrados = listaOficiales.filter(o => {
    const coincideTexto = (o.nombre || '').toLowerCase().includes(texto) ||
                            (o.correo || '').toLowerCase().includes(texto) ||
                            (o.id || '').toLowerCase().includes(texto);
    const coincideRol = rol === 'todos' || o.rol === rol;
    const coincideEstado = estado === 'todos' || o.estado === estado;
    return coincideTexto && coincideRol && coincideEstado;
    });

    renderizarTabla(filtrados);
}

  // ==========================================================================
  // 5. EVENTOS
  // ==========================================================================
if (btnToggle && sidebar) {
    btnToggle.addEventListener('click', () => sidebar.classList.toggle('open'));
}

[inputSearch, filterRol, filterEstado].forEach(el => {
    if (el) {
        el.addEventListener('input', aplicarFiltros);
        el.addEventListener('change', aplicarFiltros);
    }
});

if (btnRefresh) {
    btnRefresh.addEventListener('click', cargarDatosDesdeServidor);
}

  // Inicializar
cargarSesion();
cargarDatosDesdeServidor();
});

function verActividad(idOficial) {
console.log('Consultando bitácora del oficial:', idOficial);
}

function asignarZona(idOficial) {
console.log('Abriendo modal de asignación para:', idOficial);
}