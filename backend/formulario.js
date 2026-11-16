const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const sharp = require('sharp');
const Tesseract = require('tesseract.js');
const { randomUUID } = require('crypto');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { pool } = require('./db');

const SECRET_KEY = process.env.JWT_SECRET;
if (!SECRET_KEY) {
  throw new Error('Falta la variable de entorno JWT_SECRET');
}

// ==========================================================================
// Utilidades de log
// ==========================================================================
function bytesDeDataUrl(dataUrl) {
  const base64 = String(dataUrl || '').replace(/^data:image\/\w+;base64,/, '');
  return Buffer.byteLength(base64, 'base64');
}

function formatearTamano(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

// ==========================================================================
// Autenticación: toma la identidad del token, no del cuerpo de la petición
// ==========================================================================
function verificarToken(req, res, next) {
  const encabezado = req.headers.authorization || '';
  const token = encabezado.startsWith('Bearer ') ? encabezado.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Sesión requerida.' });
  }

  try {
    req.usuario = jwt.verify(token, SECRET_KEY); // { id, telefono, rol }
    next();
  } catch (err) {
    res.status(401).json({ error: 'Sesión inválida o vencida.' });
  }
}

// ==========================================================================
// S3
// ==========================================================================
const BUCKET = process.env.AWS_S3_BUCKET;
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

// Comprime la evidencia: máximo 1280 px, JPEG calidad 75, respeta la rotación del celular
async function comprimirEvidencia(dataUrl) {
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  return sharp(Buffer.from(base64, 'base64'))
    .rotate()
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 75, mozjpeg: true })
    .toBuffer();
}

// Sube el archivo y devuelve la key y el ETag que confirma S3
async function subirEvidencia(buffer, usuarioId) {
  const key = `evidencia/${usuarioId}/${Date.now()}-${randomUUID()}.jpg`;
  const respuesta = await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: 'image/jpeg'
  }));
  return { key, etag: respuesta.ETag };
}

// ==========================================================================
// OCR de placas
// ==========================================================================
const WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-';
const MODOS_PSM = ['7', '6', '11']; // una línea, bloque, texto disperso

// Confusiones típicas: se cuentan como sustituciones para elegir la lectura más limpia
const A_LETRA = { '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '8': 'B', '6': 'G' };
const A_NUMERO = { O: '0', Q: '0', D: '0', I: '1', L: '1', Z: '2', S: '5', B: '8', G: '6' };

let workerPromise = null;

function obtenerWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await Tesseract.createWorker('eng');
      await worker.setParameters({ tessedit_char_whitelist: WHITELIST });
      return worker;
    })().catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

// Genera varias versiones de la imagen para tener más oportunidades de lectura
async function variantesImagen(dataUrl) {
  const buf = Buffer.from(dataUrl.replace(/^data:image\/\w+;base64,/, ''), 'base64');
  const base = sharp(buf).rotate().grayscale().normalize().resize({ width: 1200 });

  return [
    await base.clone().sharpen().png().toBuffer(),
    await base.clone().linear(1.3, -40).png().toBuffer(),
    await base.clone().threshold(120).png().toBuffer()
  ];
}

// Ventana de 7 caracteres. Devuelve la placa y cuántas correcciones necesitó
function evaluarVentana(ventana) {
  const salida = [];
  let sustituciones = 0;

  for (let i = 0; i < 7; i++) {
    const c = ventana[i];
    if (i < 3) {
      if (/[A-Z]/.test(c)) salida.push(c);
      else if (A_LETRA[c]) { salida.push(A_LETRA[c]); sustituciones++; }
      else return null;
    } else if (i <= 5) {
      if (/[0-9]/.test(c)) salida.push(c);
      else if (A_NUMERO[c]) { salida.push(A_NUMERO[c]); sustituciones++; }
      else return null;
    } else {
      if (/[A-Z0-9]/.test(c)) salida.push(c);
      else return null;
    }
  }

  const s = salida.join('');
  const placa = /[A-Z]/.test(s[6])
    ? `${s.slice(0, 3)}-${s.slice(3, 6)}-${s[6]}`
    : `${s.slice(0, 3)}-${s.slice(3, 7)}`;

  return { placa, sustituciones };
}

