var Proto = require('uberproto');
const { MongoClient, ObjectID } = require('mongodb');
var errors = require('feathers-errors').types;
var filter = require('feathers-query-filters');
var _ = require('lodash');

const mongoClients = {};

var MongoService = Proto.extend({
  // TODO (EK): How do we handle indexes?
  async init(collection, options) {
    // collection = {connectionString, collection }
    // console.log('MongoService.init, collection=%s', collection);
    if (_.isObject(collection)) {
      options = collection;
      collection = options.collection;
    }

    options = options || {};

    if (!collection) {
      throw new errors.GeneralError('No MongoDB collection name specified.');
    }

    this.type = 'mongodb';
    this.options = _.extend({
      _id: '_id'
    }, options);

    const db = await this._connect(this.options);
    if (!db) process.exit(-1);
    this.store = db;
    this.collection = db.collection(this.options.collection);
  },

  // TODO (EK): We need to handle replica sets.
  _connect: async (options) => {
    // options = { connectionString, collection }
    //console.log('MongoService._connect, options=', options);

    var connectionString = options.connectionString;

    //if (mongoClients[connectionString]) return;
    //mongoClients[connectionString] = {};

    const client = await MongoClient.connect(connectionString, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    if (!client) {
      console.log('failed to connect to %s', connectionString);
      process.exit(-1);
    };

    mongoClients[connectionString] = client.db();
    return client.db();

  },

  getStore() {
    const db = mongoClients[this.options.connectionString];
    return db;
  },

  getCollection() {
    // console.log('feathers-mongodb.getCollection this.options: ', this.options);
    const client = mongoClients[this.options.connectionString];
    if (!client) return null;
    //console.log('mongoClients=', mongoClients);
    return client.collection(this.options.collection);
  },

  _toObjectID: function (hex) {
    if (hex instanceof ObjectID) {
      return hex;
    }
    if (!hex || hex.length !== 24) {
      return hex;
    }
    return ObjectID.createFromHexString(hex);
  },

  _isObjectID: function (idstr) {
    return ObjectID.isValid(idstr);
  },

  find: function (params, cb) {
    // console.log('Enter feathers-mongodb.find: ', params);
    // console.log('feathers-mongodb this.options: ', this.options);

    if (_.isFunction(params)) {
      cb = params;
      params = {};
    }

    params.query = params.query || {};
    var options = params.options || {};
    var filters = filter(params.query);

    if (filters.$select && filters.$select.length) {
      options.fields = {};

      _.each(filters.$select, function (key) {
        options.fields[key] = 1;
      });
    }

    if (filters.$sort) {
      options.sort = filters.$sort;
    }

    if (filters.$limit) {
      options.limit = filters.$limit;
    }

    if (filters.$skip) {
      options.skip = filters.$skip;
    }

    this.collection = this.getCollection();
    //console.log('feathers-mongo.find: this.collection=%s', this.collection);
    const cursor = this.collection.find(params.query, options);
    //console.log('feathers-mongo.find: cursor=%s', cursor);
    cursor.toArray(cb);
  },

  get: function (id, params, cb) {
    if (_.isFunction(id)) {
      cb = id;
      return cb(new errors.BadRequest('A string or number id must be provided'));
    }

    if (_.isFunction(params)) {
      cb = params;
      params = {};
    }

    if (_.isString(id)) {
      id = id.toLowerCase();
    }

    // console.log('this=', this);
    this.collection = this.getCollection();

    // console.log('feathers-mongodb.get: id=%s', id);
    this.collection.findOne({ _id: this._toObjectID(id) }, function (error, data) {
      if (error) {
        return cb(error);
      }

      if (!data) {
        return cb(new errors.NotFound('No record found for id \'' + id + '\''));
      }

      return cb(null, data);
    });
  },

  // TODO (EK): Batch support for create, update, delete.
  create: function (data, params, cb) {
    if (_.isFunction(params)) {
      cb = params;
      params = {};
    }

    this.collection = this.getCollection();
    this.collection.insert(data, params, function (error, data) {
      if (error || !data) {
        return cb(error);
      }

      cb(null, data.length === 1 ? data[0] : data);
    });
  },

  patch: function (id, data, params, cb) {
    if (_.isFunction(params)) {
      cb = params;
      params = {};
    }

    var _get = this.get.bind(this);

    this.collection = this.getCollection();
    this.collection.updateOne({ _id: this._toObjectID(id) }, { $set: data }, function (error) {
      if (error) {
        return cb(error);
      }

      _get(id, {}, cb);
    }.bind(this));
  },

  update: function (id, data, params, cb) {
    if (_.isFunction(params)) {
      cb = params;
      params = {};
    }

    var _get = this.get.bind(this);
    this.collection = this.getCollection();
    this.collection.updateOne({ _id: this._toObjectID(id) }, data, function (error) {
      // TODO (DL) maybe we should throw a NotFound error already but
      // that doesn't seem to be necessary
      if (error) {
        return cb(error);
      }

      _get(id, {}, cb);
    }.bind(this));
  },

  remove: function (id, params, cb) {
    if (_.isFunction(params)) {
      cb = params;
      params = {};
    }

    this.collection = this.getCollection();
    var collection = this.collection;
    var _toObjectID = this._toObjectID;

    this.get(id, params, function (error, data) {
      if (error) {
        return cb(error);
      }

      collection.removeOne({ _id: _toObjectID(id) }, params.query || {}, function (error) {
        if (error) {
          return cb(error);
        }

        cb(null, data);
      });
    });
  }
});

module.exports = function (collection, options) {
  return Proto.create.call(MongoService, collection, options);
};

module.exports.Service = MongoService;
