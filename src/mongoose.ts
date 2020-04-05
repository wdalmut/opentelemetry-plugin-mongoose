import { BasePlugin } from '@opentelemetry/core';
import { CanonicalCode, Span, SpanKind } from '@opentelemetry/api';
import * as shimmer from 'shimmer';
import { AttributeNames } from './enums';
import mongoose, { Schema, Document, Model, Query } from 'mongoose';
import mongodb from 'mongodb'
import { middlewares } from './middleware';

import { VERSION } from './version'

export class MongoosePlugin extends BasePlugin<typeof mongoose> {
  constructor(readonly moduleName: string) {
    super('@wdalmut/opentelemetry-plugin-mongoose', VERSION);
  }

  protected patch() {
    if (this._moduleExports) {
      this._logger.debug('MongoosePlugin: patch mongoose plugin');

      shimmer.wrap(this._moduleExports, 'model', this.patchModel());
      shimmer.wrap(this._moduleExports.Mongoose.prototype, 'model', this.patchModel());
    }
    return this._moduleExports;
  }

  private patchModel() {
    return (originalModel: Function) => {
      const thisPlugin = this
      thisPlugin._logger.debug('MongoosePlugin: patched mongoose model');

      return function model<T extends Document>(name: string, schema?: Schema, collection?: string, skipInit?: boolean): Model<T> {
        if (!schema) {
          const returned = originalModel(...arguments)
          return returned;
        }

        for (let middleware of middlewares) {
          schema.pre(middleware, function() {
            thisPlugin._logger.debug('MongoosePlugin: pre mongoose query');

            let span = thisPlugin._tracer.startSpan(`mongoose.${name}.${middleware}`, {
              kind: SpanKind.CLIENT,
              attributes: {
                // TODO: Add collection and database name and connection information
                [AttributeNames.DB_MODEL_NAME]: name,
                [AttributeNames.DB_QUERY_TYPE]: middleware,
                [AttributeNames.DB_TYPE]: 'nosql',
                [AttributeNames.COMPONENT]: 'mongoose',
              },
            });

            if (this instanceof Query) {
              span.setAttribute(AttributeNames.DB_STATEMENT, this.getQuery() ? JSON.stringify(this.getQuery()) : null);
              span.setAttribute(AttributeNames.DB_OPTIONS, this.getOptions() ? JSON.stringify(this.getOptions()) : null);
              span.setAttribute(AttributeNames.DB_UPDATE, this.getUpdate() ? JSON.stringify(this.getUpdate()) : null);
            }

            // @ts-ignore
            this._span = span
          })

          // handle normal operations
          schema.post(middleware, function (doc: T, next: Function) {
            thisPlugin._logger.debug('MongoosePlugin: post mongoose query');

            // @ts-ignore
            const span: Span = this._span;

            if (!span) {
              thisPlugin._logger.debug('MongoosePlugin: There is no span in place...');
              return next();
            }

            span.setStatus({
              code: CanonicalCode.OK,
            });

            span.setAttribute(AttributeNames.DB_MODEL, JSON.stringify(doc));

            span.end();

            return next()
          })

          // handle error conditions
          schema.post(middleware, function(error: mongodb.MongoError, doc: T, next: Function) {
            thisPlugin._logger.debug('MongoosePlugin: post mongoose query');

            // @ts-ignore
            const span: Span = this._span;

            if (!span) {
              thisPlugin._logger.debug('MongoosePlugin: There is no span in place...');
              return next()
            }

            span.setAttribute(AttributeNames.MONGO_ERROR_CODE, error.code);
            span.setStatus({
              code: CanonicalCode.UNKNOWN,
              message: error.message,
            })

            // @ts-ignore
            span.end();

            next()
          })
        }

        const returned = originalModel(... arguments)
        return returned;
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

