const User = require('../models/user.model');
const Expedition = require('../models/expedition.model');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const crud = require('./crudFactory');
const { sendVerification } = require('./auth.controller');
const RefreshToken = require('../models/refreshToken.model');
const Booking = require('../models/booking.model');
const mailer = require('../utils/mailer');
const logger = require('../config/logger');
const upload = require('../middleware/upload');

exports.getMe = (req, res) => {
  res.status(200).json({ status: 'success', data: req.user });
};

exports.updateMe = asyncHandler(async (req, res) => {
  if (req.body.password || req.body.passwordConfirm) {
    throw new ApiError(400, 'Use PATCH /users/me/password to change a password.');
  }

  // `photo` is set by the upload middleware, never taken from the client.
  const changes = crud.pick(req.body, ['name', 'email', 'photo']);

  // The email address is how the account is recovered, so moving it takes
  // more than a live session: the current password is asked for again.
  const emailChanging =
    changes.email !== undefined &&
    String(changes.email).trim().toLowerCase() !== req.user.email;

  if (emailChanging) {
    const account = await User.findById(req.user.id).select('+password');
    if (
      typeof req.body.passwordCurrent !== 'string' ||
      !(await account.passwordMatches(req.body.passwordCurrent))
    ) {
      // 403, not 401: the session is fine, so the client must not try to
      // renew it and send the request again.
      res.locals.wrongPassword = true;
      throw new ApiError(
        403,
        'Enter your current password to change your email address.',
      );
    }
  }

  const user = await User.findByIdAndUpdate(req.user.id, changes, {
    new: true,
    runValidators: true,
  });

  // A replaced profile photo is no longer referenced anywhere.
  if (changes.photo && changes.photo !== req.user.photo) {
    await upload.discard([req.user.photo]);
  }

  // A new address has to be confirmed again. Any reset link in flight was
  // sent to the old address, and using one marks the email as confirmed, so
  // it is withdrawn here.
  if (user.email !== req.user.email) {
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await sendVerification(user, req);
    // Tell the old address too. A mail outage must not undo the change.
    await mailer
      .sendEmailChanged(user, req.user.email)
      .catch((err) => logger.warn({ err }, 'email change notice failed'));
  }

  res.status(200).json({ status: 'success', data: user });
});

// Someone has to be able to reach the Manage area: the last admin cannot be
// demoted, deleted or deactivated, by themselves or by anyone else.
const keepAnAdmin = async (user) => {
  if (user.active === false) return;
  if (user.role === 'admin' && (await User.otherAdmins(user._id)) === 0) {
    throw new ApiError(
      409,
      'This is the only admin account. Make someone else an admin first.',
    );
  }
};

// Soft delete: the account is deactivated and disappears from all queries.
exports.deleteMe = asyncHandler(async (req, res) => {
  await keepAnAdmin(req.user);
  await User.findByIdAndUpdate(req.user.id, { active: false });
  await RefreshToken.revokeAllFor(req.user.id);
  res.status(204).send();
});

// Favourites are a list of expedition ids on the user document.
exports.getMyFavourites = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).populate({
    path: 'favourites',
    select:
      'name slug region duration maxGroupSize difficulty price summary coverImage ratingsAverage ratingsQuantity departures',
  });

  res.status(200).json({
    status: 'success',
    results: user.favourites.length,
    data: user.favourites,
  });
});

const setFavourite = (operator) =>
  asyncHandler(async (req, res) => {
    const { expeditionId } = req.params;

    if (operator === '$addToSet' && !(await Expedition.exists({ _id: expeditionId }))) {
      throw new ApiError(404, 'No expedition found with that id.');
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { [operator]: { favourites: expeditionId } },
      { new: true },
    );

    res.status(200).json({ status: 'success', data: user.favourites });
  });

exports.addFavourite = setFavourite('$addToSet');
exports.removeFavourite = setFavourite('$pull');

// Admin

// Admins also see accounts that deactivated themselves, marked `active: false`.
const ALL_ACCOUNTS = { includeInactive: true };
const withInactive = (query) => query.setOptions(ALL_ACCOUNTS).select('+active');

exports.listUsers = crud.list(User, { prepare: withInactive });
exports.getUser = asyncHandler(async (req, res) => {
  res.status(200).json({ status: 'success', data: await findUser(req.params.id) });
});

const findUser = async (id) => {
  const user = await withInactive(User.findById(id));
  if (!user) throw new ApiError(404, 'No user found with that id.');
  return user;
};

exports.updateUser = asyncHandler(async (req, res) => {
  // `active` lets an admin deactivate an account or bring one back.
  const changes = crud.pick(req.body, ['name', 'email', 'role', 'active']);
  const user = await findUser(req.params.id);

  // Compared with `=== false` below, so a string must not slip through.
  if (changes.active !== undefined && typeof changes.active !== 'boolean') {
    throw new ApiError(400, 'active must be true or false.');
  }

  const stepsDown = changes.role !== undefined && changes.role !== 'admin';
  if (stepsDown || changes.active === false) await keepAnAdmin(user);

  const updated = await withInactive(
    User.findByIdAndUpdate(user._id, changes, { new: true, runValidators: true }),
  );
  if (changes.active === false) await RefreshToken.revokeAllFor(user._id);

  res.status(200).json({ status: 'success', data: updated });
});

// Bookings are records of money taken and hold seats, so an account that has
// any is not deleted from under them. Reviews stay, shown without a name.
exports.deleteUser = asyncHandler(async (req, res) => {
  const user = await findUser(req.params.id);
  await keepAnAdmin(user);

  if (await Booking.exists({ user: user._id })) {
    throw new ApiError(409, 'This user has bookings. Remove those first.');
  }

  await User.deleteOne({ _id: user._id });
  await RefreshToken.deleteMany({ user: user._id });

  res.status(204).send();
});
