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
  return function(error: MongoError|Error): Promise<MongoError> {

    if (error instanceof MongoError) {
      span.setAttribute(AttributeNames.MONGO_ERROR_CODE, error.code);
    }

    setErrorStatus(span, error)

    return Promise.reject(error)
  }
}

export function setErrorStatus(span: Span, error: Error): Span {
  span.setStatus({
    code: CanonicalCode.UNKNOWN,
    message: error.message,
  });

  return span
}
