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

// when mongoose functions are called, we store the original call context
// and then set it as the parent for the spans created by Query/Aggregate exec()
// calls. this bypass the unlinked spans issue on thenables await operations (issue #29)
export const _STORED_PARENT_SPAN: unique symbol = Symbol('stored-parent-span');

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
    });
    shimmer.wrap(this._moduleExports.Model, 'aggregate', this.patchModelAggregate());

    return this._moduleExports;
  }

  private patchAggregateExec() {
    const thisPlugin = this;
    thisPlugin._logger.debug('MongoosePlugin: patched mongoose Aggregate exec prototype');
    return (originalExec: Function) => {
      return function exec(this: any) {
        const parentSpan = this[_STORED_PARENT_SPAN];
        let span = startSpan(thisPlugin._tracer, this._model?.modelName, 'aggregate', parentSpan);
        span.setAttributes(getAttributesFromCollection(this._model.collection));
        span.setAttribute(AttributeNames.DB_QUERY_TYPE, 'aggregate');
        span.setAttribute(AttributeNames.DB_OPTIONS, safeStringify(this.options));
        span.setAttribute(AttributeNames.DB_AGGREGATE_PIPELINE, safeStringify(this._pipeline));
        
        const aggregateResponse = originalExec.apply(this, arguments);
        return handleExecResponse(aggregateResponse, span, thisPlugin?._config?.enhancedDatabaseReporting);
      }
    }
  }

  private patchQueryExec() {
    const thisPlugin = this
    thisPlugin._logger.debug('MongoosePlugin: patched mongoose Query exec prototype');
    return (originalExec: Function) => {
      return function exec(this: any) {
        const parentSpan = this[_STORED_PARENT_SPAN];
        let span = startSpan(thisPlugin._tracer, this.model.modelName, this.op, parentSpan);

        span.setAttributes(getAttributesFromCollection(this.mongooseCollection));

        span.setAttribute(AttributeNames.DB_QUERY_TYPE, this.op)
        span.setAttribute(AttributeNames.DB_STATEMENT, safeStringify(this._conditions))
        span.setAttribute(AttributeNames.DB_OPTIONS, safeStringify(this.options))
        span.setAttribute(AttributeNames.DB_UPDATE, safeStringify(this._update))

        const queryResponse = originalExec.apply(this, arguments)
        return handleExecResponse(queryResponse, span, thisPlugin?._config?.enhancedDatabaseReporting);
      }
    }
  }

  private patchOnModelMethods(op: string) {
    const thisPlugin = this
    thisPlugin._logger.debug(`MongoosePlugin: patched mongoose Model ${op} prototype`);
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
        if(aggregate) aggregate[_STORED_PARENT_SPAN] = currentSpan;
        return aggregate;
      }
    }
  }

  private patchAndCaptureSpanContext(funcName: string) {
    const thisPlugin = this
    thisPlugin._logger.debug(`MongoosePlugin: patched mongoose query ${funcName} prototype`);
    return (original: Function) => {
      return function captureSpanContext(this: any) {
        this[_STORED_PARENT_SPAN] = thisPlugin._tracer.getCurrentSpan();
        return original.apply(this, arguments);
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
    shimmer.unwrap(this._moduleExports.Model, 'aggregate');

  }
}

export const plugin = new MongoosePlugin('mongoose');

