const User = require('../models/user.model');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const crud = require('./crudFactory');

exports.getMe = (req, res) => {
  res.status(200).json({ status: 'success', data: req.user });
};

exports.updateMe = asyncHandler(async (req, res) => {
  if (req.body.password || req.body.passwordConfirm) {
    throw new ApiError(400, 'Use PATCH /users/me/password to change a password.');
  }

  // `photo` is set by the upload middleware, never taken from the client.
  const changes = crud.pick(req.body, ['name', 'email', 'photo']);

  const user = await User.findByIdAndUpdate(req.user.id, changes, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({ status: 'success', data: user });
});

// Soft delete: the account is deactivated and disappears from all queries.
exports.deleteMe = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(req.user.id, { active: false });
  res.status(204).send();
});

// Admin
exports.listUsers = crud.list(User);
exports.getUser = crud.getOne(User);
exports.updateUser = crud.update(User, { fields: ['name', 'email', 'role'] });
exports.deleteUser = crud.remove(User);
