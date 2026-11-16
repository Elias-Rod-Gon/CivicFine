// ==========================================================================
// CIVICFINE - DASHBOARD CIUDADANO
// ==========================================================================

// Lee la sesión desde localStorage o sessionStorage, en un solo lugar
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

// Guardián: solo redirige si realmente no hay sesión
const sesion = obtenerSesion();
if (!sesion) {
  console.warn('Acceso denegado: no hay sesión activa.');
  window.location.replace('IniciaSesion.html');
}

document.addEventListener('DOMContentLoaded', () => {
  if (!sesion) return; // ya se redirigió arriba

  const { token, usuario } = sesion;
  // Acepta distintos nombres de id que pueda devolver el login
  const userId = usuario.id ?? usuario.id_usuario ?? usuario.idUsuario ?? usuario._id ?? null;

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
  };

  let reportesTotales = [];

  cargarPerfil();
  configurarCierreSesion();
  configurarTabs();

  if (userId) {
    cargarReportes(userId);
  } else {
    console.warn('El usuario no tiene id; no se pueden cargar reportes.');
    renderizarLista([]);
    actualizarMetricas([]);
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

  async function cargarReportes(id) {
    if (el.containerReportes) {
      el.containerReportes.innerHTML = `
        <div class="empty-state"><p>Cargando información desde el servidor...</p></div>`;
    }

    try {
      const res = await fetch(`/api/usuario/mis-reportes/${id}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      // Un 401 significa token inválido o vencido: ahí sí cerramos sesión
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

      const placaText = rep.placa_detectada
        ? (rep.placa_detectada.length === 64 ? `${rep.placa_detectada.substring(0, 8)}...` : rep.placa_detectada)
        : 'SIN PLACA';

      return `
        <article class="report-card">
          <div class="report-header">
            <span class="report-folio">${rep.folio || 'FOLIO-000'}</span>
            <span class="badge-status badge-${estado}">${estadoText}</span>
          </div>
          <div class="report-body">
            <img
              src="${rep.evidencia_url || 'https://via.placeholder.com/64?text=Sin+Foto'}"
              alt="Evidencia"
              class="report-thumb"
              onerror="this.src='https://via.placeholder.com/64?text=Sin+Foto';"
            >
            <div class="report-info">
              <strong>${rep.tipo_infraccion || 'Infracción Vial'}</strong>
              <span>📍 ${rep.direccion || 'Ubicación no especificada'}</span>
              <small>Placa: <strong>${placaText}</strong> | 📅 ${fechaText}</small>
            </div>
          </div>
        </article>`;
    }).join('');
  }
});
