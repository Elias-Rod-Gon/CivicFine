// ==========================================================================
// CIVICFINE - ESTADÍSTICAS VIALES (PANEL AUTORIDAD)
// ==========================================================================

// 1. GUARDIÁN DE AUTENTICACIÓN
(function verificarSesionAutoridad() {
  const token = localStorage.getItem('civicfine_token') || sessionStorage.getItem('civicfine_token');
  const usuarioRaw = localStorage.getItem('civicfine_user') || sessionStorage.getItem('civicfine_user');

  if (!token || !usuarioRaw) {
    window.location.replace('IniciaSesion.html');
    return;
  }
})();

document.addEventListener('DOMContentLoaded', () => {
  // Elementos DOM del Header & Topbar
  const operadorNombre = document.getElementById('operador-nombre');
  const operadorRol = document.getElementById('operador-rol');
  const sectorActual = document.getElementById('sector-actual');
  const btnCerrarSesion = document.getElementById('btn-cerrar-sesion');
  const btnToggleMenu = document.getElementById('btn-toggle-menu');
  const sidebar = document.getElementById('sidebar');

  // Elementos DOM de Filtros
  const formFiltros = document.getElementById('form-filtros-fecha');
  const inputFechaDesde = document.getElementById('fecha-desde');
  const inputFechaHasta = document.getElementById('fecha-hasta');
  const btnLimpiarFiltros = document.getElementById('btn-limpiar-filtros');

  // Elementos DOM de KPIs
  const kpiTotalReportes = document.getElementById('kpi-total-reportes');
  const kpiPorcentajeReales = document.getElementById('kpi-porcentaje-reales');
  const kpiRealesNota = document.getElementById('kpi-reales-nota');
  const kpiCantidadCerrados = document.getElementById('kpi-cantidad-cerrados');
  const kpiHoraPico = document.getElementById('kpi-hora-pico');

  // Elementos DOM de Secciones
  const mapaCalorContainer = document.getElementById('mapa-calor-container');
  const graficaHorasContainer = document.getElementById('grafica-horas-pico-container');
  const listaTopDirecciones = document.getElementById('lista-top-direcciones');

  // Elementos DOM de Desglose
  const countPendiente = document.getElementById('count-estado-pendiente');
  const countRevision = document.getElementById('count-estado-revision');
  const countMultado = document.getElementById('count-estado-multado');
  const countDescartado = document.getElementById('count-estado-descartado');

  // Instancias de Control
  let mapInstance = null;
  let heatLayer = null;

  // 2. Cargar Datos del Operador
  const usuarioGuardado = JSON.parse(
    localStorage.getItem('civicfine_user') || sessionStorage.getItem('civicfine_user') || '{}'
  );

  if (operadorNombre) operadorNombre.textContent = usuarioGuardado.nombre || 'Operador Autoridad';
  if (operadorRol) operadorRol.textContent = usuarioGuardado.rol ? usuarioGuardado.rol.toUpperCase() : 'AUTORIDAD';
  if (sectorActual) sectorActual.textContent = `Comité de Monitoreo Urbano > ${usuarioGuardado.municipio_nombre || 'Zapopan'}`;

  // Menú Móvil
  if (btnToggleMenu && sidebar) {
    btnToggleMenu.addEventListener('click', () => {
      sidebar.classList.toggle('active');
    });
  }

  // Cerrar Sesión
  if (btnCerrarSesion) {
    btnCerrarSesion.addEventListener('click', () => {
      localStorage.clear();
      sessionStorage.clear();
      window.location.replace('IniciaSesion.html');
    });
  }

  // 3. Establecer Rango por Defecto (Últimos 30 Días)
  function establecerRangoInicial() {
    const hoy = new Date();
    const hace30Dias = new Date();
    hace30Dias.setDate(hoy.getDate() - 30);

    inputFechaHasta.value = hoy.toISOString().split('T')[0];
    inputFechaDesde.value = hace30Dias.toISOString().split('T')[0];
  }

  // 4. Inicializar Mapa de Calor (Leaflet)
  function inicializarMapa() {
    if (mapInstance) return;

    // Coordenadas fijas de Zapopan Centro (20.7215, -103.3868)
    mapInstance = L.map(mapaCalorContainer).setView([20.7215, -103.3868], 12);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '© OpenStreetMap'
    }).addTo(mapInstance);
  }

  // 5. Consultar API y Calcular Estadísticas
  async function cargarEstadisticas() {
    const desde = inputFechaDesde.value;
    const hasta = inputFechaHasta.value;

    const token = localStorage.getItem('civicfine_token') || sessionStorage.getItem('civicfine_token');

    try {
      const res = await fetch(`/api/autoridad/estadisticas?desde=${desde}&hasta=${hasta}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      let reportes = [];
      if (res.ok) {
        const data = await res.json();
        reportes = data.reportes || data || [];
      } else {
        // Fallback local si el endpoint devuelve array o requiere formato plano
        console.warn('API estadísticas sin respuesta estructurada, intentando endpoint directo.');
        const resDirecta = await fetch('/api/autoridad/reportes', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (resDirecta.ok) {
          const dataDirecta = await resDirecta.json();
          reportes = dataDirecta.reportes || [];
        }
      }

      procesarYRenderizar(reportes);

    } catch (err) {
      console.error('Error al cargar estadísticas:', err);
      procesarYRenderizar([]);
    }
  }

  // 6. Procesamiento de Datos y KPIs
  function procesarYRenderizar(reportes) {
    const total = reportes.length;

    // Desglose por estados
    let pendientes = 0;
    let revision = 0;
    let multados = 0;
    let descartados = 0;

    // Conteo por horas (0 a 23 hrs)
    const conteoHoras = new Array(24).fill(0);

    // Conteo por direcciones
    const mapaDirecciones = {};

    // Puntos para mapa de calor [lat, lng, intensidad]
    const puntosCalor = [];

    reportes.forEach(rep => {
      const est = (rep.estado || '').toLowerCase();
      if (est === 'pendiente') pendientes++;
      else if (est === 'en_revision' || est === 'revision') revision++;
      else if (est === 'multado' || est === 'validado') multados++;
      else if (est === 'descartado' || est === 'rechazado') descartados++;

      // Extraer hora
      if (rep.fecha_hora) {
        const hora = new Date(rep.fecha_hora).getHours();
        if (!isNaN(hora) && hora >= 0 && hora < 24) {
          conteoHoras[hora]++;
        }
      }

      // Direcciones
      const dir = rep.direccion || 'Sin dirección registrada';
      mapaDirecciones[dir] = (mapaDirecciones[dir] || 0) + 1;

      // Coordenadas GPS
      const lat = parseFloat(rep.latitud);
      const lng = parseFloat(rep.longitud);
      if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
        puntosCalor.push([lat, lng, 0.8]);
      }
    });

    // Renderizar KPIs
    if (kpiTotalReportes) kpiTotalReportes.textContent = total;

    const cantidadCerrados = multados + descartados;
    if (kpiCantidadCerrados) kpiCantidadCerrados.textContent = cantidadCerrados;

    if (kpiPorcentajeReales && kpiRealesNota) {
      if (cantidadCerrados === 0) {
        kpiPorcentajeReales.textContent = '0%';
        kpiRealesNota.textContent = 'Sin datos';
      } else {
        const pct = Math.round((multados / cantidadCerrados) * 100);
        kpiPorcentajeReales.textContent = `${pct}%`;
        kpiRealesNota.textContent = `${multados} de ${cantidadCerrados} cerrados`;
      }
    }

    // Calcular Hora Pico
    let maxIncidencias = 0;
    let horaPicoIndex = -1;
    conteoHoras.forEach((cant, h) => {
      if (cant > maxIncidencias) {
        maxIncidencias = cant;
        horaPicoIndex = h;
      }
    });

    if (kpiHoraPico) {
      if (horaPicoIndex === -1 || maxIncidencias === 0) {
        kpiHoraPico.textContent = '--:--';
      } else {
        const hFormateada = String(horaPicoIndex).padStart(2, '0');
        kpiHoraPico.textContent = `${hFormateada}:00 hrs`;
      }
    }

    // Actualizar Contadores de Estado
    if (countPendiente) countPendiente.textContent = pendientes;
    if (countRevision) countRevision.textContent = revision;
    if (countMultado) countMultado.textContent = multados;
    if (countDescartado) countDescartado.textContent = descartados;

    // Renderizar Mapa de Calor
    renderizarMapaCalor(puntosCalor);

    // Renderizar Gráfica de 24 Horas
    renderizarGrafica24H(conteoHoras, horaPicoIndex);

    // Renderizar Top 5 Direcciones
    renderizarTopDirecciones(mapaDirecciones);
  }

  // 7. Renderizar Capa de Calor
  function renderizarMapaCalor(puntos) {
    inicializarMapa();

    if (heatLayer) {
      mapInstance.removeLayer(heatLayer);
    }

    if (puntos.length > 0) {
      heatLayer = L.heatLayer(puntos, {
        radius: 25,
        blur: 15,
        maxZoom: 16
      }).addTo(mapInstance);

      // Centrar mapa en el primer punto válido
      mapInstance.panTo([puntos[0][0], puntos[0][1]]);
    }
  }

  // 8. Renderizar Gráfica de Barras CSS
  function renderizarGrafica24H(conteoHoras, horaPicoIndex) {
    if (!graficaHorasContainer) return;

    const maxVal = Math.max(...conteoHoras, 1);

    let html = '<div class="chart-bar-grid">';
    for (let h = 0; h < 24; h++) {
      const val = conteoHoras[h];
      const pctHeight = Math.max(Math.round((val / maxVal) * 100), 4);
      const esPico = h === horaPicoIndex && val > 0;
      const clasePeak = esPico ? 'peak' : '';

      html += `
        <div class="chart-bar-item">
          <span class="chart-bar-value">${val > 0 ? val : ''}</span>
          <div class="chart-bar-fill ${clasePeak}" style="height: ${pctHeight}%;"></div>
          <span class="chart-bar-label">${String(h).padStart(2, '0')}h</span>
        </div>
      `;
    }
    html += '</div>';

    graficaHorasContainer.innerHTML = html;
  }

  // 9. Renderizar Tabla Top 5 Direcciones
  function renderizarTopDirecciones(mapaDirecciones) {
    if (!listaTopDirecciones) return;

    const ordenadas = Object.keys(mapaDirecciones)
      .map(dir => ({ direccion: dir, total: mapaDirecciones[dir] }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    if (ordenadas.length === 0) {
      listaTopDirecciones.innerHTML = `
        <tr>
          <td colspan="3" style="text-align: center; color: #94a3b8;">Sin incidencias registradas</td>
        </tr>
      `;
      return;
    }

    listaTopDirecciones.innerHTML = ordenadas.map((item, index) => `
      <tr>
        <td style="font-weight: 700; color: #0284c7;">${index + 1}</td>
        <td>${item.direccion}</td>
        <td style="text-align: right; font-weight: 700;">${item.total}</td>
      </tr>
    `).join('');
  }

  // Eventos de Filtros
  if (formFiltros) {
    formFiltros.addEventListener('submit', (e) => {
      e.preventDefault();
      cargarEstadisticas();
    });
  }

  if (btnLimpiarFiltros) {
    btnLimpiarFiltros.addEventListener('click', () => {
      establecerRangoInicial();
      cargarEstadisticas();
    });
  }

  // Inicio de Ejecución
  establecerRangoInicial();
  cargarEstadisticas();
});
