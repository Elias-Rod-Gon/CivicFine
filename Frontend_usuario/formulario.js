// Guardian de sesion
(function verificarSesion() {
  const token = localStorage.getItem('civicfine_token') || sessionStorage.getItem('civicfine_token');
  const user = localStorage.getItem('civicfine_user') || sessionStorage.getItem('civicfine_user');

  if (!token || !user) {
    window.location.replace('IniciaSesion.html');
  }
})();

document.addEventListener('DOMContentLoaded', () => {
  // Elementos DOM
  const step1 = document.getElementById('step-1');
  const step2 = document.getElementById('step-2');
  const step3 = document.getElementById('step-3');

  const progressBar = document.getElementById('progress-bar');
  const stepIndicator = document.getElementById('step-indicator');

  // Camara Stream
  const videoStream = document.getElementById('video-stream');
  const canvasCapture = document.getElementById('canvas-capture');
  const imgCaptured = document.getElementById('img-captured');
  const cameraOverlay = document.getElementById('camera-overlay');
  const btnCapturePhoto = document.getElementById('btn-capture-photo');
  const btnRetakePhoto = document.getElementById('btn-retake-photo');

  // OCR y GPS
  const inputPlaca = document.getElementById('input-placa');
  const ocrBadge = document.getElementById('ocr-badge');
  const inputDireccion = document.getElementById('input-direccion');
  const gpsBadge = document.getElementById('gps-badge');
  const selectInfraccion = document.getElementById('select-infraccion');
  const btnStep1Next = document.getElementById('btn-step1-next');

  // Paso 2
  const inputMarca = document.getElementById('input-marca');
  const inputModelo = document.getElementById('input-modelo');
  const inputColor = document.getElementById('input-color');
  const txtObservaciones = document.getElementById('txt-observaciones');
  const btnStep2Prev = document.getElementById('btn-step2-prev');
  const btnStep2Next = document.getElementById('btn-step2-next');
  const selectMarca = document.getElementById('select-marca');

selectMarca.addEventListener('change', () => {
  const esOtra = selectMarca.value === 'Otra';
  inputMarca.style.display = esOtra ? 'block' : 'none';
  inputMarca.value = esOtra ? '' : selectMarca.value;
});

  // Paso 3
  const summaryImg = document.getElementById('summary-img');
  const summaryPlaca = document.getElementById('summary-placa');
  const summaryInfraccion = document.getElementById('summary-infraccion');
  const summaryDireccion = document.getElementById('summary-direccion');
  const summaryVehiculo = document.getElementById('summary-vehiculo');
  const chkProtesta = document.getElementById('chk-protesta');
  const btnStep3Prev = document.getElementById('btn-step3-prev');
  const formDenuncia = document.getElementById('form-denuncia');
  const btnEnviarReporte = document.getElementById('btn-enviar-reporte');

  // Variables de Estado
  let streamMedia = null;
  let fotoBase64 = null;
  let latitud = null;
  let longitud = null;

  // 1. Iniciar Camara en Vivo al cargar (Preferencia trasera / environment)
  async function iniciarCamara() {
    try {
      streamMedia = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      videoStream.srcObject = streamMedia;
    } catch (err) {
      try {
        streamMedia = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        videoStream.srcObject = streamMedia;
      } catch (e) {
        alert('No se pudo acceder a la camara en tiempo real.');
      }
    }
  }

  iniciarCamara();

  // 2. Captura Sincrona de Foto + GPS al presionar el boton
  btnCapturePhoto.addEventListener('click', () => {
    if (!videoStream.srcObject) return;

    // Congelar cuadro en canvas
    const width = videoStream.videoWidth || 640;
    const height = videoStream.videoHeight || 480;
    canvasCapture.width = width;
    canvasCapture.height = height;

    const ctx = canvasCapture.getContext('2d');
    ctx.drawImage(videoStream, 0, 0, width, height);

    fotoBase64 = canvasCapture.toDataURL('image/jpeg', 0.85);
    imgCaptured.src = fotoBase64;

    // Visibilidad del visor
    videoStream.style.display = 'none';
    cameraOverlay.style.display = 'none';
    imgCaptured.style.display = 'block';

    btnCapturePhoto.style.display = 'none';
    btnRetakePhoto.style.display = 'flex';

    // Disparar GPS exacto del disparo y OCR
    obtenerUbicacionMomento();
    procesarOCR(fotoBase64);
  });

  // Re-retomar captura
  btnRetakePhoto.addEventListener('click', () => {
    fotoBase64 = null;
    imgCaptured.style.display = 'none';
    videoStream.style.display = 'block';
    cameraOverlay.style.display = 'flex';

    btnCapturePhoto.style.display = 'flex';
    btnRetakePhoto.style.display = 'none';

    ocrBadge.textContent = 'Esperando captura';
    ocrBadge.className = 'badge-status-ocr';
    inputPlaca.value = '';
    validarPaso1();
  });

  // 3. Obtener GPS Exacto
  function obtenerUbicacionMomento() {
    gpsBadge.textContent = 'Obteniendo GPS...';
    gpsBadge.className = 'badge-status-gps';

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          latitud = pos.coords.latitude;
          longitud = pos.coords.longitude;
          gpsBadge.textContent = 'GPS Capturado';
          gpsBadge.classList.add('active');
          inputDireccion.value = `Lat: ${latitud.toFixed(4)}, Lon: ${longitud.toFixed(4)} (Zapopan)`;
          validarPaso1();
        },
        () => {
          gpsBadge.textContent = 'GPS Manual';
          inputDireccion.value = 'Zapopan Centro, Jalisco';
          validarPaso1();
        },
        { enableHighAccuracy: true, timeout: 6000 }
      );
    } else {
      inputDireccion.value = 'Zapopan Centro, Jalisco';
      validarPaso1();
    }
  }

  // 4. Procesar OCR
  async function procesarOCR(b64) {
    ocrBadge.textContent = 'Analizando...';
    ocrBadge.className = 'badge-status-ocr';

    try {
      const res = await fetch('/api/reportes/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagen: b64 })
      });
      const data = await res.json();

      if (res.ok && data.placa) {
        inputPlaca.value = data.placa;
        ocrBadge.textContent = 'Reconocida';
        ocrBadge.classList.add('success');
      } else {
        ocrBadge.textContent = 'Ingreso manual';
      }
    } catch (e) {
      ocrBadge.textContent = 'Ingreso manual';
    }
    validarPaso1();
  }

  function validarPaso1() {
    const placaOk = inputPlaca.value.trim().length >= 3;
    const dirOk = inputDireccion.value.trim().length > 0;
    const infOk = selectInfraccion.value !== '';
    const fotoOk = fotoBase64 !== null;

    btnStep1Next.disabled = !(placaOk && dirOk && infOk && fotoOk);
  }

  inputPlaca.addEventListener('input', validarPaso1);
  selectInfraccion.addEventListener('change', validarPaso1);

  // Navegación entre Pasos
  btnStep1Next.addEventListener('click', () => {
    step1.style.display = 'none';
    step2.style.display = 'flex';
    progressBar.style.width = '66.66%';
    stepIndicator.textContent = '2 / 3';
  });

  btnStep2Prev.addEventListener('click', () => {
    step2.style.display = 'none';
    step1.style.display = 'flex';
    progressBar.style.width = '33.33%';
    stepIndicator.textContent = '1 / 3';
  });

  btnStep2Next.addEventListener('click', () => {
    summaryImg.src = fotoBase64;
    summaryPlaca.textContent = inputPlaca.value.toUpperCase();
    summaryInfraccion.textContent = selectInfraccion.options[selectInfraccion.selectedIndex].text;
    summaryDireccion.textContent = inputDireccion.value;

    const marca = inputMarca.value.trim() || 'No esp.';
    const modelo = inputModelo.value.trim() || 'No esp.';
    const color = inputColor.value.trim() || 'No esp.';
    summaryVehiculo.textContent = `${marca} ${modelo} (${color})`;

    step2.style.display = 'none';
    step3.style.display = 'flex';
    progressBar.style.width = '100%';
    stepIndicator.textContent = '3 / 3';
  });

  btnStep3Prev.addEventListener('click', () => {
    step3.style.display = 'none';
    step2.style.display = 'flex';
    progressBar.style.width = '66.66%';
    stepIndicator.textContent = '2 / 3';
  });

  // Envío Final
  formDenuncia.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!chkProtesta.checked) {
      alert('Debe declarar la autenticidad de la evidencia para continuar.');
      return;
    }

    const token = localStorage.getItem('civicfine_token') || sessionStorage.getItem('civicfine_token');
    const userRaw = localStorage.getItem('civicfine_user') || sessionStorage.getItem('civicfine_user');
    const usuario = JSON.parse(userRaw);

    btnEnviarReporte.disabled = true;
    btnEnviarReporte.textContent = 'Enviando Denuncia...';

    const payload = {
      usuario_id: usuario.id || usuario.id_usuario,
      infraccion_id: selectInfraccion.value,
      placa: inputPlaca.value.trim().toUpperCase(),
      direccion: inputDireccion.value.trim(),
      latitud: latitud,
      longitud: longitud,
      marca: inputMarca.value.trim(),
      modelo: inputModelo.value.trim(),
      color: inputColor.value.trim(),
      observaciones: txtObservaciones.value.trim(),
      foto_base64: fotoBase64
    };

    try {
      const res = await fetch('/api/reportes/crear', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (res.ok) {
        alert('Reporte registrado exitosamente.');

        if (streamMedia) {
          streamMedia.getTracks().forEach(track => track.stop());
        }

        window.location.href = 'main_screen_user.html';
      } else {
        alert(`Error al registrar: ${data.error || 'Intenta de nuevo'}`);
        btnEnviarReporte.disabled = false;
        btnEnviarReporte.textContent = 'Emitir Denuncia Oficial';
      }
    } catch (err) {
      alert('Error de conexion al enviar el reporte.');
      btnEnviarReporte.disabled = false;
      btnEnviarReporte.textContent = 'Emitir Denuncia Oficial';
    }
  });
});
