const API = '/api/autoridad';
const VALOR_UMA = 113.14;

const ETIQUETA_ESTADO = { pendiente: 'Pendiente', en_revision: 'En revisión', validado: 'Multado', rechazado: 'Descartado' };

function obtenerSesion() {
  const token = localStorage.getItem('civicfine_token') || sessionStorage.getItem('civicfine_token');
  const raw = localStorage.getItem('civicfine_user') || sessionStorage.getItem('civicfine_user');
  let usuario = null;
  try { usuario = raw ? JSON.parse(raw) : null; } catch (e) { usuario = null; }
  if (!token || token === 'undefined' || token === 'null' || !usuario) return null;
  return { token, usuario };
}

const sesion = obtenerSesion();
const ROLES_PANEL = ['autoridad', 'admin'];
if (!sesion || !ROLES_PANEL.includes(sesion.usuario.rol)) window.location.replace('/IniciaSesion.html');

document.addEventListener('DOMContentLoaded', () => {
  if (!sesion || !ROLES_PANEL.includes(sesion.usuario.rol)) return;

  const esAutoridad = sesion.usuario.rol === 'autoridad';
  const $ = id => document.getElementById(id);

  const el = {
    tbody: $('table-body'),
    search: $('input-search'),
    btnClear: $('btn-clear'),
    btnActualizar: $('btn-actualizar'),
    filtroEstado: $('filter-status'),
    filtroFecha: $('filter-date'),
    filtroTipo: $('filter-type'),
    btnMenu: $('btn-toggle-menu'),
    sidebar: $('sidebar'),
    kpiHoy: $('kpi-hoy'),
    kpiPendientes: $('kpi-pendientes'),
    kpiMultados: $('kpi-multados'),
    kpiUmas: $('kpi-umas'),
    kpiDescartados: $('kpi-descartados'),
    operadorNombre: $('operador-nombre'),
    operadorRol: $('operador-rol'),
    modal: $('modal-dictamen'),
    btnCerrarModal: $('btn-cerrar-modal'),
    modalFolio: $('modal-folio'),
    modalPlaca: $('modal-placa'),
    modalTipo: $('modal-tipo'),
    modalDescripcion: $('modal-descripcion'),
    modalDireccion: $('modal-direccion'),
    fotoContenedor: $('modal-foto-container'),
    tabs: document.querySelectorAll('#modal-dictamen .btn-action-tab'),
    paneles: {
      multar: $('panel-multar'),
      unidad: $('panel-unidad'),
      descartar: $('panel-descartar')
    },
    inputUmas: $('monto-umas'),
    previewMxn: $('monto-mxn-preview'),
    notasMulta: $('notas-multa'),
    tipoUnidad: $('tipo-unidad'),
    prioridadUnidad: $('prioridad-unidad'),
    etaUnidad: $('eta-unidad'),
    motivoDescarte: $('motivo-descarte'),
    detalleDescarte: $('detalle-descarte'),
    firma: $('firma-dictamen'),
    btnConfirmar: $('btn-confirmar-dictamen')
  };

  let reportes = [];
  let reporteActual = null;
  let accionActual = null;
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

  function folio(id) { return `REP-2026-${String(id).padStart(6, '0')}`; }

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
    try { data = await res.json(); } catch (e) { data = {}; }
    return { ok: res.ok, status: res.status, data };
  }

  function setConexion(texto) {
    if (el.operadorRol) el.operadorRol.textContent = texto;
  }

  // ------------------------------------------------------------------------
  // KPI, catálogos y tabla
  // ------------------------------------------------------------------------
  async function cargarResumen() {
    const r = await api('/resumen');
    if (!r.ok) return;
    const d = r.data;
    if (el.kpiHoy) el.kpiHoy.textContent = d.hoy;
    if (el.kpiPendientes) el.kpiPendientes.textContent = d.pendientes;
    if (el.kpiMultados) el.kpiMultados.textContent = d.multados_semana;
    if (el.kpiUmas) el.kpiUmas.textContent = Number(d.monto_semana).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
    if (el.kpiDescartados) el.kpiDescartados.textContent = d.descartados_semana;
  }

  async function cargarCatalogos() {
    const r = await api('/catalogos');
    if (!r.ok || !el.filtroTipo) return;
    el.filtroTipo.innerHTML =
      '<option value="todos">Todas las infracciones</option>' +
      r.data.tipos.map(t => `<option value="${esc(t.nombre)}">${esc(t.nombre)}</option>`).join('');
  }

  async function cargarReportes() {
    const params = new URLSearchParams();
    if (el.filtroEstado && el.filtroEstado.value !== 'todos') params.set('estado', el.filtroEstado.value);
    if (el.filtroTipo && el.filtroTipo.value !== 'todos') params.set('tipo', el.filtroTipo.value);
    if (el.filtroFecha && el.filtroFecha.value) params.set('desde', el.filtroFecha.value);
    const q = el.search ? el.search.value.trim() : '';
    if (q) params.set('q', q);

    const r = await api(`/reportes?${params.toString()}`);
    if (!r.ok) {
      if (el.tbody) el.tbody.innerHTML = `<tr><td colspan="6">${esc(r.data.error || 'Error al cargar.')}</td></tr>`;
      return;
    }
    reportes = r.data.reportes;
    renderTabla();
  }

  function renderTabla() {
    if (!el.tbody) return;
    if (!reportes.length) {
      el.tbody.innerHTML = '<tr><td colspan="6">No hay reportes con esos filtros.</td></tr>';
      return;
    }
    el.tbody.innerHTML = reportes.map(r => {
      const activo = ['pendiente', 'en_revision'].includes(r.estado);
      return `
        <tr>
          <td><strong>${folio(r.id)}</strong></td>
          <td><span class="badge-plate">${esc(r.placa_detectada || 'SIN PLACA')}</span></td>
          <td>${esc(r.tipo_infraccion)}</td>
          <td>${fechaTexto(r.fecha_hora)}</td>
          <td><span class="estado estado-${esc(r.estado)}">${esc(ETIQUETA_ESTADO[r.estado] || r.estado)}</span></td>
          <td>${activo
            ? `<button data-accion="abrir-modal" data-id="${r.id}">Dictaminar</button>`
            : '<span class="muted">Cerrado</span>'}</td>
        </tr>`;
    }).join('');
  }

  async function refrescarTodo() {
    await Promise.all([cargarResumen(), cargarReportes()]);
  }

  // ------------------------------------------------------------------------
  // Modal de dictamen
  // ------------------------------------------------------------------------
  function abrirModalDictamen(id) {
    const rep = reportes.find(x => String(x.id) === String(id));
    if (!rep || !el.modal) return;

    reporteActual = rep;
    accionActual = null;

    el.tabs.forEach(t => t.classList.remove('active'));
    Object.values(el.paneles).forEach(p => { if (p) p.hidden = true; });

    if (el.firma) el.firma.checked = false;
    if (el.inputUmas) el.inputUmas.value = '';
    if (el.previewMxn) el.previewMxn.textContent = 'Equivalente: $0.00 MXN';
    if (el.notasMulta) el.notasMulta.value = '';
    if (el.motivoDescarte) el.motivoDescarte.value = '';
    if (el.detalleDescarte) el.detalleDescarte.value = '';
    if (el.btnConfirmar) el.btnConfirmar.disabled = true;

    if (el.modalFolio) el.modalFolio.textContent = `#${folio(rep.id)}`;
    if (el.modalPlaca) el.modalPlaca.textContent = rep.placa_detectada || 'SIN PLACA';
    if (el.modalTipo) el.modalTipo.textContent = rep.tipo_infraccion || '--';
    if (el.modalDescripcion) el.modalDescripcion.textContent = rep.descripcion || 'Sin descripción proporcionada.';
    if (el.modalDireccion) el.modalDireccion.textContent = rep.direccion || 'Ubicación no especificada';

    if (el.fotoContenedor) {
      if (rep.evidencia_url) {
        el.fotoContenedor.innerHTML = `<img src="${esc(rep.evidencia_url)}" alt="Evidencia"
          onerror="this.style.display='none';this.nextElementSibling.style.display='block';">
          <span style="display:none;">La imagen no se pudo cargar</span>`;
      } else {
        el.fotoContenedor.innerHTML = '<span>Sin imagen adjunta</span>';
      }
    }

    el.modal.hidden = false;
  }

  function cerrarModal() {
    if (el.modal) el.modal.hidden = true;
    reporteActual = null;
  }

  function validarFormulario() {
    let ok = Boolean(el.firma && el.firma.checked && accionActual);
    if (accionActual === 'multar' && !(Number(el.inputUmas && el.inputUmas.value) > 0)) ok = false;
    if (accionActual === 'descartar' && !(el.motivoDescarte && el.motivoDescarte.value)) ok = false;
    if (accionActual === 'unidad' && !(el.tipoUnidad && el.tipoUnidad.value)) ok = false;
    if (el.btnConfirmar) el.btnConfirmar.disabled = !ok;
  }

  if (el.btnCerrarModal) el.btnCerrarModal.addEventListener('click', cerrarModal);

  el.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      accionActual = tab.dataset.accion;
      el.tabs.forEach(t => t.classList.toggle('active', t === tab));
      Object.entries(el.paneles).forEach(([k, p]) => { if (p) p.hidden = k !== accionActual; });
      validarFormulario();
    });
  });

  if (el.inputUmas) {
    el.inputUmas.addEventListener('input', () => {
      const umas = Number(el.inputUmas.value);
      if (el.previewMxn) {
        el.previewMxn.textContent = umas > 0
          ? `Equivalente: $${(umas * VALOR_UMA).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`
          : 'Equivalente: $0.00 MXN';
      }
      validarFormulario();
    });
  }

  if (el.motivoDescarte) el.motivoDescarte.addEventListener('change', validarFormulario);
  if (el.tipoUnidad) el.tipoUnidad.addEventListener('change', validarFormulario);
  if (el.firma) el.firma.addEventListener('change', validarFormulario);

  if (el.btnConfirmar) {
    el.btnConfirmar.addEventListener('click', async () => {
      if (!reporteActual || !accionActual) return;

      const idReal = reporteActual.id;
      const textoOriginal = el.btnConfirmar.textContent;
      el.btnConfirmar.disabled = true;
      el.btnConfirmar.textContent = 'Enviando...';

      let endpoint;
      let payload;

      if (accionActual === 'multar') {
        const umas = Number(el.inputUmas.value);
        endpoint = `/reportes/${idReal}/dictamen`;
        payload = {
          resultado: 'validado',
          monto: Number((umas * VALOR_UMA).toFixed(2)),
          comentario: el.notasMulta ? el.notasMulta.value.trim() : ''
        };
      } else if (accionActual === 'unidad') {
        endpoint = `/reportes/${idReal}/enviar-unidad`;
        payload = {
          tipo_unidad: el.tipoUnidad ? el.tipoUnidad.value : 'patrulla',
          prioridad: el.prioridadUnidad ? el.prioridadUnidad.value : 'media',
          eta_minutos: el.etaUnidad ? Number(el.etaUnidad.value) : 15,
          comentario: ''
        };
      } else {
        const motivo = el.motivoDescarte ? el.motivoDescarte.options[el.motivoDescarte.selectedIndex].text : '';
        const detalle = el.detalleDescarte ? el.detalleDescarte.value.trim() : '';
        endpoint = `/reportes/${idReal}/dictamen`;
        payload = {
          resultado: 'rechazado',
          monto: null,
          comentario: detalle ? `${motivo}: ${detalle}` : motivo
        };
      }

      const r = await api(endpoint, { method: 'POST', body: JSON.stringify(payload) });

      el.btnConfirmar.textContent = textoOriginal;

      if (!r.ok) {
        alert(r.data.error || 'No se pudo registrar la acción.');
        validarFormulario();
        return;
      }

      alert(accionActual === 'unidad'
        ? 'Unidad enviada. El reporte queda abierto para dictamen.'
        : 'Dictamen registrado correctamente.');

      cerrarModal();
      await refrescarTodo();
    });
  }

  // ------------------------------------------------------------------------
  // Eventos de la tabla y filtros
  // ------------------------------------------------------------------------
  document.addEventListener('click', (e) => {
    const boton = e.target.closest('button[data-accion="abrir-modal"]');
    if (boton) abrirModalDictamen(boton.dataset.id);
  });

  [el.filtroEstado, el.filtroTipo, el.filtroFecha].forEach(c => {
    if (c) c.addEventListener('change', cargarReportes);
  });

  if (el.search) {
    el.search.addEventListener('input', () => {
      clearTimeout(debounceBusqueda);
      debounceBusqueda = setTimeout(cargarReportes, 350);
    });
  }

  if (el.btnClear) {
    el.btnClear.addEventListener('click', () => {
      el.search.value = '';
      el.filtroEstado.value = 'todos';
      el.filtroTipo.value = 'todos';
      el.filtroFecha.value = '';
      cargarReportes();
    });
  }

  if (el.btnActualizar) el.btnActualizar.addEventListener('click', refrescarTodo);
  if (el.btnMenu) el.btnMenu.addEventListener('click', () => el.sidebar.classList.toggle('open'));

  // ------------------------------------------------------------------------
  // Tiempo real (SSE)
  // ------------------------------------------------------------------------
  function conectarTiempoReal() {
    const es = new EventSource(`${API}/stream?token=${encodeURIComponent(sesion.token)}`);
    es.addEventListener('open', () => setConexion(`${esAutoridad ? 'Operador' : 'Admin'} · En vivo`));
    es.addEventListener('cambio', () => {
      clearTimeout(debounceTiempoReal);
      debounceTiempoReal = setTimeout(refrescarTodo, 250);
    });
    es.onerror = () => setConexion('Sin conexión, reintentando...');
  }

  // ------------------------------------------------------------------------
  // Arranque
  // ------------------------------------------------------------------------
  if (el.operadorNombre) el.operadorNombre.textContent = sesion.usuario.nombre || 'Operador';
  setConexion(esAutoridad ? 'Operador' : 'Admin');

  cargarCatalogos();
  refrescarTodo();
  conectarTiempoReal();
  setInterval(refrescarTodo, 60000);
});
