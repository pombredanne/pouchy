'use strict'

var bluebird = require('bluebird')
var defaults = require('lodash/defaults')
var unique = require('lodash/uniq')
var toArray = require('lodash/toArray')
var get = require('lodash/get')
var isFunction = require('lodash/isFunction')
var designDocRegex = new RegExp('^_design/')
var toUnderscorePrefix = require('./to-underscore-prefix')

/** @lends Pouchy.prototype */
var publicMethods = {
  /**
   * add a document to the db.
   * @see save
   * @example
   * // with _id
   * p.add({ _id: 'my-sauce', bbq: 'sauce' }).then(function(doc) {
   *   console.log(doc._id, doc._rev, doc.bbq); // 'my-sauce', '1-a76...46c', 'sauce'
   * });
   *
   * // no _id
   * p.add({ peanut: 'butter' }).then(function(doc) {
   *   console.log(doc._id, doc._rev, doc.peanut); // '66188...00BF885E', '1-0d74...7ac', 'butter'
   * });
   * @param {object} doc
   * @param {function} [cb]
   * @returns {Promise}
   */
  add: function add () {
    return this.save.apply(this, arguments)
  },

  /**
   * get all documents from db
   * @example
   * p.all().then((docs) => console.log(`total # of docs: ${docs.length}!`))
   * p.all({ includeDesignDocs: true }).then(function(docs) {
   *    console.log('this will include design docs as well');
   * })
   * @param {object} [opts] defaults to `include_docs: true`. In addition to the usual [PouchDB allDocs options](http://pouchdb.com/api.html#batch_fetch), you may also specify `includeDesignDocs: true` to have CouchDB design documents returned.
   * @param {function} [cb]
   * @returns {Promise} resolves to array of documents (excluding any design documents), vs an object with a `docs` array per Pouch allDocs default
   */
  all: function (opts, cb) {
    opts = defaults(opts || {}, { include_docs: true })
    return this.db.allDocs(opts)
    .then(function handleReceivedDocs (docs) {
      return docs.rows.reduce(function simplifyAllDocSet (r, v) {
        var doc = opts.include_docs ? v.doc : v
        // rework doc format to always have id ==> _id
        if (!opts.include_docs) {
          doc._id = doc.id
          doc._rev = doc.value.rev
          delete doc.id
          delete doc.value
          delete doc.key
        }
        /* istanbul ignore next */
        if (!opts.includeDesignDocs) r.push(doc)
        else if (opts.includeDesignDocs && doc._id.match(designDocRegex)) r.push(doc)
        return r
      }, [])
    })
  },

  /**
   * The native bulkGet PouchDB API is not very user friendly.  In fact, it's down right wacky!
   * This method patches PouchDB's `bulkGet` and assumes that _all_ of your requested docs exist.  If they do not, it will error via the usual error control flows.
   * @example
   * // A good example of what you can expect is actually right out of the tests!
   * let dummyDocs = [
   *   { _id: 'a', data: 'a' },
   *   { _id: 'b', data: 'b' }
   * ]
   * Promise.resolve()
   * .then(() => p.save(dummyDocs[0])) // add our first doc to the db
   * .then((doc) => (dummyDocs[0] = doc)) // update our closure doc it knows the _rev
   * .then(() => p.save(dummyDocs[1]))
   * .then((doc) => (dummyDocs[1] = doc))
   * .then(() => {
   *   // prepare bulkGet query (set of { _id, _rev}'s are required)
   *   const toFetch = dummyDocs.map(dummy => ({
   *     _id: dummy._id,
   *     _rev: dummy._rev
   *     // or you can provide .id, .rev
   *   }))
   *   p.bulkGet(toFetch)
   *     .then((docs) => {
   *       t.deepEqual(docs, dummyDocs, 'bulkGet returns sane results')
   *       t.end()
   *     })
   * })
   * @param {object|array} opts array of {_id, _rev}s, or { docs: [ ... } } where
   *                            ... is an array of {_id, _rev}s
   * @param {function} [cb]
   */
  bulkGet: function (opts, cb) {
    /* istanbul ignore else */
    if (!opts) throw new Error('missing bulkGet opts')
    if (Array.isArray(opts)) opts = { docs: opts }
    if (!Array.isArray(opts.docs)) {
      throw new Error('bulkGet requires array of doc filters. please see couchdb bulkGet')
    }
    opts.docs = opts.docs.map(function remapIdRev (doc) {
      // we need to map back to id and rev here
      /* istanbul ignore else */
      if (doc._id) doc.id = doc._id
      /* istanbul ignore else */
      if (doc._rev) doc.rev = doc._rev
      delete doc._rev
      delete doc._id
      return doc
    })
    if (!opts.docs.length) return Promise.resolve([])
    return this.db.bulkGet(opts)
    .then(function mapBulkGetResultsToRoot (r) {
      return r.results.map(function tidyBulkGetDocs (docGroup) {
        var doc = get(docGroup, 'docs[0].ok')
        if (!doc) throw new ReferenceError('doc ' + docGroup.id + 'not found')
        return doc
      })
    })
  },

  /**
   * easy way to create a db index.
   * @see createIndicies
   * @example
   * p.createIndex('myIndex')
   * @param {string} indexName
   * @param {function} [cb]
   * @returns {Promise}
   */
  createIndex: function () {
    return this.createIndicies.apply(this, arguments)
  },

  /**
   * allow single or bulk creation of indicies. also, doesn't flip out if you've
   * already set an index.
   * @example
   * p.createIndicies('test')
   * .then((indexResults) => console.dir(indexResults));
   * // ==>
   * /*
   * [{
   *     id: "_design/idx-28933dfe7bc072c94e2646126133dc0d"
   *     name: "idx-28933dfe7bc072c94e2646126133dc0d"
   *     result: "created"
   * }]
   * @param {array|string} indices 'an-index' or ['some', 'indicies']
   * @param {function} [cb]
   * @returns {Promise} resolves with index meta.  see `pouchy.createIndex`
   */
  createIndicies: function (indicies) {
    indicies = Array.isArray(indicies) ? indicies : [indicies]
    return this.db.createIndex({ index: { fields: unique(indicies) } })
    /* istanbul ignore next */
    .catch(function handleFailCreateIndicies (err) {
      /* istanbul ignore next */
      if (err.status !== 409) throw err
    })
  },

  /**
   * @see deleteAll
   * @param {function} [cb]
   * @returns {Promise}
   */
  clear: function () {
    return this.deleteAll.apply(this, arguments)
  },

  /**
   * delete a document.
   * @example
   * // same as pouch.remove
   * p.delete(doc).then(() => { console.dir(arguments); });
   * // ==>
   * {
   *     id: "test-doc-1"
   *     ok: true
   *     rev: "2-5cf6a4725ed4b9398d609fc8d7af2553"
   * }
   * @param {object} doc
   * @param {object} [opts] pouchdb.remove opts
   * @param {function} [cb]
   * @returns {Promise}
   */
  delete: function (doc, opts) {
    return this.db.remove(doc, opts)
  },

  /**
   * clears the db of documents. under the hood, `_deleted` flags are added to docs
   * @param {function} [cb]
   * @returns {Promise}
   */
  deleteAll: function (cb) {
    var deleteSingleDoc = function deleteSingleDoc (doc) { return this.delete(doc) }.bind(this)
    return this.all()
    .then(function deleteEach (docs) {
      return Promise.all(docs.map(deleteSingleDoc))
    })
  },

  /**
   * @see pouchdb.destroy
   * @param {function} [cb]
   * @returns {Promise}
   */
  deleteDB: function (cb) {
    /* istanbul ignore next */
    return this.db.destroy()
  },

  /**
   * proxies to pouchdb.destroy, but does internal tidy first
   * @param {function} [cb]
   * @returns {Promise}
   */
  destroy: function () {
    var chain = bluebird.resolve()
    /* istanbul ignore next */
    if (this.syncEmitter) {
      if (this._replicationOpts && this._replicationOpts.live) {
        // early bind the `complete` event listener.  careful not to bind it
        // inside the .then, otherwise binding happens at the end of the event
        // loop, which is too late! `.cancel` is a sync call!
        var isCompleteP = new Promise(function waitForLiveSyncComplete (resolve) {
          this.syncEmitter.on('complete', resolve)
        }.bind(this))
        chain = chain.then(isCompleteP)
      }
      this.syncEmitter.cancel() // will trigger complete event per
    }
    chain = chain.then(function bbPouchyDestroy () {
      return this.db.destroy.apply(this.db, arguments)
    }.bind(this))
    return chain
  },

  /**
   * normal pouchdb.find, but returns simple set of results
   * @param {object} opts find query opts
   * @param {function} [cb]
   * @returns {Promise}
   */
  find: function _find (opts, cb) {
    return this.db.find(opts)
    .then(function returnDocsArray (rslt) { return rslt.docs })
  },

  /**
   * normal pouchdb.get, but returns simple set of results
   * @param {string} id
   * @param {object} [opts]
   * @param {function} [cb]
   * @returns {Promise}
   */
  get: function _get (id, cb) {
    return this.db.get.apply(this.db, arguments)
  },

  /**
   * update a document, and get your sensibly updated doc in return.
   * @example
   * p.update({ _id: 'my-doc', _rev: '1-abc123' })
   * .then((doc) => console.log(doc))
   * // ==>
   * {
   *    _id: 'my-doc',
   *    _rev: '2-abc234'
   * }
   * @param {object} doc
   * @param {function} [cb]
   * @returns {Promise}
   */
  update: function (doc, cb) {
    // http://pouchdb.com/api.html#create_document
    // db.put(doc, [docId], [docRev], [options], [callback])
    return this.db.put(doc)
    .then(function (meta) {
      doc._id = meta.id
      doc._rev = meta.rev
      return doc
    })
  },

  /**
   * Adds or updates a document.  If `_id` is set, a `put` is performed (basic add operation). If no `_id` present, a `post` is performed, in which the doc is added, and large-random-string is assigned as `_id`.
   * @example
   * p.save({ beep: 'bop' }).then((doc) => console.log(doc))
   * // ==>
   * {
   *   _id: 'AFEALJW-234LKJASDF-2A;LKFJDA',
   *   _rev: '1-asdblkue242kjsa0f',
   *   beep: 'bop'
   * }
   * @param {object} doc
   * @param {object} [opts] `pouch.put/post` options
   * @param {function} [cb]
   * @returns {Promise} resolves w/ doc, with updated `_id` and `_rev` properties
   */
  save: function (doc, opts, cb) {
    // http://pouchdb.com/api.html#create_document
    // db.post(doc, [docId], [docRev], [options], [callback])
    /* istanbul ignore next */
    var method = doc.hasOwnProperty('_id') && (doc._id || doc._id === 0) ? 'put' : 'post'
    return this.db[method](doc)
      .then(function tidySaveResults (meta) {
        delete meta.status
        doc._id = meta.id
        doc._rev = meta.rev
        return doc
      })
  }
}

function publicMethodFactory (method) {
  return function pouchDualApiSupportMethod () {
    var args = toArray(arguments)
    var cb
    if (typeof args[args.length - 1] === 'function') cb = args.pop()
    var res = bluebird
    .resolve(publicMethods[method].apply(this, args))
    .then(res => toUnderscorePrefix(res))
    return cb ? res.asCallback(cb) : res
  }
}

var dualApiPublicMethods = {}
for (var k in publicMethods) {
  /* istanbul ignore next */
  if (publicMethods.hasOwnProperty(k)) {
    /* istanbul ignore next */
    if (isFunction(publicMethods[k])) {
      dualApiPublicMethods[k] = publicMethodFactory(k)
    }
  }
}

module.exports = dualApiPublicMethods
