import { BasePlugin } from '@opentelemetry/core';
import * as shimmer from 'shimmer';
import mongoose, { Schema, Document, Model, Collection } from 'mongoose';

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

      shimmer.wrap(this._moduleExports, 'model', this.patchModel());
      shimmer.wrap(this._moduleExports.Query.prototype, 'exec', this.patchQueryExec());
      shimmer.wrap(this._moduleExports.Mongoose.prototype, 'model', this.patchModel());
    }
    return this._moduleExports;
  }

  private patchQueryExec() {
    const thisPlugin = this
    thisPlugin._logger.debug('MongoosePlugin: patched mongoose query exec prototype');
    return (originalExec: Function) => {
      return function exec(this: any) {
        let span = startSpan(thisPlugin._tracer, this.model.modelName, this.op);

        span.setAttribute(AttributeNames.DB_NAME, this.mongooseCollection.conn.name)
        span.setAttribute(AttributeNames.COLLECTION_NAME, this.collection.name)

        span.setAttribute(AttributeNames.DB_QUERY_TYPE, this.op)
        span.setAttribute(AttributeNames.DB_STATEMENT, JSON.stringify(this._conditions))
        span.setAttribute(AttributeNames.DB_OPTIONS, JSON.stringify(this.options))
        span.setAttribute(AttributeNames.DB_UPDATE, JSON.stringify(this._update))

        const queryResponse = originalExec.apply(this, arguments)
        span.end()
        return queryResponse
      }
    }
  }

  private patchModel() {
    const thisPlugin = this
    thisPlugin._logger.debug('MongoosePlugin: patched mongoose model');
    return (originalModel: Function) => {
      return function model<T extends Document>(name: string, schema?: Schema, collection?: string, skipInit?: boolean): Model<T> {
        if (!schema) {
          const returned = originalModel(...arguments)
          return returned;
        }

        const returned = originalModel(... arguments)

        let m = mongoose.model(name)

        shimmer.wrap(m.prototype, 'save', thisPlugin.patchSave(name, m.collection))

        return returned;
      }
    }
  }

  private patchSave(name: string, collection: Collection) {
    const thisPlugin = this
    thisPlugin._logger.debug('MongoosePlugin: patched mongoose save prototype');
    return (originalSave: Function) => {
      return function save(this: any) {
        let span = startSpan(thisPlugin._tracer, name, 'save');

        span.setAttribute(AttributeNames.DB_QUERY_TYPE, 'save')
        span.setAttribute(AttributeNames.DB_NAME, collection.conn.name)
        span.setAttribute(AttributeNames.COLLECTION_NAME, collection.name)

        return originalSave.apply(this, arguments)
          .catch(handleError(span))
          .finally(() => span.end() )
      }
    }
  }

  protected unpatch(): void {
    this._logger.debug('MongoosePlugin: unpatch mongoose plugin');
    shimmer.unwrap(this._moduleExports, 'model')
    shimmer.unwrap(this._moduleExports.Mongoose.prototype, 'model')
  }
}

export const plugin = new MongoosePlugin('mongoose');