// Busca la mejor placa en el texto: la que requiera menos correcciones
function extraerPlaca(texto) {
  const limpio = String(texto || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  let mejor = null;

  for (let i = 0; i + 7 <= limpio.length; i++) {
    const r = evaluarVentana(limpio.slice(i, i + 7));
    if (!r) continue;
    if (!mejor || r.sustituciones < mejor.sustituciones) mejor = r;
  }


  // Más de 1 corrección casi siempre es ruido, no una placa
  return mejor && mejor.sustituciones <= 1 ? mejor.placa : null;
}

// Prueba cada variante con cada modo y se queda con la lectura más confiable
async function buscarPlaca(worker, variantes) {
  let mejor = null;
  const textos = [];

  for (const img of variantes) {
    for (const psm of MODOS_PSM) {
      await worker.setParameters({ tessedit_pageseg_mode: psm });
      const { data } = await worker.recognize(img);
      const texto = String(data.text || '').trim();
      textos.push(texto);

      const UMBRAL_CONFIANZA_OCR = 50; // de 0 a 100

      const placa = data.confidence >= UMBRAL_CONFIANZA_OCR ? extraerPlaca(texto) : null;
        if (placa && (!mejor || data.confidence > mejor.confianza)) {
        mejor = { placa, confianza: data.confidence, texto };
      }
    }
  }

  return { mejor, textos };
}

// ==========================================================================
// 1. OCR
// ==========================================================================
router.post('/ocr', async (req, res) => {
  try {
    const { imagen } = req.body;
    if (!imagen) {
      return res.status(400).json({ error: 'No se envió ninguna imagen.' });
    }

    const variantes = await variantesImagen(imagen);
    const worker = await obtenerWorker();
    const { mejor, textos } = await buscarPlaca(worker, variantes);

    console.log('[OCR] textos:', JSON.stringify(textos));

    if (!mejor) {
      console.log('[OCR] sin placa válida');
      // 200 con placa null: el frontend pide captura manual sin tratarlo como error
      return res.json({ exito: false, placa: null, confianza: 0, textos });
    }

    const confianza = Math.round(mejor.confianza) / 100;
    console.log(`[OCR] placa: ${mejor.placa} | confianza: ${confianza}`);

    res.json({ exito: true, placa: mejor.placa, confianza, texto_crudo: mejor.texto });
  } catch (err) {
    console.error('[OCR] error:', err);
    res.status(500).json({ error: 'Error procesando OCR' });
  }
});

// ==========================================================================
// 2. Crear reporte: sube la foto a S3 y guarda reporte + evidencia en una transacción
// ==========================================================================
router.post('/crear', verificarToken, async (req, res) => {
  const cliente = await pool.connect();
  let s3Key = null;

  try {
    const {
      infraccion_id, placa, direccion, latitud, longitud,
      descripcion, foto_base64, municipio_id
    } = req.body;

    const ciudadanoId = req.usuario.id;

    if (!ciudadanoId || !placa || !foto_base64) {
      return res.status(400).json({ error: 'Faltan datos obligatorios para registrar el reporte.' });
    }

    const comprimida = await comprimirEvidencia(foto_base64);
    const subida = await subirEvidencia(comprimida, ciudadanoId);
    s3Key = subida.key;
    console.log(`[S3] subida OK | key: ${s3Key}`);

    await cliente.query('BEGIN');

    const reporteRes = await cliente.query(
      `INSERT INTO reporte
        (ciudadano_id, municipio_id, tipo_infraccion_id, fecha_hora, latitud, longitud,
        direccion, descripcion, placa_detectada, estado)
        VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7, $8, 'pendiente')
        RETURNING reporte_id`,
      [
        ciudadanoId,
        municipio_id || 1,
        infraccion_id || 1,
        latitud ?? null,
        longitud ?? null,
        direccion || 'Zapopan, Jal.',
        descripcion || null,
        placa
      ]
    );

    const reporteId = reporteRes.rows[0].reporte_id;

    await cliente.query(
      `INSERT INTO evidencia (reporte_id, tipo, url_archivo)
      VALUES ($1, 'foto', $2)`,
      [reporteId, s3Key]
    );

    await cliente.query('COMMIT');
    console.log(`[REPORTE] guardado | reporte_id: ${reporteId} | usuario: ${ciudadanoId}`);

    res.status(201).json({
      exito: true,
      mensaje: 'Reporte registrado exitosamente.',
      reporte_id: reporteId
    });
  } catch (err) {
    await cliente.query('ROLLBACK').catch(() => {});

    if (s3Key) {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: s3Key })).catch(() => {});
    }

    console.error('[REPORTE] error al guardar:', err);
    res.status(500).json({ error: 'No se pudo registrar el reporte.' });
  } finally {
    cliente.release();
  }
});

module.exports = router;
