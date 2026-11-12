(() => {
  'use strict';

  /* ==========================================================
    Configuración
     ========================================================== */
  const KEY = 'civicfine.reportes.v1';
  const FOLIO_KEY = 'civicfine.folio.v1';
  const MAX_FOTO = 1.5 * 1024 * 1024; // 1.5 MB

  // Línea de tiempo de demo (milisegundos desde que se crea el reporte).
  // Cuando haya backend real, estos estados vendrán del servidor.
  const PASOS = [
    { label: 'Recibido',       desc: 'Tu reporte llegó a CivicFine.',       pill: 's-blue',  at: 0     },
    { label: 'En revisión',    desc: 'Juez cívico validando la evidencia.', pill: 's-amber', at: 15000 },
    { label: 'Unidad enviada', desc: 'Una patrulla va en camino.',          pill: 's-green', at: 35000 },
    { label: 'Multado',        desc: 'Sanción aplicada.',                   pill: 's-red',   at: 60000 }
  ];
  const IDX_MULTADO = PASOS.length - 1;
  const IDX_UNIDAD = PASOS.length - 2;

  const GRUPOS = { curso: [0, 1, 2], resueltos: [IDX_MULTADO] };
  const NOMBRES = { todos: 'Todos', curso: 'En curso', resueltos: 'Resueltos' };
  const MINIATURAS = ['', 'thumb-alt', 'thumb-soft', 'thumb-dark'];

  /* ==========================================================
    Utilidades
     ========================================================== */
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const hora = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit' });
  const diaMes = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short' });
  const mismoDia = (a, b) => a.toDateString() === b.toDateString();

  function cuando(ms) {
    const d = new Date(ms);
    const ayer = new Date(Date.now() - 864e5);
    if (mismoDia(d, new Date())) return `Hoy, ${hora.format(d)}`;
    if (mismoDia(d, ayer)) return `Ayer, ${hora.format(d)}`;
    return `${diaMes.format(d)}, ${hora.format(d)}`;
  }

  function cuandoCorto(ms) {
    const min = Math.floor((Date.now() - ms) / 60000);
    if (min < 1) return 'Hace un momento';
    if (min < 60) return `Hace ${min} min`;
    return cuando(ms);
  }

  // Índice del paso actual según el tiempo transcurrido
  function pasoActual(r, ahora = Date.now()) {
    const t = ahora - r.creado;
    let idx = 0;
    PASOS.forEach((p, i) => { if (t >= p.at) idx = i; });
    return idx;
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  /* ==========================================================
    Estado y almacenamiento
     ========================================================== */
  let reportes = [];
  let filtro = 'todos';
  let orden = 'recientes';

  function cargar() {
    try { reportes = JSON.parse(localStorage.getItem(KEY)) ?? []; }
    catch { reportes = []; }
  }

  function guardar() {
    try { localStorage.setItem(KEY, JSON.stringify(reportes)); return true; }
    catch { return false; }
  }

  /* ==========================================================
    Render
     ========================================================== */
  function tarjeta(r, i) {
    const p = PASOS[r.idx];
    const foot = r.idx === IDX_MULTADO ? 'note-red' : r.idx === IDX_UNIDAD ? 'note-green' : '';
    const mini = r.foto ? 'has-photo' : MINIATURAS[i % MINIATURAS.length];
    return `
      <li class="card report" data-id="${esc(r.id)}">
        <div class="report-top">
          <span class="report-id"># ${esc(r.folio)}</span>
          <span class="status ${p.pill}">${esc(p.label)}</span>
        </div>
        <div class="report-body" data-open="${esc(r.id)}" role="button" tabindex="0">
          <div class="thumb ${mini}">
            <span class="plate">${esc(r.placa)}</span>
          </div>
          <div class="report-info">
            <h3>${esc(r.tipo)}</h3>
            <p class="meta">${cuandoCorto(r.creado)}</p>
            <p class="address">${esc(r.direccion)}</p>
          </div>
        </div>
        <div class="report-foot ${foot}">
          <span>${esc(p.desc)}</span>
          <button class="link" type="button" data-open="${esc(r.id)}">Detalles</button>
        </div>
      </li>`;
  }

  function render() {
    const ahora = Date.now();
    const datos = reportes.map((r) => ({ ...r, idx: pasoActual(r, ahora) }));

    const enCurso = datos.filter((r) => GRUPOS.curso.includes(r.idx));
    const resueltos = datos.filter((r) => GRUPOS.resueltos.includes(r.idx));
    const conteo = { todos: datos.length, curso: enCurso.length, resueltos: resueltos.length };

    // Filtros
    $('#n-todos').textContent = conteo.todos;
    $('#n-curso').textContent = conteo.curso;
    $('#n-resueltos').textContent = conteo.resueltos;
    $('#filtro-actual').textContent = `${NOMBRES[filtro]} (${conteo[filtro]})`;

    // Estadísticas
    const hoy = new Date();
    const delMes = datos.filter((r) => {
      const d = new Date(r.creado);
      return d.getMonth() === hoy.getMonth() && d.getFullYear() === hoy.getFullYear();
    }).length;
    $('#v-enviados').textContent = delMes;
    $('#v-multados').textContent = resueltos.length;
    $('#v-efectividad').textContent = datos.length
      ? `${Math.round((resueltos.length / datos.length) * 100)}% efectividad`
      : 'Sin datos aún';

    // Lista según filtro y orden
    const lista = datos
      .filter((r) => filtro === 'todos' || (GRUPOS[filtro] ?? []).includes(r.idx))
      .sort((a, b) => (orden === 'recientes' ? b.creado - a.creado : a.creado - b.creado));

    $('#vacio').hidden = datos.length > 0;
    $('#controles').hidden = datos.length === 0;
    $('#lista').hidden = datos.length === 0;
    $('#sin-filtro').hidden = !(datos.length > 0 && lista.length === 0);

    const ul = $('#lista');
    ul.innerHTML = lista.map(tarjeta).join('');

    // Fotos (se asignan por JS para no meter datos en atributos HTML)
    lista.forEach((r) => {
      if (!r.foto) return;
      const li = ul.querySelector(`li[data-id="${CSS.escape(r.id)}"] .thumb`);
      if (li) li.style.backgroundImage = `url("${r.foto}")`;
    });
  }

  /* ==========================================================
    Detalle (popover)
     ========================================================== */
  function llenarDetalle(id) {
    const r = reportes.find((x) => x.id === id);
    if (!r) return false;
    const idx = pasoActual(r);

    $('#det-folio').textContent = `# ${r.folio}`;
    $('#det-titulo').textContent = r.tipo;
    $('#det-meta').textContent = `${r.placa} · ${r.direccion} · ${cuando(r.creado)}`;
    $('#det-descripcion').textContent = r.descripcion || 'Sin descripción adicional.';

    const foto = $('#det-foto');
    foto.hidden = !r.foto;
    if (r.foto && foto.src !== r.foto) foto.src = r.foto;

    $('#det-pasos').innerHTML = PASOS.map((p, i) => `
      <li class="${i <= idx ? 'done' : ''} ${i === idx ? 'current' : ''}">
        <strong>${esc(p.label)}</strong>
        <span>${i <= idx ? esc(p.desc) : 'Pendiente'}</span>
      </li>`).join('');

    $('#detalle').dataset.id = id;
    return true;
  }

  function abrirDetalle(id) {
    if (!llenarDetalle(id)) return;
    const d = $('#detalle');
    if (!d.matches(':popover-open')) d.showPopover();
  }

  function refrescarDetalle() {
    const d = $('#detalle');
    if (d.matches(':popover-open') && d.dataset.id) llenarDetalle(d.dataset.id);
  }

  /* ==========================================================
    Formulario de nuevo reporte
     ========================================================== */
  const form = $('#form');
  const inputPlaca = form.querySelector('input[name="placa"]');
  const inputFoto = form.querySelector('input[name="foto"]');
  const preview = $('#foto-preview');

  inputPlaca.addEventListener('input', () => {
    inputPlaca.value = inputPlaca.value.toUpperCase();
  });

  inputFoto.addEventListener('change', () => {
    const f = inputFoto.files[0];
    if (f) {
      preview.src = URL.createObjectURL(f);
      preview.hidden = false;
    } else {
      preview.hidden = true;
      preview.removeAttribute('src');
    }
  });

  function leerFoto(file) {
    return new Promise((resolve, reject) => {
      const lector = new FileReader();
      lector.onload = () => resolve(lector.result);
      lector.onerror = reject;
      lector.readAsDataURL(file);
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;

    const fd = new FormData(form);
    const archivo = fd.get('foto');
    let foto = null;

    if (archivo && archivo.size) {
      if (archivo.size <= MAX_FOTO) foto = await leerFoto(archivo);
      else toast('La foto pesa más de 1.5 MB. El reporte se guardará sin foto.');
    }

    const ahora = Date.now();
    const seq = (Number(localStorage.getItem(FOLIO_KEY)) || 0) + 1;
    localStorage.setItem(FOLIO_KEY, String(seq));

    const nuevo = {
      id: `${ahora}-${seq}`,
      folio: `ZPN-${new Date(ahora).getFullYear()}-${String(seq).padStart(6, '0')}`,
      tipo: String(fd.get('tipo')),
      placa: String(fd.get('placa')).toUpperCase(),
      direccion: String(fd.get('direccion')).trim(),
      descripcion: String(fd.get('descripcion') || '').trim(),
      foto,
      creado: ahora
    };

    reportes.unshift(nuevo);

    // Si el navegador no tiene espacio para la foto, se guarda sin ella
    if (!guardar()) {
      nuevo.foto = null;
      guardar();
      toast('Sin espacio para la foto; el reporte se guardó sin ella.');
    }

    avisarOtrasPestanas();
    form.reset();
    preview.hidden = true;
    preview.removeAttribute('src');
    form.closest('[popover]').hidePopover();
    render();
    toast(`Reporte enviado · ${nuevo.folio}`);
  });

  /* ==========================================================
    Filtros y orden (popover)
     ========================================================== */
  $$('input[name="filtro"]').forEach((input) => {
    input.addEventListener('change', () => {
      filtro = input.value;
      render();
      $('#filtros').hidePopover();
    });
  });

  $$('input[name="orden"]').forEach((input) => {
    input.addEventListener('change', () => {
      orden = input.value;
      render();
    });
  });

  /* ==========================================================
    Abrir detalles desde la lista
     ========================================================== */
  $('#lista').addEventListener('click', (e) => {
    const b = e.target.closest('[data-open]');
    if (b) abrirDetalle(b.dataset.open);
  });

  $('#lista').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('.report-body')) {
      abrirDetalle(e.target.dataset.open);
    }
  });

  /* ==========================================================
    Tiempo real
    - Se actualiza cada segundo: estados y "hace X min".
    - Se sincroniza entre pestañas (BroadcastChannel y storage).
     ========================================================== */
  const canal = 'BroadcastChannel' in window ? new BroadcastChannel('civicfine') : null;

  function avisarOtrasPestanas() {
    canal?.postMessage('cambio');
  }

  function sincronizar() {
    cargar();
    render();
    refrescarDetalle();
  }

  canal?.addEventListener('message', sincronizar);
  window.addEventListener('storage', (e) => { if (e.key === KEY) sincronizar(); });

  function firmaActual(ahora = Date.now()) {
    return reportes
      .map((r) => `${pasoActual(r, ahora)}:${Math.floor((ahora - r.creado) / 60000)}`)
      .join('|');
  }

  let firma = '';
  function latido() {
    const nueva = firmaActual();
    if (nueva !== firma) {
      firma = nueva;
      render();
      refrescarDetalle();
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) latido();
  });

  /* ==========================================================
    Arranque
     ========================================================== */
  cargar();
  render();
  firma = firmaActual();
  setInterval(latido, 1000);
})();
