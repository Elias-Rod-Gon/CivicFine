/**
 * LÓGICA DINÁMICA DE REPORTES Y CONSULTAS BD
 */

const API_BASE_URL = 'http://localhost:3000/api';
const authToken = localStorage.getItem('jwt_token') || null;

document.addEventListener('DOMContentLoaded', () => {
  inicializarDashboard();
});

async function inicializarDashboard() {
  const perfil = await obtenerPerfilUsuario();

  // Validar si el usuario/sistema está activo según BD (PostgreSQL)
  validarEstadoSistema(perfil?.activo ?? true);

  const reportes = await obtenerReportesUsuario();

  // Renderizado dinámico de la lista (maneja vacíos)
  renderizarSeccionReportes(reportes);
  actualizarContadores(reportes);
}

/**
 * CONSULTA A POSTGRES: GET /api/v1/user/profile
 */
async function obtenerPerfilUsuario() {
  try {
    /*
    const response = await fetch(`${API_BASE_URL}/user/profile`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    return await response.json();
    */

    // MOCK TEMPORAL:
    return {
      nombre: "Elías",
      apellido: "Rodríguez",
      municipio: "Zapopan",
      estado: "Jal.",
      iniciales: "E",
      activo: true // Flag de estado traído de BD
    };
  } catch (err) {
    console.error("Error al consultar perfil:", err);
    return null;
  }
}

function validarEstadoSistema(isSystemActive) {
  const btnReportePrincipal = document.getElementById('btn-create-report');
  const btnReporteNav = document.getElementById('nav-new-report-link');
  const statusDot = document.getElementById('user-status-dot');

  if (!isSystemActive) {
    if (btnReportePrincipal) {
      btnReportePrincipal.classList.add('disabled-btn');
      btnReportePrincipal.textContent = 'Servicio inactivo';
      btnReportePrincipal.removeAttribute('href');
    }

    if (btnReporteNav) {
      btnReporteNav.classList.add('disabled-btn');
      btnReporteNav.removeAttribute('href');
    }

    if (statusDot) {
      statusDot.style.backgroundColor = '#ef4444';
    }
  }
}

/**
 * CONSULTA A POSTGRES: GET /api/v1/reports
 */
async function obtenerReportesUsuario() {
  try {
    /*
    const response = await fetch(`${API_BASE_URL}/reports`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    return await response.json();
    */

    // Devuelve array vacío al iniciar base de datos limpia:
    return [];
  } catch (err) {
    console.error("Error al consultar reportes:", err);
    return [];
  }
}

/**
 * RENDERIZADO DINÁMICO & EMPTY STATE
 */
function renderizarSeccionReportes(reportes) {
  const container = document.getElementById('reports-container');
  container.innerHTML = '';

  // CASO: SIN REGISTROS EN BASE DE DATOS
  if (!reportes || reportes.length === 0) {
    container.innerHTML = `
      <article class="empty-state">
        <div class="empty-icon">
          <svg width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
        </div>
        <h4>Aún no hay reportes</h4>
        <p>Los reportes que generes aparecerán organizados aquí.</p>
      </article>
    `;
    return;
  }

  // CASO: CON REGISTROS
  reportes.forEach(rep => {
    let badgeClass = 'badge-received';
    let badgeText = rep.estado;

    switch(rep.estado) {
      case 'MULTADO':
        badgeClass = 'badge-fined';
        badgeText = 'Multado';
        break;
      case 'UNIDAD_ENVIADA':
        badgeClass = 'badge-sent';
        badgeText = 'Enviado';
        break;
      case 'EN_REVISION':
        badgeClass = 'badge-review';
        badgeText = 'En revisión';
        break;
      case 'RECIBIDO':
        badgeClass = 'badge-received';
        badgeText = 'Recibido';
        break;
    }

    const cardHTML = `
      <article class="report-item">
        <header class="report-top">
          <span class="report-folio"># ${rep.folio}</span>
          <span class="badge ${badgeClass}">${badgeText}</span>
        </header>
        <div class="report-content">
          <img src="${rep.imagen_url}" alt="Evidencia de ${rep.titulo}" class="report-img" />
          <div class="report-details">
            <h4 class="report-title">${rep.titulo}</h4>
            <time class="report-time">${rep.fecha}</time>
            <div class="report-tags">
              <span class="tag-plate">${rep.placa}</span>
              <span class="tag-address">${rep.ubicacion}</span>
            </div>
          </div>
        </div>
        <footer class="report-action-bar">
          <span>${rep.subtexto}</span>
          ${rep.accionLabel ? `<a href="/reporte-detalle.html?folio=${rep.folio}" class="link-all">${rep.accionLabel}</a>` : ''}
        </footer>
      </article>
    `;
    container.insertAdjacentHTML('beforeend', cardHTML);
  });
}

function actualizarContadores(reportes) {
  const total = reportes.length;
  document.getElementById('filter-all-count').textContent = total;
  document.getElementById('stat-sent-count').textContent = total;

  const enCurso = reportes.filter(r => r.estado === 'EN_REVISION' || r.estado === 'UNIDAD_ENVIADA').length;
  document.getElementById('filter-progress-count').textContent = enCurso;

  const multados = reportes.filter(r => r.estado === 'MULTADO').length;
  document.getElementById('stat-fined-count').textContent = multados;
  document.getElementById('filter-resolved-count').textContent = multados;

  const efectividad = total > 0 ? Math.round((multados / total) * 100) : 0;
  document.getElementById('stat-effectiveness').textContent = `${efectividad}% efectividad`;
}
