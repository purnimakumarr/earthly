const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const QueryBuilder = require('../utils/QueryBuilder');

// Generic handlers shared by every resource. Each takes a Mongoose model and
// returns Express middleware, so controllers only spell out what is special.

const notFound = (Model) =>
  new ApiError(404, `No ${Model.modelName.toLowerCase()} found with that id.`);

const pick = (source, fields) =>
  Object.fromEntries(Object.entries(source).filter(([key]) => fields.includes(key)));

// Nested routes such as /expeditions/:expeditionId/reviews or
// /users/:userId/bookings narrow a collection to one parent.
const parentScope = (params) => ({
  ...(params.expeditionId && { expedition: params.expeditionId }),
  ...(params.userId && { user: params.userId }),
});

exports.pick = pick;
exports.parentScope = parentScope;

// `prepare`, when given, adjusts the base query (options, extra fields).
exports.list = (Model, { prepare = (query) => query } = {}) =>
  asyncHandler(async (req, res) => {
    const scope = parentScope(req.params);

    const builder = new QueryBuilder(prepare(Model.find(scope)), req.query)
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
