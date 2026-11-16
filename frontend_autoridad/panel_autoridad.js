// ==========================================================================
// CIVICFINE - PANEL DE AUTORIDAD (BANDEJA DE REPORTES)
// ==========================================================================

const API = '/api/autoridad';
const MINUTOS_RECLAMO = 30;

const ETIQUETA_ESTADO = {
  pendiente: 'Pendiente',
  en_revision: 'En revisión',
  validado: 'Multado',
  rechazado: 'Descartado'
};

function obtenerSesion() {
  const token = localStorage.getItem('civicfine_token') || sessionStorage.getItem('civicfine_token');
  const raw = localStorage.getItem('civicfine_user') || sessionStorage.getItem('civicfine_user');

  let usuario = null;
  try {
    usuario = raw ? JSON.parse(raw) : null;
  } catch (e) {
    usuario = null;
  }

  if (!token || token === 'undefined' || token === 'null' || !usuario) return null;
  return { token, usuario };
}

const sesion = obtenerSesion();
const ROLES_PANEL = ['autoridad', 'admin'];
if (!sesion || !ROLES_PANEL.includes(sesion.usuario.rol)) {
  window.location.replace('/IniciaSesion.html');
}

document.addEventListener('DOMContentLoaded', () => {
  if (!sesion || !ROLES_PANEL.includes(sesion.usuario.rol)) return;

  const esAutoridad = sesion.usuario.rol === 'autoridad';

  const el = {
    tbody: document.getElementById('table-body'),
    search: document.getElementById('input-search'),
    btnClear: document.getElementById('btn-clear'),
    btnActualizar: document.getElementById('btn-actualizar'),
    filtroEstado: document.getElementById('filter-status'),
    filtroFecha: document.getElementById('filter-date'),
    filtroTipo: document.getElementById('filter-type'),
    btnMenu: document.getElementById('btn-toggle-menu'),
    sidebar: document.getElementById('sidebar'),
    kpiHoy: document.getElementById('kpi-hoy'),
    kpiPendientes: document.getElementById('kpi-pendientes'),
    kpiMultados: document.getElementById('kpi-multados'),
    kpiUmas: document.getElementById('kpi-umas'),
    kpiDescartados: document.getElementById('kpi-descartados'),
    operadorNombre: document.getElementById('operador-nombre'),
    operadorRol: document.getElementById('operador-rol')
  };

  let reportes = [];
  let debounceBusqueda = null;
  let debounceTiempoReal = null;

  // ------------------------------------------------------------------------
  // Utilidades
  // ------------------------------------------------------------------------
  function esc(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function folio(id) {
    return `REP-2026-${String(id).padStart(6, '0')}`;
  }

  function fechaTexto(fecha) {
    if (!fecha) return '—';
    return new Date(fecha).toLocaleString('es-MX', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  function cerrarSesion() {
    localStorage.clear();
    sessionStorage.clear();
    window.location.replace('/IniciaSesion.html');
  }

  // Envuelve fetch: agrega el token y maneja la sesión vencida
  async function api(ruta, opciones = {}) {
    const res = await fetch(`${API}${ruta}`, {
      ...opciones,
      headers: {
        'Authorization': `Bearer ${sesion.token}`,
        'Content-Type': 'application/json'
      }
    });

    if (res.status === 401) {
      cerrarSesion();
      return { ok: false, status: 401, data: { error: 'Sesión expirada.' } };
    }

    let data = {};
    try {
      data = await res.json();
    } catch (e) {
      data = {};
    }
    return { ok: res.ok, status: res.status, data };
  }

  function setConexion(texto) {
    if (el.operadorRol) el.operadorRol.textContent = texto;
  }

  // ------------------------------------------------------------------------
  // KPI, catálogos y lista
  // ------------------------------------------------------------------------
  async function cargarResumen() {
    const r = await api('/resumen');
    if (!r.ok) return;

    const d = r.data;
    el.kpiHoy.textContent = d.hoy;
    el.kpiPendientes.textContent = d.pendientes;
    el.kpiMultados.textContent = d.multados_semana;
    el.kpiUmas.textContent = `${Number(d.monto_semana).toLocaleString('es-MX', {
      style: 'currency', currency: 'MXN'
    })} acumulados`;
    el.kpiDescartados.textContent = d.descartados_semana;
  }

  async function cargarCatalogos() {
    const r = await api('/catalogos');
    if (!r.ok) return;

    el.filtroTipo.innerHTML =
      '<option value="todos">Todas las infracciones</option>' +
      r.data.tipos.map(t => `<option value="${esc(t.nombre)}">${esc(t.nombre)}</option>`).join('');
  }

  async function cargarReportes() {
    const params = new URLSearchParams();
    if (el.filtroEstado.value !== 'todos') params.set('estado', el.filtroEstado.value);
    if (el.filtroTipo.value !== 'todos') params.set('tipo', el.filtroTipo.value);
    if (el.filtroFecha.value) params.set('desde', el.filtroFecha.value);

    const q = el.search.value.trim();
    if (q) params.set('q', q);

    const r = await api(`/reportes?${params.toString()}`);
    if (!r.ok) {
      el.tbody.innerHTML = `<tr><td colspan="7">${esc(r.data.error || 'No se pudieron cargar los reportes.')}</td></tr>`;
      return;
    }

    reportes = r.data.reportes;
    renderTabla();
  }

  function botonesAccion(r) {
    if (!esAutoridad) return '<span class="muted">Solo lectura</span>';

    const activo = ['pendiente', 'en_revision'].includes(r.estado);
    if (!activo) return '<span class="muted">Dictaminado</span>';

    if (r.reclamado_por_mi) {
      return `
        <button data-accion="dictaminar" data-id="${r.id}">Dictaminar</button>
        <button class="btn-secundario" data-accion="liberar" data-id="${r.id}">Liberar</button>`;
    }

    if (r.reclamo_vigente) return '<span class="muted">Reclamado</span>';

    return `<button data-accion="reclamar" data-id="${r.id}">Reclamar</button>`;
  }

  function renderTabla() {
    if (!reportes.length) {
      el.tbody.innerHTML = '<tr><td colspan="7">No hay reportes con esos filtros.</td></tr>';
      return;
    }

    el.tbody.innerHTML = reportes.map(r => {
      let operador = '—';
      if (r.reclamo_vigente) {
        operador = r.reclamado_por_mi ? 'Tú' : esc(r.operador_nombre || 'Otro operador');
      }

      return `
        <tr>
          <td><strong>${folio(r.id)}</strong></td>
          <td><span class="badge-plate">${esc(r.placa_detectada || 'SIN PLACA')}</span></td>
          <td>${esc(r.tipo_infraccion)}</td>
          <td>${fechaTexto(r.fecha_hora)}</td>
          <td><span class="estado estado-${esc(r.estado)}">${esc(ETIQUETA_ESTADO[r.estado] || r.estado)}</span></td>
          <td>${operador}</td>
          <td>${botonesAccion(r)}</td>
        </tr>`;
    }).join('');
  }

  async function refrescarTodo() {
    await Promise.all([cargarResumen(), cargarReportes()]);
  }

  // ------------------------------------------------------------------------
  // Acciones del operador
  // ------------------------------------------------------------------------
  async function reclamar(id) {
    const r = await api(`/reportes/${id}/reclamar`, { method: 'POST' });
    if (!r.ok) alert(r.data.error || 'No se pudo reclamar el reporte.');
    await refrescarTodo();
  }

  async function liberar(id) {
    if (!confirm('¿Liberar este reporte para que otro operador lo tome?')) return;
    const r = await api(`/reportes/${id}/liberar`, { method: 'POST' });
    if (!r.ok) alert(r.data.error || 'No se pudo liberar el reporte.');
    await refrescarTodo();
  }

  async function dictaminar(id) {
    const rep = reportes.find(x => x.id === id);
    if (!rep) return;

    const opcion = (prompt('Escribe M para multar o D para descartar:') || '').trim().toUpperCase();
    if (!opcion) return;
    if (opcion !== 'M' && opcion !== 'D') {
      alert('Escribe M o D.');
      return;
    }

    let monto = null;
    if (opcion === 'M') {
      const entrada = prompt('Monto de la multa (MXN):', rep.monto_referencia ?? '');
      if (entrada === null) return;
      monto = Number(entrada);
      if (!(monto > 0)) {
        alert('El monto debe ser mayor a cero.');
        return;
      }
    }

    const comentario = prompt('Comentario para el expediente (opcional):') ?? '';

    const r = await api(`/reportes/${id}/dictamen`, {
      method: 'POST',
      body: JSON.stringify({
        resultado: opcion === 'M' ? 'validado' : 'rechazado',
        monto,
        comentario
      })
    });

    if (!r.ok) alert(r.data.error || 'No se pudo registrar el dictamen.');
    await refrescarTodo();
  }

  el.tbody.addEventListener('click', (e) => {
    const boton = e.target.closest('button[data-accion]');
    if (!boton) return;

    const id = Number(boton.dataset.id);
    switch (boton.dataset.accion) {
      case 'reclamar': reclamar(id); break;
      case 'liberar': liberar(id); break;
      case 'dictaminar': dictaminar(id); break;
    }
  });

  // ------------------------------------------------------------------------
  // Filtros y controles
  // ------------------------------------------------------------------------
  [el.filtroEstado, el.filtroTipo, el.filtroFecha].forEach(control => {
    control.addEventListener('change', cargarReportes);
  });

  el.search.addEventListener('input', () => {
    clearTimeout(debounceBusqueda);
    debounceBusqueda = setTimeout(cargarReportes, 350);
  });

  el.btnClear.addEventListener('click', () => {
    el.search.value = '';
    el.filtroEstado.value = 'todos';
    el.filtroTipo.value = 'todos';
    el.filtroFecha.value = '';
    cargarReportes();
  });

  el.btnActualizar.addEventListener('click', refrescarTodo);

  if (el.btnMenu) {
    el.btnMenu.addEventListener('click', () => el.sidebar.classList.toggle('open'));
  }

  // ------------------------------------------------------------------------
  // Tiempo real (SSE)
  // ------------------------------------------------------------------------
  function conectarTiempoReal() {
    const url = `${API}/stream?token=${encodeURIComponent(sesion.token)}`;
    const es = new EventSource(url);

    es.addEventListener('open', () => setConexion(`${esAutoridad ? 'Operador' : 'Administrador'} · En vivo`));

    es.addEventListener('cambio', () => {
      // Agrupa varios cambios seguidos en una sola recarga
      clearTimeout(debounceTiempoReal);
      debounceTiempoReal = setTimeout(refrescarTodo, 250);
    });

    es.onerror = () => setConexion('Sin conexión, reintentando...');
  }

  // ------------------------------------------------------------------------
  // Arranque
  // ------------------------------------------------------------------------
  el.operadorNombre.textContent = sesion.usuario.nombre || 'Operador';
  setConexion(esAutoridad ? 'Operador' : 'Administrador');

  cargarCatalogos();
  refrescarTodo();
  conectarTiempoReal();

  // Recarga cada minuto para que los reclamos vencidos se liberen en pantalla
  setInterval(refrescarTodo, 60000);
});
