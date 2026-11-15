const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod;

exports.connect = async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'earthly-test' });
  // Unique and geo indexes must exist before the first write.
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
};

exports.clear = async () => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})),
  );
};

exports.disconnect = async () => {
  await mongoose.disconnect();
  await mongod.stop();
};
