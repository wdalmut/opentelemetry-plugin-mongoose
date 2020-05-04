import { BasePlugin } from '@opentelemetry/core';
import * as shimmer from 'shimmer';
import mongoose from 'mongoose';

import { AttributeNames } from './enums'

import { startSpan, handleError, setErrorStatus, safeStringify } from './utils'

import { VERSION } from './version'

export class MongoosePlugin extends BasePlugin<typeof mongoose> {
  constructor(readonly moduleName: string) {
    super('@wdalmut/opentelemetry-plugin-mongoose', VERSION);
  }

  protected patch() {
    this._logger.debug('MongoosePlugin: patch mongoose plugin');

    shimmer.wrap(this._moduleExports.Model.prototype, 'save', this.patchOnModelMethods('save'));
    shimmer.wrap(this._moduleExports.Model.prototype, 'remove', this.patchOnModelMethods('remove'));
    shimmer.wrap(this._moduleExports.Query.prototype, 'exec', this.patchQueryExec());
    return this._moduleExports;
  }

  private patchQueryExec() {
    const thisPlugin = this
    thisPlugin._logger.debug('MongoosePlugin: patched mongoose query exec prototype');
    return (originalExec: Function) => {
      return function exec(this: any) {
        let span = startSpan(thisPlugin._tracer, this.model.modelName, this.op);

        span.setAttribute(AttributeNames.COLLECTION_NAME, this.mongooseCollection.name)

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
          .then(response => {
            if (thisPlugin?._config?.enhancedDatabaseReporting) {
              span.setAttribute(AttributeNames.DB_RESPONSE, safeStringify(response));
            }
            return response;
          })
          .catch(handleError(span))
          .finally(() => span.end())
      }
    }
  }

  private patchOnModelMethods(op: string) {
    const thisPlugin = this
    thisPlugin._logger.debug(`MongoosePlugin: patched mongoose ${op} prototype`);
    return (originalOnModelFunction: Function) => {
      return function method(this: any, options?: any, fn?: Function) {
        let span = startSpan(thisPlugin._tracer, this.constructor.modelName, op);

        span.setAttribute(AttributeNames.DB_QUERY_TYPE, op)

        span.setAttribute(AttributeNames.DB_NAME, this.constructor.collection.conn.name)
        span.setAttribute(AttributeNames.DB_HOST, this.constructor.collection.conn.host)
        span.setAttribute(AttributeNames.DB_PORT, this.constructor.collection.conn.port)
        span.setAttribute(AttributeNames.DB_USER, this.constructor.collection.conn.user)

        span.setAttribute(AttributeNames.COLLECTION_NAME, this.constructor.collection.name)

        if (thisPlugin?._config?.enhancedDatabaseReporting) {
          span.setAttribute(AttributeNames.DB_SAVE, safeStringify(this));
        }

        if (options instanceof Function) {
          fn = options
          options = undefined
        }

        if (fn instanceof Function) {
          return originalOnModelFunction.apply(this, [options, (err: Error, product: any) => {
            if (err) {
              setErrorStatus(span, err)
            }
            span.end()
            return fn!(err, product)
          }])
        } else {
          return originalOnModelFunction.apply(this, arguments)
            .catch(handleError(span))
            .finally(() => span.end() )
        }
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

