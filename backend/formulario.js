const pasos = document.querySelectorAll('.paso');
const indicadores = document.querySelectorAll('#stepper li');
const botonSiguiente = document.getElementById('siguiente');
const botonAnterior = document.getElementById('anterior');
const botonTomar = document.getElementById('tomar');
const video = document.getElementById('video');
const canvas = document.getElementById('lienzo');

let pasoActual = 0;
let fotoTomada = false;

navigator.mediaDevices.getUserMedia({ video: true })
  .then(stream => {
    video.srcObject = stream;
  })
  .catch(error => {
    alert('No se pudo acceder a la cámara: ' + error.message);
  });

botonTomar.addEventListener('click', () => {
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  canvas.hidden = false;
  fotoTomada = true;
});

function mostrarPaso(indice) {
  pasos.forEach((paso, i) => {
    paso.hidden = i !== indice;
  });

  indicadores.forEach((li, i) => {
    li.classList.toggle('activo', i <= indice);
  });

  botonAnterior.hidden = indice === 0;
  botonSiguiente.hidden = indice === pasos.length - 1;
}

botonSiguiente.addEventListener('click', () => {
  const pasoVisible = pasos[pasoActual];
  const campos = pasoVisible.querySelectorAll('input');
  const valido = [...campos].every(campo => campo.value.trim() !== '');

  if (pasoActual === 0 && !fotoTomada) {
    alert('Toma la foto antes de continuar.');
    return;
  }

  if (!valido) {
    alert('Completa todos los campos antes de continuar.');
    return;
  }

  if (pasoActual < pasos.length - 1) {
    pasoActual++;
    mostrarPaso(pasoActual);
  }
});

botonAnterior.addEventListener('click', () => {
  if (pasoActual > 0) {
    pasoActual--;
    mostrarPaso(pasoActual);
  }
});

mostrarPaso(pasoActual);

