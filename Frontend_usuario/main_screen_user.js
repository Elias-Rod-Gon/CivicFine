// ==========================================================================
// CIVICFINE - DASHBOARD CIUDADANO
// ==========================================================================

function obtenerSesion() {
  const token = localStorage.getItem('civicfine_token') || sessionStorage.getItem('civicfine_token');
  const raw = localStorage.getItem('civicfine_user') || sessionStorage.getItem('civicfine_user');

  let usuario = null;
  try {
    usuario = raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error('Error parseando usuario local:', e);
  }

  const esValido = token && token !== 'undefined' && token !== 'null' && usuario;
  return esValido ? { token, usuario } : null;
}

const sesion = obtenerSesion();
if (!sesion) {
  console.warn('Acceso denegado: no hay sesión activa.');
  window.location.replace('IniciaSesion.html');
}

document.addEventListener('DOMContentLoaded', () => {
  if (!sesion) return;

  const { token, usuario } = sesion;
  const userId = usuario.id ?? usuario.usuario_id ?? usuario.id_usuario ?? null;

  const el = {
    containerReportes: document.getElementById('container-reportes'),
    userDisplayName: document.getElementById('user-display-name'),
    userSector: document.getElementById('user-sector'),
    headerUserName: document.getElementById('header-user-name'),
    btnCerrarSesion: document.getElementById('btn-cerrar-sesion'),
    kpiPendientes: document.getElementById('kpi-pendientes'),
    kpiValidados: document.getElementById('kpi-validados'),
    lblTodos: document.getElementById('lbl-todos'),
    lblRevision: document.getElementById('lbl-revision'),
    lblResueltos: document.getElementById('lbl-resueltos'),
    tabTodos: document.getElementById('tab-todos'),
    tabRevision: document.getElementById('tab-revision'),
    tabResueltos: document.getElementById('tab-resueltos'),
    modal: document.getElementById('modal-detalle'),
    btnCerrarDetalle: document.getElementById('btn-cerrar-detalle'),
    detFoto: document.getElementById('det-foto'),
    detFolio: document.getElementById('det-folio'),
    detEstado: document.getElementById('det-estado'),
    detInfraccion: document.getElementById('det-infraccion'),
    detPlaca: document.getElementById('det-placa'),
    detFecha: document.getElementById('det-fecha'),
    detDireccion: document.getElementById('det-direccion'),
    detMapa: document.getElementById('det-mapa'),
    detDescripcion: document.getElementById('det-descripcion'),
  };

  let reportesTotales = [];

  cargarPerfil();
  configurarCierreSesion();
  configurarTabs();
  configurarDetalle();

  if (userId) {
    cargarReportes();
  } else {
    console.warn('El usuario no tiene id; no se pueden cargar reportes.');
    actualizarMetricas([]);
    renderizarLista([]);
  }

  function cargarPerfil() {
    const nombre = usuario.nombre || 'Ciudadano';
    if (el.userDisplayName) el.userDisplayName.textContent = `Hola, ${nombre}`;
    if (el.headerUserName) el.headerUserName.textContent = nombre.split(' ')[0];
    if (el.userSector) el.userSector.textContent = `📍 ${usuario.municipio_nombre || 'Zapopan Centro'}`;
  }

  function configurarCierreSesion() {
    if (!el.btnCerrarSesion) return;
    el.btnCerrarSesion.addEventListener('click', () => {
      localStorage.clear();
      sessionStorage.clear();
      window.location.replace('IniciaSesion.html');
    });
  }

  function configurarTabs() {
    [el.tabTodos, el.tabRevision, el.tabResueltos].forEach(tab => {
      if (tab) tab.addEventListener('change', renderizarSegunTab);
    });
  }

  function configurarDetalle() {
    if (!el.btnCerrarDetalle) return;
    el.btnCerrarDetalle.addEventListener('click', cerrarDetalle);
  }

  function cerrarDetalle() {
    el.modal.hidden = true;
    el.detMapa.removeAttribute('src');
    el.detFoto.removeAttribute('src');
  }

  async function cargarReportes() {
    if (el.containerReportes) {
      el.containerReportes.innerHTML = `
        <div class="empty-state"><p>Cargando información desde el servidor...</p></div>`;
    }

    try {
      const res = await fetch('/api/usuario/mis-reportes', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (res.status === 401) {
        localStorage.clear();
        sessionStorage.clear();
        window.location.replace('IniciaSesion.html');
        return;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      reportesTotales = data.reportes || [];
    } catch (err) {
      console.warn('No se pudieron cargar los reportes:', err.message);
      reportesTotales = [];
    }

    actualizarMetricas(reportesTotales);
    renderizarSegunTab();
  }

  function actualizarMetricas(reportes) {
    const pendientes = reportes.filter(r => r.estado === 'pendiente' || r.estado === 'en_revision');
    const validados = reportes.filter(r => r.estado === 'validado');
    const resueltos = reportes.filter(r => r.estado === 'validado' || r.estado === 'rechazado');

    if (el.kpiPendientes) el.kpiPendientes.textContent = pendientes.length;
    if (el.kpiValidados) el.kpiValidados.textContent = validados.length;
    if (el.lblTodos) el.lblTodos.textContent = `Todos (${reportes.length})`;
    if (el.lblRevision) el.lblRevision.textContent = `En revisión (${pendientes.length})`;
    if (el.lblResueltos) el.lblResueltos.textContent = `Resueltos (${resueltos.length})`;
  }

  function renderizarSegunTab() {
    if (el.tabRevision?.checked) {
      renderizarLista(reportesTotales.filter(r => r.estado === 'pendiente' || r.estado === 'en_revision'));
    } else if (el.tabResueltos?.checked) {
      renderizarLista(reportesTotales.filter(r => r.estado === 'validado' || r.estado === 'rechazado'));
    } else {
      renderizarLista(reportesTotales);
    }
  }

  function renderizarLista(lista) {
    if (!el.containerReportes) return;

    if (!lista || lista.length === 0) {
      el.containerReportes.innerHTML = `
        <div class="empty-state">
          <p>No tienes reportes registrados todavía.</p>
          <small>Presiona el botón <strong>+</strong> para reportar una infracción vial.</small>
        </div>`;
      return;
    }

    el.containerReportes.innerHTML = lista.map(rep => {
      const fechaText = rep.fecha_hora
        ? new Date(rep.fecha_hora).toLocaleDateString('es-MX', {
            day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
          })
        : 'Fecha no registrada';

      const estado = rep.estado || 'pendiente';
      const estadoText = estado.replace('_', ' ').toUpperCase();
      const placaText = rep.placa_detectada || 'SIN PLACA';
      const folio = `REP-2026-${String(rep.id).padStart(6, '0')}`;

      const miniatura = rep.evidencia_url
        ? `<img class="report-thumb" src="${rep.evidencia_url}" alt="Evidencia" loading="lazy"
              onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'report-thumb-placeholder',textContent:'Sin Foto'}))">`
        : `<div class="report-thumb-placeholder">Sin Foto</div>`;

      return `
        <article class="report-card clickable" data-id="${rep.id}">
          <div class="report-header">
            <span class="report-folio">${folio}</span>
            <span class="badge-status badge-${estado}">${estadoText}</span>
          </div>
          <div class="report-body">
            ${miniatura}
            <div class="report-info">
              <strong>${rep.tipo_infraccion || 'Infracción Vial'}</strong>
              <span>📍 ${rep.direccion || 'Ubicación no especificada'}</span>
              <small>Placa: <strong>${placaText}</strong> | 📅 ${fechaText}</small>
            </div>
          </div>
        </article>`;
    }).join('');

    el.containerReportes.querySelectorAll('.report-card.clickable').forEach(card => {
      card.addEventListener('click', () => abrirDetalle(card.dataset.id));
    });
  }

  async function abrirDetalle(reporteId) {
    try {
      const res = await fetch(`/api/usuario/reportes/${reporteId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { reporte: r } = await res.json();

      const fecha = new Date(r.fecha_hora).toLocaleString('es-MX', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
      });

      if (r.evidencia_url) {
        el.detFoto.src = r.evidencia_url;
        el.detFoto.style.display = 'block';
      } else {
        el.detFoto.removeAttribute('src');
        el.detFoto.style.display = 'none';
      }

      el.detFolio.textContent = `REP-2026-${String(r.reporte_id).padStart(6, '0')}`;
      el.detEstado.textContent = r.estado.replace('_', ' ').toUpperCase();
      el.detEstado.className = `badge-status badge-${r.estado}`;
      el.detInfraccion.textContent = r.tipo_infraccion;
      el.detPlaca.textContent = r.placa_detectada || 'Sin placa';
      el.detFecha.textContent = fecha;
      el.detDireccion.textContent = r.direccion || 'Sin dirección';
      el.detDescripcion.textContent = r.descripcion || 'Sin observaciones';

      if (r.latitud && r.longitud) {
        const lat = Number(r.latitud);
        const lon = Number(r.longitud);
        const d = 0.003;
        el.detMapa.src =
          `https://www.openstreetmap.org/export/embed.html?bbox=${lon - d},${lat - d},${lon + d},${lat + d}&layer=mapnik&marker=${lat},${lon}`;
      } else {
        el.detMapa.removeAttribute('src');
      }

      el.modal.hidden = false;
    } catch (err) {
      console.warn('No se pudo abrir el detalle:', err.message);
      alert('No se pudo abrir el reporte.');
    }
  }
});
