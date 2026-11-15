const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const QueryBuilder = require('../utils/QueryBuilder');

// Generic handlers shared by every resource. Each takes a Mongoose model and
// returns Express middleware, so controllers only spell out what is special.

const notFound = (Model) =>
  new ApiError(404, `No ${Model.modelName.toLowerCase()} found with that id.`);

const pick = (source, fields) =>
  Object.fromEntries(Object.entries(source).filter(([key]) => fields.includes(key)));

exports.pick = pick;

exports.list = (Model) =>
  asyncHandler(async (req, res) => {
    // Supports nested routes such as /expeditions/:expeditionId/reviews
    const scope = req.params.expeditionId ? { expedition: req.params.expeditionId } : {};

    const builder = new QueryBuilder(Model.find(scope), req.query)
      .filter()
      .sort()
      .select();

    const total = await Model.countDocuments(builder.query.getFilter());
    const docs = await builder.paginate().query;

    res.status(200).json({
      status: 'success',
      results: docs.length,
      total,
      page: builder.page,
      data: docs,
    });
  });

exports.getOne = (Model, populate) =>
  asyncHandler(async (req, res) => {
    let query = Model.findById(req.params.id);
    if (populate) query = query.populate(populate);

    const doc = await query;
    if (!doc) throw notFound(Model);

    res.status(200).json({ status: 'success', data: doc });
  });

exports.create = (Model) =>
  asyncHandler(async (req, res) => {
    const doc = await Model.create(req.body);

    res.status(201).json({ status: 'success', data: doc });
  });

// `fields`, when given, is the allow-list of properties a client may change.
exports.update = (Model, { fields } = {}) =>
  asyncHandler(async (req, res) => {
    const changes = fields ? pick(req.body, fields) : req.body;

    const doc = await Model.findByIdAndUpdate(req.params.id, changes, {
      new: true,
      runValidators: true,
    });
    if (!doc) throw notFound(Model);

    res.status(200).json({ status: 'success', data: doc });
  });

exports.remove = (Model) =>
  asyncHandler(async (req, res) => {
    const doc = await Model.findByIdAndDelete(req.params.id);
    if (!doc) throw notFound(Model);

    res.status(204).send();
  });
