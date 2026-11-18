const fs = require('fs/promises');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');
const mongoSanitize = require('express-mongo-sanitize');
const config = require('../config');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

const UPLOAD_ROOT = config.uploadDir;

// Files stay in memory so sharp can resize them before anything hits disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, done) => {
    if (file.mimetype.startsWith('image/')) return done(null, true);
    done(new ApiError(400, 'Only image files can be uploaded.'));
  },
});

const saveJpeg = async (buffer, folder, filename, width, height) => {
  const dir = path.join(UPLOAD_ROOT, folder);
  await fs.mkdir(dir, { recursive: true });

  await sharp(buffer)
    .rotate()
    .resize(width, height, { fit: 'cover' })
    .jpeg({ quality: 85 })
    .toFile(path.join(dir, filename));

  return `/uploads/${folder}/${filename}`;
};

// Deletes uploaded files by their public URL. Anything that is not under
// /uploads (the bundled expedition photos, a missing value) is left alone.
const discard = (urls) =>
  Promise.all(
    urls
      .filter((url) => typeof url === 'string' && url.startsWith('/uploads/'))
      .map((url) => path.resolve(UPLOAD_ROOT, url.slice('/uploads/'.length)))
      .filter((file) => file.startsWith(UPLOAD_ROOT + path.sep))
      .map((file) => fs.unlink(file).catch(() => {})),
  );

// Images are written before the document is validated. If the request then
// fails, or the client goes away before the response is out, the files it
// wrote are removed so nothing is left orphaned. `close` fires in both cases.
const discardOnFailure = (res, urls) => {
  res.once('close', () => {
    if (res.writableFinished && res.statusCode < 400) return;
    discard(urls);
  });
};

// Multer fills req.body after the global sanitiser has run, so multipart
// text fields are cleaned here: no `$` operators and no dotted paths.
const cleanBody = (req) => {
  req.body = mongoSanitize.sanitize({ ...req.body });
};

exports.UPLOAD_ROOT = UPLOAD_ROOT;
exports.discard = discard;

exports.userPhoto = [
  upload.single('photo'),
  asyncHandler(async (req, res, next) => {
    cleanBody(req);
    // The photo path is only ever set from an uploaded file, below.
    delete req.body.photo;

    if (!req.file) return next();

    req.body.photo = await saveJpeg(
      req.file.buffer,
      'users',
      `${req.user.id}-${Date.now()}.jpeg`,
      500,
      500,
    );
    discardOnFailure(res, [req.body.photo]);
    next();
  }),
];

exports.expeditionImages = [
  upload.fields([
    { name: 'coverImage', maxCount: 1 },
    { name: 'images', maxCount: 3 },
  ]),
  asyncHandler(async (req, res, next) => {
    const files = req.files || {};

    // The id becomes part of a filename, so it must be an id and nothing else.
    if (req.params.id && !/^[a-f\d]{24}$/i.test(req.params.id)) {
      throw new ApiError(400, 'Invalid id.');
    }
    const stamp = `${req.params.id || 'new'}-${Date.now()}`;

    // Multipart fields are flat strings, so nested values (departures, stops,
    // guides) travel as one JSON part named `data`.
    if (typeof req.body.data === 'string') {
      let data;
      try {
        data = JSON.parse(req.body.data);
      } catch {
        throw new ApiError(400, 'The "data" field is not valid JSON.');
      }
      if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        throw new ApiError(400, 'The "data" field must be a JSON object.');
      }
      req.body = data;
    }
    cleanBody(req);

    const saved = [];
    discardOnFailure(res, saved);

    // Cover and gallery are independent: either can be replaced on its own.
    if (files.coverImage) {
      req.body.coverImage = await saveJpeg(
        files.coverImage[0].buffer,
        'expeditions',
        `${stamp}-cover.jpeg`,
        2000,
        1333,
      );
      saved.push(req.body.coverImage);
    }

    if (files.images) {
      req.body.images = await Promise.all(
        files.images.map((file, i) =>
          saveJpeg(file.buffer, 'expeditions', `${stamp}-${i + 1}.jpeg`, 2000, 1333),
        ),
      );
      saved.push(...req.body.images);
    }

    next();
  }),
];
