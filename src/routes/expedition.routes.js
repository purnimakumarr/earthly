const express = require('express');
const expeditions = require('../controllers/expedition.controller');
const { requireAuth, allowRoles } = require('../middleware/auth');
const upload = require('../middleware/upload');
const reviewRouter = require('./review.routes');

const router = express.Router();
const staff = [requireAuth, allowRoles('admin', 'lead')];

router.use('/:expeditionId/reviews', reviewRouter);

// Named routes come before /:id so they are not read as ids.
router.get('/featured', expeditions.featuredPreset, expeditions.listExpeditions);
router.get('/stats', expeditions.getStats);
router.get('/nearby', expeditions.getNearby);
router.get('/distances', expeditions.getDistances);
router.get('/slug/:slug', expeditions.getExpeditionBySlug);
router.get(
  '/schedule/:year',
  requireAuth,
  allowRoles('admin', 'lead', 'guide'),
  expeditions.getSchedule,
);

router
  .route('/')
  .get(expeditions.listExpeditions)
  .post(staff, expeditions.createExpedition);

router
  .route('/:id')
  .get(expeditions.getExpedition)
  .patch(staff, upload.expeditionImages, expeditions.updateExpedition)
  .delete(staff, expeditions.deleteExpedition);

module.exports = router;
