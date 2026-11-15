const express = require('express');
const users = require('../controllers/user.controller');
const { changePassword } = require('../controllers/auth.controller');
const { requireAuth, allowRoles } = require('../middleware/auth');
const upload = require('../middleware/upload');

const router = express.Router();

router.use(requireAuth);

router
  .route('/me')
  .get(users.getMe)
  .patch(upload.userPhoto, users.updateMe)
  .delete(users.deleteMe);
router.patch('/me/password', changePassword);

router.use(allowRoles('admin'));

router.get('/', users.listUsers);
router.route('/:id').get(users.getUser).patch(users.updateUser).delete(users.deleteUser);

module.exports = router;
