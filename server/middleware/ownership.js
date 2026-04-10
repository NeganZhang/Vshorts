const db = require('../db');

/**
 * Middleware: verify the authenticated user owns the project in req.params.projectId.
 * Must be used AFTER authRequired.
 * Attaches req.project if valid.
 */
function projectOwner(req, res, next) {
  const { projectId } = req.params;
  if (!projectId) {
    return res.status(400).json({ error: 'Project ID is required' });
  }

  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(projectId, req.user.id);

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  req.project = project;
  next();
}

module.exports = { projectOwner };
