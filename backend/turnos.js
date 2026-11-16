// ==========================================================================
// CIVICFINE - CONTROL DE TURNOS PARA AUTORIDAD
// Horas en America/Mexico_City
// ==========================================================================
const TURNOS = {
  Matutino:   { inicio: 6,  fin: 14 },
  Vespertino: { inicio: 14, fin: 22 },
  Nocturno:   { inicio: 22, fin: 6  } // cruza la medianoche
};

// Hora actual (0 a 23) en la zona de Ciudad de México
function horaActualMexico(fecha = new Date()) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City',
    hour: 'numeric',
    hourCycle: 'h23'
  }).formatToParts(fecha);
  return Number(partes.find(p => p.type === 'hour').value);
}

// ¿El turno indicado está activo en este momento?
function enTurno(turno, fecha = new Date()) {
  const t = TURNOS[turno];
  if (!t) return false;

  const hora = horaActualMexico(fecha);
  return t.inicio < t.fin
    ? hora >= t.inicio && hora < t.fin
    : hora >= t.inicio || hora < t.fin;
}

// Middleware para rutas de autoridad: revisa el turno en cada petición,
// así un token válido fuera de turno tampoco puede usar el panel.
// Uso: router.get('/ruta', verificarToken, requerirTurnoActivo(pool), handler)
function requerirTurnoActivo(pool) {
  return async (req, res, next) => {
    if (!req.usuario || req.usuario.rol !== 'autoridad') return next();

    try {
      const { rows } = await pool.query(
        `SELECT a.turno
        FROM autoridad a
        JOIN usuario u ON u.usuario_id = a.usuario_id
        WHERE a.usuario_id = $1 AND u.activo = true`,
        [req.usuario.id]
      );

      if (rows.length === 0 || !enTurno(rows[0].turno)) {
        return res.status(403).json({ error: 'Fuera de tu turno. No puedes usar el panel en este momento.' });
      }
      next();
    } catch (err) {
      console.error('[TURNO] error:', err);
      res.status(500).json({ error: 'No se pudo verificar tu turno.' });
    }
  };
}

module.exports = { TURNOS, horaActualMexico, enTurno, requerirTurnoActivo };
