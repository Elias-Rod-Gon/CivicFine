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

// FUNCIÓN PARA ENCONTRAR LA FOTO SIN IMPORTAR EL NOMBRE DE LA COLUMNA
function obtenerUrlFoto(rep) {
  // 1. Buscar en nombres comunes
  let url = rep.foto_url || rep.foto || rep.foto_aws || rep.url_foto || rep.imagen || rep.evidencia || rep.foto_base64;
  if (url && typeof url === 'string' && url.length > 10) return url;

  // 2. Si no se encontró, buscar en cualquier propiedad que parezca una URL
  for (const key in rep) {
    if (typeof rep[key] === 'string' && (rep[key].startsWith('http') || rep[key].startsWith('data:image'))) {
      return rep[key];
    }
  }
  return null;
}

document.addEventListener('DOMContentLoaded', () => {
  if (!sesion || !ROLES_PANEL.includes(sesion.usuario.rol)) return;

  const esAutoridad = ['autoridad', 'admin'].includes(sesion.usuario.rol);

  const el = {
    tbody: document.getElementById('table-body'),
    search: document.getElementById('input-search'), btnClear: document.getElementById('btn-clear'), btnActualizar: document.getElementById('btn-actualizar'),
    filtroEstado: document.getElementById('filter-status'), filtroFecha: document.getElementById('filter-date'), filtroTipo: document.getElementById('filter-type'),
    btnMenu: document.getElementById('btn-toggle-menu'), sidebar: document.getElementById('sidebar'),
    kpiHoy: document.getElementById('kpi-hoy'), kpiPendientes: document.getElementById('kpi-pendientes'), kpiMultados: document.getElementById('kpi-multados'),
    kpiUmas: document.getElementById('kpi-umas'), kpiDescartados: document.getElementById('kpi-descartados'),
    operadorNombre: document.getElementById('operador-nombre'), operadorRol: document.getElementById('operador-rol')
  };

  const modal = document.getElementById('modal-dictamen');
  const btnCerrarModal = document.getElementById('btn-cerrar-modal');
  const modalFolio = document.getElementById('modal-folio');
  const tabs = modal ? modal.querySelectorAll('.btn-action-tab') : [];
  const paneles = { multar: document.getElementById('panel-multar'), unidad: document.getElementById('panel-unidad'), descartar: document.getElementById('panel-descartar') };
  const btnConfirmar = document.getElementById('btn-confirmar-dictamen');
  const firma = document.getElementById('firma-dictamen');
  const motivoDescarte = document.getElementById('motivo-descarte');
  const inputUmas = document.getElementById('monto-umas');
  const previewMxn = document.getElementById('monto-mxn-preview');

  let reportes = [];
  let debounceBusqueda = null;
  let debounceTiempoReal = null;
  let reporteActual = null;
  let accionActual = null;

  function esc(valor) { return String(valor ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function folio(id) { return `REP-2026-${String(id).padStart(6, '0')}`; }
  function fechaTexto(fecha) { if (!fecha) return '—'; return new Date(fecha).toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  function cerrarSesion() { localStorage.clear(); sessionStorage.clear(); window.location.replace('/IniciaSesion.html'); }

  async function api(ruta, opciones = {}) {
    const res = await fetch(`${API}${ruta}`, { ...opciones, headers: { 'Authorization': `Bearer ${sesion.token}`, 'Content-Type': 'application/json' } });
    if (res.status === 401) { cerrarSesion(); return { ok: false, status: 401, data: { error: 'Sesión expirada.' } }; }
    let data = {}; try { data = await res.json(); } catch (e) { data = {}; }
    return { ok: res.ok, status: res.status, data };
  }

  function setConexion(texto) { if (el.operadorRol) el.operadorRol.textContent = texto; }

  async function cargarResumen() {
    const r = await api('/resumen'); if (!r.ok) return;
    const d = r.data;
    if (el.kpiHoy) el.kpiHoy.textContent = d.hoy;
    if (el.kpiPendientes) el.kpiPendientes.textContent = d.pendientes;
    if (el.kpiMultados) el.kpiMultados.textContent = d.multados_semana;
    if (el.kpiUmas) el.kpiUmas.textContent = `${Number(d.monto_semana).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}`;
    if (el.kpiDescartados) el.kpiDescartados.textContent = d.descartados_semana;
  }

  async function cargarCatalogos() {
    const r = await api('/catalogos'); if (!r.ok || !el.filtroTipo) return;
    el.filtroTipo.innerHTML = '<option value="todos">Todas las infracciones</option>' + r.data.tipos.map(t => `<option value="${esc(t.nombre)}">${esc(t.nombre)}</option>`).join('');
  }

  async function cargarReportes() {
    const params = new URLSearchParams();
    if (el.filtroEstado && el.filtroEstado.value !== 'todos') params.set('estado', el.filtroEstado.value);
    if (el.filtroTipo && el.filtroTipo.value !== 'todos') params.set('tipo', el.filtroTipo.value);
    if (el.filtroFecha && el.filtroFecha.value) params.set('desde', el.filtroFecha.value);
    const q = el.search ? el.search.value.trim() : ''; if (q) params.set('q', q);

    const r = await api(`/reportes?${params.toString()}`);
    if (!r.ok) { if (el.tbody) el.tbody.innerHTML = `<tr><td colspan="7">${esc(r.data.error || 'Error al cargar.')}</td></tr>`; return; }
    reportes = r.data.reportes;
    renderTabla();
  }

  function renderTabla() {
    if (!el.tbody) return;
    if (!reportes.length) { el.tbody.innerHTML = '<tr><td colspan="7">No hay reportes con esos filtros.</td></tr>'; return; }

    el.tbody.innerHTML = reportes.map(r => {
      const activo = ['pendiente', 'en_revision'].includes(r.estado);
      const idReal = r.id || r.reporte_id;
      const urlFoto = obtenerUrlFoto(r);

      const fotoHTML = urlFoto
        ? `<img src="${urlFoto}" class="table-thumb" alt="Evidencia" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+PHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiBmaWxsPSIjZTFlOGYwIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtc2l6ZT0iMTAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIiBmaWxsPSIjOTRhM2I4Ij5FcnJvcjwvdGV4dD48L3N2Zz4='">`
        : `<div class="table-thumb-empty">S/F</div>`;

      return `
        <tr>
          <td><strong>${folio(idReal)}</strong></td>
          <td>${fotoHTML}</td>
          <td><span class="badge-plate">${esc(r.placa_detectada || 'SIN PLACA')}</span></td>
          <td>${esc(r.tipo_infraccion)}</td>
          <td>${fechaTexto(r.fecha_hora)}</td>
          <td><span class="estado estado-${esc(r.estado)}">${esc(ETIQUETA_ESTADO[r.estado] || r.estado)}</span></td>
          <td>${activo ? `<button data-accion="abrir-modal" data-id="${idReal}">Dictaminar</button>` : '<span class="muted">Cerrado</span>'}</td>
        </tr>`;
    }).join('');
  }

  async function refrescarTodo() { await Promise.all([cargarResumen(), cargarReportes()]); }

  function abrirModalDictamen(id) {
    const rep = reportes.find(x => String(x.id) === String(id) || String(x.reporte_id) === String(id));
    if (!rep || !modal) return;

    reporteActual = rep; accionActual = null;
    if (firma) firma.checked = false;
    if (btnConfirmar) btnConfirmar.disabled = true;
    if (document.getElementById('notas-multa')) document.getElementById('notas-multa').value = '';
    if (motivoDescarte) motivoDescarte.value = '';
    if (document.getElementById('detalle-descarte')) document.getElementById('detalle-descarte').value = '';
    if (inputUmas) { inputUmas.value = ''; if(previewMxn) previewMxn.textContent = 'Equivalente: $0.00 MXN'; }

    if (modalFolio) modalFolio.textContent = `#${folio(rep.id || rep.reporte_id)}`;
    if (document.getElementById('modal-placa')) document.getElementById('modal-placa').textContent = rep.placa_detectada || 'SIN PLACA';
    if (document.getElementById('modal-tipo')) document.getElementById('modal-tipo').textContent = rep.tipo_infraccion;
    if (document.getElementById('modal-descripcion')) document.getElementById('modal-descripcion').textContent = rep.descripcion || rep.detalles || 'Sin descripción proporcionada.';
    if (document.getElementById('modal-direccion')) document.getElementById('modal-direccion').textContent = rep.direccion || 'Ubicación no especificada';

    // BUSCAR LA FOTO EN EL MODAL
    const fotoBox = document.getElementById('modal-foto-container');
    const urlFoto = obtenerUrlFoto(rep);

    if (fotoBox) {
      if (urlFoto) {
        fotoBox.innerHTML = `<img src="${urlFoto}" alt="Evidencia" style="width: 100%; height: 100%; object-fit: contain;" onerror="this.style.display='none'; document.getElementById('modal-foto-texto').style.display='block'; document.getElementById('modal-foto-texto').textContent='La imagen no se pudo cargar (URL inválida)';">
                             <span id="modal-foto-texto" style="display:none;">Imagen no disponible</span>`;
      } else {
        fotoBox.innerHTML = `<span id="modal-foto-texto">Foto no adjunta en la base de datos</span>`;
      }
    }

    tabs.forEach(t => t.classList.remove('active'));
    Object.values(paneles).forEach(p => { if(p) p.hidden = true; });
    modal.hidden = false;
  }

  if (modal) {
    if (btnCerrarModal) btnCerrarModal.addEventListener('click', () => modal.hidden = true);

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        accionActual = tab.dataset.accion;
        tabs.forEach(t => t.classList.toggle('active', t === tab));
        Object.entries(paneles).forEach(([k, p]) => { if(p) p.hidden = k !== accionActual; });
        validarFormulario();
      });
    });

    if (motivoDescarte) motivoDescarte.addEventListener('change', validarFormulario);
    if (firma) firma.addEventListener('change', validarFormulario);

    if (inputUmas) {
      inputUmas.addEventListener('input', () => {
        const umas = Number(inputUmas.value);
        if (umas > 0) {
          previewMxn.textContent = `Equivalente: $${(umas * VALOR_UMA).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`;
        } else {
          previewMxn.textContent = 'Equivalente: $0.00 MXN';
        }
        validarFormulario();
      });
    }

    function validarFormulario() {
      let ok = firma && firma.checked && accionActual;
      if (accionActual === 'multar' && inputUmas && !(Number(inputUmas.value) > 0)) ok = false;
      if (accionActual === 'descartar' && motivoDescarte && !motivoDescarte.value) ok = false;
      if (btnConfirmar) btnConfirmar.disabled = !ok;
    }

    if (btnConfirmar) {
      btnConfirmar.addEventListener('click', async () => {
        if (!reporteActual || !accionActual) return;
        btnConfirmar.disabled = true; btnConfirmar.textContent = 'Enviando...';
        try {
          let endpoint, payload;
          const idReal = reporteActual.id || reporteActual.reporte_id;

          if (accionActual === 'multar') {
            const umas = Number(inputUmas.value);
            const montoMxn = umas * VALOR_UMA;
            endpoint = `/reportes/${idReal}/dictamen`;
            payload = { resultado: 'validado', monto: montoMxn, comentario: document.getElementById('notas-multa') ? document.getElementById('notas-multa').value : '' };
          } else if (accionActual === 'unidad') {
            endpoint = `/reportes/${idReal}/enviar-unidad`;
            payload = { tipo_unidad: document.getElementById('tipo-unidad') ? document.getElementById('tipo-unidad').value : 'patrulla', prioridad: 'media', eta_minutos: 15, comentario: '' };
          } else {
            endpoint = `/reportes/${idReal}/dictamen`;
            payload = { resultado: 'rechazado', monto: null, comentario: motivoDescarte ? (motivoDescarte.options[motivoDescarte.selectedIndex].text + ': ' + (document.getElementById('detalle-descarte') ? document.getElementById('detalle-descarte').value : '')) : 'Desestimado' };
          }

          const r = await api(endpoint, { method: 'POST', body: JSON.stringify(payload) });
          if (!r.ok) { alert(r.data.error || 'Error.'); return; }

          alert('Acción registrada correctamente.');
          modal.hidden = true;
          await refrescarTodo();
        } catch (e) {
          alert("Error de red");
        } finally {
          btnConfirmar.disabled = false;
          btnConfirmar.textContent = 'Confirmar Dictamen';
        }
      });
    }
  }

  document.addEventListener('click', (e) => {
    const boton = e.target.closest('button[data-accion="abrir-modal"]');
    if (boton) abrirModalDictamen(boton.dataset.id);
  });

  [el.filtroEstado, el.filtroTipo, el.filtroFecha].forEach(c => { if(c) c.addEventListener('change', cargarReportes); });
  if (el.search) el.search.addEventListener('input', () => { clearTimeout(debounceBusqueda); debounceBusqueda = setTimeout(cargarReportes, 350); });
  if (el.btnClear) el.btnClear.addEventListener('click', () => { el.search.value = ''; el.filtroEstado.value = 'todos'; el.filtroTipo.value = 'todos'; el.filtroFecha.value = ''; cargarReportes(); });
  if (el.btnActualizar) el.btnActualizar.addEventListener('click', refrescarTodo);
  if (el.btnMenu) el.btnMenu.addEventListener('click', () => el.sidebar.classList.toggle('open'));

  function conectarTiempoReal() {
    const es = new EventSource(`${API}/stream?token=${encodeURIComponent(sesion.token)}`);
    es.addEventListener('open', () => setConexion(`${esAutoridad ? 'Operador' : 'Admin'} · En vivo`));
    es.addEventListener('cambio', () => { clearTimeout(debounceTiempoReal); debounceTiempoReal = setTimeout(refrescarTodo, 250); });
    es.onerror = () => setConexion('Sin conexión, reintentando...');
  }

  if (el.operadorNombre) el.operadorNombre.textContent = sesion.usuario.nombre || 'Operador';
  setConexion(esAutoridad ? 'Operador' : 'Admin');

  cargarCatalogos();
  refrescarTodo();
  conectarTiempoReal();
  setInterval(refrescarTodo, 60000);
});
