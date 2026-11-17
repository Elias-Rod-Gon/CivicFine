// ==========================================================================
// CIVICFINE - ESTADÍSTICAS VIALES (PANEL AUTORIDAD)
// ==========================================================================

(function verificarSesionAutoridad() {
  const token = localStorage.getItem('civicfine_token') || sessionStorage.getItem('civicfine_token');
  const usuarioRaw = localStorage.getItem('civicfine_user') || sessionStorage.getItem('civicfine_user');

  if (!token || !usuarioRaw) {
    window.location.replace('IniciaSesion.html');
  }
})();

document.addEventListener('DOMContentLoaded', () => {
  const operadorNombre = document.getElementById('operador-nombre');
  const operadorRol = document.getElementById('operador-rol');
  const sectorActual = document.getElementById('sector-actual');
  const btnCerrarSesion = document.getElementById('btn-cerrar-sesion');
  const btnToggleMenu = document.getElementById('btn-toggle-menu');
  const sidebar = document.getElementById('sidebar');

  const formFiltros = document.getElementById('form-filtros-fecha');
  const inputFechaDesde = document.getElementById('fecha-desde');
  const inputFechaHasta = document.getElementById('fecha-hasta');
  const btnLimpiarFiltros = document.getElementById('btn-limpiar-filtros');

  const kpiTotalReportes = document.getElementById('kpi-total-reportes');
  const kpiPorcentajeReales = document.getElementById('kpi-porcentaje-reales');
  const kpiRealesNota = document.getElementById('kpi-reales-nota');
  const kpiCantidadCerrados = document.getElementById('kpi-cantidad-cerrados');
  const kpiHoraPico = document.getElementById('kpi-hora-pico');

  const mapaCalorContainer = document.getElementById('mapa-calor-container');
  const graficaHorasContainer = document.getElementById('grafica-horas-pico-container');
  const listaTopDirecciones = document.getElementById('lista-top-direcciones');

  const countPendiente = document.getElementById('count-estado-pendiente');
  const countRevision = document.getElementById('count-estado-revision');
  const countMultado = document.getElementById('count-estado-multado');
  const countDescartado = document.getElementById('count-estado-descartado');

  let mapInstance = null;
  let heatLayer = null;

  const usuarioGuardado = JSON.parse(
    localStorage.getItem('civicfine_user') || sessionStorage.getItem('civicfine_user') || '{}'
  );

  if (operadorNombre) operadorNombre.textContent = usuarioGuardado.nombre || 'Operador Autoridad';
  if (operadorRol) operadorRol.textContent = usuarioGuardado.rol ? usuarioGuardado.rol.toUpperCase() : 'AUTORIDAD';
  if (sectorActual) sectorActual.textContent = `Comité de Monitoreo Urbano > ${usuarioGuardado.municipio_nombre || 'Zapopan'}`;

  if (btnToggleMenu && sidebar) {
    btnToggleMenu.addEventListener('click', () => {
      sidebar.classList.toggle('active');
    });
  }

  if (btnCerrarSesion) {
    btnCerrarSesion.addEventListener('click', () => {
      localStorage.clear();
      sessionStorage.clear();
      window.location.replace('IniciaSesion.html');
    });
  }

  function establecerRangoInicial() {
    const hoy = new Date();
    const hace30Dias = new Date();
    hace30Dias.setDate(hoy.getDate() - 30);

    inputFechaHasta.value = hoy.toISOString().split('T')[0];
    inputFechaDesde.value = hace30Dias.toISOString().split('T')[0];
  }

  function inicializarMapa() {
    if (mapInstance || !mapaCalorContainer) return;

    mapInstance = L.map(mapaCalorContainer).setView([20.7215, -103.3868], 12);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '© OpenStreetMap'
    }).addTo(mapInstance);

    setTimeout(() => mapInstance.invalidateSize(), 300);
  }

  async function cargarEstadisticas() {
    const desde = inputFechaDesde.value;
    const hasta = inputFechaHasta.value;
    const token = localStorage.getItem('civicfine_token') || sessionStorage.getItem('civicfine_token');

    try {
      // RUTA CORREGIDA: /api/estadisticas
      const res = await fetch(`/api/estadisticas?desde=${desde}&hasta=${hasta}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!res.ok) {
        console.warn(`Error al consultar /api/estadisticas (${res.status})`);
        return;
      }

      const data = await res.json();
      procesarYRenderizar(data);

    } catch (err) {
      console.error('Error al cargar estadísticas:', err);
    }
  }

  function procesarYRenderizar(data) {
    const conteo = data.conteo || {};

    if (kpiTotalReportes) kpiTotalReportes.textContent = data.total || 0;
    if (kpiCantidadCerrados) kpiCantidadCerrados.textContent = data.cerrados || 0;

    if (kpiPorcentajeReales && kpiRealesNota) {
      if (data.porcentaje_reales !== null && data.porcentaje_reales !== undefined) {
        kpiPorcentajeReales.textContent = `${data.porcentaje_reales}%`;
        kpiRealesNota.textContent = `${conteo.validado || 0} de ${data.cerrados || 0} cerrados`;
      } else {
        kpiPorcentajeReales.textContent = '0%';
        kpiRealesNota.textContent = 'Sin datos';
      }
    }

    if (countPendiente) countPendiente.textContent = conteo.pendiente || 0;
    if (countRevision) countRevision.textContent = conteo.en_revision || 0;
    if (countMultado) countMultado.textContent = conteo.validado || 0;
    if (countDescartado) countDescartado.textContent = conteo.rechazado || 0;

    let maxIncidencias = 0;
    let horaPicoIndex = -1;
    const conteoHoras = (data.por_hora || []).map((h, i) => {
      const totalHora = h.total || 0;
      if (totalHora > maxIncidencias) {
        maxIncidencias = totalHora;
        horaPicoIndex = i;
      }
      return totalHora;
    });

    if (kpiHoraPico) {
      if (horaPicoIndex === -1 || maxIncidencias === 0) {
        kpiHoraPico.textContent = '--:--';
      } else {
        const hFormateada = String(horaPicoIndex).padStart(2, '0');
        kpiHoraPico.textContent = `${hFormateada}:00 hrs`;
      }
    }

    // Filtrar coordenadas válidas descartando ceros y centroides por defecto (0.001)
    const puntosCalor = (data.puntos_mapa || [])
      .filter(p => p.lat !== null && p.lng !== null && Math.abs(p.lat) > 0.001 && Math.abs(p.lng) > 0.001)
      .map(p => [parseFloat(p.lat), parseFloat(p.lng), 0.5]);

    renderizarMapaCalor(puntosCalor);
    renderizarGrafica24H(conteoHoras, horaPicoIndex);
    renderizarTopDirecciones(data.top_direcciones || []);
  }

  function renderizarMapaCalor(puntos) {
    inicializarMapa();
    if (!mapInstance) return;

    if (heatLayer) {
      mapInstance.removeLayer(heatLayer);
    }
    mapInstance.closePopup();

    if (puntos.length > 0 && typeof L.heatLayer === 'function') {
      heatLayer = L.heatLayer(puntos, {
        radius: 22,
        blur: 15,
        maxZoom: 17,
        max: 3.0,
        minOpacity: 0.25
      }).addTo(mapInstance);

      mapInstance.setView([puntos[0][0], puntos[0][1]], 13);
    } else {
      L.popup()
        .setLatLng([20.7215, -103.3868])
        .setContent('<p style="font-size:12px; margin:0;">No hay reportes con coordenadas GPS en este rango.</p>')
        .openOn(mapInstance);
    }
  }

  function renderizarGrafica24H(conteoHoras, horaPicoIndex) {
    if (!graficaHorasContainer) return;
    const maxVal = Math.max(...conteoHoras, 1);

    let html = '<div class="chart-bar-grid">';
    for (let h = 0; h < 24; h++) {
      const val = conteoHoras[h] || 0;
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

  function renderizarTopDirecciones(direcciones) {
    if (!listaTopDirecciones) return;

    if (direcciones.length === 0) {
      listaTopDirecciones.innerHTML = `<tr><td colspan="3" class="table-loading">Sin incidencias registradas</td></tr>`;
      return;
    }

    listaTopDirecciones.innerHTML = direcciones.map((item, index) => `
      <tr>
        <td style="font-weight: 700; color: var(--color-primary, #0B3D91);">${index + 1}</td>
        <td>${item.direccion}</td>
        <td style="text-align: right; font-weight: 700;">${item.total}</td>
      </tr>
    `).join('');
  }

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

  establecerRangoInicial();
  cargarEstadisticas();
});
