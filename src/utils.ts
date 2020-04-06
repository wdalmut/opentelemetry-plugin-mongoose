import { Tracer } from '@opentelemetry/api'
import { CanonicalCode, Span, SpanKind } from '@opentelemetry/api';
import { MongoError } from 'mongodb'
import { AttributeNames } from './enums';

export function startSpan(tracer: Tracer, name: string, op: string): Span {
  return tracer.startSpan(`mongoose.${name}.${op}`, {
    kind: SpanKind.CLIENT,
    attributes: {
      [AttributeNames.DB_MODEL_NAME]: name,
      [AttributeNames.DB_TYPE]: 'nosql',
      [AttributeNames.COMPONENT]: 'mongoose',
    },
  })
}

export function handleError(span: Span) {
  return function(error: MongoError): Promise<MongoError> {
    span.setAttribute(AttributeNames.MONGO_ERROR_CODE, error.code);

    span.setStatus({
      code: CanonicalCode.UNKNOWN,
      message: error.message,
    });

    return Promise.reject(error)
  }
}

