document.addEventListener('DOMContentLoaded', () => {

  // ==========================================================================
  // 1. CONFIGURACIÓN Y VARIABLES DE ESTADO
  // ==========================================================================
  // Obtener el folio desde la URL (ej: detalle-reporte.html?folio=ZPN-2026-000123)
const params = new URLSearchParams(window.location.search);
const folioActual = params.get('folio') || '';

const API_BASE_URL = 'https://tu-proyecto.up.railway.app/api/reportes';
const VALOR_UMA_2026 = 108.57;

let sesionActual = {
    idOficial: "#ZAP-9921",
    nombre: "R. Méndez",
    rol: "Operador Activo",
    area: "Dir. de Movilidad, Zapopan"
};

  // Variable vacía que almacenará el expediente cargado desde PostgreSQL + AWS S3
let expedienteData = null;

  // Estado del formulario de dictamen
let accionSeleccionada = 'multar';
let umasSeleccionadas = 10;

  // ==========================================================================
  // 2. REFERENCIAS AL DOM
  // ==========================================================================
const btnToggle = document.getElementById('btn-toggle-menu');
const sidebar = document.getElementById('sidebar');
const notasInput = document.getElementById('notas-dictamen');
const checkFirma = document.getElementById('check-firma');
const btnEmitir = document.getElementById('btn-emitir-boleta');

  // ==========================================================================
  // 3. CONEXIÓN AL SERVIDOR (RAILWAY + POSTGRESQL + AWS S3)
  // ==========================================================================
async function cargarExpediente() {
    if (!folioActual) {
        renderizarEstadoVacio();
        return;
    }

    try {
        const res = await fetch(`${API_BASE_URL}/${encodeURIComponent(folioActual)}`);
        if (!res.ok) throw new Error('Expediente no encontrado en servidor');
        expedienteData = await res.json();
        renderizarExpediente(expedienteData);

    } catch (error) {
        console.warn('Esperando datos de PostgreSQL:', error.message);
        renderizarEstadoVacio();
    }
}

  // ==========================================================================
  // 4. RENDERIZADO DINÁMICO
  // ==========================================================================
function cargarSesion() {
    document.getElementById('operador-nombre').textContent = sesionActual.nombre;
    document.getElementById('operador-rol').textContent = sesionActual.rol;
    document.getElementById('sidebar-user-name').textContent = sesionActual.nombre;
    document.getElementById('sidebar-user-area').textContent = sesionActual.area;
    document.getElementById('dictamen-oficial-id').textContent = `Oficial ${sesionActual.idOficial}`;
}

function renderizarEstadoVacio() {
    document.getElementById('exp-titulo').textContent = folioActual
    ? `Expediente de Infracción: ${folioActual}`
    : 'Sin expediente seleccionado';
    document.getElementById('exp-subtitulo').textContent = 'No hay datos cargados desde la base de datos por el momento.';
    renderizarTimeline([]);
    actualizarTextoBotonEmitir();
}

function renderizarExpediente(data) {
    // Cabecera
    document.getElementById('exp-sector').textContent = data.sector || 'Sector sin asignar';
    document.getElementById('exp-prioridad').textContent = data.prioridad || 'Prioridad estándar';
    document.getElementById('exp-titulo').textContent = `Expediente de Infracción: ${data.folio}`;
    document.getElementById('exp-subtitulo').textContent = `Reportado por ${data.ciudadano || 'Anónimo'} • ${data.fecha} • ${data.ubicacion}`;
    document.getElementById('exp-estado').textContent = (data.estado || 'EN REVISIÓN').toUpperCase();

    // Evidencia fotográfica (AWS S3)
    if (data.evidenciaUrlS3) {
        const img = document.getElementById('evidencia-img');
        img.src = data.evidenciaUrlS3;
        img.style.display = 'block';
        document.getElementById('evidencia-placeholder').style.display = 'none';
        document.getElementById('btn-full-res').disabled = false;
    }
    document.getElementById('evidencia-hash').textContent = data.hashSha256 ? 'Hash SHA-256 Válido' : 'Hash Pendiente';
    document.getElementById('evidencia-calle').textContent = `Marcador de Calle: ${data.ubicacion || 'Sin dato'}`;
    document.getElementById('evidencia-gps').textContent = `GPS: ${data.lat || '0.0'}° N, ${data.lng || '0.0'}° W`;
    document.getElementById('evidencia-fecha').textContent = data.fecha || '';

    // Vehículo e infracción
    document.getElementById('vehiculo-placa').textContent = data.placa || '---';
    document.getElementById('vehiculo-tipo').textContent = data.vehiculoTipo || 'No identificado';
    document.getElementById('vehiculo-color').textContent = `Color: ${data.vehiculoColor || '---'}`;
    document.getElementById('vehiculo-carroceria').textContent = `Carrocería: ${data.vehiculoCarroceria || '---'}`;
    document.getElementById('vehiculo-afectacion').textContent = data.afectacion || 'Sin evaluación';
    document.getElementById('vehiculo-detalle-afectacion').textContent = data.afectacionDetalle || '';
    document.getElementById('infraccion-descripcion').textContent = data.tipoInfraccion || 'Sin tipificar';

    // Mapa
    document.getElementById('mapa-direccion').textContent = data.ubicacion || 'Dirección pendiente';
    document.getElementById('mapa-colonia').textContent = data.colonia || 'Zapopan, Jalisco';

    // Antecedentes de placa
    document.getElementById('antecedentes-titulo').textContent = `Historial de Placa ${data.placa || '---'}`;
    document.getElementById('antecedentes-detalle').textContent = `${data.antecedentesCount || 0} antecedente(s) previo(s) en los últimos 12 meses`;

    // Historial (Timeline)
    renderizarTimeline(data.historial || []);
}

function renderizarTimeline(eventos) {
    const lista = document.getElementById('timeline-list');
    document.getElementById('historial-count').textContent = `${eventos.length} Registros`;
    lista.innerHTML = '';

    if (eventos.length === 0) {
        lista.innerHTML = `<li class="empty">Aún no hay eventos registrados en este expediente.</li>`;
        return;
    }

    eventos.forEach(ev => {
        const li = document.createElement('li');
        li.innerHTML = `
        <strong>${ev.hora} • ${ev.titulo}</strong>
        <p>${ev.descripcion}</p>
    `;
        lista.appendChild(li);
    });
}

  // ==========================================================================
  // 5. LÓGICA DE DICTAMEN (UMAs, VALIDACIÓN Y ENVÍO A POSTGRESQL)
  // ==========================================================================
function actualizarTextoBotonEmitir() {
    if (accionSeleccionada === 'multar') {
      const montoTotal = (umasSeleccionadas * VALOR_UMA_2026).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        btnEmitir.textContent = umasSeleccionadas > 0
        ? `Emitir Boleta de Infracción Formal (${umasSeleccionadas} UMA • $${montoTotal} MXN)`
        : 'Emitir Boleta de Infracción (Monto Especial)';
        btnEmitir.style.background = '#0f766e';
    } else if (accionSeleccionada === 'unidad') {
        btnEmitir.textContent = 'Despachar Unidad Operativa al Punto';
        btnEmitir.style.background = '#0284c7';
    } else {
        btnEmitir.textContent = 'Descartar y Archivar Reporte';
        btnEmitir.style.background = '#b91c1c';
    }
}

function validarFormulario() {
    const tieneNotas = notasInput.value.trim().length > 5;
    const estaFirmado = checkFirma.checked;
    btnEmitir.disabled = !(tieneNotas && estaFirmado);
}

  // Selección de pestaña (Multar / Enviar unidad / Descartar)
document.querySelectorAll('#decision-tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('#decision-tabs button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        accionSeleccionada = btn.dataset.accion;
        actualizarTextoBotonEmitir();
    });
});

  // Selección de tarjeta de UMA
