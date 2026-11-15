const fs = require('fs/promises');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

const UPLOAD_ROOT = path.join(__dirname, '../../uploads');

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

exports.UPLOAD_ROOT = UPLOAD_ROOT;

exports.userPhoto = [
  upload.single('photo'),
  asyncHandler(async (req, res, next) => {
    if (!req.file) return next();

    req.body.photo = await saveJpeg(
      req.file.buffer,
      'users',
      `${req.user.id}-${Date.now()}.jpeg`,
      500,
      500,
    );
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
    const stamp = `${req.params.id}-${Date.now()}`;

    // Cover and gallery are independent: either can be replaced on its own.
    if (files.coverImage) {
      req.body.coverImage = await saveJpeg(
        files.coverImage[0].buffer,
        'expeditions',
        `${stamp}-cover.jpeg`,
        2000,
        1333,
      );
    }

    if (files.images) {
      req.body.images = await Promise.all(
        files.images.map((file, i) =>
          saveJpeg(file.buffer, 'expeditions', `${stamp}-${i + 1}.jpeg`, 2000, 1333),
        ),
      );
    }

    next();
  }),
];
