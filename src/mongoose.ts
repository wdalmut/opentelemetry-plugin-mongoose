import { BasePlugin } from '@opentelemetry/core';
import * as shimmer from 'shimmer';
import mongoose from 'mongoose';

import { AttributeNames } from './enums'

import { startSpan, handleError } from './utils'

import { VERSION } from './version'

export class MongoosePlugin extends BasePlugin<typeof mongoose> {
  constructor(readonly moduleName: string) {
    super('@wdalmut/opentelemetry-plugin-mongoose', VERSION);
  }

  protected patch() {
    if (this._moduleExports) {
      this._logger.debug('MongoosePlugin: patch mongoose plugin');

      shimmer.wrap(this._moduleExports.Model.prototype, 'save', this.patchSave());
      shimmer.wrap(this._moduleExports.Model.prototype, 'remove', this.patchRemove());
      shimmer.wrap(this._moduleExports.Query.prototype, 'exec', this.patchQueryExec());
    }
    return this._moduleExports;
  }

  private patchQueryExec() {
    const thisPlugin = this
    thisPlugin._logger.debug('MongoosePlugin: patched mongoose query exec prototype');
    return (originalExec: Function) => {
      return function exec(this: any) {
        let span = startSpan(thisPlugin._tracer, this.model.modelName, this.op);

        span.setAttribute(AttributeNames.COLLECTION_NAME, this.collection.name)

        span.setAttribute(AttributeNames.DB_NAME, this.mongooseCollection.conn.name)
        span.setAttribute(AttributeNames.DB_HOST, this.mongooseCollection.conn.host)
        span.setAttribute(AttributeNames.DB_PORT, this.mongooseCollection.conn.port)
        span.setAttribute(AttributeNames.DB_USER, this.mongooseCollection.conn.user)

        span.setAttribute(AttributeNames.DB_QUERY_TYPE, this.op)
        span.setAttribute(AttributeNames.DB_STATEMENT, JSON.stringify(this._conditions))
        span.setAttribute(AttributeNames.DB_OPTIONS, JSON.stringify(this.options))
        span.setAttribute(AttributeNames.DB_UPDATE, JSON.stringify(this._update))

        const queryResponse = originalExec.apply(this, arguments)

        if (!(queryResponse instanceof Promise)) {
          span.end()
          return queryResponse
        }

        return queryResponse
          .catch(handleError(span))
          .finally(() => span.end() )
      }
    }
  }

  private patchSave() {
    const thisPlugin = this
    thisPlugin._logger.debug('MongoosePlugin: patched mongoose save prototype');
    return (originalSave: Function) => {
      return function save(this: any) {
        let span = startSpan(thisPlugin._tracer, this.constructor.modelName, 'save');

        span.setAttribute(AttributeNames.DB_QUERY_TYPE, 'save')

        span.setAttribute(AttributeNames.DB_NAME, this.constructor.collection.conn.name)
        span.setAttribute(AttributeNames.DB_HOST, this.constructor.collection.conn.host)
        span.setAttribute(AttributeNames.DB_PORT, this.constructor.collection.conn.port)
        span.setAttribute(AttributeNames.DB_USER, this.constructor.collection.conn.user)

        span.setAttribute(AttributeNames.COLLECTION_NAME, this.constructor.collection.name)

        return originalSave.apply(this, arguments)
          .catch(handleError(span))
          .finally(() => span.end() )
      }
    }
  }

  private patchRemove() {
    const thisPlugin = this
    thisPlugin._logger.debug('MongoosePlugin: patched mongoose remove prototype');
    return (originalRemove: Function) => {
      return function remove(this: any) {
        let span = startSpan(thisPlugin._tracer, this.constructor.modelName, 'remove');

        span.setAttribute(AttributeNames.DB_QUERY_TYPE, 'remove')

        span.setAttribute(AttributeNames.DB_NAME, this.constructor.collection.conn.name)
        span.setAttribute(AttributeNames.DB_HOST, this.constructor.collection.conn.host)
        span.setAttribute(AttributeNames.DB_PORT, this.constructor.collection.conn.port)
        span.setAttribute(AttributeNames.DB_USER, this.constructor.collection.conn.user)

        span.setAttribute(AttributeNames.COLLECTION_NAME, this.constructor.collection.name)

        return originalRemove.apply(this, arguments)
          .catch(handleError(span))
          .finally(() => span.end() )
      }
    }
  }

  protected unpatch(): void {
    this._logger.debug('MongoosePlugin: unpatch mongoose plugin');
    shimmer.unwrap(this._moduleExports.Model.prototype, 'save')
    shimmer.unwrap(this._moduleExports.Model.prototype, 'remove')
    shimmer.unwrap(this._moduleExports.Query.prototype, 'exec')
  }
}

export const plugin = new MongoosePlugin('mongoose');