document.querySelectorAll('#uma-grid .uma-card').forEach(card => {
    card.addEventListener('click', () => {
        document.querySelectorAll('#uma-grid .uma-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        umasSeleccionadas = Number(card.dataset.umas);
        actualizarTextoBotonEmitir();
    });
});

  // Validación en tiempo real
    notasInput.addEventListener('input', validarFormulario);
    checkFirma.addEventListener('change', validarFormulario);

  // Envío del dictamen al backend en Railway
btnEmitir.addEventListener('click', async () => {
    const payload = {
        folio: folioActual,
        oficialId: sesionActual.idOficial,
        accion: accionSeleccionada,
        umas: accionSeleccionada === 'multar' ? umasSeleccionadas : 0,
        notas: notasInput.value.trim(),
        firmado: checkFirma.checked
    };

    try {
        btnEmitir.disabled = true;
        btnEmitir.textContent = 'Procesando dictamen...';

        const res = await fetch(`${API_BASE_URL}/${encodeURIComponent(folioActual)}/dictamen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
});

    if (!res.ok) throw new Error('Error al guardar dictamen en servidor');
    alert('Dictamen registrado correctamente en PostgreSQL.');
    window.location.href = 'index.html';

    } catch (error) {
        alert('No se pudo conectar con el servidor en Railway. Revisa tu conexión.');
        validarFormulario();
        actualizarTextoBotonEmitir();
    }
});

  // Menú móvil
if (btnToggle && sidebar) {
    btnToggle.addEventListener('click', () => sidebar.classList.toggle('open'));
}

  // Inicializar
cargarSesion();
cargarExpediente();
});