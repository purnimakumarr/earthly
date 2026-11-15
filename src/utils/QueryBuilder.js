const RESERVED = ['page', 'sort', 'limit', 'fields'];
const MAX_LIMIT = 100;

/**
 * Turns a request query string into a Mongoose query.
 *
 *   ?difficulty=easy&price[lte]=40000   filter
 *   &sort=-ratingsAverage,price         sort
 *   &fields=name,price                  projection
 *   &page=2&limit=6                     pagination
 */
class QueryBuilder {
  constructor(query, params) {
    this.query = query;
    this.params = params;
    this.page = 1;
    this.limit = MAX_LIMIT;
  }

  filter() {
    const criteria = { ...this.params };
    RESERVED.forEach((key) => delete criteria[key]);

    const withOperators = JSON.stringify(criteria).replace(
      /\b(gte|gt|lte|lt|ne)\b/g,
      (op) => `$${op}`,
    );

    this.query = this.query.find(JSON.parse(withOperators));
    return this;
  }

  sort() {
    const order = this.params.sort
      ? String(this.params.sort).split(',').join(' ')
      : '-createdAt';
    this.query = this.query.sort(`${order} _id`);
    return this;
  }

  select() {
    const fields = this.params.fields
      ? String(this.params.fields).split(',').join(' ')
      : '-__v';
    this.query = this.query.select(fields);
    return this;
  }

  paginate() {
    this.page = Math.max(parseInt(this.params.page, 10) || 1, 1);
    this.limit = Math.min(
      Math.max(parseInt(this.params.limit, 10) || MAX_LIMIT, 1),
      MAX_LIMIT,
    );
    this.query = this.query.skip((this.page - 1) * this.limit).limit(this.limit);
    return this;
  }
}

module.exports = QueryBuilder;
