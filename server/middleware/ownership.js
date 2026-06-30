const data = require('../data');

/**
 * Middleware: verify the authenticated user owns the project in req.params.projectId.
 * Must be used AFTER authRequired. Attaches req.project if valid.
 */
async function projectOwner(req, res, next) {
  const { projectId } = req.params;
  if (!projectId) return res.status(400).json({ error: 'Project ID is required' });

  try {
    const project = await data.projects.getOwned(projectId, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    req.project = project;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { projectOwner };
