import { BasePlugin } from '@opentelemetry/core';
import * as shimmer from 'shimmer';
import mongoose from 'mongoose';

import { AttributeNames } from './enums'

import { startSpan, handleError, setErrorStatus, safeStringify, getAttributesFromCollection, handleExecResponse } from './utils'

import { VERSION } from './version'

const contextCaptureFunctions = [
  'remove',
  'deleteOne',
  'deleteMany',
  'find',
  'findOne',
  'estimatedDocumentCount',
  'countDocuments',
  'count',
  'distinct',
  'where',
  '$where',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndReplace',
  'findOneAndRemove',
]

export class MongoosePlugin extends BasePlugin<typeof mongoose> {
  constructor(readonly moduleName: string) {
    super('@wdalmut/opentelemetry-plugin-mongoose', VERSION);
  }

  protected patch() {
    this._logger.debug('MongoosePlugin: patch mongoose plugin');

    shimmer.wrap(this._moduleExports.Model.prototype, 'save', this.patchOnModelMethods('save'));
    shimmer.wrap(this._moduleExports.Model.prototype, 'remove', this.patchOnModelMethods('remove'));
    shimmer.wrap(this._moduleExports.Query.prototype, 'exec', this.patchQueryExec());
    shimmer.wrap(this._moduleExports.Aggregate.prototype, 'exec', this.patchAggregateExec());

    contextCaptureFunctions.forEach( (funcName: string) => {
      shimmer.wrap(this._moduleExports.Query.prototype, funcName as any, this.patchAndCaptureSpanContext(funcName));
    })
    shimmer.wrap(this._moduleExports.Model, 'aggregate' as any, this.patchModelAggregate());

    shimmer.wrap(this._moduleExports.Query.prototype, 'then', this.patchMongooseThen('Query'));
    shimmer.wrap(this._moduleExports.Aggregate.prototype, 'then', this.patchMongooseThen('Aggregate'));
    
    return this._moduleExports;
  }

  private patchAggregateExec() {
    const thisPlugin = this;
    thisPlugin._logger.debug('MongoosePlugin: patched mongoose query exec prototype');
    return (originalExec: Function) => {
      return function exec(this: any) {
        let span = startSpan(thisPlugin._tracer, this._model?.modelName, 'aggregate');
        span.setAttributes(getAttributesFromCollection(this._model.collection));
        span.setAttribute(AttributeNames.DB_QUERY_TYPE, 'aggregate');
        span.setAttribute(AttributeNames.DB_OPTIONS, JSON.stringify(this.options));
        span.setAttribute(AttributeNames.DB_AGGREGATE_PIPELINE, JSON.stringify(this._pipeline));
        
        const aggregateResponse = originalExec.apply(this, arguments);
        return handleExecResponse(aggregateResponse, span, thisPlugin?._config?.enhancedDatabaseReporting);
      }
    }
  }

  private patchQueryExec() {
    const thisPlugin = this
    thisPlugin._logger.debug('MongoosePlugin: patched mongoose query exec prototype');
    return (originalExec: Function) => {
      return function exec(this: any) {
        let span = startSpan(thisPlugin._tracer, this.model.modelName, this.op);

        span.setAttributes(getAttributesFromCollection(this.mongooseCollection));

        span.setAttribute(AttributeNames.DB_QUERY_TYPE, this.op)
        span.setAttribute(AttributeNames.DB_STATEMENT, JSON.stringify(this._conditions))
        span.setAttribute(AttributeNames.DB_OPTIONS, JSON.stringify(this.options))
        span.setAttribute(AttributeNames.DB_UPDATE, JSON.stringify(this._update))

        const queryResponse = originalExec.apply(this, arguments)
        return handleExecResponse(queryResponse, span, thisPlugin?._config?.enhancedDatabaseReporting);
      }
    }
  }

  private patchOnModelMethods(op: string) {
    const thisPlugin = this
    thisPlugin._logger.debug(`MongoosePlugin: patched mongoose ${op} prototype`);
    return (originalOnModelFunction: Function) => {
      return function method(this: any, options?: any, fn?: Function) {
        let span = startSpan(thisPlugin._tracer, this.constructor.modelName, op);
        span.setAttributes(getAttributesFromCollection(this.constructor.collection));

        span.setAttribute(AttributeNames.DB_QUERY_TYPE, op)

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

  // we want to capture the otel span on the object which is calling exec.
  // in the special case of aggregate, we need have no function to path
  // on the Aggregate object to capture the context on, so we patch
  // the aggregate of Model, and set the context on the Aggregate object
  private patchModelAggregate() {
    const thisPlugin = this
    thisPlugin._logger.debug(`MongoosePlugin: patched mongoose model aggregate`);
    return (original: Function) => {
      return function captureSpanContext(this: any) {
        const currentSpan = thisPlugin._tracer.getCurrentSpan();
        const aggregate = original.apply(this, arguments);
        if(aggregate) aggregate._otContext = currentSpan;
        return aggregate;
      }
    }
  }

  private patchAndCaptureSpanContext(funcName: string) {
    const thisPlugin = this
    thisPlugin._logger.debug(`MongoosePlugin: patched mongoose query ${funcName} prototype`);
    return (original: Function) => {
      return function captureSpanContext(this: any) {
        this._otContext = thisPlugin._tracer.getCurrentSpan();
        return original.apply(this, arguments);
      }
    }
  }

  private patchMongooseThen(patchedObject: string) {
    const thisPlugin = this
    thisPlugin._logger.debug(`MongoosePlugin: patched ${patchedObject} then prototype`);
    return (originalThen: Function) => {
      return function patchedThen(this: any) {
        if(this._otContext) {
          return thisPlugin._tracer.withSpan(this._otContext, () => {
            return originalThen.apply(this, arguments);
          });  
        }
        else {
          return originalThen.apply(this, arguments);
        }
      }
    }
  }

  protected unpatch(): void {
    this._logger.debug('MongoosePlugin: unpatch mongoose plugin');
    shimmer.unwrap(this._moduleExports.Model.prototype, 'save');
    shimmer.unwrap(this._moduleExports.Model.prototype, 'remove');
    shimmer.unwrap(this._moduleExports.Query.prototype, 'exec');

    contextCaptureFunctions.forEach( (funcName: string) => {
      shimmer.unwrap(this._moduleExports.Query.prototype, funcName as any);
    });

    shimmer.unwrap(this._moduleExports.Query.prototype, 'then');
  }
}

export const plugin = new MongoosePlugin('mongoose');

