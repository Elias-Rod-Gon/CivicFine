document.addEventListener('DOMContentLoaded', () => {
  const formLogin = document.getElementById('form-login');
  const formRegistro = document.getElementById('form-registro');

  const loginTelefono = document.getElementById('login-telefono');
  const loginContrasena = document.getElementById('login-contrasena');
  const btnLoginSubmit = document.getElementById('btn-login-submit');

  const regNombre = document.getElementById('reg-nombre');
  const regApellidos = document.getElementById('reg-apellidos');
  const regCorreo = document.getElementById('reg-correo');
  const regTelefono = document.getElementById('reg-telefono');
  const regContrasena = document.getElementById('reg-contrasena');
  const hintTelefonoCheck = document.getElementById('hint-telefono-check');
  const btnRegisterSubmit = document.getElementById('btn-register-submit');

  // Formatear números a 10 dígitos
  [loginTelefono, regTelefono].forEach(input => {
    if (input) {
      input.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '');
      });
    }
  });

  // 1. Verificación asíncrona de teléfono
  if (regTelefono && hintTelefonoCheck) {
    regTelefono.addEventListener('input', async () => {
      const telefono = regTelefono.value.trim();
      if (telefono.length !== 10) {
        hintTelefonoCheck.textContent = 'Ingresa 10 dígitos.';
        hintTelefonoCheck.className = 'field-hint';
        if (btnRegisterSubmit) btnRegisterSubmit.disabled = false;
        return;
      }

      hintTelefonoCheck.textContent = 'Verificando número...';
      try {
        const res = await fetch(`/api/auth/verificar-telefono/${telefono}`);
        const data = await res.json();
        if (res.ok && data.existe) {
          hintTelefonoCheck.textContent = 'Este número ya está registrado.';
          hintTelefonoCheck.className = 'field-hint error';
          if (btnRegisterSubmit) btnRegisterSubmit.disabled = true;
        } else {
          hintTelefonoCheck.textContent = 'Número disponible.';
          hintTelefonoCheck.className = 'field-hint success';
          if (btnRegisterSubmit) btnRegisterSubmit.disabled = false;
        }
      } catch (e) {
        hintTelefonoCheck.textContent = 'Error al verificar número.';
      }
    });
  }

  // 2. Procesar Login
  if (formLogin) {
    formLogin.addEventListener('submit', async (e) => {
      e.preventDefault();

      const telefono = loginTelefono.value.trim();
      const contrasena = loginContrasena.value.trim();

      if (telefono.length !== 10 || !contrasena) {
        alert('Por favor completa todos los campos.');
        return;
      }

      btnLoginSubmit.disabled = true;
      btnLoginSubmit.textContent = 'Autenticando...';

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ telefono, contrasena })
        });

        const data = await res.json();

        if (res.ok && data.token && data.usuario) {
          // Guardado estricto en localStorage
          localStorage.clear();
          localStorage.setItem('civicfine_token', String(data.token));
          localStorage.setItem('civicfine_user', JSON.stringify(data.usuario));

          // Pequeña pausa para asegurar la persistencia en memoria del navegador antes de redirigir
          setTimeout(() => {
            window.location.replace(
            ['admin', 'autoridad'].includes(data.usuario.rol)
            ? '/autoridad/panel_autoridad.html'
            : 'main_screen_user.html'
);
          }, 100);
        } else {
          alert(`Error: ${data.error || 'Credenciales inválidas'}`);
          btnLoginSubmit.disabled = false;
          btnLoginSubmit.textContent = 'Iniciar Sesión';
        }
      } catch (err) {
        console.error(err);
        alert('Error al conectar con el servidor.');
        btnLoginSubmit.disabled = false;
        btnLoginSubmit.textContent = 'Iniciar Sesión';
      }
    });
  }

  // 3. Procesar Registro
  if (formRegistro) {
    formRegistro.addEventListener('submit', async (e) => {
      e.preventDefault();

      const nombreCompleto = `${regNombre.value.trim()} ${regApellidos.value.trim()}`.trim();
      const correo = regCorreo.value.trim();
      const telefono = regTelefono.value.trim();
      const contrasena = regContrasena.value.trim();

      if (!regNombre.value || !regApellidos.value || !correo || telefono.length !== 10 || contrasena.length < 6) {
        alert('Completa los campos correctamente.');
        return;
      }

      btnRegisterSubmit.disabled = true;
      btnRegisterSubmit.textContent = 'Creando cuenta...';

      try {
        const res = await fetch('/api/auth/registro', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nombre: nombreCompleto,
            correo: correo,
            telefono: telefono,
            contrasena: contrasena,
            municipio_id: 1
          })
        });

        const data = await res.json();

        if (res.ok && data.token && data.usuario) {
          localStorage.clear();
          localStorage.setItem('civicfine_token', String(data.token));
          localStorage.setItem('civicfine_user', JSON.stringify(data.usuario));

          setTimeout(() => {
            window.location.replace('main_screen_user.html');
          }, 100);
        } else {
          alert(`Error: ${data.error || 'No se pudo crear la cuenta'}`);
          btnRegisterSubmit.disabled = false;
          btnRegisterSubmit.textContent = 'Registrarme e Iniciar';
        }
      } catch (err) {
        console.error(err);
        alert('Error al conectar con el servidor.');
        btnRegisterSubmit.disabled = false;
        btnRegisterSubmit.textContent = 'Registrarme e Iniciar';
      }
    });
  }
});
