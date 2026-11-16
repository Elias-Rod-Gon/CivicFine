// ==========================================================================
// CIVICFINE - PERFIL DEL CIUDADANO
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
  window.location.replace('IniciaSesion.html');
}

document.addEventListener('DOMContentLoaded', () => {
  if (!sesion) return;

  const { token } = sesion;

  const el = {
    formPerfil: document.getElementById('form-perfil'),
    nombre: document.getElementById('perfil-nombre'),
    correo: document.getElementById('perfil-correo'),
    municipio: document.getElementById('perfil-municipio'),
    telefono: document.getElementById('perfil-telefono'),
    btnGuardar: document.getElementById('btn-guardar-perfil'),
    msgPerfil: document.getElementById('msg-perfil'),
    formContrasena: document.getElementById('form-contrasena'),
    passActual: document.getElementById('pass-actual'),
    passNueva: document.getElementById('pass-nueva'),
    passConfirmar: document.getElementById('pass-confirmar'),
    msgContrasena: document.getElementById('msg-contrasena'),
    btnDesactivar: document.getElementById('btn-desactivar'),
  };

  const cabeceras = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  function mostrarMensaje(elMsg, texto, esError) {
    elMsg.textContent = texto;
    elMsg.className = `mensaje ${esError ? 'error' : 'ok'}`;
    elMsg.hidden = false;
  }

  function cerrarSesionYSalir() {
    localStorage.clear();
    sessionStorage.clear();
    window.location.replace('IniciaSesion.html');
  }

  async function cargarPerfil() {
    try {
      const res = await fetch('/api/perfil', { headers: cabeceras });
      if (res.status === 401) return cerrarSesionYSalir();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const { usuario } = await res.json();
      el.nombre.value = usuario.nombre || '';
      el.correo.value = usuario.correo || '';
      el.telefono.value = usuario.telefono || '';
      await cargarMunicipios(usuario.municipio_id);
    } catch (err) {
      console.warn('No se pudo cargar el perfil:', err.message);
      mostrarMensaje(el.msgPerfil, 'No se pudo cargar tu perfil.', true);
    }
  }

  async function cargarMunicipios(municipioActual) {
    try {
      const res = await fetch('/api/perfil/municipios', { headers: cabeceras });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { municipios } = await res.json();

      el.municipio.innerHTML = '<option value="">-- Selecciona tu municipio --</option>';
      municipios.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.nombre;
        if (String(m.id) === String(municipioActual)) opt.selected = true;
        el.municipio.appendChild(opt);
      });
    } catch (err) {
      console.warn('No se pudieron cargar los municipios:', err.message);
    }
  }

  el.formPerfil.addEventListener('submit', async (e) => {
    e.preventDefault();

    const nombre = el.nombre.value.trim();
    const correo = el.correo.value.trim();
    if (!nombre || !correo) {
      return mostrarMensaje(el.msgPerfil, 'Nombre y correo son obligatorios.', true);
    }

    el.btnGuardar.disabled = true;
    try {
      const res = await fetch('/api/perfil', {
        method: 'PUT',
        headers: cabeceras,
        body: JSON.stringify({
          nombre,
          correo,
          municipio_id: el.municipio.value || null
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo guardar.');

      // Actualiza el nombre guardado localmente para el dashboard
      const raw = localStorage.getItem('civicfine_user') || sessionStorage.getItem('civicfine_user');
      const usuarioLocal = raw ? JSON.parse(raw) : {};
      usuarioLocal.nombre = data.usuario.nombre;
      usuarioLocal.correo = data.usuario.correo;
      const almacen = localStorage.getItem('civicfine_user') ? localStorage : sessionStorage;
      almacen.setItem('civicfine_user', JSON.stringify(usuarioLocal));

      mostrarMensaje(el.msgPerfil, 'Perfil actualizado.', false);
    } catch (err) {
      mostrarMensaje(el.msgPerfil, err.message, true);
    } finally {
      el.btnGuardar.disabled = false;
    }
  });

  el.formContrasena.addEventListener('submit', async (e) => {
    e.preventDefault();

    const actual = el.passActual.value;
    const nueva = el.passNueva.value;
    const confirmar = el.passConfirmar.value;

    if (nueva.length < 8) {
      return mostrarMensaje(el.msgContrasena, 'La nueva contraseña debe tener al menos 8 caracteres.', true);
    }
    if (nueva !== confirmar) {
      return mostrarMensaje(el.msgContrasena, 'Las contraseñas no coinciden.', true);
    }

    try {
      const res = await fetch('/api/perfil/contrasena', {
        method: 'PUT',
        headers: cabeceras,
        body: JSON.stringify({ actual, nueva })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo cambiar la contraseña.');

      el.formContrasena.reset();
      mostrarMensaje(el.msgContrasena, 'Contraseña actualizada.', false);
    } catch (err) {
      mostrarMensaje(el.msgContrasena, err.message, true);
    }
  });

  el.btnDesactivar.addEventListener('click', async () => {
    const ok = confirm('¿Seguro que quieres desactivar tu cuenta? No podrás volver a iniciar sesión.');
    if (!ok) return;

    try {
      const res = await fetch('/api/perfil', { method: 'DELETE', headers: cabeceras });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      cerrarSesionYSalir();
    } catch (err) {
      alert('No se pudo desactivar la cuenta. Intenta de nuevo.');
    }
  });

  cargarPerfil();
});
