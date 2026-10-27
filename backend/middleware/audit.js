const db = require('../db');

function logAudit(actorId, actorName, action, entityType, entityId, details, ip) {
  try {
    db.prepare(
      'INSERT INTO audit_log (actor_id, actor_name, action, entity_type, entity_id, details, ip) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(actorId || null, actorName || null, action, entityType || null, entityId || null,
      details ? JSON.stringify(details) : null, ip || null);
  } catch (e) {
    console.error('[audit] log error:', e.message);
  }
}

module.exports = { logAudit };
